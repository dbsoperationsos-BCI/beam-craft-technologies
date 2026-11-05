const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const engine = require("../src/modules/ai-feature/face-engine/engine");

/*
 * The face engine's environment is made by the deploy, never by hand. These pin the pieces that
 * make that true: the requirements name every package the engine imports (with the headless
 * OpenCV, not the desktop one), the setup script and the deploy call each other the way the docs
 * say, and the health report the deploy gates on has the shape it greps for.
 */
const BACKEND = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(BACKEND, relative), "utf8");

test("requirements-face.txt names every package the engine imports, with the headless OpenCV only", () => {
  const requirements = read("requirements-face.txt");
  const named = requirements.split("\n").filter((line) => line.trim() && !line.trim().startsWith("#")).map((line) => line.trim().split(/[<>=!~\s]/)[0].toLowerCase());
  for (const required of ["insightface", "onnxruntime", "opencv-python-headless", "numpy", "huggingface_hub", "onnx", "scipy", "scikit-image", "requests", "tqdm"]) assert.ok(named.includes(required), `${required} is missing from requirements-face.txt`);
  assert.ok(!named.includes("opencv-python"), "the desktop opencv-python must not be installed beside the headless build");
  assert.match(requirements, /^insightface==\d/m, "insightface is pinned to the version the engine was written against");
  // Every `import x` the Python engine performs is covered.
  const python = read("src/modules/ai-feature/face-engine/face_engine.py");
  const imported = new Set([...python.matchAll(/^\s*(?:from|import)\s+([a-zA-Z_]+)/gm)].map((match) => match[1]));
  const provides = { cv2: "opencv-python-headless", numpy: "numpy", insightface: "insightface", huggingface_hub: "huggingface_hub", onnxruntime: "onnxruntime" };
  for (const [module, pkg] of Object.entries(provides)) if (imported.has(module)) assert.ok(named.includes(pkg), `${module} is imported but ${pkg} is not in requirements-face.txt`);
});

test("the setup script exists, is executable, and does what a one-time server setup relies on", () => {
  const file = path.join(BACKEND, "scripts", "face-engine-setup.sh");
  // Windows has no execute bit to read, so the check is left to a Linux run, which is what the
  // server is: git records the script as 100755 and a Linux checkout makes it executable.
  if (process.platform !== "win32") assert.ok(fs.statSync(file).mode & 0o111, "face-engine-setup.sh must be executable");
  const script = fs.readFileSync(file, "utf8");
  assert.match(script, /set -euo pipefail/);
  assert.match(script, /\.venv-face/);
  assert.match(script, /requirements-face\.txt/);
  assert.match(script, /--no-deps/, "insightface is installed without its own dependency list, which would pull the desktop OpenCV in");
  assert.match(script, /"\$ENGINE" --check/, "the engine's own --check is what proves the environment");
  assert.match(script, /--skip-if-disabled/);
  assert.match(script, /python3-venv/, "a missing venv module is explained, not left as a bare error");
});

test("the deploy leaves the engine's environment to a one-time setup, and still gates on its health", () => {
  const deploy = fs.readFileSync(path.join(BACKEND, "..", ".github", "workflows", "deploy.yml"), "utf8");
  // Rebuilding .venv-face every night took minutes of CPU inside the deploy's timeout and was part
  // of the 2026-09-24 half-finished deploy. The only mention left is the repair hint.
  assert.doesNotMatch(deploy, /bash "\$APP_PATH\/backend\/scripts\/face-engine-setup\.sh"/, "deploy.yml must not rebuild the face engine's environment on every deploy");
  assert.match(deploy, /"faceEngine":"/, "the health check reads the face engine's state from /api/health");
  assert.match(deploy, /ready\) echo "Face engine is ready\."/);
});

test("the health report is cheap, never throws, and reads disabled / not-started / offline as the deploy expects", () => {
  const previous = process.env.AI_FACE_ENGINE_ENABLED;
  try {
    engine._resetForTests();
    delete process.env.AI_FACE_ENGINE_ENABLED;
    let health = engine.health();
    assert.equal(health.status, "disabled");
    assert.equal(health.reason, null);
    assert.ok(health.venv.path.endsWith(path.join("backend", ".venv-face")), `venv path is backend/.venv-face, got ${health.venv.path}`);
    assert.ok(!health.venv.path.includes(path.join("backend", "backend")), "the path must not double the backend folder");
    assert.deepEqual(Object.keys(health.models.files).sort(), ["det_10g.onnx", "w600k_r50.onnx"]);
    process.env.AI_FACE_ENGINE_ENABLED = "true";
    health = engine.health();
    assert.equal(health.status, "not-started");
    assert.match(health.reason, /No worker/);
  } finally {
    engine._resetForTests();
    if (previous === undefined) delete process.env.AI_FACE_ENGINE_ENABLED; else process.env.AI_FACE_ENGINE_ENABLED = previous;
  }
});

test("face_engine.py compiles and its --check refuses cleanly without the packages", { skip: spawnSync("python3", ["--version"]).status !== 0 && "no python3 on this machine" }, () => {
  const script = path.join(BACKEND, "src", "modules", "ai-feature", "face-engine", "face_engine.py");
  assert.equal(spawnSync("python3", ["-m", "py_compile", script], { encoding: "utf8" }).status, 0);
  // `-S` skips the site module, so no site-packages at all: a machine with nothing installed, even
  // when the python3 on this PATH is a virtualenv that has everything.
  const probe = spawnSync("python3", ["-S", "-I", script, "--check", "--no-load"], { encoding: "utf8", timeout: 60_000 });
  assert.equal(probe.status, 1);
  const report = JSON.parse(probe.stdout.trim().split("\n").pop());
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((line) => /opencv-python-headless|numpy|insightface/.test(line)), JSON.stringify(report.errors));
  assert.match(report.hint, /face-engine-setup\.sh/);
});
