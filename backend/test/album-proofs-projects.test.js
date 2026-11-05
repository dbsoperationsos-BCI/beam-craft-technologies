const test = require("node:test");
const assert = require("node:assert/strict");
const { createAlbumProofingProjectService, albumProgressOf, orderBy } = require("../src/modules/image-selection/album-proofs/projects.service");

// Album Proofing's project service on fakes: every query the real repository makes pins
// `albumProofing: true`, so the fake only ever holds this section's rows.
function fakeRepository() {
  let nextId = 1;
  const state = { projects: [], albums: [], uploads: [], lastListQuery: null, purged: [] };
  const repo = {
    state,
    transaction: (callback) => callback(repo),
    listProjects: async ({ search, archived, orderBy: order }) => {
      state.lastListQuery = { search, archived, orderBy: order };
      return state.projects.filter((row) => !row.deletedAt && (archived ? row.archivedAt : !row.archivedAt) && (!search || row.projectName.includes(search)));
    },
    findProject: async (id, { archived } = {}) => state.projects.find((row) => row.id === id && !row.deletedAt && (archived === undefined || (archived ? row.archivedAt : !row.archivedAt))) || null,
    findSalesProject: async (id) => (id === "sales-1" ? { id, whatsappGroupName: "WED Deevesh & Sarasaa" } : null),
    findProjectBySalesProjectId: async (salesProjectId) => state.projects.find((row) => row.salesProjectId === salesProjectId && !row.deletedAt) || null,
    createProject: async (data) => { const row = { id: `project-${nextId++}`, albumProofing: true, archivedAt: null, deletedAt: null, totalPhotoSize: BigInt(0), createdAt: new Date(), ...data }; state.projects.push(row); return row; },
    updateProject: async (id, data) => { const row = state.projects.find((item) => item.id === id); Object.assign(row, data); return row; },
    albumStatusesByProject: async (projectIds) => state.albums.filter((album) => projectIds.includes(album.projectId) && !album.deletedAt),
    countLiveAlbums: async (projectId) => state.albums.filter((album) => album.projectId === projectId && !album.deletedAt).length,
    listUploadFilesForPurge: async (projectId) => state.uploads.filter((upload) => upload.projectId === projectId),
    purgeProjectData: async (projectId) => { state.purged.push(projectId); const row = state.projects.find((item) => item.id === projectId); Object.assign(row, { deletedAt: new Date(), salesProjectId: null, totalPhotoSize: BigInt(0) }); return row; },
  };
  return repo;
}
const fakeCleanup = () => { const calls = []; return { calls, purgeDerivatives: async (uploads) => { calls.push(uploads); return { failed: [] }; } }; };

test("orders by the requested field with a stable tie-break", () => {
  assert.deepEqual(orderBy("name", "asc"), [{ projectName: "asc" }, { createdAt: "asc" }]);
  assert.equal(orderBy("size", "desc")[0].totalPhotoSize, "desc");
  assert.equal(orderBy("unknown", "desc")[0].createdAt, "desc");
});

test("the sidebar dot follows the project's albums", () => {
  assert.equal(albumProgressOf([]), "notStarted");
  assert.equal(albumProgressOf(["DRAFT", "QC_REVIEW"]), "inProgress");
  assert.equal(albumProgressOf(["CLIENT_REVIEW", "DRAFT"]), "partiallyCompleted");
  assert.equal(albumProgressOf(["COMPLETED", "DRAFT"]), "partiallyCompleted");
  assert.equal(albumProgressOf(["COMPLETED", "COMPLETED"]), "completed");
});

test("lists this section's active or archived projects with search, ordering and a progress dot", async () => {
  const repo = fakeRepository();
  await repo.createProject({ projectName: "Rahul & Priya", sourceType: "Manual", salesProjectId: null });
  await repo.createProject({ projectName: "Archived Album", sourceType: "Manual", salesProjectId: null, archivedAt: new Date() });
  repo.state.albums.push({ projectId: "project-1", status: "CLIENT_REVIEW" });
  const service = createAlbumProofingProjectService(repo, { cleanup: fakeCleanup() });
  const active = await service.list({ search: "Rahul", sort: "name", order: "asc", archived: false });
  assert.equal(active.length, 1);
  assert.equal(active[0].selectionProgress, "partiallyCompleted");
  assert.equal(typeof active[0].totalPhotoSize, "string");
  assert.deepEqual(repo.state.lastListQuery, { search: "Rahul", archived: false, orderBy: orderBy("name", "asc") });
  const archived = await service.list({ search: "", sort: "dateAdded", order: "desc", archived: true });
  assert.deepEqual(archived.map((row) => [row.projectName, row.selectionProgress]), [["Archived Album", "notStarted"]]);
});

test("a manual project records its own client; a linked one is named by the group name and refuses a second client copy", async () => {
  const repo = fakeRepository();
  const service = createAlbumProofingProjectService(repo, { cleanup: fakeCleanup() });
  const manual = await service.create({ projectName: "Rahul & Priya", salesProjectId: null, clientName: "Rahul", clientMainNumber: "+91 9876543210" }, 7);
  assert.equal(manual.sourceType, "Manual");
  assert.equal(manual.clientMainNumber, "+91 9876543210");
  assert.equal(manual.createdByUserId, 7);
  const linked = await service.create({ projectName: "ignored", salesProjectId: "sales-1" }, 7);
  assert.equal(linked.sourceType, "Sales");
  assert.equal(linked.projectName, "WED Deevesh & Sarasaa");
  await assert.rejects(service.create({ projectName: "x", salesProjectId: "sales-1", clientName: "Someone" }, 7), (error) => error.status === 409);
  await assert.rejects(service.create({ projectName: "x", salesProjectId: "sales-missing" }, 7), (error) => error.status === 404);
});

test("a group name is taken only within Album Proofing, and a second project for it is refused", async () => {
  const repo = fakeRepository();
  const service = createAlbumProofingProjectService(repo, { cleanup: fakeCleanup() });
  await service.create({ projectName: "ignored", salesProjectId: "sales-1" }, 7);
  await assert.rejects(service.create({ projectName: "ignored", salesProjectId: "sales-1" }, 7), (error) => error.status === 409 && /Album Proofing project/.test(error.message));
});

test("editing renames a manual project and refuses a linked one", async () => {
  const repo = fakeRepository();
  const service = createAlbumProofingProjectService(repo, { cleanup: fakeCleanup() });
  const manual = await service.create({ projectName: "Old", salesProjectId: null, clientName: "Rahul", clientMainNumber: "+91 9876543210" }, 7);
  const renamed = await service.edit(manual.id, { projectName: "New", clientName: "Priya" });
  assert.equal(renamed.projectName, "New");
  assert.equal(renamed.clientName, "Priya");
  assert.equal(renamed.clientMainNumber, "+91 9876543210");
  const linked = await service.create({ projectName: "ignored", salesProjectId: "sales-1" }, 7);
  await assert.rejects(service.edit(linked.id, { projectName: "Other" }), (error) => error.status === 409);
  await assert.rejects(service.edit("missing", { projectName: "Other" }), (error) => error.status === 404);
});

test("archive and restore move a project between the two lists", async () => {
  const repo = fakeRepository();
  const service = createAlbumProofingProjectService(repo, { cleanup: fakeCleanup() });
  const project = await service.create({ projectName: "Rahul & Priya", salesProjectId: null, clientName: "Rahul", clientMainNumber: "+91 9876543210" }, 7);
  assert.ok((await service.archive(project.id)).archivedAt);
  await assert.rejects(service.archive(project.id), (error) => error.status === 404);
  assert.equal((await service.restore(project.id)).archivedAt, null);
});

test("delete refuses a linked project or one still holding albums, and otherwise purges derivatives then the rows", async () => {
  const repo = fakeRepository();
  const cleanup = fakeCleanup();
  const service = createAlbumProofingProjectService(repo, { cleanup });
  const linked = await service.create({ projectName: "ignored", salesProjectId: "sales-1" }, 7);
  await assert.rejects(service.remove(linked.id), (error) => error.status === 409 && /Archive it instead/.test(error.message));
  const manual = await service.create({ projectName: "Rahul & Priya", salesProjectId: null, clientName: "Rahul", clientMainNumber: "+91 9876543210" }, 7);
  repo.state.albums.push({ projectId: manual.id, status: "DRAFT" });
  await assert.rejects(service.remove(manual.id), (error) => error.status === 409 && /Delete its albums first/.test(error.message));
  repo.state.albums[0].deletedAt = new Date();
  repo.state.uploads.push({ projectId: manual.id, thumbnailKey: "t", processedKey: "p" });
  const removed = await service.remove(manual.id);
  assert.equal(cleanup.calls.length, 1);
  assert.equal(cleanup.calls[0][0].thumbnailKey, "t");
  assert.deepEqual(repo.state.purged, [manual.id]);
  assert.ok(removed.deletedAt);
  await assert.rejects(service.remove(manual.id), (error) => error.status === 404);
});
