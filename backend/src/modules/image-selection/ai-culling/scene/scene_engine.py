"""The culling scene engine: one long-lived process per worker, spoken to over JSON lines, the
same contract as the face engine (ai-feature/face-engine/face_engine.py).

For each photo - always a PREVIEW derivative, never an original - it computes one CLIP ViT-B/32
image embedding (the int8-quantized vision tower, CPU by default, CUDA when onnxruntime offers it)
and from that one vector three things:

  - the scene: cosine similarity against the profile's scene vectors (assets/scene-labels.*.json,
    built by scripts/build-scene-assets.py), softmaxed at CLIP's logit scale; the top three come
    back with probabilities, and an `accidental` flag when the top scene is the profile's
    accidental-frame scene;
  - the aesthetic score: the LAION aesthetic predictor's linear head on the unit embedding
    (assets/aesthetic-head.clip-b32.json, MIT), on its own roughly 1-10 scale;
  - the embedding itself, quantized to int8 and base64-encoded (684 characters), for the caches
    and later phases.

Protocol. On start it prints one line: {"ready": true, "model", "profile", "providers"} or
{"ready": false, "error"}. Then each request line {"id", "images": [base64, ...]} (at most 16)
is answered {"id", "results": [{...} | {"error"}]} in order; a photo that cannot be decoded fails
alone. Nothing is written anywhere except the one-time model download into AI_SCENE_MODEL_DIR.

Environment: AI_SCENE_MODEL_DIR (default ~/.cache/dbs-culling-scene), AI_SCENE_PROFILE
(default event), AI_SCENE_THREADS (default min(4, cores)), AI_SCENE_DEVICE (auto | cpu).
"""
import base64, hashlib, json, os, re, sys

REPO = "Xenova/clip-vit-base-patch32"
REVISION = "d15189d7028b43f1d3e65039190477f6af591c2a"
MODEL_FILE = "onnx/vision_model_quantized.onnx"
MODEL_SHA256 = "583fd1110a514667812fee7d684952aaf82a99b959760c8d7dca7e0ab9839299"
MODEL_NAME = "clip-vit-b32-int8"
LOGIT_SCALE = 100.0
MAX_BATCH = 16
MEAN = (0.48145466, 0.4578275, 0.40821073)
STD = (0.26862954, 0.26130258, 0.27577711)
HERE = os.path.dirname(os.path.abspath(__file__))


def log(message):
    print(f"[scene-engine] {message}", file=sys.stderr, flush=True)


def model_dir():
    return os.environ.get("AI_SCENE_MODEL_DIR") or os.path.join(os.path.expanduser("~"), ".cache", "dbs-culling-scene")


def sha256_of(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ensure_model():
    """The pinned vision tower, fetched once and verified; a file that does not verify is never run."""
    target = os.path.join(model_dir(), MODEL_NAME + ".onnx")
    if os.path.exists(target) and sha256_of(target) == MODEL_SHA256:
        return target
    from huggingface_hub import hf_hub_download
    os.makedirs(model_dir(), exist_ok=True)
    log(f"downloading {REPO}/{MODEL_FILE} (about 89 MB, once)")
    fetched = hf_hub_download(REPO, MODEL_FILE, revision=REVISION, cache_dir=os.path.join(model_dir(), "hub"))
    if sha256_of(fetched) != MODEL_SHA256:
        raise RuntimeError("the downloaded scene model does not match its pinned checksum")
    with open(fetched, "rb") as source, open(target + ".part", "wb") as out:
        for chunk in iter(lambda: source.read(1 << 20), b""):
            out.write(chunk)
    os.replace(target + ".part", target)
    return target


def load_assets(profile):
    # The profile id comes from the operator's environment; it still only ever names a file here.
    profile = re.sub(r"[^a-z0-9_-]", "", profile, flags=re.I) or "event"
    raw_labels = open(os.path.join(HERE, "assets", f"scene-labels.{profile}.clip-b32.json"), "rb").read()
    raw_head = open(os.path.join(HERE, "assets", "aesthetic-head.clip-b32.json"), "rb").read()
    # Any change to either asset changes the engine version a run records, and so the cache key:
    # a reading is never reused across different labels or a different aesthetic head.
    digest = hashlib.sha256(raw_labels + raw_head).hexdigest()[:8]
    return json.loads(raw_labels), json.loads(raw_head), digest


def providers_for(ort):
    available = ort.get_available_providers()
    if os.environ.get("AI_SCENE_DEVICE", "auto") != "cpu" and "CUDAExecutionProvider" in available:
        return ["CUDAExecutionProvider", "CPUExecutionProvider"]
    return ["CPUExecutionProvider"]


class Engine:
    def __init__(self, model_path, profile="event"):
        import numpy as np
        import onnxruntime as ort
        self.np = np
        options = ort.SessionOptions()
        options.intra_op_num_threads = int(os.environ.get("AI_SCENE_THREADS") or min(4, os.cpu_count() or 1))
        self.session = ort.InferenceSession(model_path, sess_options=options, providers=providers_for(ort))
        self.providers = self.session.get_providers()
        self.input = self.session.get_inputs()[0].name
        names = [output.name for output in self.session.get_outputs()]
        self.output = "image_embeds" if "image_embeds" in names else names[0]
        labels, head, digest = load_assets(profile)
        self.profile = f"{labels['profile']}@{labels['version']}#{digest}"
        self.scenes = labels["scenes"]
        self.scene_matrix = np.array([scene["vector"] for scene in self.scenes], dtype=np.float32)
        self.head_weight = np.array(head["weight"], dtype=np.float32)
        self.head_bias = float(head["bias"])

    def preprocess(self, data):
        import cv2
        np = self.np
        image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("the image could not be decoded")
        image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        height, width = image.shape[:2]
        scale = 224.0 / min(height, width)
        resized = cv2.resize(image, (max(224, round(width * scale)), max(224, round(height * scale))), interpolation=cv2.INTER_CUBIC)
        top = (resized.shape[0] - 224) // 2
        left = (resized.shape[1] - 224) // 2
        crop = resized[top:top + 224, left:left + 224].astype(np.float32) / 255.0
        crop = (crop - np.array(MEAN, dtype=np.float32)) / np.array(STD, dtype=np.float32)
        return crop.transpose(2, 0, 1)

    def analyze_batch(self, payloads):
        np = self.np
        results = [None] * len(payloads)
        frames, slots = [], []
        for index, data in enumerate(payloads):
            try:
                frames.append(self.preprocess(data))
                slots.append(index)
            except Exception as error:  # one bad photo never fails its neighbours
                results[index] = {"error": str(error)}
        if frames:
            embeds = self.session.run([self.output], {self.input: np.stack(frames).astype(np.float32)})[0]
            for slot, vector in zip(slots, embeds):
                results[slot] = self.describe(vector)
        return results

    def describe(self, vector):
        np = self.np
        unit = vector / (np.linalg.norm(vector) or 1.0)
        logits = self.scene_matrix @ unit * LOGIT_SCALE
        probabilities = np.exp(logits - logits.max())
        probabilities /= probabilities.sum()
        order = np.argsort(-probabilities)[:3]
        top = [{"id": self.scenes[i]["id"], "p": round(float(probabilities[i]), 4)} for i in order]
        quantized = np.clip(np.round(unit * 127.0), -127, 127).astype(np.int8)
        return {
            "scenes": top,
            "scene": top[0]["id"],
            "confidence": top[0]["p"],
            "accidental": bool(self.scenes[order[0]].get("accidental")),
            "aesthetic": round(float(unit @ self.head_weight + self.head_bias), 4),
            "embedding": base64.b64encode(quantized.tobytes()).decode("ascii"),
        }


def main():
    try:
        engine = Engine(ensure_model(), os.environ.get("AI_SCENE_PROFILE", "event"))
    except Exception as error:
        print(json.dumps({"ready": False, "error": str(error)}), flush=True)
        return
    print(json.dumps({"ready": True, "model": f"{MODEL_NAME}@{REVISION[:8]}", "profile": engine.profile, "providers": engine.providers, "python": sys.executable}), flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            images = request.get("images") or []
            if len(images) > MAX_BATCH:
                raise ValueError(f"at most {MAX_BATCH} images per request")
            results = engine.analyze_batch([base64.b64decode(image) for image in images])
            print(json.dumps({"id": request_id, "results": results}), flush=True)
        except Exception as error:
            print(json.dumps({"id": request_id, "error": str(error)}), flush=True)


if __name__ == "__main__":
    main()
