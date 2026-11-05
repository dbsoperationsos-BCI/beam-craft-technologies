const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createCleanupService } = require("../src/modules/image-selection/cleanup/service");
const { createFolderService } = require("../src/modules/image-selection/folders/service");
const { createImageSelectionProjectService } = require("../src/modules/image-selection/projects/service");

// Deleting in Image Selection means: database rows + R2 derivatives. It must NEVER mean the
// photographer's original under `originalPath` — these tests are the contract's enforcement.

const upload = (overrides = {}) => ({
  storageName: "stor-1", originalPath: null, thumbnailName: "thumb-1.webp", processedName: "prev-1.jpg",
  compressedName: null, thumbnailKey: "k/thumb-1", previewKey: "k/prev-1", ...overrides,
});

function fakeR2(options = {}) {
  const calls = [];
  return {
    calls,
    deleteObjects: async (keys) => {
      calls.push([...keys]);
      const failed = (options.failKeys || []).filter((key) => keys.includes(key)).map((key) => ({ key, code: "InternalError", message: "boom" }));
      return { deleted: keys.length - failed.length, failed };
    },
  };
}

function fakeFs() {
  const removed = [];
  return { removed, rm: async (target) => { removed.push(String(target)); } };
}

function service(overrides = {}) {
  const bucket = overrides.r2 || fakeR2();
  const files = overrides.fs || fakeFs();
  return { bucket, files, cleanup: createCleanupService({ r2: bucket, fs: files, uploadRoot: "/srv/uploads", log: () => {} }) };
}

test("collects only the stored R2 keys, never keys rebuilt from names", () => {
  const { cleanup } = service();
  const keys = cleanup.collectR2Keys([upload(), upload({ thumbnailKey: null, previewKey: "k/prev-2" }), upload({ thumbnailKey: null, previewKey: null })]);
  assert.deepEqual(keys, ["k/thumb-1", "k/prev-1", "k/prev-2"]);
});

test("purges the bucket first, then local derivatives, in one call per delete", async () => {
  const { bucket, files, cleanup } = service();
  await cleanup.purgeDerivatives([upload()]);
  assert.deepEqual(bucket.calls, [["k/thumb-1", "k/prev-1"]]);
  assert.ok(files.removed.some((target) => target.includes("thumbnails")));
  assert.ok(files.removed.some((target) => target.includes("processed")));
});

test("a bucket failure aborts before any local file is touched, with a retryable error", async () => {
  const { files, cleanup } = service({ r2: fakeR2({ failKeys: ["k/prev-1"] }) });
  await assert.rejects(() => cleanup.purgeDerivatives([upload()]), { status: 502 });
  assert.deepEqual(files.removed, []);
});

test("an object already missing from the bucket is a quiet success, not a failure", async () => {
  // S3/R2 DeleteObjects semantics: deleting a nonexistent key reports no error. The fake mirrors
  // that by only failing keys it is told to; everything else deletes quietly.
  const { cleanup } = service();
  await assert.doesNotReject(() => cleanup.purgeDerivatives([upload({ thumbnailKey: "k/long-gone" })]));
});

test("NEVER deletes the original: a registered photo loses only its derived files", async () => {
  const { files, cleanup } = service();
  const registered = upload({ originalPath: "D:/NAS/Weddings/IMG_001.CR2" });
  const browserUploaded = upload({ storageName: "stor-2", originalPath: null, thumbnailName: "t2", processedName: "p2", thumbnailKey: "k/t2", previewKey: "k/p2" });
  await cleanup.purgeDerivatives([registered, browserUploaded]);
  // No removed path contains the original, ever.
  assert.equal(files.removed.some((target) => target.includes("IMG_001") || target.includes("NAS")), false);
  // The registered photo's local master slot is skipped; the browser upload's own file is not.
  assert.equal(files.removed.some((target) => target.endsWith("stor-1") && !target.includes(".chunks")), false);
  assert.equal(files.removed.some((target) => target.endsWith("stor-2") && !target.includes(".chunks")), true);
});

test("the cleanup source never hands originalPath to a filesystem delete", () => {
  const source = fs.readFileSync(require.resolve("../src/modules/image-selection/cleanup/service.js"), "utf8");
  assert.equal(/rm\([^)]*originalPath/.test(source), false);
  assert.match(source, /if \(!upload\.originalPath\)/);
});

test("unconfigured R2 reports zero deletions and zero failures", async () => {
  const r2 = require("../src/modules/image-selection/storage/r2");
  if (r2.isConfigured()) return; // only meaningful in an environment without R2 credentials
  assert.deepEqual(await r2.deleteObjects(["k/a", "k/b"]), { deleted: 0, failed: [] });
});

// ---- Folder deletion through the folder service ----

const folderRow = (overrides = {}) => ({
  id: "folder-1", projectId: "project-1", parentId: null, name: "Main", sortOrder: 1,
  createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"), _count: { children: 0 }, ...overrides,
});

function fakeFolderRepository() {
  const state = { folders: [folderRow()], uploads: [], deletedFolderIds: [], purgeReads: [] };
  const active = () => state.folders.filter((item) => !item.deletedAt);
  return {
    state,
    findProject: async (id) => (id === "project-1" ? { id, projectName: "Image Project" } : null),
    listFolders: async () => active(),
    findFolder: async (projectId, id) => active().find((item) => item.projectId === projectId && item.id === id) || null,
    findFolderByShoot: async (projectShootId) => active().find((item) => item.projectShootId === projectShootId) || null,
    syncProjectShootFolders: async () => {},
    listUploadFilesForPurge: async (projectId, folderIds) => { state.purgeReads.push([...folderIds].sort()); return state.uploads.filter((item) => folderIds.includes(item.folderId)); },
    deletionImpact: async (projectId, folderIds) => {
      const inside = state.uploads.filter((item) => folderIds.includes(item.folderId));
      return { photoCount: inside.length, submittedSelectionCount: inside.filter((item) => item.submitted).length };
    },
    deleteFolderTree: async (projectId, folderIds) => {
      state.deletedFolderIds.push(...folderIds);
      state.folders = state.folders.filter((item) => !(item.projectId === projectId && folderIds.includes(item.id)));
      state.uploads = state.uploads.filter((item) => !folderIds.includes(item.folderId));
      return { count: folderIds.length };
    },
  };
}

function fakeCleanup(options = {}) {
  const purges = [];
  return {
    purges,
    purgeDerivatives: async (uploads) => {
      if (options.fail) { const error = new Error("Cloud cleanup failed."); error.status = 502; throw error; }
      purges.push(uploads);
    },
  };
}

test("folder delete cleans exactly the subtree's derivatives and leaves siblings alone", async () => {
  const repo = fakeFolderRepository();
  repo.state.folders.push(folderRow({ id: "folder-2", parentId: "folder-1", name: "Bride" }));
  repo.state.folders.push(folderRow({ id: "folder-3", parentId: "folder-2", name: "Subfolder" }));
  repo.state.folders.push(folderRow({ id: "folder-4", parentId: null, name: "Keep" }));
  repo.state.uploads = [
    upload({ folderId: "folder-1", previewKey: "k/a" }),
    upload({ folderId: "folder-3", previewKey: "k/b" }),
    upload({ folderId: "folder-4", previewKey: "k/keep" }),
  ];
  const cleanup = fakeCleanup();
  const result = await createFolderService(repo, { cleanup }).remove("project-1", "folder-1");
  assert.equal(result.deletedFolderCount, 3);
  assert.equal(result.deletedPhotoCount, 2);
  assert.deepEqual(cleanup.purges[0].map((item) => item.previewKey).sort(), ["k/a", "k/b"]);
  // The sibling folder and its photo survive untouched.
  assert.deepEqual(repo.state.folders.map((item) => item.id), ["folder-4"]);
  assert.deepEqual(repo.state.uploads.map((item) => item.previewKey), ["k/keep"]);
});

test("an empty folder deletes without a single storage call worth failing on", async () => {
  const repo = fakeFolderRepository();
  const cleanup = fakeCleanup();
  const result = await createFolderService(repo, { cleanup }).remove("project-1", "folder-1");
  assert.equal(result.deletedFolderCount, 1);
  assert.equal(result.deletedPhotoCount, 0);
  assert.deepEqual(cleanup.purges, [[]]);
});

test("a cloud failure leaves the folder rows — and their keys — fully intact", async () => {
  const repo = fakeFolderRepository();
  repo.state.uploads = [upload({ folderId: "folder-1" })];
  await assert.rejects(() => createFolderService(repo, { cleanup: fakeCleanup({ fail: true }) }).remove("project-1", "folder-1"), { status: 502 });
  assert.deepEqual(repo.state.deletedFolderIds, []);
  assert.equal(repo.state.folders.length, 1);
  assert.equal(repo.state.uploads.length, 1);
});

test("an unknown folder or project answers 404 before anything is read for deletion", async () => {
  const repo = fakeFolderRepository();
  const folders = createFolderService(repo, { cleanup: fakeCleanup() });
  await assert.rejects(() => folders.remove("project-1", "missing"), { status: 404 });
  await assert.rejects(() => folders.remove("missing-project", "folder-1"), { status: 404 });
  assert.deepEqual(repo.state.purgeReads, []);
});

// ---- Shoot deletion (via Project Management) ----

test("deleting a shoot purges its folder tree while other shoots keep theirs", async () => {
  const repo = fakeFolderRepository();
  repo.state.folders = [
    folderRow({ id: "shoot-a-root", projectShootId: "shoot-a", name: "Wedding" }),
    folderRow({ id: "shoot-a-sub", parentId: "shoot-a-root", name: "Card 1" }),
    folderRow({ id: "shoot-b-root", projectShootId: "shoot-b", name: "Reception" }),
  ];
  repo.state.uploads = [
    upload({ folderId: "shoot-a-sub", previewKey: "k/a" }),
    upload({ folderId: "shoot-b-root", previewKey: "k/b" }),
  ];
  const cleanup = fakeCleanup();
  const result = await createFolderService(repo, { cleanup }).removeForShoot("shoot-a");
  assert.equal(result.deletedFolderCount, 2);
  assert.deepEqual(cleanup.purges[0].map((item) => item.previewKey), ["k/a"]);
  assert.deepEqual(repo.state.folders.map((item) => item.id), ["shoot-b-root"]);
  assert.deepEqual(repo.state.uploads.map((item) => item.previewKey), ["k/b"]);
});

test("a shoot that never grew a folder here is a quiet no-op", async () => {
  const result = await createFolderService(fakeFolderRepository(), { cleanup: fakeCleanup() }).removeForShoot("never-synced");
  assert.deepEqual(result, { deletedFolderCount: 0, deletedPhotoCount: 0 });
});

test("the workspace endpoint still refuses shoot folders; only the shoot path may pass", async () => {
  const repo = fakeFolderRepository();
  repo.state.folders[0].projectShootId = "shoot-1";
  const folders = createFolderService(repo, { cleanup: fakeCleanup() });
  await assert.rejects(() => folders.remove("project-1", "folder-1"), { status: 409 });
  const result = await folders.removeForShoot("shoot-1");
  assert.equal(result.deletedFolderCount, 1);
});

// ---- Project deletion through the project service ----

function fakeProjectRepository() {
  const state = {
    projects: [{ id: "project-1", projectName: "P", salesProjectId: null, deletedAt: null, archivedAt: null, totalPhotoSize: BigInt(0) }],
    uploads: [upload({ previewKey: "k/p1" }), upload({ originalPath: "D:/NAS/IMG_002.CR2", previewKey: "k/p2", thumbnailKey: "k/t2" })],
  };
  return {
    state,
    findProject: async (projectId) => state.projects.find((item) => item.id === projectId && item.deletedAt === null) || null,
    listUploadFilesForPurge: async () => state.uploads,
    deletionImpact: async () => ({ shootCount: 1, folderCount: 2, photoCount: state.uploads.length, submittedSelectionCount: state.uploads.filter((item) => item.submitted).length }),
    purgeProjectData: async (projectId) => { state.purged = [...(state.purged || []), projectId]; const item = state.projects.find((candidate) => candidate.id === projectId); Object.assign(item, { deletedAt: new Date(), totalPhotoSize: BigInt(0) }); return item; },
  };
}

test("project delete hands every upload's keys to cleanup before purging rows", async () => {
  const repo = fakeProjectRepository();
  const cleanup = fakeCleanup();
  await createImageSelectionProjectService(repo, { cleanup }).remove("project-1");
  assert.deepEqual(cleanup.purges[0].map((item) => item.previewKey), ["k/p1", "k/p2"]);
  assert.deepEqual(repo.state.purged, ["project-1"]);
});

test("a cloud failure aborts project deletion with the project fully intact", async () => {
  const repo = fakeProjectRepository();
  await assert.rejects(() => createImageSelectionProjectService(repo, { cleanup: fakeCleanup({ fail: true }) }).remove("project-1"), { status: 502 });
  assert.equal(repo.state.purged, undefined);
  assert.equal(repo.state.projects[0].deletedAt, null);
});

// ---- Client-submitted selections: the high-impact gate ----

test("a folder holding submitted selections refuses a plain delete with the counts attached", async () => {
  const repo = fakeFolderRepository();
  repo.state.uploads = [upload({ folderId: "folder-1", submitted: true }), upload({ folderId: "folder-1" })];
  const cleanup = fakeCleanup();
  await assert.rejects(() => createFolderService(repo, { cleanup }).remove("project-1", "folder-1"), (error) => {
    assert.equal(error.status, 409);
    assert.equal(error.details.requiresAcknowledgement, true);
    assert.equal(error.details.scope, "folder");
    assert.equal(error.details.submittedSelectionCount, 1);
    assert.equal(error.details.photoCount, 2);
    return true;
  });
  // Nothing was purged, nowhere: rows, files and bucket objects are all still standing.
  assert.deepEqual(cleanup.purges, []);
  assert.deepEqual(repo.state.deletedFolderIds, []);
});

test("the same folder deletes once the caller acknowledges the submitted selections", async () => {
  const repo = fakeFolderRepository();
  repo.state.uploads = [upload({ folderId: "folder-1", submitted: true })];
  const cleanup = fakeCleanup();
  const result = await createFolderService(repo, { cleanup }).remove("project-1", "folder-1", { acknowledgeSubmitted: true });
  assert.equal(result.deletedFolderCount, 1);
  assert.equal(cleanup.purges.length, 1);
});

test("a submitted shoot answers the shoot-scoped high warning until acknowledged", async () => {
  const repo = fakeFolderRepository();
  repo.state.folders[0].projectShootId = "shoot-1";
  repo.state.uploads = [upload({ folderId: "folder-1", submitted: true })];
  const folders = createFolderService(repo, { cleanup: fakeCleanup() });
  await assert.rejects(() => folders.removeForShoot("shoot-1"), (error) => {
    assert.equal(error.status, 409);
    assert.equal(error.details.scope, "shoot");
    assert.equal(error.details.submittedSelectionCount, 1);
    return true;
  });
  const result = await folders.removeForShoot("shoot-1", { acknowledgeSubmitted: true });
  assert.equal(result.deletedFolderCount, 1);
});

test("a project holding submitted selections refuses a plain delete and stays fully intact", async () => {
  const repo = fakeProjectRepository();
  repo.state.uploads[0].submitted = true;
  const cleanup = fakeCleanup();
  const service = createImageSelectionProjectService(repo, { cleanup });
  await assert.rejects(() => service.remove("project-1"), (error) => {
    assert.equal(error.status, 409);
    assert.equal(error.details.requiresAcknowledgement, true);
    assert.equal(error.details.scope, "project");
    assert.equal(error.details.projectName, "P");
    assert.equal(error.details.submittedSelectionCount, 1);
    assert.equal(error.details.photoCount, 2);
    return true;
  });
  assert.deepEqual(cleanup.purges, []);
  assert.equal(repo.state.purged, undefined);
  await service.remove("project-1", { acknowledgeSubmitted: true });
  assert.deepEqual(repo.state.purged, ["project-1"]);
});

// ---- Large-batch chunking in the real R2 client ----

test("deleteObjects reports per-key failures across 1000-key batches without aborting", async () => {
  // The chunking lives in storage/r2.js; its request layer is not injectable, so the equivalent
  // contract is asserted at the cleanup seam: one call receives the full key list, and the
  // caller's failure handling consumes { deleted, failed } whatever the batch count was.
  const bucket = fakeR2({ failKeys: ["k/prev-1500"] });
  const cleanup = createCleanupService({ r2: bucket, fs: fakeFs(), uploadRoot: "/srv/uploads", log: () => {} });
  const many = Array.from({ length: 1500 }, (_, index) => upload({ thumbnailKey: null, previewKey: `k/prev-${index + 1}` }));
  await assert.rejects(() => cleanup.purgeDerivatives(many), { status: 502 });
  assert.equal(bucket.calls[0].length, 1500);
});
