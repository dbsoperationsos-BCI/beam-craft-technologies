const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { FEATURE_NAMES } = require("../src/modules/image-selection/ai-culling/learning/featureSet");
const { loadTreeModel } = require("../src/modules/image-selection/ai-culling/learning/treeModel");
const { prepareBundle, decideRun } = require("../src/modules/image-selection/ai-culling/learning/scorer");

// The server evaluates LightGBM's own dump in JS: this trains a real model (synthetic data) with
// the Python pipeline and checks every JS prediction against LightGBM's. Needs the training
// environment (backend/.venv-ml); skipped where it is not installed, as in CI.
const python = path.join(__dirname, "..", ".venv-ml", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const available = fs.existsSync(python);

test("JS tree evaluation matches LightGBM on a trained bundle", { skip: available ? false : "backend/.venv-ml not installed" }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "culling-parity-"));
  const names = path.join(tmp, "names.json");
  fs.writeFileSync(names, JSON.stringify(FEATURE_NAMES));
  const cwd = path.join(__dirname, "..", "ml", "culling");
  const run = (args) => { const out = spawnSync(python, args, { cwd, encoding: "utf8" }); assert.equal(out.status, 0, out.stderr); return out.stdout; };
  run(["-m", "culling_ml.synth", "--out", path.join(tmp, "data"), "--version", "parity", "--feature-names", names, "--projects", "60"]);
  run(["-m", "culling_ml.train", "--dataset", path.join(tmp, "data", "parity"), "--out", path.join(tmp, "models"), "--version", "0.0.1"]);
  const dir = path.join(tmp, "models", "culling-ranker", "0.0.1");
  const bundle = JSON.parse(fs.readFileSync(path.join(dir, "bundle.json"), "utf8"));
  const sample = JSON.parse(fs.readFileSync(path.join(dir, "predictions_sample.json"), "utf8"));
  const global = loadTreeModel(bundle.global);
  const burst = bundle.burst ? loadTreeModel(bundle.burst) : null;
  let worst = 0;
  for (const entry of sample) {
    worst = Math.max(worst, Math.abs(global.raw(entry.features) - entry.raw), Math.abs(global.predict(entry.features) - entry.p));
    if (burst) worst = Math.max(worst, Math.abs(burst.raw(entry.features) - entry.burst));
  }
  assert.ok(worst < 1e-9, `largest difference ${worst}`);
  assert.ok(sample.length >= 100);
  // And the bundle drives today's decision code end to end.
  const prepared = prepareBundle(bundle);
  const rows = sample.slice(0, 20).map((entry, index) => ({ id: `r${index}`, uploadId: `u${index}`, reasonCodes: [], technicalScore: entry.features[0], blurScore: entry.features[1], exposureScore: entry.features[2] }));
  const decided = decideRun(rows, prepared, { mode: "BALANCED" });
  assert.equal(decided.updates.length, 20);
  assert.ok(decided.updates.every((update) => ["KEEP", "MAYBE", "REJECT"].includes(update.aiDecision)));
  fs.rmSync(tmp, { recursive: true, force: true });
});
