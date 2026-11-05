const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createCullingLearningService } = require("../src/modules/image-selection/culling-learning/service");
const { consentSchema } = require("../src/modules/image-selection/culling-learning/controller");

// The studio's training consent: off until someone with Settings / Organization Read-Write turns
// it on; the registry view never hands out where a model's file lives.
test("the routes sit behind protect and Settings / Organization", () => {
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", "culling-learning", "routes.js"), "utf8");
  assert.match(routes, /router\.use\(protect\);\s*router\.use\(requireModule\("SETTINGS", "Organization"\)\);/);
  const server = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");
  assert.match(server, /app\.use\("\/api\/image-selection\/culling-learning", imageSelectionCullingLearningRoutes\)/);
});

test("consent is a strict boolean, off by default, stamped with who and when only when it changes", async () => {
  assert.equal(consentSchema.safeParse({ consent: "yes" }).success, false);
  assert.equal(consentSchema.safeParse({ consent: true, extra: 1 }).success, false);
  let row = null;
  let writes = 0;
  const people = { 7: { id: 7, name: "Studio Owner" }, 9: { id: 9, name: "Manager" } };
  const shaped = () => row && { ...row, cullingTrainingConsentByUser: people[row.cullingTrainingConsentByUserId] || null };
  const client = {
    imageSelectionSettings: {
      findUnique: async () => shaped(),
      upsert: async ({ update, create }) => { writes += 1; row = { ...(row || create), ...update }; return shaped(); },
    },
  };
  const first = new Date(Date.UTC(2026, 9, 7));
  let at = first;
  const service = createCullingLearningService(client, { now: () => at });
  assert.deepEqual(await service.consent(), { consent: false, consentAt: null, consentBy: null });
  assert.deepEqual(await service.setConsent(true, 7), { consent: true, consentAt: first, consentBy: "Studio Owner" });
  at = new Date(Date.UTC(2026, 9, 9));
  assert.deepEqual(await service.setConsent(true, 9), { consent: true, consentAt: first, consentBy: "Studio Owner" }, "saving the same answer again changes nothing");
  assert.equal(writes, 1);
  assert.deepEqual(await service.setConsent(false, 9), { consent: false, consentAt: at, consentBy: "Manager" });
});

test("the model list carries status and headline metrics, never the artifact path", async () => {
  let asked;
  const client = { imageSelectionCullingModel: { findMany: async (args) => { asked = args; return [{ id: "m", name: "culling-ranker", version: "1.0.0", status: "SHADOW", metrics: { headline: { agreement: 0.81 }, test: {} } }]; } } };
  const [model] = await createCullingLearningService(client).models();
  assert.deepEqual(model.headline, { agreement: 0.81 });
  assert.equal(asked.select.artifactPath, undefined);
  assert.equal(model.metrics, undefined);
});
