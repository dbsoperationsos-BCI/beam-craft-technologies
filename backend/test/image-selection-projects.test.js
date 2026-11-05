const test = require("node:test");
const assert = require("node:assert/strict");
const { createImageSelectionProjectService, orderBy, nextCopyName } = require("../src/modules/image-selection/projects/service");
const { createProjectSchema, editProjectSchema, settingsSchema } = require("../src/modules/image-selection/projects/validation");
const controller = require("../src/modules/image-selection/projects/controller");

const project = (overrides = {}) => ({ id: "project-1", projectName: "Original Name", sourceType: "Manual", salesProjectId: null, status: "New", selectionValidUntil: null, allowPhotoSelection: true, publicSlug: null, archivedAt: null, lastOpenedAt: null, totalPhotoSize: BigInt(0), publishVersion: 1, createdByUserId: 1, deletedAt: null, createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-02"), ...overrides });

function fakeRepository() {
  const state = { projects: [project()], folders: [{ id: "folder-root", parentId: null, name: "Root", sortOrder: 2 }, { id: "folder-child", parentId: "folder-root", name: "Child", sortOrder: 1 }], configs: [{ projectPostProductionAllocationId: "allocation-1", projectShootDeliverableId: null, enabled: true, selectionLimitOverride: 5, displayOrder: 1, inactiveAt: null }], createdFolders: [], createdConfigs: [] };
  let id = 2;
  const repo = {
    state,
    transaction: async (callback) => callback(repo),
    listProjects: async (query) => { state.lastListQuery = query; return state.projects.filter((item) => item.deletedAt === null && (query.archived ? item.archivedAt : !item.archivedAt) && (!query.search || item.projectName.includes(query.search))); },
    findProject: async (projectId, filter = {}) => state.projects.find((item) => item.id === projectId && item.deletedAt === null && (filter.archived === undefined || (filter.archived ? item.archivedAt : !item.archivedAt))) || null,
    findProjectByName: async (projectName) => state.projects.find((item) => item.projectName === projectName && item.deletedAt === null) ? { id: "exists" } : null,
    findSalesProject: async () => null,
    // The booking is live unless a test says otherwise; `state.deletedSalesProjects` is how a test
    // stages one being deleted in the window between the sync's read and its create.
    findLiveSalesProjectForUpdate: async (id) => { state.lockedSalesProjects = [...(state.lockedSalesProjects || []), id]; return (state.deletedSalesProjects || []).includes(id) ? null : { id }; },
    findProjectBySalesProjectId: async () => null,
    listSalesProjectsAwaitingImageProject: async (statuses) => { state.lastSyncStatuses = statuses; return state.awaitingSalesProjects || []; },
    // Linked rows whose Sales project's group was renamed since: `state.renamed`, `{ id, name }` each.
    listRenamedLinkedProjects: async () => state.renamed || [],
    selectionProgressData: async () => state.progressData || { publishedProjectIds: [], configs: [], selectedConfigIds: [] },
    // Every linked project has a shoot already past unless a test stages `state.shoots`.
    listShootDatesForSalesProjects: async (ids) => { state.lastShootQuery = ids; return state.shoots || ids.map((projectId) => ({ projectId, dateCreated: new Date("2026-01-01") })); },
    createProject: async (data) => { const item = project({ id: `project-${id++}`, ...data }); state.projects.push(item); return item; },
    // The AI Culling, AI Editing and Signature Album projects made with a workspace, each numbered.
    createModuleProject: async ({ module, ...data }) => { const item = { id: `module-project-${id++}`, module, projectCode: `DBS-VC-${module}-${id}`, ...data }; (state.moduleProjects ||= []).push(item); return item; },
    countModuleProjects: async (projectId) => (state.moduleProjects || []).filter((item) => item.imageSelectionProjectId === projectId).length,
    updateProject: async (projectId, data) => { const item = state.projects.find((candidate) => candidate.id === projectId); Object.assign(item, data, { updatedAt: new Date() }); return item; },
    listFoldersForDuplicate: async () => state.folders,
    createFolder: async (data) => { const item = { id: `new-folder-${state.createdFolders.length + 1}`, ...data }; state.createdFolders.push(item); return item; },
    listDeliverableConfigs: async () => state.configs,
    createDeliverableConfigs: async (data) => { state.createdConfigs.push(...data); return { count: data.length }; },
    listUploadFilesForPurge: async () => [],
    deletionImpact: async () => ({ shootCount: 0, folderCount: 0, photoCount: 0, submittedSelectionCount: 0 }),
    purgeProjectData: async (projectId) => { state.purged = [...(state.purged || []), projectId]; const item = state.projects.find((candidate) => candidate.id === projectId); Object.assign(item, { deletedAt: new Date(), totalPhotoSize: BigInt(0) }); return item; },
  };
  return repo;
}

test("maps every requested sidebar sort to actual ImageSelectionProject fields", () => {
  assert.deepEqual(orderBy("name", "asc"), [{ projectName: "asc" }, { createdAt: "asc" }]);
  assert.equal(orderBy("dateLastOpened", "desc")[0].lastOpenedAt, "desc");
  assert.equal(orderBy("dateAdded", "desc")[0].createdAt, "desc");
  assert.equal(orderBy("dateModified", "asc")[0].updatedAt, "asc");
  assert.equal(orderBy("dateCreated", "asc")[0].createdAt, "asc");
  assert.equal(orderBy("size", "desc")[0].totalPhotoSize, "desc");
});

test("lists active and archived projects with search and requested ordering", async () => {
  const repo = fakeRepository(); repo.state.projects.push(project({ id: "archived", projectName: "Wedding Archive", archivedAt: new Date() })); const service = createImageSelectionProjectService(repo);
  const active = await service.list({ search: "Original", sort: "name", order: "asc", archived: false });
  assert.equal(active.length, 1); assert.equal(repo.state.lastListQuery.search, "Original"); assert.deepEqual(repo.state.lastListQuery.orderBy, orderBy("name", "asc"));
  const archived = await service.list({ search: "Archive", sort: "dateAdded", order: "desc", archived: true });
  assert.equal(archived[0].id, "archived"); assert.equal(typeof archived[0].totalPhotoSize, "string");
});

// One project per Sales Manager project on this page. A second live row for the same Sales project
// (a row another module filed under the same Sales project) must not become
// a duplicate sidebar entry: the row created first stays, the later one is left to its own page.
test("lists one project per Sales Manager project, the one created first", async () => {
  const repo = fakeRepository();
  repo.state.projects.push(project({ id: "first", projectName: "Deevesh & Sarasaa", sourceType: "Sales", salesProjectId: "sales-9", createdAt: new Date("2026-08-26") }));
  repo.state.projects.push(project({ id: "later", projectName: "Deevesh & Sarasaa", sourceType: "Sales", salesProjectId: "sales-9", createdAt: new Date("2026-09-03") }));
  repo.state.projects.push(project({ id: "manual", projectName: "Manual", sourceType: "Manual", salesProjectId: null, createdAt: new Date("2026-09-04") }));
  const ids = (await createImageSelectionProjectService(repo).list({ sort: "dateAdded", order: "desc", archived: false })).map((row) => row.id);
  assert.ok(ids.includes("first")); assert.ok(!ids.includes("later")); assert.ok(ids.includes("manual"));
});

// Allocation, not a picker: a Sales Manager project that has been started - any status but Yet to
// Start - appears in the list as a linked project on the next read, named by its WhatsApp group
// name — and a concurrent list creating the same project first is absorbed, not surfaced as an error.
test("listing creates linked projects for newly started Sales Manager projects", async () => {
  const repo = fakeRepository();
  repo.state.awaitingSalesProjects = [{ id: "sales-9", whatsappGroupName: "  WED qwerty HYD  " }];
  const service = createImageSelectionProjectService(repo);
  const listed = await service.list({ sort: "dateAdded", order: "desc", archived: false });
  // Every status but Yet to Start: Completed, On Hold and the rest are linked too, and neither
  // Production nor Pre Production is asked about.
  assert.deepEqual(repo.state.lastSyncStatuses, ["Yet to Start"]);
  const linked = listed.find((item) => item.salesProjectId === "sales-9");
  assert.ok(linked); assert.equal(linked.projectName, "WED qwerty HYD"); assert.equal(linked.sourceType, "Sales");

  const racing = fakeRepository();
  racing.state.awaitingSalesProjects = [{ id: "sales-9", whatsappGroupName: "WED qwerty HYD" }];
  racing.createProject = async () => { const error = new Error("Unique constraint failed"); error.code = "P2002"; throw error; };
  await createImageSelectionProjectService(racing).list({ sort: "dateAdded", order: "desc", archived: false });
});

// The sidebar dot's ladder: unpublished bronze, published blue, any pick (or partial submission)
// amber, every live item submitted green — and a published project with no items never completes.
test("each listed project carries its selection progress for the sidebar dot", async () => {
  const repo = fakeRepository();
  const service = createImageSelectionProjectService(repo);
  const stage = async () => (await service.list({ sort: "dateAdded", order: "desc", archived: false }))[0].selectionProgress;

  assert.equal(await stage(), "notStarted"); // unpublished
  repo.state.progressData = { publishedProjectIds: ["project-1"], configs: [], selectedConfigIds: [] };
  assert.equal(await stage(), "inProgress"); // published, nothing to pick yet
  repo.state.progressData = { publishedProjectIds: ["project-1"], configs: [{ id: "c1", imageSelectionProjectId: "project-1", selectionSubmittedAt: null }], selectedConfigIds: [] };
  assert.equal(await stage(), "inProgress"); // published, client has not touched it
  repo.state.progressData = { publishedProjectIds: ["project-1"], configs: [{ id: "c1", imageSelectionProjectId: "project-1", selectionSubmittedAt: null }], selectedConfigIds: ["c1"] };
  assert.equal(await stage(), "partiallyCompleted"); // client started selecting
  repo.state.progressData = { publishedProjectIds: ["project-1"], configs: [{ id: "c1", imageSelectionProjectId: "project-1", selectionSubmittedAt: new Date() }, { id: "c2", imageSelectionProjectId: "project-1", selectionSubmittedAt: null }], selectedConfigIds: [] };
  assert.equal(await stage(), "partiallyCompleted"); // one item submitted, one open
  repo.state.progressData = { publishedProjectIds: ["project-1"], configs: [{ id: "c1", imageSelectionProjectId: "project-1", selectionSubmittedAt: new Date() }], selectedConfigIds: [] };
  assert.equal(await stage(), "completed"); // everything submitted
});

// The retired picker's protections survive the sync: one project per group name (a second sales
// row sharing the name, or a name an existing project already carries, is skipped — never a
// duplicate sidebar entry), blank names never become projects, one poison row cannot take the
// list down with it, and the archived list — where a synced project can't appear — never syncs.
test("the sync dedupes names, skips blanks, survives a bad row, and leaves archived reads alone", async () => {
  const repo = fakeRepository();
  repo.state.awaitingSalesProjects = [
    { id: "sales-1", whatsappGroupName: "Original Name" }, // an existing project already owns it
    { id: "sales-2", whatsappGroupName: "WED Twins" },
    { id: "sales-3", whatsappGroupName: "wed twins" }, // same name, second sales row
    { id: "sales-4", whatsappGroupName: "   " },
    { id: "sales-5", whatsappGroupName: "Poison Row" },
    { id: "sales-6", whatsappGroupName: "After The Poison" },
  ];
  const realCreate = repo.createProject;
  repo.createProject = async (data) => { if (data.projectName === "Poison Row") throw new Error("value too long"); return realCreate(data); };
  const service = createImageSelectionProjectService(repo);
  const listed = await service.list({ sort: "dateAdded", order: "desc", archived: false });
  const syncedNames = listed.filter((item) => item.sourceType === "Sales").map((item) => item.projectName);
  assert.deepEqual(syncedNames.sort(), ["After The Poison", "WED Twins"]);

  repo.state.lastSyncStatuses = null;
  await service.list({ sort: "dateAdded", order: "desc", archived: true });
  assert.equal(repo.state.lastSyncStatuses, null);
});

test("edits, archives, lists archived, and restores an Image Selection project", async () => {
  const repo = fakeRepository(); const service = createImageSelectionProjectService(repo);
  assert.equal((await service.edit("project-1", { projectName: "Updated" })).projectName, "Updated");
  await service.archive("project-1"); assert.ok(repo.state.projects[0].archivedAt);
  assert.equal((await service.list({ search: "Updated", sort: "dateAdded", order: "desc", archived: true })).length, 1);
  await service.restore("project-1"); assert.equal(repo.state.projects[0].archivedAt, null);
});

// The sidebar hides Edit and Delete on a linked project — its name is the Sales Manager
// project's WhatsApp group name and its life is Project Management's to end — so the API
// refuses both rather than trusting the buttons to stay hidden.
test("refuses to rename or delete a project created from a Sales Manager group name", async () => {
  const repo = fakeRepository(); repo.state.projects[0].salesProjectId = "sales-1";
  const service = createImageSelectionProjectService(repo);
  await assert.rejects(() => service.edit("project-1", { projectName: "Renamed" }), { status: 409 });
  await assert.rejects(() => service.remove("project-1"), { status: 409 });
});

// Deleting a manual project purges its data — photos, selections, folders, selection items,
// gallery rows — and soft-deletes the row itself, so it leaves every list and its published
// gallery link answers 404 while the id can never be reused.
test("deletes a manual project's data and soft-deletes the row", async () => {
  const repo = fakeRepository(); const service = createImageSelectionProjectService(repo);
  await service.remove("project-1");
  assert.deepEqual(repo.state.purged, ["project-1"]);
  assert.ok(repo.state.projects[0].deletedAt);
  await assert.rejects(() => service.remove("project-1"), { status: 404 });
});

test("uses incrementing duplicate names", async () => {
  const repo = fakeRepository(); repo.state.projects.push(project({ id: "copy-1", projectName: "Original Name - Copy" }), project({ id: "copy-2", projectName: "Original Name - Copy 2" }));
  assert.equal(await nextCopyName("Original Name", repo), "Original Name - Copy 3");
});

test("duplicates only configuration, folders, and deliverable settings", async () => {
  const repo = fakeRepository(); const service = createImageSelectionProjectService(repo); const duplicate = await service.duplicate("project-1", 42);
  assert.equal(duplicate.projectName, "Original Name - Copy"); assert.equal(duplicate.salesProjectId, null); assert.equal(duplicate.totalPhotoSize, "0");
  assert.equal(repo.state.createdFolders.length, 2); assert.equal(repo.state.createdFolders[1].parentId, "new-folder-1");
  assert.equal(repo.state.createdConfigs.length, 1); assert.equal(repo.state.createdConfigs[0].imageSelectionProjectId, duplicate.id);
  assert.equal(Object.hasOwn(repo.state, "uploads"), false); assert.equal(Object.hasOwn(repo.state, "notifications"), false);
});

// Access is the route's to decide, not the controller's: the module is mounted behind
// IMAGE_SELECTION / Project Management, and a permission is something a role can actually be given.
// This used to assert the controller refused anybody whose legacy `role` was not SUPER_ADMIN, which
// meant the permission could be granted and the screen still refused.
test("projects are mounted behind the Image Selection permission", () => {
  const routes = require("node:fs").readFileSync(require.resolve("../src/modules/image-selection/projects/routes.js"), "utf8");
  assert.match(routes, /requireModule\("IMAGE_SELECTION", "Project Management"\)/);
  assert.equal(routes.includes("SUPER_ADMIN"), false);
});

test("stores the client name and number a manual project needs to be shared", async () => {
  const repo = fakeRepository(); const service = createImageSelectionProjectService(repo);
  const saved = await service.saveSettings("project-1", { selectionValidityEnabled: true, allowPhotoSelection: true, clientName: "Anika", clientMainNumber: "+91 9000000000" });
  assert.equal(saved.clientName, "Anika");
  assert.equal(saved.clientMainNumber, "+91 9000000000");
});

// The Expiry Date field in Selection Settings. The date is the studio's answer for this project,
// so it is stored on the row and, when a gallery is already with the client, pushed onto the
// publication as well — otherwise editing it would change the panel and nothing else.
test("stores the expiry date and moves it on a gallery already published", async () => {
  const repo = fakeRepository();
  const moved = [];
  const service = createImageSelectionProjectService(repo, { publisher: { setExpiry: async (projectId, expiresAt) => moved.push({ projectId, expiresAt }) } });
  const expiry = new Date("2026-12-31T23:59:59.999Z");
  const saved = await service.saveSettings("project-1", { selectionValidityEnabled: true, allowPhotoSelection: true, selectionValidUntil: expiry });
  assert.deepEqual(saved.selectionValidUntil, expiry);
  assert.deepEqual(moved, [{ projectId: "project-1", expiresAt: expiry }]);
});

test("leaves the expiry alone when the settings save omits it", async () => {
  const repo = fakeRepository();
  const moved = [];
  const service = createImageSelectionProjectService(repo, { publisher: { setExpiry: async (...args) => moved.push(args) } });
  await service.saveSettings("project-1", { selectionValidityEnabled: true, allowPhotoSelection: true, selectionValidUntil: new Date("2026-12-31T00:00:00Z") });
  const saved = await service.saveSettings("project-1", { selectionValidityEnabled: false, allowPhotoSelection: true });
  assert.deepEqual(saved.selectionValidUntil, new Date("2026-12-31T00:00:00Z"));
  assert.equal(moved.length, 1);
});

test("reads the expiry date the calendar sends and rejects one it could not have", () => {
  const base = { selectionValidityEnabled: true, allowPhotoSelection: true };
  const parse = (selectionValidUntil) => settingsSchema.safeParse({ ...base, selectionValidUntil });
  // The whole of the chosen day is inside the window, so it ends at the day's last instant.
  assert.deepEqual(parse("2026-12-31").data.selectionValidUntil, new Date("2026-12-31T23:59:59.999Z"));
  // Blank clears it, which hands the gallery back to the studio-wide validity window.
  assert.equal(parse("").data.selectionValidUntil, null);
  // Absent means "leave the stored date alone", which is how publish-share saves settings.
  assert.equal(settingsSchema.safeParse(base).data.selectionValidUntil, undefined);
  assert.equal(parse("31-12-2026").success, false);
  assert.equal(parse("2026-13-45").success, false);
});

// publish-share saves pending settings without the client fields, so an absent key has to mean
// "leave it alone" rather than "clear it" — otherwise sharing a gallery would wipe the number
// it was about to send to.
test("leaves saved client details untouched when the settings save omits them", async () => {
  const repo = fakeRepository(); const service = createImageSelectionProjectService(repo);
  await service.saveSettings("project-1", { selectionValidityEnabled: true, allowPhotoSelection: true, clientName: "Anika", clientMainNumber: "+91 9000000000" });
  const saved = await service.saveSettings("project-1", { selectionValidityEnabled: false, allowPhotoSelection: true });
  assert.equal(saved.clientMainNumber, "+91 9000000000");
  assert.equal(saved.selectionValidityEnabled, false);
});

test("refuses client details on a project that already reads them from Sales Manager", async () => {
  const repo = fakeRepository(); repo.state.projects[0].salesProjectId = "sales-1";
  await assert.rejects(() => createImageSelectionProjectService(repo).saveSettings("project-1", { selectionValidityEnabled: true, allowPhotoSelection: true, clientName: "Anika" }), { status: 409 });
});

// Creating the project is the only place a manual one is asked for its client, so the answer has
// to survive the create rather than wait for a settings save that never asks again.
test("records the client a manual project was created with", async () => {
  const repo = fakeRepository(); const service = createImageSelectionProjectService(repo);
  const created = await service.create({ projectName: "Manual Wedding", salesProjectId: null, clientName: "Anika", clientMainNumber: "+91 9000000000" }, 7);
  assert.equal(created.clientName, "Anika");
  assert.equal(created.clientMainNumber, "+91 9000000000");
  assert.equal(created.sourceType, "Manual");
});

test("refuses client details on a project created from a Sales Manager group name", async () => {
  const repo = fakeRepository();
  await assert.rejects(
    () => createImageSelectionProjectService(repo).create({ projectName: "Linked", salesProjectId: "sales-1", clientName: "Anika", clientMainNumber: "+91 9000000000" }, 7),
    { status: 409 },
  );
});

// Creating the project is the only screen that asks for a manual project's client, so the API
// insists on the same three answers the form does rather than letting a request past it create a
// project whose gallery could never be shared.
test("requires the client's name and number on a manually named project", () => {
  const parse = (input) => createProjectSchema.safeParse({ projectName: "Manual Wedding", ...input });
  assert.equal(parse({ clientName: "Anika", clientMainNumber: "+91 9000000000" }).success, true);
  assert.equal(parse({}).success, false);
  assert.equal(parse({ clientName: "Anika" }).success, false);
  assert.equal(parse({ clientMainNumber: "+91 9000000000" }).success, false);
  assert.equal(parse({ clientName: "   ", clientMainNumber: "+91 9000000000" }).success, false);
  // A half-written number is rejected rather than normalized into something unsendable.
  assert.equal(parse({ clientName: "Anika", clientMainNumber: "+91 90000" }).success, false);
  assert.equal(parse({ clientName: "Anika", clientMainNumber: "9000000000" }).success, false);
  // Stored in the shape SalesProject uses, whatever spacing was typed.
  assert.equal(parse({ clientName: "Anika", clientMainNumber: "+919000000000" }).data.clientMainNumber, "+91 9000000000");
});

// A project created from a saved group name reads its client from Sales Manager, so it is created
// with neither field and must not be forced to invent them.
test("asks a project created from a saved group name for no client details", () => {
  const result = createProjectSchema.safeParse({ projectName: "Linked", salesProjectId: "sales-1" });
  assert.equal(result.success, true);
  assert.equal(result.data.clientName, undefined);
});

test("carries the source project's client details into a duplicate", async () => {
  const repo = fakeRepository(); const service = createImageSelectionProjectService(repo);
  await service.saveSettings("project-1", { selectionValidityEnabled: true, allowPhotoSelection: true, clientName: "Anika", clientMainNumber: "+91 9000000000" });
  const copy = await service.duplicate("project-1", 1);
  assert.equal(copy.clientName, "Anika");
  assert.equal(copy.clientMainNumber, "+91 9000000000");
});

// The Workspace Tabs choice on the Create New Project form: a manual project stores which of
// Photo Selection, Photo Culling and Signature Album its workspace opens with. A linked project
// earns its tabs from the allocation instead and must not send a hand-picked set.
test("stores the workspace tabs a manual project was created with", async () => {
  const repo = fakeRepository(); const service = createImageSelectionProjectService(repo);
  const created = await service.create({ projectName: "Manual Wedding", salesProjectId: null, clientName: "Anika", clientMainNumber: "+91 9000000000", workspaceTabs: { photoSelection: false, photoCulling: true, signatureAlbum: true } }, 7);
  assert.equal(created.photoSelectionTab, false);
  assert.equal(created.photoCullingTab, true);
  assert.equal(created.signatureAlbumTab, true);
});

test("a manual project created without the choice keeps Photo Selection alone", async () => {
  const repo = fakeRepository(); const service = createImageSelectionProjectService(repo);
  const created = await service.create({ projectName: "Manual Wedding", salesProjectId: null, clientName: "Anika", clientMainNumber: "+91 9000000000" }, 7);
  assert.equal(created.photoSelectionTab, true);
  assert.equal(created.photoCullingTab, false);
  assert.equal(created.signatureAlbumTab, false);
});

test("refuses workspace tabs on a project created from a Sales Manager group name", async () => {
  await assert.rejects(
    () => createImageSelectionProjectService(fakeRepository()).create({ projectName: "Linked", salesProjectId: "sales-1", workspaceTabs: { photoSelection: true, photoCulling: false, signatureAlbum: false } }, 7),
    { status: 409 },
  );
});

test("requires at least one workspace tab when the choice is sent", () => {
  const base = { projectName: "Manual Wedding", clientName: "Anika", clientMainNumber: "+91 9000000000" };
  assert.equal(createProjectSchema.safeParse({ ...base, workspaceTabs: { photoSelection: false, photoCulling: false, signatureAlbum: false } }).success, false);
  assert.equal(createProjectSchema.safeParse({ ...base, workspaceTabs: { photoSelection: false, photoCulling: true, signatureAlbum: false } }).success, true);
  // Absent stays allowed: an older client simply gets the Photo Selection default.
  assert.equal(createProjectSchema.safeParse(base).success, true);
});

// Edit re-opens the creation form for the name and client - and never changes which modules the
// project is in: those are chosen when it is created, so ticks an older form still sends are not applied.
test("the edit form updates the client, and never the modules the project is in", async () => {
  const repo = fakeRepository(); const service = createImageSelectionProjectService(repo);
  repo.state.projects[0].photoCullingTab = false;
  const saved = await service.edit("project-1", { projectName: "Renamed", clientName: "Anika", clientMainNumber: "+91 9000000000", workspaceTabs: { photoSelection: true, photoCulling: true, signatureAlbum: true } });
  assert.equal(saved.projectName, "Renamed");
  assert.equal(saved.clientName, "Anika");
  assert.equal(saved.photoCullingTab, false);
  assert.notEqual(saved.signatureAlbumTab, true);
});

// One Create Project makes the workspace and a project of its own in each other module named -
// own ID, the form's name and client copied - in one transaction.
test("creating in several modules makes a project in each, each with its own ID", async () => {
  const repo = fakeRepository(); const service = createImageSelectionProjectService(repo);
  const created = await service.create({ projectName: "Wedding ABC", salesProjectId: null, clientName: "Praba", clientMainNumber: "+91 9876543210", modules: ["culling", "editing", "album"] }, 7);
  assert.equal(created.photoSelectionTab, false);
  assert.equal(created.photoCullingTab, true);
  assert.deepEqual(created.moduleProjects.map((item) => item.module), ["culling", "editing", "album"]);
  assert.equal(new Set(created.moduleProjects.map((item) => item.projectCode)).size, 3);
  for (const item of repo.state.moduleProjects) {
    assert.equal(item.imageSelectionProjectId, created.id);
    assert.equal(item.projectName, "Wedding ABC");
    assert.equal(item.clientName, "Praba");
  }
  // Photo Selection alone makes no module records at all.
  const photos = await service.create({ projectName: "Only Selection", salesProjectId: null, clientName: "Praba", clientMainNumber: "+91 9876543210", modules: ["photos"] }, 7);
  assert.equal(photos.moduleProjects, undefined);
});

// Deleting Photo Selection's project leaves the AI Culling, AI Editing and Signature Album projects
// made with it - and their photos - where they are: Photo Selection lets go of the workspace.
test("deleting Photo Selection's project keeps the projects it was created with", async () => {
  const repo = fakeRepository(); const service = createImageSelectionProjectService(repo);
  const created = await service.create({ projectName: "Wedding ABC", salesProjectId: null, clientName: "Praba", clientMainNumber: "+91 9876543210", modules: ["photos", "culling"] }, 7);
  const result = await service.remove(created.id);
  assert.equal(result.photoSelectionTab, false);
  assert.equal(repo.state.projects.find((item) => item.id === created.id).deletedAt ?? null, null);
  assert.equal(repo.state.moduleProjects.length, 1);
});

test("a rename on its own leaves the client and tabs untouched", async () => {
  const repo = fakeRepository(); repo.state.projects[0].clientName = "Anika"; repo.state.projects[0].photoCullingTab = true;
  const service = createImageSelectionProjectService(repo);
  const saved = await service.edit("project-1", { projectName: "Renamed" });
  assert.equal(saved.clientName, "Anika");
  assert.equal(saved.photoCullingTab, true);
});

test("the edit schema refuses clearing the client and refuses zero tabs", () => {
  assert.equal(editProjectSchema.safeParse({ projectName: "X", clientName: "  " }).success, false);
  assert.equal(editProjectSchema.safeParse({ projectName: "X", clientMainNumber: "" }).success, false);
  assert.equal(editProjectSchema.safeParse({ projectName: "X", workspaceTabs: { photoSelection: false, photoCulling: false, signatureAlbum: false } }).success, false);
  assert.equal(editProjectSchema.safeParse({ projectName: "X" }).success, true);
});

test("carries the workspace-tab choice into a duplicate", async () => {
  const repo = fakeRepository(); const service = createImageSelectionProjectService(repo);
  const created = await service.create({ projectName: "Manual Wedding", salesProjectId: null, clientName: "Anika", clientMainNumber: "+91 9000000000", workspaceTabs: { photoSelection: true, photoCulling: true, signatureAlbum: false } }, 7);
  const copy = await service.duplicate(created.id, 1);
  assert.equal(copy.photoCullingTab, true);
  assert.equal(copy.signatureAlbumTab, false);
});

/*
 * A linked project is the production project's presence in Image Selection: named by its WhatsApp
 * group name, reading its client from it, and refusing to be renamed, deleted or re-addressed here
 * because all three belong to Project Management. Deleting the project there therefore has to take
 * it, or it stays in the sidebar with nothing behind it and no instruction it will accept.
 *
 * Deleting a project moves it to Resource Management → Recycling Bin, so the gallery is hidden with
 * it - stamped with the project's own time, for Restore to find - and its photographs are kept. The
 * purge belongs to the bin's Delete permanently (`purgeDeletedProject`), which is the step that
 * cannot be undone.
 */
test("deleting a project in Project Management hides its Image Selection project; Delete permanently purges the photographs", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "projects", "controller.js"), "utf8");
  // `retireProjectWithin` holds the steps inside the transaction - written once, so the Delete
  // button, the bulk delete and Pre Production → Import's replace delete a project the same way.
  const remove = source.slice(source.indexOf("async function retireProjectWithin"), source.indexOf("async function verifyProjectShoots"));
  assert.ok(remove, "removeProject is no longer where this test looked for it");

  // One transaction: a project cannot be deleted while its gallery survives, or the other way about.
  assert.match(remove, /prisma\.\$transaction\(async \(transaction\) => \{/);
  assert.match(remove, /transaction\.salesProject\.updateMany/);

  // Matched on the project alone, with no `albumProofing` clause: the Projects page and Album
  // Proofing file their projects in one table under that flag, and both go - with the project's time.
  const cascade = remove.slice(remove.indexOf("imageSelectionProject.updateMany"), remove.indexOf("return { gallery"));
  assert.match(cascade, /where: \{ salesProjectId: id, deletedAt: null \}, data: \{ deletedAt \}/);
  assert.equal(cascade.includes("albumProofing"), false, "the cascade must not pin a section, or the other keeps its project");

  // The delete erases nothing: a project in the bin comes back with its photographs.
  assert.doesNotMatch(remove, /purgeData\(/);

  // Nothing is touched when the project is not this caller's, or is already gone - and each caller
  // says so in its own register: the route with a 404, the bulk delete by throwing.
  assert.match(remove, /if \(result\.count !== 1\) return null;/);
  assert.match(remove, /if \(removed === null\) return res\.status\(404\)/);
  assert.match(remove, /if \(removed === null\) throw new Error\("Project not found\."\);/);
  // And the bulk delete asks `mayDeleteProject` per project, since `requireProjectDeleter` cannot.
  assert.match(remove, /if \(!await mayDeleteProject\(project, req\.user\)\) throw new Error\(PROJECT_DELETE_REFUSAL\);/);

  // Delete permanently: Image Selection's own purge, reused whole, for the Projects page's galleries
  // only - an Album Proofing project's proof pages carry upload ids no foreign key protects - and
  // before the row goes, so a bucket failure leaves the project in the bin to be tried again.
  const bin = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "assets", "recycling-bin.service.js"), "utf8");
  const purge = bin.slice(bin.indexOf("async function purgeDeletedProject"), bin.indexOf("module.exports"));
  assert.match(purge, /albumProofing: false/);
  assert.match(purge, /imageSelectionProjects\.purgeData\(gallery\.id\)/);
  assert.ok(purge.indexOf("imageSelectionProjects.purgeData") < purge.indexOf("prisma.$transaction"), "photos first, then the row");
  assert.match(purge.slice(purge.indexOf("catch (error)")), /throw httpError\(502/);
});

/*
 * One delete implementation. `remove` is the interactive path and owns the two questions a person
 * answers - may this page delete this project at all, and has the client already submitted
 * selections - and `purgeData` underneath it is the work, which the deleted-booking cascade and
 * the one-time cleanup call directly. A copy of the R2-before-rows ordering in a second place is
 * how one of them ends up orphaning objects.
 */
test("purgeData clears R2 before rows, and asks nobody's permission", async () => {
  const repo = fakeRepository();
  const order = [];
  repo.state.projects.push(project({ id: "linked", sourceType: "Sales", salesProjectId: "sales-9" }));
  repo.listUploadFilesForPurge = async () => { order.push("read"); return [{ thumbnailKey: "t/1.jpg", previewKey: "p/1.jpg" }]; };
  const purged = [];
  repo.purgeProjectData = async (id) => { order.push("rows"); purged.push(id); return repo.state.projects.find((row) => row.id === id); };
  const cleanup = { purgeDerivatives: async (uploads) => { order.push("r2"); assert.equal(uploads.length, 1); } };
  const service = createImageSelectionProjectService(repo, { cleanup });

  // A linked project: `remove` refuses it, and the cascade purges it anyway. That is the point -
  // the refusal is about who may press the button, and the booking's delete already was one.
  await assert.rejects(() => service.remove("linked"), /cannot be deleted/);
  await service.purgeData("linked");
  assert.deepEqual(order, ["read", "r2", "rows"]);
  assert.deepEqual(purged, ["linked"]);
});

/*
 * Submitted selections do not stop the cascade either. The high-impact warning exists so nobody
 * destroys a client's picks by accident from the Image Selection sidebar; deleting the booking in
 * Project Management is a deliberate act on the project as a whole, and the photographs are part
 * of it. `remove` keeps the warning.
 */
test("the cascade purges a project whose client has already submitted selections", async () => {
  const repo = fakeRepository();
  repo.deletionImpact = async () => ({ shootCount: 0, folderCount: 2, photoCount: 40, submittedSelectionCount: 3 });
  await assert.rejects(() => createImageSelectionProjectService(repo).remove("project-1"), /high-impact warning/);
  await createImageSelectionProjectService(repo).purgeData("project-1");
  assert.deepEqual(repo.state.purged, ["project-1"]);
});

/*
 * The sync reads which bookings are awaiting a project, then creates them a moment later. A
 * booking deleted inside that window must not be handed a brand new project by the very read that
 * should have stopped showing it - which is exactly how a deleted project comes back.
 */
test("the sync will not create a project for a booking deleted since it read the list", async () => {
  const repo = fakeRepository();
  repo.state.awaitingSalesProjects = [{ id: "sales-gone", whatsappGroupName: "WED Deleted" }, { id: "sales-live", whatsappGroupName: "WED Live" }];
  repo.state.deletedSalesProjects = ["sales-gone"];
  const listed = await createImageSelectionProjectService(repo).list({ sort: "dateAdded", order: "desc", archived: false });

  // Both were re-checked, and the re-check is what decided - not the stale list.
  assert.deepEqual(repo.state.lockedSalesProjects, ["sales-gone", "sales-live"]);
  assert.equal(listed.some((row) => row.salesProjectId === "sales-gone"), false, "a deleted booking must not get a project");
  assert.ok(listed.some((row) => row.salesProjectId === "sales-live"));
});

/*
 * The safety net under the cascade.
 *
 * The cascade is what hides a linked project when its booking goes, and it only began doing that
 * on 9 September 2026 - every booking deleted before then left its project fully live, because
 * neither the list nor the dashboard had any reason to look at the parent. One filter, written
 * once and read by both, so a project the sidebar will not show can never be a number on the
 * dashboard either. It is a net, not the mechanism: the rows it hides still have to be purged.
 */
test("a project whose Sales Manager project is deleted is out of the list and out of the counts", () => {
  const { LIVE_PARENT, IN_PHOTO_SELECTION, createRepository } = require("../src/modules/image-selection/projects/repository");

  // A manual project has no parent to outlive, so it is always in scope.
  assert.deepEqual(LIVE_PARENT, { OR: [{ salesProjectId: null }, { salesProject: { is: { deletedAt: null } } }] });

  const queries = [];
  const client = { imageSelectionProject: { findMany: (args) => { queries.push(args); return []; } } };
  createRepository(client).listProjects({ search: "", archived: false, orderBy: [] });
  assert.deepEqual(queries[0].where.OR, LIVE_PARENT.OR, "the list must not show a project whose booking is deleted");
  // Word Chunk Search: every word typed, any order, beside the rule rather than replacing it.
  createRepository(client).listProjects({ search: "naidu lokesh", archived: false, orderBy: [] });
  assert.deepEqual(queries[1].where.OR, LIVE_PARENT.OR);
  // Photo Selection's own projects only: a workspace made only for another module is not one.
  assert.deepEqual(queries[0].where.AND, [IN_PHOTO_SELECTION]);
  assert.deepEqual(queries[1].where.AND, [IN_PHOTO_SELECTION, { projectName: { contains: "naidu" } }, { projectName: { contains: "lokesh" } }]);

  const dashboard = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "modules", "image-selection", "dashboard", "repository.js"), "utf8");
  assert.match(dashboard, /const \{ LIVE_PARENT, IN_PHOTO_SELECTION \} = require\("\.\.\/projects\/repository"\);/, "the dashboard must read the list's rule, not restate it");
  assert.match(dashboard, /const projectScope = \{ deletedAt: null, albumProofing: false, \.\.\.LIVE_PARENT, AND: \[IN_PHOTO_SELECTION\] \};/);
});

test("a linked project is listed from the day after its first shoot, and a manual one as always", async () => {
  const repo = fakeRepository();
  const day = (offset) => new Date(Date.now() + offset * 86400000);
  repo.state.projects = [
    project({ id: "manual", projectName: "Manual", salesProjectId: null }),
    project({ id: "no-shoots", projectName: "No shoots", sourceType: "Sales", salesProjectId: "sales-none" }),
    project({ id: "all-ahead", projectName: "All ahead", sourceType: "Sales", salesProjectId: "sales-ahead" }),
    project({ id: "one-passed", projectName: "One passed", sourceType: "Sales", salesProjectId: "sales-one" }),
    project({ id: "undated", projectName: "Undated", sourceType: "Sales", salesProjectId: "sales-undated" }),
  ];
  repo.state.shoots = [
    { projectId: "sales-ahead", dateCreated: day(5) },
    { projectId: "sales-ahead", dateCreated: day(20) },
    // Shot two days ago, beside two still to come: the one is enough.
    { projectId: "sales-one", dateCreated: day(-2) },
    { projectId: "sales-one", dateCreated: day(5) },
    { projectId: "sales-one", dateCreated: day(10) },
    // No date is an unscheduled shoot, which has not happened.
    { projectId: "sales-undated", dateCreated: null },
  ];
  const service = createImageSelectionProjectService(repo);
  const listed = await service.list({ sort: "dateAdded", order: "desc" });
  assert.deepEqual(listed.map((row) => row.id).sort(), ["manual", "one-passed"]);
  // One read of the shoots for the whole list, not one per project.
  assert.deepEqual(repo.state.lastShootQuery.sort(), ["sales-ahead", "sales-none", "sales-one", "sales-undated"]);
  // Held back, not removed: nothing was deleted or recreated, and the day its shoot passes it is listed.
  assert.equal(repo.state.projects.length, 5);
  assert.ok(!repo.state.purged);
  repo.state.shoots.push({ projectId: "sales-ahead", dateCreated: day(-1) });
  assert.ok((await service.list({ sort: "dateAdded", order: "desc" })).some((row) => row.id === "all-ahead"));
  assert.equal(repo.state.projects.length, 5, "the same row, not a new one");
});

test("the archived list is not held back by shoot dates", async () => {
  const repo = fakeRepository();
  repo.state.projects = [project({ id: "archived", sourceType: "Sales", salesProjectId: "sales-a", archivedAt: new Date() })];
  repo.state.shoots = [];
  const listed = await createImageSelectionProjectService(repo).list({ archived: true, sort: "dateAdded", order: "desc" });
  assert.deepEqual(listed.map((row) => row.id), ["archived"]);
});

test("a linked project whose WhatsApp group was renamed takes the new name, by its id, and nothing else changes", async () => {
  const repo = fakeRepository();
  const linked = project({ id: "linked-1", projectName: "WED old name", salesProjectId: "sales-3", sourceType: "Sales" });
  repo.state.projects.push(linked);
  repo.state.renamed = [{ id: "linked-1", name: "dxcfghjk" }];
  const listed = await createImageSelectionProjectService(repo).list({ sort: "dateAdded", order: "desc", archived: false });
  const row = listed.find((item) => item.id === "linked-1");
  assert.equal(row.projectName, "dxcfghjk");
  assert.equal(row.salesProjectId, "sales-3", "the link is the same row");
  assert.equal(repo.state.projects.filter((item) => item.salesProjectId === "sales-3").length, 1, "renamed, not re-made");
});

test("a rename that would give two projects one name is left as it was", async () => {
  const repo = fakeRepository();
  repo.state.projects.push(project({ id: "manual-1", projectName: "dxcfghjk", salesProjectId: null, sourceType: "Manual" }));
  repo.state.projects.push(project({ id: "linked-1", projectName: "WED old name", salesProjectId: "sales-3", sourceType: "Sales" }));
  repo.state.renamed = [{ id: "linked-1", name: "dxcfghjk" }];
  const warn = console.warn; const warned = []; console.warn = (...args) => warned.push(args.join(" "));
  try { await createImageSelectionProjectService(repo).list({ sort: "dateAdded", order: "desc", archived: false }); } finally { console.warn = warn; }
  assert.equal(repo.state.projects.find((item) => item.id === "linked-1").projectName, "WED old name");
  assert.ok(warned.some((line) => line.includes("kept project linked-1's old name")));
});

test("a Sales project whose group name another project already carries is not linked twice, and is logged rather than skipped silently", async () => {
  const repo = fakeRepository();
  repo.state.projects.push(project({ id: "manual-1", projectName: "WED Asha", salesProjectId: null, sourceType: "Manual" }));
  repo.state.awaitingSalesProjects = [{ id: "sales-7", whatsappGroupName: "WED Asha" }];
  const warn = console.warn; const warned = []; console.warn = (...args) => warned.push(args.join(" "));
  try { await createImageSelectionProjectService(repo).list({ sort: "dateAdded", order: "desc", archived: false }); } finally { console.warn = warn; }
  assert.equal(repo.state.projects.filter((item) => item.projectName === "WED Asha").length, 1, "never merged into, never duplicated");
  assert.ok(warned.some((line) => line.includes("sales project sales-7")));
});
