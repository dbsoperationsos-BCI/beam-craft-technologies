const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

/*
 * Culling V2: the face engine's optional models (68-point landmarks, FER+ expression) are fetched
 * from the Hub only when missing, and a fetched file is kept only when its sha256 is the pinned
 * one - a tampered or substituted download is deleted and its measurements stay off.
 */
const ENGINE = path.join(__dirname, "..", "src", "modules", "ai-feature", "face-engine", "face_engine.py");
const source = fs.readFileSync(ENGINE, "utf8");

test("the optional models carry pinned sha256 digests", () => {
  assert.match(source, /"1k3d68\.onnx": "df5c06b8a0c12e422b2ed8947b8869faa4105387f199c477af038aa01f9a45cc"/);
  assert.match(source, /"emotion-ferplus-8\.onnx": "a2a2ba6a335a3b29c21acb6272f962bd3d47f84952aaffa03b60986e04efa61c"/);
});

test("a fetched file whose digest does not match is deleted, never kept", (t) => {
  const python = ["python", "python3", "py"].find((bin) => spawnSync(bin, ["--version"]).status === 0);
  if (!python) return t.skip("no Python on this machine");
  const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "pins-"));
  const script = `
import importlib.util, os, sys
spec = importlib.util.spec_from_file_location("face_engine", ${JSON.stringify(ENGINE)})
engine = importlib.util.module_from_spec(spec); spec.loader.exec_module(engine)
target = os.path.join(${JSON.stringify(tmp)}, "emotion-ferplus-8.onnx")
def fake(repo, filename, destination, revision=None):
    open(destination, "wb").write(b"not the model")
engine._download = fake
print(engine._fetch_pinned(engine.EXPRESSION_REPO, "emotion-ferplus-8.onnx", target), os.path.exists(target))
`;
  const run = spawnSync(python, ["-c", script], { encoding: "utf8" });
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), "False False");
});

/*
 * Production readiness: the core buffalo_l files are pinned too - to the Hub revision they are
 * fetched at and to their sha256 (both confirmed against the Hub's own LFS metadata on 2026-10-07)
 * - and a file already on disk is verified offline at load, so a substituted model never runs.
 */
function runEngine(t, script, env = {}) {
  const python = ["python", "python3", "py"].find((bin) => spawnSync(bin, ["--version"]).status === 0);
  if (!python) { t.skip("no Python on this machine"); return null; }
  const prelude = `
import importlib.util, os, sys, json
spec = importlib.util.spec_from_file_location("face_engine", ${JSON.stringify(ENGINE)})
engine = importlib.util.module_from_spec(spec); spec.loader.exec_module(engine)
`;
  const run = spawnSync(python, ["-c", prelude + script], { encoding: "utf8", env: { ...process.env, AI_FACE_MODEL_REPO: "", AI_FACE_MODEL_NAME: "", AI_FACE_MODEL_REVISION: "", AI_FACE_VERIFY_MODELS: "", ...env } });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim();
}

test("the core models and the Hub revisions are pinned", () => {
  assert.match(source, /"det_10g\.onnx": "5838f7fe053675b1c7a08b633df49e7af5495cee0493c7dcf6697200b85b5b91"/);
  assert.match(source, /"w600k_r50\.onnx": "4c06341c33c2ca1f86781dab0e829f88ad5b64be9fba56e56bc9ebdefc619e43"/);
  assert.match(source, /33c1063c49c785b7652d3fd529f86fa4f149392b/);
  assert.match(source, /4d016bfebdb4122b1f37511c5a9d40b5c87054a8/);
});

test("a substituted core model on disk stops the engine; verification can be switched off; a custom repo is unpinned", (t) => {
  const home = fs.mkdtempSync(path.join(require("os").tmpdir(), "core-"));
  const root = path.join(home, "models", "buffalo_l");
  fs.mkdirSync(root, { recursive: true });
  for (const name of ["det_10g.onnx", "w600k_r50.onnx"]) fs.writeFileSync(path.join(root, name), "not the model");
  const probe = `
try:
    engine.ensure_models(); print("loaded")
except engine.ModelIntegrityError as error:
    print("refused", "det_10g.onnx" in str(error) or "w600k_r50.onnx" in str(error))
`;
  try {
    const refused = runEngine(t, probe, { INSIGHTFACE_HOME: home });
    if (refused === null) return;
    assert.equal(refused, "refused True");
    assert.equal(runEngine(t, probe, { INSIGHTFACE_HOME: home, AI_FACE_VERIFY_MODELS: "0" }), "loaded", "the escape hatch for a deliberately different local copy");
    assert.equal(runEngine(t, probe, { INSIGHTFACE_HOME: home, AI_FACE_MODEL_REPO: "studio/own-models" }), "loaded", "pins describe the default repository only");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("a download asks for the pinned revision, and a custom repo for its own or the latest", (t) => {
  const probe = `
seen = []
def fake(repo, filename, destination, revision=None):
    seen.append(revision); open(destination, "wb").write(b"x")
engine._download = fake
import tempfile
target = os.path.join(tempfile.mkdtemp(), "emotion-ferplus-8.onnx")
engine._fetch_pinned(engine.EXPRESSION_REPO, "emotion-ferplus-8.onnx", target, engine.EXPRESSION_REVISION)
print(json.dumps(seen))
`;
  const pinned = runEngine(t, probe);
  if (pinned === null) return;
  assert.deepEqual(JSON.parse(pinned), ["4d016bfebdb4122b1f37511c5a9d40b5c87054a8"]);
  assert.deepEqual(JSON.parse(runEngine(t, probe, { AI_FACE_EXPRESSION_REPO: "studio/expr", AI_FACE_EXPRESSION_REVISION: "" })), [null]);
});

test("a substituted optional model is moved out of InsightFace's way, never left for it to parse", (t) => {
  const home = fs.mkdtempSync(path.join(require("os").tmpdir(), "optional-"));
  const root = path.join(home, "models", "buffalo_l");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "1k3d68.onnx"), "not the landmark model");
  try {
    const out = runEngine(t, "print(json.dumps(engine.ensure_optional_models()))", { INSIGHTFACE_HOME: home, AI_FACE_OPTIONAL_DOWNLOAD: "0" });
    if (out === null) return;
    assert.equal(JSON.parse(out).landmarks, false);
    assert.equal(fs.existsSync(path.join(root, "1k3d68.onnx")), false, "no longer where InsightFace globs *.onnx");
    assert.equal(fs.existsSync(path.join(root, "1k3d68.onnx.rejected")), true, "kept aside, not deleted");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("switching verification off is said out loud at start", () => {
  assert.match(source, /if not VERIFY_MODELS:\s*\n\s*log\("model verification is OFF/);
});
