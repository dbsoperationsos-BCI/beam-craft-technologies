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
"""

import base64
import contextlib
import json
import os
import sys
import warnings

# Apple's bundled Python links LibreSSL, which urllib3 warns about on every import. The warning is
# right and harmless here - the Hub download is the only network call - so it is silenced rather
# than printed into the API's log at every boot.
warnings.filterwarnings("ignore", message="urllib3 v2 only supports OpenSSL")


MODEL_NAME = os.environ.get("AI_FACE_MODEL_NAME", "buffalo_l")
MODEL_REPO = os.environ.get("AI_FACE_MODEL_REPO", "public-data/insightface")
MODEL_FILES = ("det_10g.onnx", "w600k_r50.onnx")
DET_SIZE = int(os.environ.get("AI_FACE_DET_SIZE", "640"))


def log(message):
    print(f"[face-engine] {message}", file=sys.stderr, flush=True)


def model_root():
    return os.path.join(os.path.expanduser(os.environ.get("INSIGHTFACE_HOME", "~/.insightface")), "models", MODEL_NAME)


def ensure_models():
    """Fetch the two ONNX files from the Hub if they are not already on disk."""
    root = model_root()
    missing = [name for name in MODEL_FILES if not os.path.exists(os.path.join(root, name))]
    if not missing:
        return root
    os.makedirs(root, exist_ok=True)
    from huggingface_hub import hf_hub_download
    for name in missing:
        log(f"downloading {name} from {MODEL_REPO}")
        path = hf_hub_download(repo_id=MODEL_REPO, filename=f"models/{MODEL_NAME}/{name}")
        # hf_hub_download keeps its own cache; place a copy where InsightFace looks.
        import shutil
        shutil.copyfile(path, os.path.join(root, name))
    return root


def load_app():
    import cv2  # noqa: F401 - opencv-python-headless, the decoder insightface expects
    from insightface.app import FaceAnalysis
    ensure_models()
    # InsightFace narrates its model loading with print(), which would land on the protocol
    # channel; stdout is the JSON line stream and nothing else, so its chatter goes to stderr.
    with contextlib.redirect_stdout(sys.stderr):
        app = FaceAnalysis(name=MODEL_NAME, allowed_modules=["detection", "recognition"], providers=["CPUExecutionProvider"])
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


def describe(app, image):
    height, width = image.shape[:2]
    faces = []
    for face in app.get(image):
        embedding = getattr(face, "normed_embedding", None)
        if embedding is None:
            continue
        x1, y1, x2, y2 = [float(v) for v in face.bbox]
        faces.append({
            "box": [max(0.0, x1), max(0.0, y1), min(float(width), x2), min(float(height), y2)],
            "detScore": float(face.det_score),
            "quality": quality_of(face, width, height),
            "embedding": [float(v) for v in embedding],
        })
    return {"width": int(width), "height": int(height), "faces": faces}


def main():
    try:
        app = load_app()
    except Exception as error:  # noqa: BLE001
        print(json.dumps({"ready": False, "error": f"{type(error).__name__}: {error}", "python": sys.executable}), flush=True)
        return 1
    print(json.dumps({"ready": True, "model": MODEL_NAME, "python": sys.executable}), flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            with contextlib.redirect_stdout(sys.stderr):
                result = describe(app, decode_image(request["image"]))
            print(json.dumps({"id": request_id, **result}), flush=True)
        except Exception as error:  # noqa: BLE001
            print(json.dumps({"id": request_id, "error": f"{type(error).__name__}: {error}"}), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
