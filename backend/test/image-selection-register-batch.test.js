const test = require("node:test");
const assert = require("node:assert/strict");
const { createOriginalsService } = require("../src/modules/image-selection/originals/service");
const { registerBatchSchema } = require("../src/modules/image-selection/originals/validation");

// The desktop registration path: metadata only, no server-side stat, identity = storage root +
// relative trail, deduped per folder. These tests pin the trust boundary — what is accepted from
// the desktop, what is refused, and what a re-run leaves alone.

function fakeRepository({ existingPaths = [] } = {}) {
  const state = { uploads: [], nextId: 1 };
  return {
    state,
    findProject: async (id) => (id === "project-1" ? { id, projectName: "Test" } : null),
    findFolder: async (projectId, folderId) => (folderId === "folder-1" ? { id: folderId, name: "Wedding" } : null),
    findStorageRoot: async (id) => (id === "root-1" ? { id, name: "STUDIO_NAS_MAIN" } : null),
    listRegisteredFolderPaths: async () => existingPaths,
    createUpload: async (data) => { const upload = { id: `upload-${state.nextId++}`, ...data }; state.uploads.push(upload); return upload; },
  };
}
const serviceFor = (repo) => createOriginalsService(repo, { settings: { read: async () => ({}) } });

test("registers desktop-scanned photos with storage root identity and no queue", async () => {
  const repo = fakeRepository();
  const result = await serviceFor(repo).registerBatch("project-1", {
    folderId: "folder-1",
    storageRootId: "root-1",
    files: [{ relativePath: "2026/Raj-Priya/Wedding/DSC_0001.JPG", sizeBytes: 123, width: 6000, height: 4000 }],
  });
  assert.equal(result.registered, 1);
  assert.equal(result.storageRoot, "STUDIO_NAS_MAIN");
  const row = repo.state.uploads[0];
  assert.equal(row.storageRootId, "root-1");
  assert.equal(row.originalPath, "2026/Raj-Priya/Wedding/DSC_0001.JPG");
  assert.equal(row.status, "PROCESSING");
  assert.equal(row.width, 6000);
});

test("a re-run reports duplicates per folder instead of creating second rows", async () => {
  const repo = fakeRepository({ existingPaths: [{ folderId: "folder-1", originalPath: "wedding/dsc_0001.jpg" }] });
  const result = await serviceFor(repo).registerBatch("project-1", {
    folderId: "folder-1",
    storageRootId: "root-1",
    files: [
      { relativePath: "Wedding/DSC_0001.JPG", sizeBytes: 1 },
      { relativePath: "Wedding/DSC_0002.JPG", sizeBytes: 2 },
    ],
  });
  assert.equal(result.duplicates, 1);
  assert.equal(result.registered, 1);
  assert.equal(repo.state.uploads.length, 1);
});

test("the same trail under a different folder is not a duplicate", async () => {
  const repo = fakeRepository({ existingPaths: [{ folderId: "folder-other", originalPath: "wedding/dsc_0001.jpg" }] });
  const result = await serviceFor(repo).registerBatch("project-1", {
    folderId: "folder-1",
    storageRootId: "root-1",
    files: [{ relativePath: "Wedding/DSC_0001.JPG", sizeBytes: 1 }],
  });
  assert.equal(result.registered, 1);
});

test("refuses traversal trails and non-images without failing the batch", async () => {
  const repo = fakeRepository();
  const result = await serviceFor(repo).registerBatch("project-1", {
    folderId: null,
    storageRootId: "root-1",
    files: [
      { relativePath: "../outside/secret.jpg", sizeBytes: 1 },
      { relativePath: "Wedding/notes.txt", sizeBytes: 1 },
      { relativePath: "Wedding/DSC_0009.NEF", sizeBytes: 1 },
    ],
  });
  assert.equal(result.registered, 1);
  assert.equal(result.skipped.length, 2);
});

test("an unknown storage root or folder is a 404, not a silent null", async () => {
  const service = serviceFor(fakeRepository());
  await assert.rejects(() => service.registerBatch("project-1", { storageRootId: "nope", files: [{ relativePath: "a.jpg", sizeBytes: 1 }] }), { status: 404 });
  await assert.rejects(() => service.registerBatch("project-1", { folderId: "nope", storageRootId: "root-1", files: [{ relativePath: "a.jpg", sizeBytes: 1 }] }), { status: 404 });
});

test("validation refuses absolute paths and empty batches", () => {
  assert.equal(registerBatchSchema.safeParse({ storageRootId: "root-1", files: [] }).success, false);
  assert.equal(registerBatchSchema.safeParse({ storageRootId: "root-1", files: [{ relativePath: "C:/photos/a.jpg", sizeBytes: 1 }] }).success, false);
  assert.equal(registerBatchSchema.safeParse({ storageRootId: "root-1", files: [{ relativePath: "Wedding/a.jpg", sizeBytes: 1 }] }).success, true);
});
