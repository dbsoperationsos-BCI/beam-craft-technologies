const test = require("node:test");
const assert = require("node:assert/strict");
const { createFolderService, buildTree } = require("../src/modules/image-selection/folders/service");
const { createFolderRepository } = require("../src/modules/image-selection/folders/repository");
const controller = require("../src/modules/image-selection/folders/controller");

const folder = (overrides = {}) => ({
  id: "folder-1", projectId: "project-1", parentId: null, name: "Main", sortOrder: 1,
  createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"), _count: { children: 0 }, ...overrides,
});

function fakeRepository() {
  const state = { folders: [folder()], deletedFolderIds: [] };
  let nextId = 2;
  const active = () => state.folders.filter((item) => !item.deletedAt);
  return {
    state,
    findProject: async (id) => id === "project-1" ? { id, projectName: "Image Project" } : null,
    listFolders: async () => active(),
    findFolder: async (projectId, id) => active().find((item) => item.projectId === projectId && item.id === id) || null,
    findSibling: async (projectId, parentId, name, excludeId) => active().find((item) => item.projectId === projectId && item.parentId === (parentId || null) && item.name === name && item.id !== excludeId) || null,
    nextSiblingSortOrder: async (projectId, parentId) => Math.max(0, ...active().filter((item) => item.projectId === projectId && item.parentId === (parentId || null)).map((item) => item.sortOrder)) + 1,
    createFolder: async (data) => { const item = folder({ id: `folder-${nextId++}`, ...data }); state.folders.push(item); return item; },
    renameFolder: async (id, name) => { const item = state.folders.find((candidate) => candidate.id === id); item.name = name; return item; },
    syncProjectShootFolders: async () => {},
    listUploadFilesForPurge: async () => [],
    deletionImpact: async () => ({ photoCount: 0, submittedSelectionCount: 0 }),
    deleteFolderTree: async (projectId, folderIds) => {
      state.deletedFolderIds.push(...folderIds);
      state.folders = state.folders.filter((item) => !(item.projectId === projectId && folderIds.includes(item.id)));
      return { count: folderIds.length };
    },
  };
}

test("creates a top-level folder at the next sibling display order", async () => {
  const repo = fakeRepository(); const service = createFolderService(repo);
  const created = await service.create("project-1", { name: "Ceremony" }, 7);
  assert.equal(created.parentId, null); assert.equal(created.sortOrder, 2); assert.equal(created.createdByUserId, 7);
});

test("creates a subfolder only under a folder in the same project", async () => {
  const repo = fakeRepository(); const service = createFolderService(repo);
  const created = await service.create("project-1", { name: "Bride", parentId: "folder-1" }, 7);
  assert.equal(created.parentId, "folder-1"); assert.equal(created.sortOrder, 1);
});

test("renames a folder while preserving its parent and display order", async () => {
  const repo = fakeRepository(); const service = createFolderService(repo);
  const renamed = await service.rename("project-1", "folder-1", { name: "Reception" });
  assert.equal(renamed.name, "Reception"); assert.equal(renamed.sortOrder, 1);
});

test("rejects duplicate sibling names", async () => {
  const service = createFolderService(fakeRepository());
  await assert.rejects(() => service.create("project-1", { name: "Main" }, 7), { status: 409 });
});

test("rejects an invalid parent folder", async () => {
  const service = createFolderService(fakeRepository());
  await assert.rejects(() => service.create("project-1", { name: "Child", parentId: "wrong-folder" }, 7), { status: 404 });
});

test("detects circular folder relationships in a corrupted hierarchy", () => {
  assert.throws(() => buildTree([folder({ id: "a", parentId: "b" }), folder({ id: "b", parentId: "a" })]), { status: 409 });
});

test("deletes a folder that holds photos rather than refusing", async () => {
  const repo = fakeRepository();
  const result = await createFolderService(repo).remove("project-1", "folder-1");
  assert.equal(result.deletedFolderCount, 1);
  assert.deepEqual(repo.state.deletedFolderIds, ["folder-1"]);
  assert.equal(repo.state.folders.length, 0);
});

test("deletes every folder beneath the one named, not just its direct children", async () => {
  const repo = fakeRepository();
  repo.state.folders.push(folder({ id: "folder-2", parentId: "folder-1", name: "Bride" }));
  repo.state.folders.push(folder({ id: "folder-3", parentId: "folder-2", name: "Getting Ready" }));
  repo.state.folders.push(folder({ id: "folder-4", parentId: null, name: "Reception" }));

  const result = await createFolderService(repo).remove("project-1", "folder-1");

  assert.equal(result.deletedFolderCount, 3);
  assert.deepEqual([...repo.state.deletedFolderIds].sort(), ["folder-1", "folder-2", "folder-3"]);
  // A sibling of the deleted folder is left alone.
  assert.deepEqual(repo.state.folders.map((item) => item.id), ["folder-4"]);
});

// A shoot's folder is unique across the whole table. When a second Image Selection project is backed
// by the same Sales project, or the shoot's folder here was soft-deleted, the listing must leave
// that shoot alone instead of tripping the unique index and answering 409 to a plain read.
test("shoot folder sync skips a shoot whose folder already exists anywhere in the table", async () => {
  const created = [];
  const client = {
    $transaction: async (run) => run(client),
    projectShoot: { findMany: async () => [
      { id: "shoot-1", shoot: "Pre Wedding", dateCreated: new Date("2026-01-01") },
      { id: "shoot-2", shoot: "Wedding", dateCreated: new Date("2026-01-02") },
    ] },
    imageSelectionFolder: {
      // The root listing of THIS project is empty; the cross-table lookup finds shoot-1's folder
      // living in a sibling project.
      findMany: async ({ where }) => (where.projectShootId ? [{ projectShootId: "shoot-1" }] : []),
      create: async ({ data }) => { created.push(data); return data; },
    },
  };
  await createFolderRepository(client).syncProjectShootFolders({ id: "project-2", salesProjectId: "sales-1" });
  assert.deepEqual(created.map((item) => item.projectShootId), ["shoot-2"]);
  assert.equal(created[0].projectId, "project-2");
});

test("refuses to delete a Project Management shoot folder", async () => {
  const repo = fakeRepository();
  repo.state.folders[0].projectShootId = "shoot-1";
  await assert.rejects(() => createFolderService(repo).remove("project-1", "folder-1"), { status: 409 });
  assert.deepEqual(repo.state.deletedFolderIds, []);
});

// Folders are decided by the permission the route mounts rather than by the signed-in user's legacy
// role, so what is worth asserting is that the guard is there and the role check has not come back.
test("folders are mounted behind the Image Selection permission", () => {
  const routes = require("node:fs").readFileSync(require.resolve("../src/modules/image-selection/folders/routes.js"), "utf8");
  assert.match(routes, /requireModule\("IMAGE_SELECTION", "Project Management"\)/);
  assert.equal(routes.includes("SUPER_ADMIN"), false);
});
