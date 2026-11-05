const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createSceneEngine, MAX_BATCH } = require("../src/modules/image-selection/ai-culling/scene/engine");

/*
 * The scene engine's Node client over a fake engine that speaks the same protocol. What is
 * pinned: the switch, the version a run records, batching, a photo that fails alone, and that a
 * missing or dying engine becomes a reason string — never a crash of the worker.
 */
// The fake engine is written to a temp folder at load: a script under test/ would itself be run
// as a test file by `node --test` (and wait on stdin forever).
const fs = require("node:fs");
const os = require("node:os");
const FAKE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fake-scene-engine-")), "fake-scene-engine.js");
fs.writeFileSync(FAKE, `// A stand-in for scene_engine.py speaking the same JSON-lines protocol.
// FAKE_SCENE_MODE: ready (default) | not-ready | never-ready | slow | delay | crash-after-ready
const readline = require("node:readline");
const mode = process.env.FAKE_SCENE_MODE || "ready";
if (mode === "not-ready") { console.log(JSON.stringify({ ready: false, error: "C:/secret/path/model missing" })); process.exit(0); }
if (mode === "never-ready") { setInterval(() => {}, 1000); }
else {
  console.log(JSON.stringify({ ready: true, model: "fake-clip@00000000", profile: process.env.JWT_SECRET ? "leaked@1" : "event@1", providers: ["CPUExecutionProvider"] }));
  if (mode === "crash-after-ready") setTimeout(() => process.exit(3), 50);
  readline.createInterface({ input: process.stdin }).on("line", (line) => {
    const request = JSON.parse(line);
    if (mode === "slow") return;
    const answer = () => console.log(JSON.stringify({ id: request.id, results: request.images.map((image) => (Buffer.from(image, "base64").toString() === "broken"
      ? { error: "the image could not be decoded" }
      : { scene: "CEREMONY", confidence: 0.8, accidental: false, aesthetic: 5.5, scenes: [{ id: "CEREMONY", p: 0.8 }], embedding: "AAAA" })) }));
    if (mode === "delay") setTimeout(answer, 200); else answer();
  });
}
`);
const engineWith = (mode = "ready", extra = {}) => createSceneEngine({ bin: process.execPath, script: FAKE, env: { ...process.env, FAKE_SCENE_MODE: mode }, enabled: () => true, requestTimeoutMs: 1500, ...extra });

test("off by default: not ready, says why, and describes nothing", async () => {
  const engine = createSceneEngine({ bin: process.execPath, script: FAKE, enabled: () => false });
  assert.equal(await engine.isReady(), false);
  assert.match(engine.unavailableReason(), /AI_CULLING_SCENE_ENABLED/);
  await assert.rejects(engine.describeBatch([Buffer.from("x")]), { code: "SCENE_ENGINE_UNAVAILABLE" });
});

test("a ready engine names its version and answers a batch in order, one bad photo failing alone", async (t) => {
  const engine = engineWith();
  t.after(() => engine.stop());
  assert.equal(await engine.isReady(), true);
  assert.equal(engine.version(), "fake-clip@00000000/event@1");
  const results = await engine.describeBatch([Buffer.from("a"), Buffer.from("broken"), Buffer.from("c")]);
  assert.equal(results.length, 3);
  assert.equal(results[0].scene, "CEREMONY");
  assert.match(results[1].error, /decoded/);
  assert.equal(results[2].aesthetic, 5.5);
  assert.equal(engine.health().status, "ready");
});

test("batches larger than the engine accepts are split, never refused", async (t) => {
  const engine = engineWith();
  t.after(() => engine.stop());
  const results = await engine.describeBatch(Array.from({ length: MAX_BATCH * 2 + 3 }, () => Buffer.from("x")));
  assert.equal(results.length, MAX_BATCH * 2 + 3);
  assert.ok(results.every((result) => result.scene === "CEREMONY"));
});

test("an engine that is not ready, too slow or that dies becomes a reason, not a crash", async (t) => {
  const missing = engineWith("not-ready");
  assert.equal(await missing.isReady(), false);
  assert.match(missing.unavailableReason(), /model missing/);
  const slow = engineWith("slow", { requestTimeoutMs: 300 });
  t.after(() => slow.stop());
  await assert.rejects(slow.describeBatch([Buffer.from("x")]), /did not answer in time/);
  const dying = engineWith("crash-after-ready");
  assert.equal(await dying.isReady(), true);
  // The fake exits 50ms after ready; how soon its exit is heard depends on how busy the machine is
  // (the whole suite runs at once), so wait for it - up to five seconds - rather than a fixed 200ms.
  for (const started = Date.now(); dying.health().status !== "offline" && Date.now() - started < 5000;) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(dying.health().status, "offline");
});

test("the health report names the scene engine in one word and the culling worker warms it at boot", () => {
  const fs = require("node:fs");
  const server = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");
  assert.match(server, /cullingSceneEngine: [^,]*scene\.status/, "a report, never a gate: ok stays true");
  const worker = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", "ai-culling", "worker.js"), "utf8");
  assert.match(worker, /sceneEngine\.isReady\(\)/, "the model downloads at boot, not inside the first run");
  const example = fs.readFileSync(path.join(__dirname, "..", ".env.example"), "utf8");
  for (const name of ["AI_CULLING_SCENE_ENABLED", "AI_SCENE_MODEL_DIR", "AI_SCENE_THREADS", "AI_SCENE_DEVICE", "AI_SCENE_PROFILE", "AI_SCENE_REQUEST_TIMEOUT_MS"]) assert.match(example, new RegExp(`^${name}=`, "m"), name);
});

test("an engine that never says ready gives up at its start deadline and is stopped", async () => {
  const engine = engineWith("never-ready", { startTimeoutMs: 400 });
  const started = Date.now();
  assert.equal(await engine.isReady(), false);
  assert.ok(Date.now() - started < 3000);
  assert.match(engine.unavailableReason(), /did not become ready/);
  assert.equal(engine.health().status, "offline");
});

test("a request that times out stops the engine, so the next one starts fresh instead of queueing behind it", async (t) => {
  const engine = engineWith("slow", { requestTimeoutMs: 300 });
  t.after(() => engine.stop());
  await assert.rejects(engine.describeBatch([Buffer.from("x")]), /did not answer in time/);
  assert.equal(engine.health().status, "offline", "the wedged process was killed");
});

test("requests go one at a time, each timed from when it is sent, so a healthy engine never times out a queued batch", async (t) => {
  const engine = engineWith("delay", { requestTimeoutMs: 350 });
  t.after(() => engine.stop());
  const [first, second] = await Promise.all([engine.describeBatch([Buffer.from("a")]), engine.describeBatch([Buffer.from("b")])]);
  assert.equal(first[0].scene, "CEREMONY");
  assert.equal(second[0].scene, "CEREMONY");
});

test("the engine process gets no secrets, and the public reason names no path", async (t) => {
  const engine = engineWith("ready", { env: { ...process.env, JWT_SECRET: "do-not-pass", FAKE_SCENE_MODE: "ready" } });
  t.after(() => engine.stop());
  assert.equal(await engine.isReady(), true);
  assert.equal(engine.version(), "fake-clip@00000000/event@1", "JWT_SECRET never reached the child");
  const missing = engineWith("not-ready");
  await missing.isReady();
  assert.match(missing.unavailableReason(), /secret\/path/, "the log-side reason keeps the detail");
  assert.doesNotMatch(missing.health().reason, /secret|path|[A-Z]:\//i, "the public reason is a fixed phrase");
  assert.deepEqual(Object.keys(engineWith("ready").health()).sort(), ["reason", "status"], "health says status and a reason, nothing about the install");
});

test("a write to an engine that died never crashes the process", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", "ai-culling", "scene", "engine.js"), "utf8");
  assert.match(source, /own\.stdin\.on\("error"/);
});
