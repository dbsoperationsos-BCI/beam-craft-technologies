"""
The AI Feature's face engine: detect every face in a frame and describe each one with a vector.

Open-source models only. Detection is InsightFace's SCRFD-10G (`det_10g.onnx`) and recognition
its ArcFace ResNet-50 trained on WebFace600K (`w600k_r50.onnx`), the pair InsightFace ships as
"buffalo_l". Both files are fetched from the Hugging Face Hub (`public-data/insightface`) into
InsightFace's own model folder, so the library finds them without ever calling GitHub. Set
AI_FACE_MODEL_REPO to another Hub repository laid out the same way (`models/buffalo_l/*.onnx`).

Run as a long-lived subprocess by `engine.js` rather than once per photo: loading the two models
takes a second or two, and an event is thousands of photos. The protocol is one JSON object per
line on stdin and one per line on stdout; everything else goes to stderr.

    {"id": "...", "image": "<base64 jpeg/png/webp>"}
    {"id": "...", "width": W, "height": H, "faces": [{"box": [x1, y1, x2, y2], "detScore": f, "quality": f, "embedding": [f, ...]}]}

`quality` is a 0-1 score of how usable the face is for matching: how large it is in the frame,
the detector's own confidence and how frontal the pose is. The caller gates on it.

Face signals v2 (`signals: "face-v2@1"`, on unless AI_FACE_SIGNALS=v1) add measurements for photo
culling, each from a real model or a measurement, never a guess, and each present only when its
model is available - `capabilities` lists what this engine could measure:
  - "landmarks": InsightFace's 68-point 3D landmark model (`1k3d68.onnx`, the buffalo_l pack) -
    per face `eyes` {left, right: the eye aspect ratio of each eye from its six landmarks} and
    `pose` {pitch, yaw, roll} in degrees;
  - "expression": the ONNX Model Zoo FER+ classifier (`emotion-ferplus-8.onnx`, MIT) - per face
    `expression` {neutral, happiness, surprise, sadness, anger, disgust, fear, contempt}, the
    probability of each;
  - always: `sharpness` (the Laplacian measure inside the face, 0-100) and `brightness` (the
    face's mean luminance, 0-100).
The engine reports measurements; what they mean for a photograph is decided by its callers.

    python3 face_engine.py --check [--no-load]

is the health check the deploy and the repair script run: it imports every package, fetches the
model files if they are not on disk, loads the models and runs one detection, and prints one JSON
report on stdout - `{"ok": true, ...}` and exit 0, or `{"ok": false, "errors": [...]}` and exit 1
with a hint about what to install. `--no-load` stops after the imports and the file check.
"""

import base64
import contextlib
import importlib
import json
import os
import platform
import sys
import warnings

# Apple's bundled Python links LibreSSL, which urllib3 warns about on every import. The warning is
# right and harmless here - the Hub download is the only network call - so it is silenced rather
# than printed into the API's log at every boot.
warnings.filterwarnings("ignore", message="urllib3 v2 only supports OpenSSL")


DEFAULT_MODEL_NAME = "buffalo_l"
DEFAULT_MODEL_REPO = "public-data/insightface"
MODEL_NAME = os.environ.get("AI_FACE_MODEL_NAME") or DEFAULT_MODEL_NAME
MODEL_REPO = os.environ.get("AI_FACE_MODEL_REPO") or DEFAULT_MODEL_REPO
MODEL_FILES = ("det_10g.onnx", "w600k_r50.onnx")
# Pins describe the default repository only: a studio pointing AI_FACE_MODEL_REPO / _NAME at its own
# copy is not held to them. The revision is the Hub commit the files are fetched at (the repository's
# head when pinned); the digests are the Hub's own LFS sha256 for those files, both confirmed on
# 2026-10-07. A file already on disk is verified offline at load - no network is touched - and
# AI_FACE_VERIFY_MODELS=0 accepts a deliberately different local copy.
DEFAULT_MODELS = MODEL_REPO == DEFAULT_MODEL_REPO and MODEL_NAME == DEFAULT_MODEL_NAME
MODEL_REVISION = os.environ.get("AI_FACE_MODEL_REVISION") or ("33c1063c49c785b7652d3fd529f86fa4f149392b" if DEFAULT_MODELS else None)
VERIFY_MODELS = os.environ.get("AI_FACE_VERIFY_MODELS", "1").strip() != "0"
CORE_SHA256 = {
    "det_10g.onnx": "5838f7fe053675b1c7a08b633df49e7af5495cee0493c7dcf6697200b85b5b91",
    "w600k_r50.onnx": "4c06341c33c2ca1f86781dab0e829f88ad5b64be9fba56e56bc9ebdefc619e43",
}
DET_SIZE = int(os.environ.get("AI_FACE_DET_SIZE", "640"))
# Face signals v2: optional models. A missing one only removes its measurements; the engine and
# the People index keep working exactly as before.
FACE_V2 = os.environ.get("AI_FACE_SIGNALS", "v2").strip().lower() != "v1"
SIGNALS_VERSION = "face-v2@1"
LANDMARK_FILE = "1k3d68.onnx"
DEFAULT_EXPRESSION_REPO = "onnxmodelzoo/emotion-ferplus-8"
EXPRESSION_REPO = os.environ.get("AI_FACE_EXPRESSION_REPO") or DEFAULT_EXPRESSION_REPO
EXPRESSION_REVISION = os.environ.get("AI_FACE_EXPRESSION_REVISION") or ("4d016bfebdb4122b1f37511c5a9d40b5c87054a8" if EXPRESSION_REPO == DEFAULT_EXPRESSION_REPO else None)
EXPRESSION_FILE = "emotion-ferplus-8.onnx"
EXPRESSION_LABELS = ("neutral", "happiness", "surprise", "sadness", "anger", "disgust", "fear", "contempt")
# The expression model is kept out of InsightFace's own folder: InsightFace tries to load every
# model file it finds there.
# A managed runtime (the desktop app) installs these files itself, verified against the server's
# digests, and sets AI_FACE_OPTIONAL_DOWNLOAD=0: the engine then uses what is there and fetches nothing.
OPTIONAL_DOWNLOAD = os.environ.get("AI_FACE_OPTIONAL_DOWNLOAD", "1").strip() != "0"
# A fetched optional model is kept only with exactly these bytes (sha256): a substituted or
# corrupted download is deleted and its measurements stay off.
OPTIONAL_SHA256 = {
    "1k3d68.onnx": "df5c06b8a0c12e422b2ed8947b8869faa4105387f199c477af038aa01f9a45cc",
    "emotion-ferplus-8.onnx": "a2a2ba6a335a3b29c21acb6272f962bd3d47f84952aaffa03b60986e04efa61c",
}
_STATE = {"expression": None, "capabilities": []}


class ModelIntegrityError(RuntimeError):
    """A pinned model file on disk is not the file it is pinned to."""


def _sha256_of(path):
    import hashlib
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _pin_of(name, repo):
    """The pinned sha256 of `name` fetched from `repo`, or None when that repository is not pinned."""
    if repo == MODEL_REPO and DEFAULT_MODELS:
        return CORE_SHA256.get(name) or (OPTIONAL_SHA256[LANDMARK_FILE] if name == LANDMARK_FILE else None)
    if repo == EXPRESSION_REPO and EXPRESSION_REPO == DEFAULT_EXPRESSION_REPO and name == EXPRESSION_FILE:
        return OPTIONAL_SHA256[EXPRESSION_FILE]
    return None


def _verified(path, repo):
    """True when the file on disk is the pinned one (or nothing pins it, or verification is off)."""
    expected = _pin_of(os.path.basename(path), repo)
    return not VERIFY_MODELS or expected is None or _sha256_of(path) == expected


def log(message):
    print(f"[face-engine] {message}", file=sys.stderr, flush=True)


if not VERIFY_MODELS:
    log("model verification is OFF (AI_FACE_VERIFY_MODELS=0): model files on disk are loaded without checking their pinned digests")


def model_root():
    return os.path.join(os.path.expanduser(os.environ.get("INSIGHTFACE_HOME", "~/.insightface")), "models", MODEL_NAME)


def ensure_models():
    """Fetch the two ONNX files from the Hub (at the pinned revision) if they are not on disk, and
    verify every one against its pin. Raises ModelIntegrityError rather than load a substituted file."""
    root = model_root()
    for name in MODEL_FILES:
        target = os.path.join(root, name)
        if not os.path.exists(target):
            log(f"downloading {name} from {MODEL_REPO}{'@' + MODEL_REVISION[:8] if MODEL_REVISION else ''}")
            if not _fetch_pinned(MODEL_REPO, f"models/{MODEL_NAME}/{name}", target, MODEL_REVISION):
                raise ModelIntegrityError(f"{name} from {MODEL_REPO} does not match its pinned digest; it was discarded")
        elif not _verified(target, MODEL_REPO):
            raise ModelIntegrityError(f"{name} in {root} does not match its pinned digest - delete it to fetch it again, or set AI_FACE_VERIFY_MODELS=0 to use this copy")
    return root


def expression_root():
    return os.path.join(os.path.dirname(model_root()), "expression")


def _download(repo, filename, destination, revision=None):
    from huggingface_hub import hf_hub_download
    import shutil
    # hf_hub_download keeps its own cache; place a copy where the engine looks.
    shutil.copyfile(hf_hub_download(repo_id=repo, filename=filename, revision=revision), destination)


def _fetch_pinned(repo, filename, target, revision=None):
    """Download `filename` beside `target` and move it into place only when it matches its pin
    (a repository nothing pins is taken as it comes)."""
    os.makedirs(os.path.dirname(target), exist_ok=True)
    partial = target + ".part"
    try:
        _download(repo, filename, partial, revision=revision)
        expected = _pin_of(os.path.basename(target), repo)
        if expected is not None and _sha256_of(partial) != expected:
            log(f"{os.path.basename(target)} from {repo} does not match its pinned digest; discarded")
            return False
        os.replace(partial, target)
        return True
    finally:
        if os.path.exists(partial):
            os.remove(partial)


def ensure_optional_models():
    """The v2 models, fetched once if missing. Returns {name: present}; a failure is logged, never raised."""
    present = {"landmarks": False, "expression": False}
    if not FACE_V2:
        return present
    landmark = os.path.join(model_root(), LANDMARK_FILE)
    if not os.path.exists(landmark) and OPTIONAL_DOWNLOAD:
        try:
            log(f"downloading {LANDMARK_FILE} from {MODEL_REPO}")
            _fetch_pinned(MODEL_REPO, f"models/{MODEL_NAME}/{LANDMARK_FILE}", landmark, MODEL_REVISION)
        except Exception as error:  # noqa: BLE001
            log(f"landmarks unavailable ({type(error).__name__}: {error}); eyes and pose will not be measured")
    present["landmarks"] = os.path.exists(landmark) and _verified(landmark, MODEL_REPO)
    if os.path.exists(landmark) and not present["landmarks"]:
        # InsightFace parses every *.onnx in its folder before it filters by module, so a file that
        # failed its pin is moved aside (kept, never deleted) rather than left for it to load.
        os.replace(landmark, landmark + ".rejected")
        log(f"{LANDMARK_FILE} does not match its pinned digest; moved aside to {LANDMARK_FILE}.rejected - eyes and pose will not be measured")
    expression = os.path.join(expression_root(), EXPRESSION_FILE)
    if not os.path.exists(expression) and OPTIONAL_DOWNLOAD:
        try:
            log(f"downloading {EXPRESSION_FILE} from {EXPRESSION_REPO}")
            _fetch_pinned(EXPRESSION_REPO, EXPRESSION_FILE, expression, EXPRESSION_REVISION)
        except Exception as error:  # noqa: BLE001
            log(f"expression model unavailable ({type(error).__name__}: {error}); expressions will not be measured")
    present["expression"] = os.path.exists(expression) and _verified(expression, EXPRESSION_REPO)
    if os.path.exists(expression) and not present["expression"]:
        log(f"{EXPRESSION_FILE} does not match its pinned digest; expressions will not be measured")
    return present


def load_app():
    import cv2  # noqa: F401 - opencv-python-headless, the decoder insightface expects
    from insightface.app import FaceAnalysis
    ensure_models()
    optional = ensure_optional_models()
    modules = ["detection", "recognition"] + (["landmark_3d_68"] if optional["landmarks"] else [])
    _STATE["capabilities"] = [name for name, ok in optional.items() if ok]
    if optional["expression"]:
        try:
            import onnxruntime
            _STATE["expression"] = onnxruntime.InferenceSession(os.path.join(expression_root(), EXPRESSION_FILE), providers=["CPUExecutionProvider"])
        except Exception as error:  # noqa: BLE001
            log(f"expression model could not load ({type(error).__name__}: {error})")
            _STATE["capabilities"] = [name for name in _STATE["capabilities"] if name != "expression"]
    # InsightFace narrates its model loading with print(), which would land on the protocol
    # channel; stdout is the JSON line stream and nothing else, so its chatter goes to stderr.
    with contextlib.redirect_stdout(sys.stderr):
        # The same root ensure_models() checked: without it InsightFace falls back to ~/.insightface
        # and, finding nothing there, tries its own download - on a workstation whose managed models
        # live under INSIGHTFACE_HOME that would ignore the verified files entirely.
        app = FaceAnalysis(name=MODEL_NAME, root=os.path.expanduser(os.environ.get("INSIGHTFACE_HOME", "~/.insightface")), allowed_modules=modules, providers=["CPUExecutionProvider"])
        app.prepare(ctx_id=-1, det_size=(DET_SIZE, DET_SIZE))
    return app


def decode_image(data):
    import numpy as np
    import cv2
    raw = np.frombuffer(base64.b64decode(data), dtype=np.uint8)
    image = cv2.imdecode(raw, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("The image could not be decoded.")
    return image


def quality_of(face, width, height):
    x1, y1, x2, y2 = [float(v) for v in face.bbox]
    size = min(x2 - x1, y2 - y1) / max(1.0, min(width, height))
    size_score = min(1.0, size / 0.12)  # a face 12% of the short edge is "large enough"
    det = float(face.det_score)
    pose_score = 1.0
    if getattr(face, "pose", None) is not None:
        yaw, pitch = abs(float(face.pose[1])), abs(float(face.pose[0]))
        pose_score = max(0.0, 1.0 - max(yaw, pitch) / 60.0)
    elif getattr(face, "kps", None) is not None:
        # Without a pose estimate, the eye-to-nose symmetry stands in for yaw.
        kps = face.kps
        left, right, nose = kps[0], kps[1], kps[2]
        span = max(1.0, abs(right[0] - left[0]))
        offset = abs(((left[0] + right[0]) / 2.0) - nose[0]) / span
        pose_score = max(0.0, 1.0 - offset * 2.0)
    # Plain floats: numpy's float32 is not JSON serialisable and every term above may be one.
    return float(max(0.0, min(1.0, 0.45 * float(size_score) + 0.30 * float(det) + 0.25 * float(pose_score))))


def _eye_aspect_ratio(points):
    """The eye aspect ratio of one eye's six landmarks (p1..p6): (|p2-p6| + |p3-p5|) / (2 |p1-p4|)."""
    import numpy as np
    p = np.asarray(points, dtype=np.float64)[:, :2]
    width = np.linalg.norm(p[0] - p[3])
    if width <= 1e-6:
        return None
    return float((np.linalg.norm(p[1] - p[5]) + np.linalg.norm(p[2] - p[4])) / (2.0 * width))


def _crop(image, box, margin=0.0, square=False):
    height, width = image.shape[:2]
    x1, y1, x2, y2 = box
    w, h = x2 - x1, y2 - y1
    if square:
        side = max(w, h) * (1.0 + margin)
        cx, cy = (x1 + x2) / 2.0, (y1 + y2) / 2.0
        x1, x2, y1, y2 = cx - side / 2.0, cx + side / 2.0, cy - side / 2.0, cy + side / 2.0
    else:
        x1, x2, y1, y2 = x1 - w * margin, x2 + w * margin, y1 - h * margin, y2 + h * margin
    x1, y1 = max(0, int(round(x1))), max(0, int(round(y1)))
    x2, y2 = min(width, int(round(x2))), min(height, int(round(y2)))
    if x2 - x1 < 8 or y2 - y1 < 8:
        return None
    return image[y1:y2, x1:x2]


def _face_sharpness_brightness(image, box):
    """Sharpness (the Laplacian measure inside the face, at a fixed 128 px face height) and brightness, both 0-100."""
    import cv2
    crop = _crop(image, box)
    if crop is None:
        return None, None
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    scale = 128.0 / max(1, gray.shape[0])
    gray = cv2.resize(gray, (max(8, int(round(gray.shape[1] * scale))), 128), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC)
    variance = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    # Calibrated on real wedding faces (128 px face height): out-of-focus faces measure 13-44,
    # smooth newborn skin ~90-110, a crisp face ~455 (the median). x4 spreads them as ~14-27, ~39, ~85.
    sharpness = min(100.0, (variance ** 0.5) * 4.0)
    brightness = float(gray.mean()) / 255.0 * 100.0
    return round(sharpness, 1), round(brightness, 1)


def _expression(image, box):
    """FER+ probabilities for one face, or None when the model is not loaded."""
    session = _STATE["expression"]
    if session is None:
        return None
    import cv2
    import numpy as np
    crop = _crop(image, box, margin=0.1, square=True)
    if crop is None:
        return None
    gray = cv2.resize(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY), (64, 64), interpolation=cv2.INTER_AREA).astype(np.float32)
    logits = session.run(None, {session.get_inputs()[0].name: gray.reshape(1, 1, 64, 64)})[0].reshape(-1)
    exp = np.exp(logits - logits.max())
    probabilities = exp / exp.sum()
    return {label: round(float(value), 4) for label, value in zip(EXPRESSION_LABELS, probabilities)}


def describe(app, image, signals=True):
    """`signals=False` leaves out the per-face culling signals - sharpness, brightness, eyes, pose,
    expression - for a caller that only groups faces (the client gallery's People). Everything it does
    return is computed exactly as before: the same models run in `app.get`, so the box, the embedding
    and the quality (which reads the landmark pose) are identical; only the expression model and the
    crop measurements are skipped, which is most of the time a face costs after recognition."""
    height, width = image.shape[:2]
    faces = []
    for face in app.get(image):
        embedding = getattr(face, "normed_embedding", None)
        if embedding is None:
            continue
        x1, y1, x2, y2 = [float(v) for v in face.bbox]
        box = [max(0.0, x1), max(0.0, y1), min(float(width), x2), min(float(height), y2)]
        entry = {
            "box": box,
            "detScore": float(face.det_score),
            "quality": quality_of(face, width, height),
            "embedding": [float(v) for v in embedding],
        }
        if FACE_V2 and signals:
            sharpness, brightness = _face_sharpness_brightness(image, box)
            entry["sharpness"] = sharpness
            entry["brightness"] = brightness
            landmarks = getattr(face, "landmark_3d_68", None)
            if landmarks is not None and len(landmarks) >= 48:
                # iBUG 68 layout: points 36-41 are one eye, 42-47 the other.
                entry["eyes"] = {"left": _eye_aspect_ratio(landmarks[36:42]), "right": _eye_aspect_ratio(landmarks[42:48])}
            pose = getattr(face, "pose", None)
            if pose is not None:
                entry["pose"] = {"pitch": round(float(pose[0]), 1), "yaw": round(float(pose[1]), 1), "roll": round(float(pose[2]), 1)}
            expression = _expression(image, box)
            if expression is not None:
                entry["expression"] = expression
        faces.append(entry)
    result = {"width": int(width), "height": int(height), "faces": faces}
    if FACE_V2 and signals:
        result["signals"] = SIGNALS_VERSION
        result["capabilities"] = ["sharpness"] + _STATE["capabilities"]
    return result


# What the engine needs installed, as "module to import" -> "package that provides it". The check
# reports each one, so a report reads "cv2 is missing: opencv-python-headless" rather than a bare
# ModuleNotFoundError from somewhere inside insightface.
REQUIRED_MODULES = (("numpy", "numpy"), ("cv2", "opencv-python-headless"), ("onnxruntime", "onnxruntime"), ("insightface", "insightface"), ("huggingface_hub", "huggingface_hub"))
INSTALL_HINT = "run: bash backend/scripts/face-engine-setup.sh   (creates backend/.venv-face and installs backend/requirements-face.txt)"


def check(load=True):
    """The health report: imports, model files, and - unless `load` is false - the models loading and one detection."""
    report = {"ok": False, "python": sys.executable, "pythonVersion": platform.python_version(), "model": MODEL_NAME, "packages": {}, "models": {}, "errors": []}
    for module_name, package in REQUIRED_MODULES:
        try:
            with contextlib.redirect_stdout(sys.stderr):
                module = importlib.import_module(module_name)
            report["packages"][package] = str(getattr(module, "__version__", "present"))
        except Exception as error:  # noqa: BLE001
            report["packages"][package] = None
            report["errors"].append(f"{module_name} cannot be imported ({type(error).__name__}: {error}) - install {package}")
    if report["errors"]:
        report["hint"] = INSTALL_HINT
        return report
    try:
        root = ensure_models()
    except ModelIntegrityError as error:
        report["errors"].append(str(error))
        return report
    except Exception as error:  # noqa: BLE001
        report["errors"].append(f"model files could not be fetched from {MODEL_REPO}: {type(error).__name__}: {error}")
        report["hint"] = f"the server needs outbound HTTPS to huggingface.co once, or the files {', '.join(MODEL_FILES)} copied into {model_root()}"
        return report
    report["modelRoot"] = root
    report["modelsVerified"] = VERIFY_MODELS and DEFAULT_MODELS
    report["modelRevision"] = MODEL_REVISION
    for name in MODEL_FILES:
        report["models"][name] = os.path.exists(os.path.join(root, name))
    missing = [name for name, present in report["models"].items() if not present]
    if missing:
        report["errors"].append(f"model files missing in {root}: {', '.join(missing)}")
        return report
    if load:
        try:
            import numpy as np
            app = load_app()
            with contextlib.redirect_stdout(sys.stderr):
                faces = app.get(np.zeros((64, 64, 3), dtype=np.uint8))
            report["inference"] = f"ok ({len(faces)} faces in a blank frame)"
        except Exception as error:  # noqa: BLE001
            report["errors"].append(f"the models loaded from {root} but could not run: {type(error).__name__}: {error}")
            return report
    if FACE_V2:
        optional = ensure_optional_models()
        report["signals"] = SIGNALS_VERSION
        report["optionalModels"] = optional
    report["ok"] = True
    return report


def main():
    if "--check" in sys.argv[1:]:
        report = check(load="--no-load" not in sys.argv[1:])
        print(json.dumps(report), flush=True)
        return 0 if report["ok"] else 1
    try:
        app = load_app()
    except Exception as error:  # noqa: BLE001
        message = f"{type(error).__name__}: {error}"
        if isinstance(error, ModuleNotFoundError):
            message += f" - {INSTALL_HINT}"
        print(json.dumps({"ready": False, "error": message, "python": sys.executable}), flush=True)
        return 1
    print(json.dumps({"ready": True, "model": MODEL_NAME, "python": sys.executable, "signals": SIGNALS_VERSION if FACE_V2 else None, "capabilities": (["sharpness"] + _STATE["capabilities"]) if FACE_V2 else []}), flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            with contextlib.redirect_stdout(sys.stderr):
                result = describe(app, decode_image(request["image"]), signals=request.get("signals", True) is not False)
            print(json.dumps({"id": request_id, **result}), flush=True)
        except Exception as error:  # noqa: BLE001
            print(json.dumps({"id": request_id, "error": f"{type(error).__name__}: {error}"}), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
