const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

/*
 * The editing engine's speed-ups must not move a single pixel: the masked steps are worked inside
 * the mask's box, the channel spread avoids numpy's slow 3-wide reduction. Each is run here in the
 * engine's own interpreter (backend/.venv-face) and compared bit for bit with the whole-frame
 * expression it replaced. Skipped where the face engine's environment is not installed.
 */
const backend = path.join(__dirname, "..");
const python = [path.join(backend, ".venv-face", "Scripts", "python.exe"), path.join(backend, ".venv-face", "bin", "python3")].find((candidate) => fs.existsSync(candidate));
const engine = path.join(backend, "src", "modules", "image-selection", "ai-editing", "edit_engine.py");

const SCRIPT = String.raw`
import importlib.util, json, sys
import numpy as np, cv2
spec = importlib.util.spec_from_file_location("edit_engine", sys.argv[1])
E = importlib.util.module_from_spec(spec); spec.loader.exec_module(E)
rng = np.random.default_rng(11)
out = {}

frame = rng.random((240, 320, 3), dtype=np.float32) * 1.4 - 0.2
out["spread"] = bool(np.array_equal(E.channel_spread(frame), frame.max(axis=2) - frame.min(axis=2)))
wide = frame.astype(np.float64)
out["spread64"] = bool(np.array_equal(E.channel_spread(wide), wide.max(axis=2) - wide.min(axis=2))) and E.channel_spread(wide).dtype == np.float64

def full(o, r, m):
    m = np.clip(m, 0, 1)[..., None]
    return o * (1 - m) + r * m

o = (rng.random((240, 320, 3), dtype=np.float32) * 255)
r = (rng.random((240, 320, 3), dtype=np.float32) * 300) - 20
mask = np.zeros((240, 320), np.float32); cv2.ellipse(mask, (60, 50), (30, 20), 0, 0, 360, 1.0, -1); mask = E.feather(mask, 7)
edge = np.zeros((240, 320), np.float32); edge[0:10, 300:320] = 1.0
cases = {"face-sized": mask, "at the frame edge": edge, "empty": np.zeros((240, 320), np.float32), "everywhere": np.full((240, 320), 0.4, np.float32)}
out["blend"] = {name: bool(np.array_equal(E.blend(o, r, m), full(o, r, m))) and E.blend(o, r, m).dtype == full(o, r, m).dtype for name, m in cases.items()}
promoted = mask.astype(np.float64)
out["blend_dtype"] = E.blend(o, r, promoted).dtype == full(o, r, promoted).dtype and bool(np.array_equal(E.blend(o, r, promoted), full(o, r, promoted)))
result = E.blend(o, r, cases["empty"]); out["blend_copy"] = result is not o and bool(np.array_equal(result, o))

out["box"] = [list(map(lambda s: [s.start, s.stop], E.mask_box(edge, 4))), E.mask_box(np.zeros((5, 5), np.float32)) is None]

# The eye pass: a blur of the box grown by EYE_BLUR_MARGIN equals the whole frame's blur under the mask.
img = (rng.random((240, 320, 3)) * 255).astype(np.uint8)
whole = cv2.GaussianBlur(img, (0, 0), 1.0)
def eye_blur_matches(points):
    eye = E.feather(E.polygon_mask(img.shape, np.array(points, np.float32), 4), 4)
    ys, xs = E.mask_box(eye, E.EYE_BLUR_MARGIN)
    local = cv2.GaussianBlur(img[ys, xs], (0, 0), 1.0)
    under = eye[ys, xs] > 0
    return bool(np.array_equal(whole[ys, xs][under], local[under]))
# Mid-frame, and an eye in the corner where the box is clamped to the frame's own edge.
out["eye_blur"] = eye_blur_matches([[100, 100], [130, 92], [160, 100], [130, 110]]) and eye_blur_matches([[0, 2], [20, 0], [40, 3], [20, 12]])
print(json.dumps(out))
`;

test("the editing engine's local and fast paths give exactly the whole-frame numbers", { skip: python ? false : "backend/.venv-face is not installed here" }, () => {
  const run = spawnSync(python, ["-I", "-c", SCRIPT, engine], { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, timeout: 120000 });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout.trim().split(/\r?\n/).pop());
  assert.equal(result.spread, true, "channel_spread equals max - min over the channels");
  assert.equal(result.spread64, true, "and keeps a float64 frame float64");
  assert.deepEqual(result.blend, { "face-sized": true, "at the frame edge": true, empty: true, everywhere: true });
  assert.equal(result.blend_dtype, true, "a float64 mask promotes the result exactly as before");
  assert.equal(result.blend_copy, true, "an empty mask answers a copy, never the caller's own array");
  assert.deepEqual(result.box, [[[0, 14], [296, 320]], true], "the box is grown by the pad and kept inside the frame");
  assert.equal(result.eye_blur, true, "the eye pass's blur reaches no further than its margin");
});

test("the engine keeps the whole-frame teeth colour pass: OpenCV's HSV round trip is not the same on a crop", () => {
  const source = fs.readFileSync(engine, "utf8");
  const teeth = source.slice(source.indexOf("def whiten_teeth"), source.indexOf("# ------------------------------------------------------------------------------ region retouching"));
  assert.match(teeth, /cv2\.cvtColor\(out\.clip\(0, 255\)\.astype\(np\.uint8\), cv2\.COLOR_BGR2HSV\)/);
  assert.doesNotMatch(teeth, /mask_box/);
});
