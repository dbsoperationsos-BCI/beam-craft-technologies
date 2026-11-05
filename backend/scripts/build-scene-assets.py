"""Build the culling scene engine's data files from its profile. Developer tool, never run in
production: the files it writes are committed and read by scene_engine.py.

    python backend/scripts/build-scene-assets.py [profile=event]

Needs, in the interpreter that runs it: onnxruntime, numpy, huggingface_hub and `tokenizers`
(only this script needs tokenizers). It downloads the CLIP ViT-B/32 *text* tower once (pinned
revision, about 250 MB, never shipped) to embed every prompt of the profile, averages each scene's
prompts into one unit vector, and writes

    scene/assets/scene-labels.<profile>.clip-b32.json   { revision, profile, version, scenes: [{ id, label, accidental, vector[512] }] }
    scene/assets/aesthetic-head.clip-b32.json           LAION aesthetic predictor (MIT), Linear(512 -> 1) on the unit image embedding

The aesthetic head is converted from LAION-AI/aesthetic-predictor `sa_0_4_vit_b_32_linear.pth` (a
PyTorch zip) without needing torch: its two tensors are raw little-endian float32 storages.
"""
import hashlib, io, json, os, sys, urllib.request, zipfile
import numpy as np
import onnxruntime as ort
from huggingface_hub import hf_hub_download
from tokenizers import Tokenizer

REPO = "Xenova/clip-vit-base-patch32"
REVISION = "d15189d7028b43f1d3e65039190477f6af591c2a"
# Pinned to a commit and a checksum: the weights are committed as JSON, so they must be exactly these.
AESTHETIC_URL = "https://github.com/LAION-AI/aesthetic-predictor/raw/814214009feff106add4bb983807704ccdd5a0db/sa_0_4_vit_b_32_linear.pth"
AESTHETIC_SHA256 = "c7b14cead230694acc7b9447974d3cad78003c72da032e402a303b6c2429e85f"
HERE = os.path.dirname(os.path.abspath(__file__))
SCENE_DIR = os.path.join(HERE, "..", "src", "modules", "image-selection", "ai-culling", "scene")


def unit(vector):
    vector = np.asarray(vector, dtype=np.float64)
    return vector / (np.linalg.norm(vector) or 1.0)


def embed_prompts(prompts):
    tokenizer = Tokenizer.from_file(hf_hub_download(REPO, "tokenizer.json", revision=REVISION))
    session = ort.InferenceSession(hf_hub_download(REPO, "onnx/text_model.onnx", revision=REVISION), providers=["CPUExecutionProvider"])
    names = [i.name for i in session.get_inputs()]
    out = []
    for prompt in prompts:
        ids = tokenizer.encode(prompt).ids[:77]
        ids = ids + [ids[-1]] * (77 - len(ids)) if "attention_mask" not in names else ids
        feed = {"input_ids": np.array([ids], dtype=np.int64)}
        if "attention_mask" in names:
            feed["attention_mask"] = np.ones((1, len(ids)), dtype=np.int64)
        outputs = dict(zip([o.name for o in session.get_outputs()], session.run(None, feed)))
        out.append(unit(outputs["text_embeds"][0]))
    return out


def aesthetic_head():
    raw = urllib.request.urlopen(AESTHETIC_URL, timeout=60).read()
    if hashlib.sha256(raw).hexdigest() != AESTHETIC_SHA256:
        raise SystemExit("the aesthetic head does not match its pinned checksum")
    archive = zipfile.ZipFile(io.BytesIO(raw))
    storages = sorted((name for name in archive.namelist() if "/data/" in name and not name.endswith("/")), key=lambda name: int(name.rsplit("/", 1)[1]))
    tensors = [np.frombuffer(archive.read(name), dtype="<f4") for name in storages]
    weight = next(t for t in tensors if t.size == 512)
    bias = next(t for t in tensors if t.size == 1)
    return {"source": "LAION-AI/aesthetic-predictor sa_0_4_vit_b_32_linear.pth (MIT)", "input": "unit CLIP ViT-B/32 image embedding", "weight": [round(float(v), 7) for v in weight], "bias": round(float(bias[0]), 7)}


def main():
    profile_id = sys.argv[1] if len(sys.argv) > 1 else "event"
    profile = json.load(open(os.path.join(SCENE_DIR, "profiles", f"{profile_id}.json"), encoding="utf-8"))
    scenes = []
    for scene in profile["scenes"]:
        vectors = embed_prompts(scene["prompts"])
        scenes.append({"id": scene["id"], "label": scene["label"], "accidental": bool(scene.get("accidental")), "vector": [round(float(v), 6) for v in unit(np.mean(vectors, axis=0))]})
        print(f"  {scene['id']}: {len(vectors)} prompts", file=sys.stderr)
    labels = {"model": f"{REPO}@{REVISION}", "profile": profile_id, "version": profile["version"], "scenes": scenes}
    os.makedirs(os.path.join(SCENE_DIR, "assets"), exist_ok=True)
    with open(os.path.join(SCENE_DIR, "assets", f"scene-labels.{profile_id}.clip-b32.json"), "w", encoding="utf-8", newline="\n") as handle:
        json.dump(labels, handle, separators=(",", ":"))
    with open(os.path.join(SCENE_DIR, "assets", "aesthetic-head.clip-b32.json"), "w", encoding="utf-8", newline="\n") as handle:
        json.dump(aesthetic_head(), handle, separators=(",", ":"))
    print("written", file=sys.stderr)


if __name__ == "__main__":
    main()
