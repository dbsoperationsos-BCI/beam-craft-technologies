const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { registerBundle, promoteModel, parseRef } = require("../src/modules/image-selection/ai-culling/learning/operations");
const { shadowReport, rates, bootstrapGain } = require("../src/modules/image-selection/ai-culling/learning/shadowReport");
const { FEATURE_NAMES, FEATURE_SET_VERSION } = require("../src/modules/image-selection/ai-culling/learning/featureSet");

// A model reaches photographers only through a named person, a passing shadow report and these
// rules - never silently, never from synthetic data.

function registryClient(models = []) {
  const rows = models.map((model, index) => ({ id: `m${index}`, notes: null, ...model }));
  const api = {
    findFirst: async ({ where }) => rows.find((row) => row.name === where.name && row.version === where.version) || null,
    findMany: async ({ where }) => rows.filter((row) => row.status === where.status && row.id !== where.NOT.id),
    create: async ({ data }) => { const row = { id: `m${rows.length}`, ...data }; rows.push(row); return row; },
    update: async ({ where, data }) => Object.assign(rows.find((row) => row.id === where.id), data),
  };
  // The approver is a login, resolved to the person.
  const users = [{ id: 7, username: "owner", name: "Studio Owner" }];
  const user = { findFirst: async ({ where }) => users.find((row) => row.username === where.username) || null };
  return { rows, client: { imageSelectionCullingModel: api, user, $transaction: (work) => work({ imageSelectionCullingModel: api }) } };
}

function trainedDir({ synthetic = false, featureSetVersion = FEATURE_SET_VERSION, version = "1.0.0" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "culling-bundle-"));
  fs.writeFileSync(path.join(dir, "bundle.json"), JSON.stringify({ name: "culling-ranker", version, featureSetVersion, featureNames: FEATURE_NAMES, datasetVersion: "dataset_v1", global: { tree_info: [] } }));
  fs.writeFileSync(path.join(dir, "metrics.json"), JSON.stringify({ synthetic, headline: { agreement: 0.8 } }));
  return dir;
}

test("registration copies the bundle under a relative path, checksums it and starts it as a CANDIDATE", async () => {
  const { client, rows } = registryClient();
  const modelDir = fs.mkdtempSync(path.join(os.tmpdir(), "culling-models-"));
  const model = await registerBundle({ client, bundleDir: trainedDir(), modelDir });
  assert.equal(model.status, "CANDIDATE");
  assert.equal(model.artifactPath, "culling-ranker/1.0.0/bundle.json", "no machine path is stored");
  assert.match(model.artifactSha256, /^[0-9a-f]{64}$/);
  assert.ok(fs.existsSync(path.join(modelDir, "culling-ranker", "1.0.0", "bundle.json")));
  await assert.rejects(() => registerBundle({ client, bundleDir: trainedDir(), modelDir }), /immutable/);
  await assert.rejects(() => registerBundle({ client, bundleDir: trainedDir({ featureSetVersion: "features_v0", version: "2.0.0" }), modelDir }), /features_v0/);
  await assert.rejects(() => registerBundle({ client, bundleDir: trainedDir({ synthetic: true, version: "3.0.0" }), modelDir }), /synthetic/);
  const synthetic = await registerBundle({ client, bundleDir: trainedDir({ synthetic: true, version: "3.0.0" }), modelDir, allowSynthetic: true });
  assert.match(synthetic.notes, /SYNTHETIC/);
  assert.equal(rows.length, 2);
});

test("promotion: the allowed moves, a named approver, the shadow gate, one holder at a time", async () => {
  const passing = async () => ({ promotable: true, reasons: [] });
  const failing = async () => ({ promotable: false, reasons: ["12 finalized shadow runs; 200 needed"] });
  const { client, rows } = registryClient([
    { name: "culling-ranker", version: "1.0.0", status: "PRODUCTION" },
    { name: "culling-ranker", version: "1.1.0", status: "CANDIDATE" },
    { name: "culling-ranker", version: "9.0.0", status: "SHADOW", notes: "SYNTHETIC: trained on generated data; may never pass SHADOW." },
  ]);
  assert.deepEqual(parseRef("culling-ranker@1.1.0"), { name: "culling-ranker", version: "1.1.0" });
  assert.throws(() => parseRef("culling-ranker"), /name@version/);
  await assert.rejects(() => promoteModel({ client, ref: "culling-ranker@1.1.0", to: "SHADOW", by: "", report: passing }), /approves/);
  await assert.rejects(() => promoteModel({ client, ref: "culling-ranker@1.1.0", to: "SHADOW", by: "nobody", report: passing }), /No user signs in as nobody/);
  await assert.rejects(() => promoteModel({ client, ref: "culling-ranker@1.1.0", to: "PRODUCTION", by: "owner", report: passing }), /can move to SHADOW, RETIRED/);
  const shadowed = await promoteModel({ client, ref: "culling-ranker@1.1.0", to: "SHADOW", by: "owner", report: passing });
  assert.equal(shadowed.model.promotedByUserId, 7, "the approver is recorded as the person, not as typed text");
  assert.match(shadowed.model.notes, /by Studio Owner \(owner\)/);
  await assert.rejects(() => promoteModel({ client, ref: "culling-ranker@1.1.0", to: "CANARY", by: "owner", report: failing }), /200 needed/);
  await promoteModel({ client, ref: "culling-ranker@1.1.0", to: "CANARY", by: "owner", report: failing, override: "studio trial agreed" });
  assert.match(rows[1].notes, /override: studio trial agreed/);
  const { retired } = await promoteModel({ client, ref: "culling-ranker@1.1.0", to: "PRODUCTION", by: "owner", report: passing });
  assert.deepEqual(retired, ["culling-ranker@1.0.0"]);
  assert.equal(rows[0].status, "RETIRED");
  assert.match(rows[0].notes, /was PRODUCTION/);
  await assert.rejects(() => promoteModel({ client, ref: "culling-ranker@9.0.0", to: "CANARY", by: "owner", report: passing, override: "x" }), /synthetic/);
  const rolled = await promoteModel({ client, ref: "culling-ranker@1.0.0", to: "PRODUCTION", by: "owner", rollback: true, report: failing });
  assert.equal(rolled.model.status, "PRODUCTION");
  assert.deepEqual(rolled.retired, ["culling-ranker@1.1.0"], "rolling back retires the model it replaces");
});

function shadowClient({ runs = 3, photographers = 3 } = {}) {
  const sessions = Array.from({ length: runs }, (_, i) => ({ id: `s${i}`, createdByUserId: (i % photographers) + 1 }));
  const results = {};
  const shadows = {};
  for (const session of sessions) {
    results[session.id] = [
      { id: `${session.id}a`, aiDecision: "REJECT", effectiveDecision: "KEEP", burstGroupId: "g", isGroupBest: true },
      { id: `${session.id}b`, aiDecision: "KEEP", effectiveDecision: "REJECT", burstGroupId: "g", isGroupBest: false },
      { id: `${session.id}c`, aiDecision: "KEEP", effectiveDecision: "KEEP" },
    ];
    shadows[session.id] = [
      { resultId: `${session.id}a`, decision: "KEEP", isGroupBest: false },
      { resultId: `${session.id}b`, decision: "REJECT", isGroupBest: true },
      { resultId: `${session.id}c`, decision: "KEEP", isGroupBest: false },
    ];
  }
  return {
    imageSelectionCullingShadowResult: { findMany: async ({ where, distinct }) => (distinct ? sessions.map((s) => ({ sessionId: s.id })) : shadows[where.sessionId]) },
    imageSelectionCullingSession: { findUnique: async ({ where }) => sessions.find((s) => s.id === where.id) },
    imageSelectionCullingResult: { findMany: async ({ where }) => results[where.sessionId] },
    imageSelectionCullingDecisionEvent: { findMany: async ({ where }) => [{ groupId: "g", groupOrder: { before: [`${where.sessionId}a`, `${where.sessionId}b`], after: [`${where.sessionId}a`, `${where.sessionId}b`] } }] },
  };
}

test("the shadow report compares the hidden calls with the real ones and applies the promotion rules", async () => {
  const report = await shadowReport(shadowClient(), "m1");
  assert.equal(report.runs, 3);
  assert.equal(report.shadow.agreement, 1);
  assert.ok(Math.abs(report.baseline.agreement - 1 / 3) < 1e-12);
  assert.equal(report.shadow.falseRejectRate, 0);
  assert.equal(report.baseline.falseRejectRate, 0.5);
  assert.equal(report.burst.groups, 3);
  assert.equal(report.burst.baselineTop1, 1, "the AI's original best was the photographer's");
  assert.equal(report.burst.shadowTop1, 0);
  assert.equal(report.promotable, false);
  assert.ok(report.reasons.some((reason) => /200 needed/.test(reason)));
  assert.ok(report.reasons.some((reason) => /photographers/.test(reason)));
  assert.deepEqual(rates([]), { n: 0, agreement: null, falseRejectRate: null, falseKeepRate: null });
  assert.equal(bootstrapGain([{ n: 1, shadowCorrect: 1, baselineCorrect: 0 }]), null);
});
