const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

process.env.CASHFREE_CLIENT_ID = "test-client";
process.env.CASHFREE_CLIENT_SECRET = "test-secret";
const cashfree = require("../src/modules/photo-selling/payments/cashfree");
const config = require("../src/modules/photo-selling/shared/config");

const sign = (timestamp, raw, secret = "test-secret") => crypto.createHmac("sha256", secret).update(`${timestamp}${raw}`).digest("base64");
const raw = '{"data":{"order":{"order_id":"PS-ABC-1","order_amount":170.00}},"type":"PAYMENT_SUCCESS_WEBHOOK"}';

test("a webhook signed with this server's secret over the exact bytes verifies", () => {
  assert.equal(cashfree.verifyWebhookSignature(Buffer.from(raw), "1700000000", sign("1700000000", raw)), true);
});

test("a tampered body, another timestamp, another secret or no signature does not", () => {
  const signature = sign("1700000000", raw);
  assert.equal(cashfree.verifyWebhookSignature(Buffer.from(raw.replace("170.00", "1.00")), "1700000000", signature), false);
  assert.equal(cashfree.verifyWebhookSignature(Buffer.from(raw), "1700000001", signature), false);
  assert.equal(cashfree.verifyWebhookSignature(Buffer.from(raw), "1700000000", sign("1700000000", raw, "other")), false);
  assert.equal(cashfree.verifyWebhookSignature(Buffer.from(raw), "1700000000", ""), false);
  assert.equal(cashfree.verifyWebhookSignature(Buffer.from(raw), "1700000000", "short"), false);
});

test("re-serialised JSON no longer verifies - the raw body is required", () => {
  const reserialised = JSON.stringify(JSON.parse(raw)); // 170.00 becomes 170
  assert.notEqual(reserialised, raw);
  assert.equal(cashfree.verifyWebhookSignature(Buffer.from(reserialised), "1700000000", sign("1700000000", raw)), false);
});

test("orders are created server side with the credentials in headers, never the body", async () => {
  const calls = [];
  cashfree.setFetch(async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ cf_order_id: 99, payment_session_id: "session_x", order_status: "ACTIVE" }) }; });
  try {
    const result = await cashfree.createOrder({ providerOrderId: "PS-ABC-1", amount: "170.00", currency: "INR", customer: { id: "ps_x", name: "Asha", phone: "9876543210" }, returnUrl: "https://store/s/ABC/orders/PS-ABC", note: "n" });
    assert.deepEqual(result, { cfOrderId: "99", paymentSessionId: "session_x", orderStatus: "ACTIVE" });
    assert.match(calls[0].url, /^https:\/\/sandbox\.cashfree\.com\/pg\/orders$/);
    assert.equal(calls[0].init.headers["x-client-secret"], "test-secret");
    assert.equal(calls[0].init.headers["x-idempotency-key"], "PS-ABC-1");
    assert.doesNotMatch(calls[0].init.body, /test-secret|test-client/);
    assert.equal(JSON.parse(calls[0].init.body).order_amount, 170);
  } finally { cashfree.setFetch(null); }
});

test("a refused provider call is a 502 that says nothing of Cashfree's internals", async () => {
  cashfree.setFetch(async () => ({ ok: false, status: 401, json: async () => ({ message: "authentication Failed", code: "request_failed" }) }));
  const original = console.error; console.error = () => {};
  try { await assert.rejects(cashfree.getOrder("PS-ABC-1"), (error) => error.status === 502 && !/authentication/i.test(error.message)); }
  finally { cashfree.setFetch(null); console.error = original; }
});

test("no credentials, or production without the second switch, keeps payments off", () => {
  const saved = { ...process.env };
  try {
    delete process.env.CASHFREE_CLIENT_SECRET;
    assert.equal(config.cashfree().enabled, false);
    process.env.CASHFREE_CLIENT_SECRET = "s";
    process.env.CASHFREE_ENV = "production";
    delete process.env.PHOTO_SELLING_PRODUCTION_PAYMENTS;
    assert.equal(config.cashfree().enabled, false);
    assert.match(config.cashfree().blockedReason, /locked/);
    process.env.PHOTO_SELLING_PRODUCTION_PAYMENTS = "true";
    assert.equal(config.cashfree().enabled, true);
    assert.equal(config.cashfree().baseUrl, "https://api.cashfree.com/pg");
  } finally { process.env = saved; }
});

test("selfie search is the AI Feature's engine: on wherever that engine is, with no licence flag and no AWS", () => {
  const saved = { ...process.env };
  try {
    for (const key of ["AI_FACE_ENGINE_ENABLED", "PHOTO_SELLING_FACE_ENGINE", "PHOTO_SELLING_FACE_LICENSE_CONFIRMED"]) delete process.env[key];
    // AWS credentials on the server (AI Photo Culling may use them) never make Photo Selling call AWS.
    Object.assign(process.env, { AWS_REGION: "ap-south-1", AWS_ACCESS_KEY_ID: "id", AWS_SECRET_ACCESS_KEY: "secret" });
    assert.equal(config.faceEngine().engine, null);
    assert.match(config.faceEngine().reason, /AI_FACE_ENGINE_ENABLED/);
    process.env.PHOTO_SELLING_FACE_ENGINE = "rekognition";
    assert.equal(config.faceEngine().engine, null, "the old engine setting chooses nothing");
    process.env.AI_FACE_ENGINE_ENABLED = "true";
    assert.deepEqual(config.faceEngine(), { engine: "insightface", reason: null }, "no licence flag is asked for");
    assert.deepEqual(Object.values(config.ENGINES), ["insightface"]);
    assert.deepEqual(Object.keys(require("../src/modules/photo-selling/faces/thresholds").THRESHOLDS), ["insightface"]);
    assert.throws(() => require("../src/modules/photo-selling/faces/rekognition"), /Cannot find module/);
  } finally { process.env = saved; }
});

test("no Photo Selling file loads AWS Rekognition (its R2 storage uses the S3 client) or reads the removed licence flag", () => {
  const fs = require("fs");
  const path = require("path");
  const files = [];
  const walk = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else if (entry.name.endsWith(".js")) files.push(full); } };
  walk(path.join(__dirname, "../src/modules/photo-selling"));
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(text, /client-rekognition|Rekognition|PHOTO_SELLING_FACE_LICENSE_CONFIRMED|PHOTO_SELLING_FACE_ENGINE/i, file);
  }
});

test("selfie search is ready only when the AI Feature's engine itself answers ready - its settings alone are not enough", () => {
  const { fakeFaceEngine } = require("./helpers/photoSellingFakeDb");
  const enginePath = require.resolve("../src/modules/ai-feature/face-engine/engine");
  const savedEngine = require.cache[enginePath];
  const saved = { ...process.env };
  const use = (engine) => { require.cache[enginePath] = { id: enginePath, filename: enginePath, loaded: true, exports: engine }; return engine; };
  try {
    for (const key of ["AI_FACE_ENGINE_ENABLED", "PHOTO_SELLING_EMBEDDED_WORKER"]) delete process.env[key];
    const engine = use(fakeFaceEngine("ready"));
    assert.equal(config.faceMatching().state, "NOT_CONFIGURED", "no engine switched on");
    process.env.AI_FACE_ENGINE_ENABLED = "true";
    assert.deepEqual(config.faceMatching(), { engine: "insightface", state: "READY", available: true, reason: null });
    assert.equal(engine.started, 0, "a ready engine is not asked to start again");
    engine.status = "offline";
    assert.equal(config.faceMatching().state, "ENGINE_OFFLINE");
    assert.equal(config.faceMatching().available, false);
    assert.equal(engine.started, 1, "an offline engine is retried from a staff read - once a minute, not on every read");
    engine.status = "disabled";
    assert.equal(config.faceMatching().state, "NOT_CONFIGURED", "the engine's own strict switch wins - never stuck at Starting");
    engine.status = "offline";
    assert.doesNotMatch(config.faceMatching().reason, /[A-Z]:\\|\/usr\/|python/i, "no server path or interpreter in the staff message");
    use(fakeFaceEngine("not-started", { modelsComplete: false }));
    assert.equal(config.faceMatching().state, "MODEL_MISSING");
    // Enabled but not loaded yet: asked to start here (searches run in this process), never awaited.
    const idle = use(fakeFaceEngine("not-started"));
    assert.equal(config.faceMatching().state, "STARTING");
    assert.equal(config.faceMatchingAvailable(), false);
    assert.ok(idle.started >= 1, "the engine was asked to start");
    // A guest's read never starts it: finding the interpreter blocks the process.
    const quiet = use(fakeFaceEngine("not-started"));
    assert.equal(config.faceMatching({ start: false }).state, "STARTING");
    assert.equal(quiet.started, 0);
    assert.equal(config.status().faceMatching.state, "STARTING");
    // Searches in another process: this one cannot see that engine and does not start its own.
    process.env.PHOTO_SELLING_EMBEDDED_WORKER = "false";
    const elsewhere = use(fakeFaceEngine("not-started"));
    assert.equal(config.faceMatching().state, "WORKER_ELSEWHERE");
    assert.equal(elsewhere.started, 0);
  } finally {
    process.env = saved;
    if (savedEngine) require.cache[enginePath] = savedEngine; else delete require.cache[enginePath];
  }
});

test("Cashfree's keys are checked against Cashfree itself: accepted, refused or unreachable - never from their presence alone", async () => {
  const saved = { ...process.env };
  const seen = [];
  let answer = { status: 404, body: { code: "order_not_found" } };
  cashfree.setFetch(async (url, init) => {
    seen.push({ url, headers: init.headers });
    if (answer === "down") throw new Error("ECONNRESET");
    return { ok: answer.status < 400, status: answer.status, json: async () => answer.body };
  });
  try {
    cashfree._resetCredentialCheck();
    Object.assign(process.env, { CASHFREE_ENV: "sandbox", CASHFREE_CLIENT_ID: "", CASHFREE_CLIENT_SECRET: "" });
    assert.equal(await cashfree.checkCredentials(), "NOT_CONFIGURED");
    assert.equal(config.status().payments.enabled, false);
    assert.equal(seen.length, 0, "nothing is asked without keys");
    Object.assign(process.env, { CASHFREE_CLIENT_ID: "test-client", CASHFREE_CLIENT_SECRET: "test-secret" });
    assert.equal(config.cashfree().credentials, "UNCHECKED");
    // Valid keys: Cashfree answers "not found" for an order that cannot exist.
    assert.equal(await cashfree.checkCredentials(), "VALID");
    assert.match(seen[0].url, /^https:\/\/sandbox\.cashfree\.com\/pg\/orders\/dbs-key-check-[0-9a-f]{12}$/);
    assert.deepEqual(config.status().payments, { provider: "CASHFREE", environment: "SANDBOX", enabled: true, reason: null, credentials: "VALID", webhookAddressSet: false });
    assert.doesNotMatch(JSON.stringify(config.status()), /test-secret|test-client/, "no key in what staff are told");
    // Remembered: no second call within the half hour.
    await cashfree.checkCredentials();
    assert.equal(seen.length, 1);
    // New keys are checked afresh; refused ones switch checkout off with the reason.
    process.env.CASHFREE_CLIENT_SECRET = "wrong-secret";
    assert.equal(config.cashfree().credentials, "UNCHECKED");
    answer = { status: 401, body: { code: "request_failed", message: "authentication Failed" } };
    assert.equal(await cashfree.checkCredentials(), "INVALID");
    assert.equal(config.cashfree().enabled, false);
    assert.match(config.status().payments.reason, /refused this server's payment keys/);
    // Cashfree unreachable: said, but checkout is not switched off for a passing outage.
    answer = "down";
    assert.equal(await cashfree.checkCredentials({ force: true }), "UNREACHABLE");
    assert.equal(config.cashfree().enabled, true);
  } finally {
    process.env = saved;
    cashfree.setFetch(null);
    cashfree._resetCredentialCheck();
  }
});
