const test = require("node:test");
const assert = require("node:assert/strict");
const { createAiCullingService } = require("../src/modules/image-selection/ai-culling/service");

/*
 * The Photo Culling workspace draws a different state for an empty folder, photos still uploading
 * or processing, photos ready, a run and a review. The overview carries the counts each state
 * needs, from the scope's own photos, never invented.
 */
function overviewRepo({ session = null, uploads = [], confidence = null, announced = 0 } = {}) {
  return {
    countAnnouncedUploads: async () => announced,
    findProject: async () => ({ id: "p1" }),
    folderSubtreeIds: async (_projectId, folderId) => (folderId === "f1" ? ["f1", "f1a"] : null),
    findLatestSession: async () => session,
    countReadyImages: async (_projectId, folderIds) => uploads.filter((u) => u.status === "READY" && (!folderIds || folderIds.includes(u.folderId))).length,
    countUploadsByStatus: async (_projectId, folderIds) => {
      const counts = {};
      for (const u of uploads) if (!folderIds || folderIds.includes(u.folderId)) counts[u.status] = (counts[u.status] || 0) + 1;
      return counts;
    },
    countResults: async () => 10,
    countResultsByFilter: async () => 0,
    countReadyNotInSession: async () => 0,
    countScenes: async () => ({}),
    coverageCounts: async () => null,
    countGroupsByType: async () => ({}),
    confidenceSummary: async () => confidence,
  };
}
const upload = (status, folderId = "f1") => ({ status, folderId });

test("the overview says how many of the scope's photos were added here and wait for culling", async () => {
  let asked;
  const repo = { ...overviewRepo({ uploads: [upload("READY"), upload("READY")] }), countHeld: async (projectId, folderIds) => { asked = [projectId, folderIds]; return 2; } };
  const overview = await createAiCullingService(repo, { queue: {}, engines: () => ({ faces: false, scene: false }) }).overview("p1", "f1");
  assert.equal(overview.photoCounts.held, 2, "carried to the workspace, not dropped on the way out");
  assert.deepEqual(asked, ["p1", ["f1", "f1a"]], "within the folder subtree");
});

test("an empty folder says zero of everything", async () => {
  const service = createAiCullingService(overviewRepo(), { queue: {}, engines: () => ({ faces: false, scene: false }) });
  const overview = await service.overview("p1", "f1");
  assert.deepEqual(overview.photoCounts, { total: 0, ready: 0, processing: 0, uploading: 0, failed: 0, held: 0 });
  assert.equal(overview.confidence, null);
});

test("the scope's photos are counted by where they are in the upload lifecycle, cancelled ones left out", async () => {
  const uploads = [upload("READY"), upload("READY", "f1a"), upload("PROCESSING"), upload("UPLOADING"), upload("PENDING"), upload("PROCESSING_FAILED"), upload("CANCELLED"), upload("ABANDONED"), upload("READY", "other")];
  const service = createAiCullingService(overviewRepo({ uploads }), { queue: {}, engines: () => ({ faces: true, scene: false }) });
  const overview = await service.overview("p1", "f1");
  assert.deepEqual(overview.photoCounts, { total: 6, ready: 2, processing: 1, uploading: 2, failed: 1, held: 0 });
  assert.deepEqual(overview.engines, { faces: true, scene: false });
});

test("a settled run carries its confidence spread; a run still moving does not", async () => {
  const confidence = { high: 6, medium: 3, low: 1, average: 0.78 };
  const settled = createAiCullingService(overviewRepo({ session: { id: "s1", status: "REVIEW_READY", totalImages: 10 }, confidence }), { queue: {}, engines: () => ({ faces: false, scene: false }) });
  assert.deepEqual((await settled.overview("p1")).confidence, confidence);
  const moving = createAiCullingService(overviewRepo({ session: { id: "s1", status: "ANALYZING", totalImages: 10 }, confidence }), { queue: {}, engines: () => ({ faces: false, scene: false }) });
  assert.equal((await moving.overview("p1")).confidence, null);
});

test("files a batch announced but has not registered yet still count as uploading, so the tab does not call the folder ready mid-upload", async () => {
  const service = createAiCullingService(overviewRepo({ uploads: [upload("READY"), upload("READY")], announced: 52 }), { queue: {}, engines: () => ({ faces: false, scene: false }) });
  const overview = await service.overview("p1", "f1");
  assert.deepEqual(overview.photoCounts, { total: 54, ready: 2, processing: 0, uploading: 52, failed: 0, held: 0 });
});

// The repository's own queries, against a recording client: the scope is always in the where, and
// the counts come out right at the band edges.
const { createRepository } = require("../src/modules/image-selection/ai-culling/repository");

test("photo counts are read within the project and the folder subtree", async () => {
  const calls = [];
  const client = { imageSelectionUpload: { groupBy: async (args) => { calls.push(args); return [{ status: "READY", _count: { _all: 3 } }, { status: "PROCESSING", _count: { _all: 1 } }]; } } };
  const counts = await createRepository(client).countUploadsByStatus("p1", ["f1", "f1a"]);
  assert.deepEqual(counts, { READY: 3, PROCESSING: 1 });
  assert.deepEqual(calls[0].where, { projectId: "p1", folderId: { in: ["f1", "f1a"] } });
});

test("files still to come are each open batch's announcement less what it registered, never negative", async () => {
  const seen = {};
  const client = {
    imageSelectionUploadBatch: { findMany: async (args) => { seen.batches = args.where; return [{ id: "b1", totalFiles: 54 }, { id: "b2", totalFiles: 2 }]; } },
    imageSelectionUpload: { groupBy: async (args) => { seen.uploads = args.where; return [{ batchId: "b1", _count: { _all: 14 } }, { batchId: "b2", _count: { _all: 5 } }]; } },
  };
  assert.equal(await createRepository(client).countAnnouncedUploads("p1", ["f1"]), 40);
  assert.deepEqual(seen.batches, { projectId: "p1", status: "UPLOADING", folderId: { in: ["f1"] } });
  assert.deepEqual(seen.uploads, { projectId: "p1", batchId: { in: ["b1", "b2"] } });
  const none = { imageSelectionUploadBatch: { findMany: async () => [] }, imageSelectionUpload: { groupBy: async () => { throw new Error("not asked"); } } };
  assert.equal(await createRepository(none).countAnnouncedUploads("p1", null), 0);
});

test("the confidence summary is one bound query over the session, with the shared band lines", async () => {
  const { CONFIDENCE_LINES } = require("../src/modules/image-selection/ai-culling/constants");
  let query;
  const client = { $queryRaw: async (strings, ...values) => { query = { sql: strings.join("?"), values }; return [{ total: 10n, high: 6n, low: 1n, average: 0.784 }]; } };
  assert.deepEqual(await createRepository(client).confidenceSummary("s1"), { high: 6, medium: 3, low: 1, average: 0.78 });
  assert.match(query.sql, /FROM image_selection_culling_result\s+WHERE session_id = \?/);
  assert.deepEqual(query.values, [CONFIDENCE_LINES.HIGH, CONFIDENCE_LINES.LOW, "s1"], "every value is bound, none is spliced into the SQL");
  const empty = { $queryRaw: async () => [{ total: 0n, high: 0n, low: 0n, average: null }] };
  assert.equal(await createRepository(empty).confidenceSummary("s1"), null);
});

test("the LOW_CONFIDENCE badge and the workspace's low band are the same line", () => {
  const { CONFIDENCE_LINES } = require("../src/modules/image-selection/ai-culling/constants");
  const { scorePhoto } = require("../src/modules/image-selection/ai-culling/analysis/scoring");
  assert.equal(CONFIDENCE_LINES.LOW, 0.55);
  const failed = scorePhoto({ reasonCodes: ["ANALYSIS_FAILED"] }, "BALANCED");
  assert.ok(failed.confidence < CONFIDENCE_LINES.LOW && failed.rankingCodes.includes("LOW_CONFIDENCE"));
});
