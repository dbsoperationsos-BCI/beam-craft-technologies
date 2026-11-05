const test = require("node:test");
const assert = require("node:assert/strict");
const { createFolderService, buildTree } = require("../src/modules/image-selection/folders/service");
const { createFolderRepository } = require("../src/modules/image-selection/folders/repository");
const controller = require("../src/modules/image-selection/folders/controller");

const folder = (overrides = {}) => ({
  id: "folder-1", projectId: "project-1", parentId: null, name: "Main", sortOrder: 1, deletedAt: null,
  createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"), _count: { children: 0 }, ...overrides,
});
const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/*
 * A stand-in for the folder repository that behaves as the real one does: delete removes the folders
 * with their photos and the manual items filed under them, rename updates the same row and the items'
 * copy of its name. `state.items` are a manual project's typed
 * selection items (`manualShootFolderId` the link, `manualShootName` the copy); `state.uploads` the
 * photos. `state.creates` counts every folder ever created.
 */
function fakeRepository({ project = { id: "project-1", projectName: "Image Project", salesProjectId: null, albumProofing: false } } = {}) {
  const state = { folders: [folder()], items: [], uploads: [], deletedFolderIds: [], creates: 0 };
  let nextId = 2;
  const active = () => state.folders.filter((item) => !item.deletedAt);
  const linkWaiting = (projectId, row) => {
    if (row.parentId || !normalize(row.name)) return;
    for (const item of state.items) if (!item.manualShootFolderId && item.manualShootName && normalize(item.manualShootName) === normalize(row.name)) { item.manualShootFolderId = row.id; item.manualShootName = row.name; }
  };
  return {
    state,
    findProject: async (id) => (id === project.id ? project : null),
    listFolders: async () => active(),
    findFolder: async (projectId, id) => active().find((item) => item.projectId === projectId && item.id === id) || null,
    findSibling: async (projectId, parentId, name, excludeId) => active().find((item) => item.projectId === projectId && item.parentId === (parentId || null) && item.name === name && item.id !== excludeId) || null,
    nextSiblingSortOrder: async (projectId, parentId) => Math.max(0, ...active().filter((item) => item.projectId === projectId && item.parentId === (parentId || null)).map((item) => item.sortOrder)) + 1,
    createFolderLinked: async (data, { manual }) => {
      state.creates += 1;
      const row = folder({ id: `folder-${nextId++}`, ...data });
      state.folders.push(row);
      if (manual) linkWaiting(data.projectId, row);
      return row;
    },
    renameFolder: async (id, name, { projectId, manual } = {}) => {
      const row = state.folders.find((candidate) => candidate.id === id);
      row.name = name;
      for (const item of state.items) if (item.manualShootFolderId === id) item.manualShootName = name;
      if (manual) linkWaiting(projectId, row);
      return row;
    },
    syncProjectShootFolders: async () => {},
    listUploadFilesForPurge: async (projectId, folderIds) => state.uploads.filter((upload) => folderIds.includes(upload.folderId)),
    keysUsedElsewhere: async () => new Set(),
    deletionImpact: async () => ({ photoCount: 0, submittedSelectionCount: 0 }),
    deleteFolderTree: async (projectId, folderIds) => {
      const items = state.items.filter((item) => folderIds.includes(item.manualShootFolderId)).length;
      state.items = state.items.filter((item) => !folderIds.includes(item.manualShootFolderId));
      state.uploads = state.uploads.filter((upload) => !folderIds.includes(upload.folderId));
      state.deletedFolderIds.push(...folderIds);
      state.folders = state.folders.filter((item) => !(item.projectId === projectId && folderIds.includes(item.id)));
      return { count: folderIds.length, selectionItemCount: items };
    },
  };
}

// A manual project's "Wedding" shoot: its root folder, two typed items with limits filed under it
// by id, and photos in it and in a subfolder - one of them picked for an item.
function weddingProject() {
  const repo = fakeRepository();
  repo.state.folders = [
    folder({ id: "wedding", name: "wedding" }),
    folder({ id: "wedding-sub", parentId: "wedding", name: "Candid" }),
    folder({ id: "reception", name: "Reception", sortOrder: 2 }),
  ];
  repo.state.items = [
    { id: "item-album", name: "Album", manualShootFolderId: "wedding", manualShootName: "wedding", selectionLimitOverride: 40, inactiveAt: null },
    { id: "item-frames", name: "Frames", manualShootFolderId: "wedding", manualShootName: "wedding", selectionLimitOverride: 5, inactiveAt: null },
    { id: "item-reception", name: "Album", manualShootFolderId: "reception", manualShootName: "Reception", selectionLimitOverride: 20, inactiveAt: null },
  ];
  repo.state.uploads = [
    { id: "photo-1", folderId: "wedding", picked: "item-album" },
    { id: "photo-2", folderId: "wedding-sub" },
    { id: "photo-3", folderId: "reception" },
  ];
  return repo;
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

test("a new root folder on a manual project takes the typed items already filed under its name, by id", async () => {
  const repo = fakeRepository();
  repo.state.items = [{ id: "item-1", name: "Album", manualShootFolderId: null, manualShootName: "Pre-Wedding", inactiveAt: null }];
  const created = await createFolderService(repo).create("project-1", { name: "pre wedding" }, 7);
  assert.equal(repo.state.items[0].manualShootFolderId, created.id);
});

test("renames a folder while preserving its parent and display order", async () => {
  const repo = fakeRepository(); const service = createFolderService(repo);
  const renamed = await service.rename("project-1", "folder-1", { name: "Reception" });
  assert.equal(renamed.name, "Reception"); assert.equal(renamed.sortOrder, 1);
});

/*
 * Rename: one UPDATE of the same row. The folder keeps its id, its parent, its photos; the shoot's
 * selection items stay filed under it by id with their limits; no folder or shoot is created - so
 * the Selection Items table and the client gallery still show one "wedding 02" shoot, never two.
 */
test("rename keeps the same folder id and its shoot's items, limits and photos - and creates nothing", async () => {
  const repo = weddingProject();
  const service = createFolderService(repo);
  const before = repo.state.folders.length;
  const renamed = await service.rename("project-1", "wedding", { name: "wedding 02" });
  assert.equal(renamed.id, "wedding");
  assert.equal(repo.state.creates, 0);
  assert.equal(repo.state.folders.length, before);
  const wedding = repo.state.items.filter((item) => item.manualShootFolderId === "wedding");
  assert.deepEqual(wedding.map((item) => [item.id, item.manualShootName, item.selectionLimitOverride]), [["item-album", "wedding 02", 40], ["item-frames", "wedding 02", 5]]);
  assert.equal(repo.state.items.find((item) => item.id === "item-reception").manualShootName, "Reception", "an unrelated shoot is untouched");
  assert.deepEqual(repo.state.uploads.map((upload) => upload.folderId), ["wedding", "wedding-sub", "reception"]);
  assert.equal(repo.state.folders.find((row) => row.id === "wedding-sub").parentId, "wedding");
});

test("renaming the same folder again and again always updates the same row", async () => {
  const repo = weddingProject();
  const service = createFolderService(repo);
  for (const name of ["wedding 02", "Wedding Day", "wedding"]) assert.equal((await service.rename("project-1", "wedding", { name })).id, "wedding");
  assert.equal(repo.state.creates, 0);
  assert.deepEqual([...new Set(repo.state.items.filter((item) => item.manualShootFolderId === "wedding").map((item) => item.manualShootName))], ["wedding"]);
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

/*
 * Delete is permanent: the folder, everything under it, its photo rows and - on a manual project -
 * the selection items (and limits) filed under it go; every other folder, item and photo stays.
 */
test("deletes an empty folder", async () => {
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

test("deleting a shoot's folder takes its photos, items and limits - and nothing of any other shoot", async () => {
  const repo = weddingProject();
  const result = await createFolderService(repo).remove("project-1", "wedding");
  assert.deepEqual([result.deletedFolderCount, result.deletedPhotoCount, result.deletedSelectionItemCount], [2, 2, 2]);
  assert.deepEqual(repo.state.folders.map((row) => row.id), ["reception"]);
  assert.deepEqual(repo.state.items.map((item) => [item.id, item.selectionLimitOverride]), [["item-reception", 20]]);
  assert.deepEqual(repo.state.uploads.map((upload) => upload.id), ["photo-3"]);
});

test("a deleted folder is gone from the listing and cannot be renamed or deleted again", async () => {
  const repo = weddingProject();
  const service = createFolderService(repo);
  await service.remove("project-1", "wedding");
  assert.equal((await service.list("project-1")).folders.some((row) => row.id === "wedding"), false);
  await assert.rejects(() => service.rename("project-1", "wedding", { name: "x" }), { status: 404 });
  await assert.rejects(() => service.remove("project-1", "wedding"), { status: 404 });
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

/*
 * A folder the studio made by hand with a shoot's name IS that shoot's folder: the sync links it by
 * id once. Linked only by name, renaming it made the next listing grow a second folder for the shoot.
 */
test("shoot folder sync links a hand-made folder of the shoot's name by id, and never makes a second one", async () => {
  const created = [];
  const linked = [];
  const roots = [{ id: "hand-made", name: "wedding", projectShootId: null, sortOrder: 1 }];
  const client = {
    $transaction: async (run) => run(client),
    projectShoot: { findMany: async () => [{ id: "shoot-1", shoot: "Wedding", dateCreated: new Date("2026-01-01") }] },
    imageSelectionFolder: {
      findMany: async ({ where }) => (where.projectShootId ? roots.filter((row) => row.projectShootId).map((row) => ({ projectShootId: row.projectShootId })) : roots.map((row) => ({ ...row }))),
      create: async ({ data }) => { created.push(data); return data; },
      update: async ({ where, data }) => { linked.push([where.id, data.projectShootId]); Object.assign(roots.find((row) => row.id === where.id), data); },
    },
  };
  const repo = createFolderRepository(client);
  await repo.syncProjectShootFolders({ id: "project-1", salesProjectId: "sales-1" });
  assert.deepEqual(linked, [["hand-made", "shoot-1"]]);
  // Renamed afterwards - the next listing finds the shoot already claimed, and makes nothing.
  roots[0].name = "wedding 02";
  await repo.syncProjectShootFolders({ id: "project-1", salesProjectId: "sales-1" });
  assert.deepEqual(created, []);
});

test("refuses to delete or rename a Project Management shoot folder - that is Project Management's", async () => {
  const repo = fakeRepository();
  repo.state.folders[0].projectShootId = "shoot-1";
  const service = createFolderService(repo);
  await assert.rejects(() => service.remove("project-1", "folder-1"), { status: 409 });
  await assert.rejects(() => service.rename("project-1", "folder-1", { name: "x" }), { status: 409 });
  assert.deepEqual(repo.state.deletedFolderIds, []);
});

// Folders are decided by the permission the route mounts rather than by the signed-in user's legacy
// role, so what is worth asserting is that the guard is there and the role check has not come back.
// The folder tree is the photo workspace every Visual Curation module works in: each module's own
// permission opens it for a project in that module, and none needs Photo Selection's.
test("folders are mounted behind the workspace's own module permissions", () => {
  const routes = require("node:fs").readFileSync(require.resolve("../src/modules/image-selection/folders/routes.js"), "utf8");
  assert.match(routes, /router\.use\(requireWorkspaceAccess\(\)\);/);
  assert.equal(routes.includes("SUPER_ADMIN"), false);
  assert.equal(typeof controller.deleteFolder, "function");
});
