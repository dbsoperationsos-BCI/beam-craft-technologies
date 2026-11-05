const test = require("node:test");
const assert = require("node:assert/strict");
const { createAiCullingService } = require("../src/modules/image-selection/ai-culling/service");
const { sendToPhotosSchema } = require("../src/modules/image-selection/ai-culling/validation");

/*
 * A finalized run's Keeps straight to Photo Selection, from the review: carried by AI Editing's
 * own send (the one release every photo takes on that way), in slices, only once the run is
 * finalized, idempotent on a retry.
 */
function fakeRepo({ session, keeps = [] }) {
  return {
    findSession: async (projectId, sessionId) => (session && session.projectId === projectId && session.id === sessionId ? { ...session } : null),
    listSessionUploadIds: async (projectId, sessionId, decision, { limit = null } = {}) => (decision === "KEEP" ? keeps.slice(0, limit || keeps.length) : []),
  };
}
const serviceOf = (repo, sender) => createAiCullingService(repo, { queue: { enqueue: async () => {} }, progress: { publish: async () => {} }, desktopAiEnabled: () => false, engines: () => ({ faces: false, scene: false }), sceneWarmup: null, photoSelectionSender: sender });

test("only a finalized run's Keeps go, the first `limit` of them, through AI Editing's own send in slices, and the counts add up", async () => {
  const sent = [];
  const sender = { sendToPhotoSelection: async (projectId, ids, { force }, userId) => { sent.push({ ids, force, userId }); return { created: 0, released: ids.length, alreadyVisible: 0, alreadySent: [], skipped: 0, notCulled: 0 }; } };
  const keeps = Array.from({ length: 230 }, (_, index) => `u${index + 1}`);
  const service = serviceOf(fakeRepo({ session: { id: "s1", projectId: "p1", status: "FINALIZED" }, keeps }), sender);
  const all = await service.sendKeepsToPhotoSelection("p1", "s1", {}, 7);
  assert.equal(all.total, 230);
  assert.equal(all.released, 230);
  assert.deepEqual(sent.map((call) => call.ids.length), [100, 100, 30], "a slice at a time, as AI Editing's send takes");
  assert.equal(sent[0].userId, 7);
  assert.equal(sent[0].force, false);
  sent.length = 0;
  const five = await service.sendKeepsToPhotoSelection("p1", "s1", { limit: 5, force: true }, 7);
  assert.deepEqual(sent, [{ ids: ["u1", "u2", "u3", "u4", "u5"], force: true, userId: 7 }], "the first that many of the run's Keeps, in the run's order");
  assert.equal(five.total, 5);
});

test("a run still under review is refused, with the reason, before anything is sent; a foreign run is not found", async () => {
  const sender = { sendToPhotoSelection: async () => { throw new Error("must not be called"); } };
  const review = serviceOf(fakeRepo({ session: { id: "s1", projectId: "p1", status: "REVIEW_READY" }, keeps: ["u1"] }), sender);
  await assert.rejects(review.sendKeepsToPhotoSelection("p1", "s1", {}, 7), (error) => error.status === 409 && error.details?.notFinalized && /Finalize the run first/.test(error.message));
  await assert.rejects(review.sendKeepsToPhotoSelection("p2", "s1", {}, 7), (error) => error.status === 404);
});

test("asked again, the send answers 'already there' and creates nothing - the retry is the sender's own idempotence, carried through", async () => {
  const visible = new Set();
  const sender = { sendToPhotoSelection: async (projectId, ids) => { const result = { created: 0, released: 0, alreadyVisible: 0, alreadySent: [], skipped: 0, notCulled: 0 }; for (const id of ids) { if (visible.has(id)) result.alreadyVisible += 1; else { visible.add(id); result.released += 1; } } return result; } };
  const service = serviceOf(fakeRepo({ session: { id: "s1", projectId: "p1", status: "FINALIZED" }, keeps: ["u1", "u2", "u3"] }), sender);
  assert.deepEqual(await service.sendKeepsToPhotoSelection("p1", "s1", {}, 7), { total: 3, created: 0, released: 3, alreadyVisible: 0, alreadySent: [], skipped: 0, notCulled: 0 });
  assert.deepEqual(await service.sendKeepsToPhotoSelection("p1", "s1", {}, 7), { total: 3, created: 0, released: 0, alreadyVisible: 3, alreadySent: [], skipped: 0, notCulled: 0 });
  assert.equal(visible.size, 3, "no photo twice");
});

test("the body is a whole count of at least one and a plain force flag, nothing else", () => {
  assert.deepEqual(sendToPhotosSchema.parse({}), { force: false });
  assert.deepEqual(sendToPhotosSchema.parse({ limit: "4", force: true }), { limit: 4, force: true });
  assert.throws(() => sendToPhotosSchema.parse({ limit: 0 }));
  assert.throws(() => sendToPhotosSchema.parse({ uploadIds: ["u1"] }), "no ids from the body: the run's own Keeps are the photos");
});
