const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * The client gallery's People and Scene filters, made faster without changing what they show.
 *
 *   - Faces: the gallery's face scan asks the engine for faces only (`{ signals: false }`) - box,
 *     embedding, quality - and skips the per-face culling signals (expression, sharpness, eyes) it
 *     never reads. Measured on real previews: ~1.24 s -> ~0.80 s a photo, the same boxes, embeddings
 *     and quality to the bit. The landmark model still runs, because quality reads its head pose.
 *     AI Culling, AI Feature and every other caller still get every signal.
 *   - Scenes: read from the moment the gallery is published, not from the client's first look.
 */

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", "modules", ...parts), "utf8");

test("only the gallery's face scan asks for faces only; every other caller keeps the signals", () => {
  const galleryEngine = read("image-selection", "faces", "engine.js");
  assert.match(galleryEngine, /engine\.describe\(buffer, \{ signals: false \}\)/);
  const shared = read("ai-feature", "face-engine", "engine.js");
  assert.match(shared, /async function describe\(buffer, \{ signals = true \} = \{\}\)/, "full signals unless asked otherwise");
  // The flag goes on the wire only when it is false, so a default request is byte-for-byte as before.
  assert.match(shared, /\.\.\.\(signals \? \{\} : \{ signals: false \}\)/);
  for (const caller of [["image-selection", "ai-culling", "providers", "insightface.provider.js"], ["ai-feature", "processing", "service.js"], ["ai-feature", "public", "service.js"]]) {
    assert.doesNotMatch(read(...caller), /signals: false/, caller.join("/"));
  }
});

test("the engine skips only the culling signals - the models that decide box, embedding and quality still run", () => {
  const py = read("ai-feature", "face-engine", "face_engine.py");
  assert.match(py, /def describe\(app, image, signals=True\):/);
  assert.match(py, /if FACE_V2 and signals:\n            sharpness, brightness = _face_sharpness_brightness\(image, box\)/);
  assert.match(py, /signals=request\.get\("signals", True\) is not False/);
  // Quality is still worked out from the landmark pose: the landmark module is not taken out of `app.get`.
  assert.match(py, /modules = \["detection", "recognition"\] \+ \(\["landmark_3d_68"\] if optional\["landmarks"\] else \[\]\)/);
  assert.match(py, /"quality": quality_of\(face, width, height\),/);
});

test("publishing a gallery starts reading its scenes, on both ways publish succeeds, and never fails the publish", () => {
  const service = read("image-selection", "publication", "service.js");
  const publish = service.slice(service.indexOf("async function publish("), service.indexOf("async function revoke("));
  assert.equal((publish.match(/readScenesAhead\(projectId\);/g) || []).length, 2, "a fresh publish and an already-published one");
  const helper = service.slice(service.indexOf("function readScenesAhead("), service.indexOf("async function publish("));
  assert.match(helper, /require\("\.\.\/ai-culling\/scene\/backfill"\)\.pending\(projectId\)\.catch\(/, "the gallery's own pass, never awaited");
  assert.match(helper, /\} catch \(error\) \{/);
});
