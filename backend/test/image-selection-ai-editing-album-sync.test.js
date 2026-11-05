const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { createAiEditingService, albumSyncState } = require("../src/modules/image-selection/ai-editing/service");

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", ...parts), "utf8");
const STYLE = { style: "warmWedding", adjustments: {}, tools: {} };
const edit = (over = {}) => ({ id: "e1", projectId: "p1", uploadId: "u1", status: "RENDERED", version: 3, outputKey: "edits/u1/v3/output.jpg", outputBytes: 9, outputWidth: 6000, outputHeight: 4000, recipe: STYLE, appliedRecipe: STYLE, albumSyncAt: new Date(), albumSyncError: null, sentToAlbumPhotoId: null, sentToAlbumVersion: null, createdByUserId: 7, upload: { fileName: "DSC_1.JPG" }, ...over });

function harness(row, { albumFails = false } = {}) {
  const calls = { album: [], marked: [], errors: [], queued: [] };
  const repo = {
    findEdit: async () => (row ? { ...row } : null),
    markAlbumSynced: async (editId, version, photoId) => { calls.marked.push([editId, version, photoId]); return { count: 1 }; },
    setAlbumSyncError: async (editId, message) => { calls.errors.push([editId, message]); return { count: 1 }; },
  };
  const albumService = {
    syncEditedCopy: async (projectId, uploadId, payload) => { calls.album.push([projectId, uploadId, payload.fileName]); if (albumFails) throw new Error("R2 down"); return { albumId: "a1", photoId: "sap1", created: true }; },
  };
  const processing = {
    recipeForModule: async (module) => ({ module }),
    renderWithRecipe: async (buffer, recipe) => { calls.recipe = recipe; return { thumbnail: { data: Buffer.from("t"), info: { size: 1 } }, preview: { data: Buffer.from("p"), info: { size: 1 } } }; },
  };
  const r2 = { isConfigured: () => true, publicUrl: () => null, getObjectStream: async (key) => { calls.read = key; return Readable.from([Buffer.from("MASTER")]); } };
  const queue = { enqueue: async () => {}, enqueueAlbumSync: async (editId, version) => { calls.queued.push([editId, version]); } };
  const service = createAiEditingService(repo, { r2, processing, albumService, queue, engine: { version: () => "t" }, settings: { read: async () => ({}) }, areLinked: async () => true });
  return { service, calls };
}

test("a saved render of an enrolled photo is compressed to the album's own preset from the master and written into its one album copy", async () => {
  const { service, calls } = harness(edit());
  const result = await service.syncToAlbum("e1", 3);
  assert.deepEqual(result, { synced: true, albumId: "a1", photoId: "sap1" });
  assert.equal(calls.read, "edits/u1/v3/output.jpg", "the saved master - never a preview or an original");
  assert.deepEqual(calls.recipe, { module: "signatureAlbum" }, "the album's configured preset");
  assert.deepEqual(calls.album, [["p1", "u1", "DSC_1 (edited).jpg"]]);
  assert.deepEqual(calls.marked, [["e1", 3, "sap1"]], "recorded for the version synced, only after the album row was written");
});

test("nothing that is not a saved edit is synced: not enrolled, still rendering, failed, reset, never applied, or an older version", async () => {
  for (const [row, why] of [
    [edit({ albumSyncAt: null }), "notEnrolled"],
    [edit({ status: "RENDERING" }), "notRendered"],
    [edit({ status: "FAILED" }), "notRendered"],
    [edit({ status: "DRAFT", outputKey: null, appliedRecipe: null }), "notRendered"],
    [edit({ appliedRecipe: null }), "notRendered"],
  ]) {
    const { service, calls } = harness(row);
    assert.equal((await service.syncToAlbum("e1", 3)).skipped, why);
    assert.equal(calls.album.length, 0, `${why}: the album is not touched - its existing asset stays`);
  }
  const { service, calls } = harness(edit({ version: 4 }));
  assert.equal((await service.syncToAlbum("e1", 3)).skipped, "superseded", "a job for an older version leaves it to the newer render's own job");
  assert.equal(calls.album.length, 0);
});

test("a repeated job or callback for a version already in the album is a no-op - no duplicate", async () => {
  const { service, calls } = harness(edit({ sentToAlbumPhotoId: "sap1", sentToAlbumVersion: 3 }));
  assert.deepEqual(await service.syncToAlbum("e1", 3), { synced: true, skipped: "alreadySynced", photoId: "sap1" });
  assert.equal(calls.album.length, 0);
  assert.equal(calls.marked.length, 0);
});

test("a failed album write keeps the saved edit and throws so the queue retries it; why is recorded only once the queue gives up", async () => {
  const { service, calls } = harness(edit(), { albumFails: true });
  await assert.rejects(service.syncToAlbum("e1", 3), /R2 down/);
  assert.equal(calls.marked.length, 0, "never reported synced");
  assert.equal(calls.errors.length, 0, "not 'failed' on screen while a retry is still on its way");
  await service.failAlbumSync("e1", new Error("R2 down"));
  assert.match(calls.errors[0][1], /could not be added to the Signature Album/);
  const { albumSyncPermanent } = require("../src/modules/image-selection/ai-editing/service");
  assert.equal(albumSyncPermanent(Object.assign(new Error("no"), { status: 404 })), true, "a refusal is not retried");
  assert.equal(albumSyncPermanent(new Error("timeout")), false);
});

test("an older sync that lands after a newer render puts the newer version back on the queue - the album never stays on the older bytes", async () => {
  let reads = 0;
  const cleared = [];
  const queued = [];
  const repo = {
    // The job's version 3, still 3 just before the write, then 4 once the album was written.
    findEdit: async () => (reads++ < 2 ? edit() : edit({ version: 4, sentToAlbumPhotoId: "sap1", sentToAlbumVersion: 4 })),
    markAlbumSynced: async () => ({ count: 0 }),
    clearAlbumSynced: async (editId, version) => { cleared.push([editId, version]); return { count: 1 }; },
    setAlbumSyncError: async () => ({ count: 1 }),
  };
  const service = createAiEditingService(repo, {
    areLinked: async () => true,
    r2: { isConfigured: () => true, publicUrl: () => null, getObjectStream: async () => Readable.from([Buffer.from("M")]) },
    processing: { recipeForModule: async () => ({}), renderWithRecipe: async () => ({ thumbnail: { data: Buffer.from("t"), info: { size: 1 } }, preview: { data: Buffer.from("p"), info: { size: 1 } } }) },
    albumService: { syncEditedCopy: async () => ({ albumId: "a", photoId: "sap1" }) },
    queue: { enqueue: async () => {}, enqueueAlbumSync: async (id, version) => queued.push([id, version]) }, settings: { read: async () => ({}) },
  });
  assert.deepEqual(await service.syncToAlbum("e1", 3), { synced: false, skipped: "superseded" });
  assert.deepEqual(cleared, [["e1", 4]], "the newer version is no longer counted as in the album");
  assert.deepEqual(queued, [["e1", 4]], "and is synced again");
});

test("a deliberate resend of an enrolled photo rewrites its one copy; without force an up-to-date one is left alone", async () => {
  const { service, calls } = harness(edit({ sentToAlbumPhotoId: "sap1", sentToAlbumVersion: 3 }));
  assert.equal((await service.syncToAlbum("e1", null)).skipped, "alreadySynced");
  assert.equal(calls.album.length, 0);
  assert.deepEqual(await service.syncToAlbum("e1", null, { force: true }), { synced: true, albumId: "a1", photoId: "sap1" });
  assert.equal(calls.album.length, 1);
});

test("each state the screens show is read from the edit alone", () => {
  assert.equal(albumSyncState(edit({ albumSyncAt: null })), null);
  assert.equal(albumSyncState(edit({ status: "QUEUED" })).state, "rendering");
  assert.equal(albumSyncState(edit({ status: "DRAFT", outputKey: null })).state, "waiting");
  assert.equal(albumSyncState(edit()).state, "pending");
  assert.equal(albumSyncState(edit({ sentToAlbumPhotoId: "sap1", sentToAlbumVersion: 3 })).state, "synced");
  assert.equal(albumSyncState(edit({ sentToAlbumPhotoId: "sap1", sentToAlbumVersion: 2 })).state, "pending", "a newer saved version is on its way");
  assert.deepEqual(albumSyncState(edit({ albumSyncError: "boom" })), { state: "failed", error: "boom" });
});

test("the sync is queued only once a render is saved - on the server or from the desktop - one job per version, retried, recovered at start", () => {
  const service = read("ai-editing", "service.js");
  assert.match(service, /const saved = await repo\.updateEdit\(edit\.id, \{\n\s+status: "RENDERED"/);
  assert.match(service, /if \(previous\.length\) await r2\.deleteObjects\(previous\)\.catch\(\(\) => \{\}\);\n\s+\/\/ Saved: an enrolled photo's new version goes on to the album \(never before this point\)\.\n\s+await queueAlbumSync\(saved\);/);
  assert.match(service, /await queueAlbumSync\(edit\);\n\s+return serializeEdit\(edit\);/, "the desktop's hand-over too");
  assert.match(service, /if \(!edit\?\.albumSyncAt \|\| edit\.status !== "RENDERED" \|\| !edit\.outputKey\) return;/);
  const queue = read("ai-editing", "queue.js");
  assert.match(queue, /const jobId = `album-\$\{editId\}-v\$\{version\}`;/);
  assert.match(queue, /attempts: 4, backoff: \{ type: "exponential", delay: 10000 \}/);
  assert.match(queue, /const syncs = \(await repository\.listAlbumSyncCandidates\(\)\)\.filter/);
  const worker = read("ai-editing", "worker.js");
  assert.match(worker, /job\.name === "album-sync" \? albumSync\(job\) : renderEdit\(job\.data\.editId\)/);
  assert.match(worker, /return await syncToAlbum\(job\.data\.editId, job\.data\.version\);/);
  assert.match(worker, /if \(job\.name === "album-sync"\) \{ if \(error\?\.name === "UnrecoverableError" \|\| job\.attemptsMade >= \(job\.opts\.attempts \|\| 1\)\) failAlbumSync\(/, "a failed sync never marks the edit failed, and is recorded once retries are over");
  assert.match(worker, /albumSyncPermanent\(error\) \? Object\.assign\(new UnrecoverableError\(error\.message\)/);
  const routes = read("ai-editing", "routes.js");
  // Enrolling needs the album's permission, whatever value is sent - and the project linked to AI
  // Editing, and to the album as well when it syncs there (projects/modules.js).
  assert.match(routes, /router\.post\("\/photos\/add", \(req, res, next\) => \(req\.body\?\.albumSync !== undefined \? albumWrite\(req, res, next\) : next\(\)\), requireProjectLink\(\(req\) => \(req\.body\?\.albumSync \? \[\["culling", "editing"\], \["editing", "album"\]\] : \[\["culling", "editing"\]\]\)\), c\.addPhotos\);/);
  assert.match(routes, /router\.post\("\/album-sync\/retry", checkPermission\("IMAGE_SELECTION", "Signature Album", "READ_WRITE"\), requireProjectLink\(\[\["editing", "album"\]\]\), c\.retryAlbumSync\);/);
});

test("enrolling from AI Culling marks each photo and sends the ones already edited at once", async () => {
  const added = [];
  const queued = [];
  const repo = {
    findProject: async () => ({ id: "p1" }),
    addToBay: async (projectId, ids, userId, options) => { added.push([ids, options]); return { added: 1, skipped: 1, missing: 0, notCulled: 0, syncNow: [{ editId: "e9", version: 2 }] }; },
  };
  const cullingRepository = { findSession: async () => ({ id: "s1", status: "FINALIZED" }), listSessionUploadIds: async (projectId, sessionId, decision, { limit } = {}) => (limit ? ["u1", "u2"].slice(0, limit) : ["u1", "u2"]) };
  const service = createAiEditingService(repo, { queue: { enqueue: async () => {}, enqueueAlbumSync: async (id, version) => queued.push([id, version]) }, cullingRepository, r2: { isConfigured: () => true, publicUrl: () => null }, settings: { read: async () => ({}) }, areLinked: async () => true });
  const result = await service.addPhotos("p1", { cullingSessionId: "s1", decision: "KEEP", albumSync: true }, 7);
  assert.deepEqual(added, [[["u1", "u2"], { albumSync: true }]], "every Keep of the finalized run - no count");
  assert.deepEqual(queued, [["e9", 2]]);
  assert.equal(result.albumSync, true);
  const { addPhotosSchema } = require("../src/modules/image-selection/ai-editing/validation");
  assert.deepEqual(addPhotosSchema.parse({ cullingSessionId: "s1", albumSync: true }), { cullingSessionId: "s1", decision: "KEEP", albumSync: true });
});

test("a render saved while an older version was being compressed wins: the older sync never writes the album", async () => {
  let reads = 0;
  const { service, calls } = harness(edit());
  // First read: version 3 (the job's); second read, just before the album write: version 4 landed.
  const original = service.syncToAlbum;
  const repo = { findEdit: async () => (reads++ === 0 ? edit() : edit({ version: 4 })), markAlbumSynced: async () => ({ count: 1 }), setAlbumSyncError: async () => ({ count: 1 }) };
  const { createAiEditingService } = require("../src/modules/image-selection/ai-editing/service");
  const albumCalls = [];
  const raced = createAiEditingService(repo, {
    areLinked: async () => true,
    r2: { isConfigured: () => true, publicUrl: () => null, getObjectStream: async () => Readable.from([Buffer.from("M")]) },
    processing: { recipeForModule: async () => ({}), renderWithRecipe: async () => ({ thumbnail: { data: Buffer.from("t"), info: { size: 1 } }, preview: { data: Buffer.from("p"), info: { size: 1 } } }) },
    albumService: { syncEditedCopy: async (...args) => { albumCalls.push(args); return { albumId: "a", photoId: "p" }; } },
    queue: { enqueue: async () => {}, enqueueAlbumSync: async () => {} }, settings: { read: async () => ({}) },
  });
  assert.deepEqual(await raced.syncToAlbum("e1", 3), { synced: false, skipped: "superseded" });
  assert.equal(albumCalls.length, 0);
  assert.ok(original && calls);
});

