const test = require("node:test");
const assert = require("node:assert/strict");

/*
 * The client gallery holds a shoot back exactly as the studio's folder tree does: the photos in a
 * shoot folder whose shoot has not reached its day (studio time) are left out of what the client is
 * shown and may pick, and nothing about them is written - they, their picks and their submissions are
 * shown again the day the shoot is. The database is a stub that records what it was asked, so the
 * conditions can be read without MySQL.
 */

const DAY = 24 * 60 * 60 * 1000;
const state = { folders: [], uploads: [], asked: [], grouped: [], preparing: [] };
const dbPath = require.resolve("../src/config/db");
require(dbPath);
require.cache[dbPath].exports = {
  imageSelectionFolder: { findMany: async () => state.folders },
  imageSelectionUpload: {
    findMany: async (args) => { state.asked.push(args.where); return state.uploads; },
    count: async (args) => { state.asked.push(args.where); return state.uploads.length; },
    findFirst: async (args) => { state.asked.push(args.where); return null; },
    groupBy: async (args) => { state.grouped.push(args); return state.preparing; },
  },
  imageSelectionUploadScene: { findMany: async (args) => { state.asked.push(args.where.upload); return []; } },
  imageSelectionDeliverableConfig: { findFirst: async () => ({ id: "config-1" }) },
  $transaction: async (calls) => Promise.all(calls),
};

const gallery = require("../src/modules/image-selection/gallery/repository");

const shootFolder = (id, dateCreated) => ({ id, parentId: null, name: id, projectShoot: { dateCreated } });
function reset({ folders = [], uploads = [], preparing = [] } = {}) { state.folders = folders; state.uploads = uploads; state.preparing = preparing; state.asked = []; state.grouped = []; }

test("the client gallery leaves out the photos of a shoot still to come, subfolders and all, and keeps unfiled ones", async () => {
  reset({ folders: [
    shootFolder("wedding", new Date(Date.now() - DAY)),
    shootFolder("reception", new Date(Date.now() + 3 * DAY)),
    { id: "reception-candid", parentId: "reception", name: "Candid", projectShoot: null },
  ] });
  await gallery.listPublishedImages("project", 1, 50, {});
  const [where] = state.asked;
  assert.ok(Array.isArray(where.AND), "the held condition is wrapped around the listing's own");
  assert.equal(where.AND[0].projectId, "project");
  const held = where.AND[1].OR;
  assert.deepEqual(held[0], { folderId: null }, "a photo filed nowhere is never held");
  assert.deepEqual(held[1].folderId.notIn.sort(), ["reception", "reception-candid"]);
});

test("with no shoot waiting, the listing is asked exactly as before", async () => {
  reset({ folders: [shootFolder("wedding", new Date(Date.now() - DAY)), { id: "manual", parentId: null, name: "Manual", projectShoot: null }] });
  await gallery.listPublishedImages("project", 1, 50, {});
  assert.equal("AND" in state.asked[0], false);
  assert.equal(state.asked[0].projectId, "project");
});

test("an undated shoot's photos are held back too", async () => {
  reset({ folders: [shootFolder("rituals", null)] });
  await gallery.listPublishedImages("project", 1, 50, {});
  assert.deepEqual(state.asked[0].AND[1].OR[1].folderId.notIn, ["rituals"]);
});

test("a held shoot's photo cannot be opened or picked by id, and the scene filter does not count it", async () => {
  reset({ folders: [shootFolder("reception", new Date(Date.now() + DAY * 2))] });
  await gallery.findPublishedImage("project", "photo-1");
  assert.equal(await gallery.setDeliverableSelection("project", "photo-1", "config-1", true).then((result) => result.count), 0);
  await gallery.listSceneReadings("project", {});
  assert.equal(state.asked.length, 3);
  for (const where of state.asked) assert.deepEqual(where.AND[1].OR[1].folderId.notIn, ["reception"]);
});

test("the client's folder cards and counts leave a held shoot out, and count everything else as before", async () => {
  reset({
    folders: [shootFolder("wedding", new Date(Date.now() - DAY)), shootFolder("reception", new Date(Date.now() + 3 * DAY))],
    uploads: [
      { id: "w1", folderId: "wedding", selected: false, photoSelections: [{ imageSelectionDeliverableConfigId: "album" }] },
      { id: "r1", folderId: "reception", selected: false, photoSelections: [{ imageSelectionDeliverableConfigId: "album" }] },
      { id: "u1", folderId: null, selected: false, photoSelections: [] },
    ],
  });
  const summary = await gallery.folderSelectionSummary("project", {});
  assert.deepEqual(summary.folders.map((item) => item.folderId), ["wedding", null]);
  assert.deepEqual(summary.overall, { total: 2, selected: 1 });
  assert.deepEqual(summary.selectionCounts, { album: 1 });
  // Read, never written: the held photo and its pick are still there for the day the shoot arrives.
  assert.equal(state.uploads.find((item) => item.id === "r1").photoSelections.length, 1);
  // The folder rows leave as they always have, with no date on them.
  assert.equal("projectShoot" in summary.folders[0], false);
});

test("each folder card says how many photos are still on their way to it, and only those", async () => {
  reset({
    folders: [shootFolder("post-wedding", new Date(Date.now() - DAY)), { id: "card-1", parentId: "post-wedding", name: "Card 1", projectShoot: null }],
    uploads: [],
    preparing: [{ folderId: "post-wedding", _count: { _all: 40 } }],
  });
  const summary = await gallery.folderSelectionSummary("project", { previews: true });
  assert.deepEqual(summary.folders.map((item) => [item.folderId, item.total, item.preparing]), [["post-wedding", 0, 40], ["card-1", 0, 0]]);
  // On its way: uploading or processing, or ready but waiting on a studio step. A rejected photo is
  // not on its way, and a photo filed in no folder belongs to no shoot.
  const [{ by, where }] = state.grouped;
  assert.deepEqual(by, ["folderId"]);
  assert.equal(where.projectId, "project");
  assert.deepEqual(where.folderId, { not: null });
  assert.equal(where.cullRejectedAt, null);
  assert.deepEqual(where.OR, [
    { status: { in: ["PENDING", "UPLOADING", "PROCESSING"] } },
    { status: "READY", OR: [{ cullingHoldAt: { not: null } }, { editingHoldAt: { not: null } }] },
  ]);
});

test("a project is linked once by its Sales project id, and a status change does not make a second one", async () => {
  const { createImageSelectionProjectService } = require("../src/modules/image-selection/projects/service");
  const sales = { id: "sales-1", whatsappGroupName: "WED Asha & Ravi", projectStatus: "Yet to Start", productionStatus: null };
  const projects = [];
  const repo = {
    transaction: (callback) => callback(repo),
    // The sync's own question: started Sales projects (any status but the ones named) with no
    // Projects-page row linked by id.
    listSalesProjectsAwaitingImageProject: async (notStarted) => (!notStarted.includes(sales.projectStatus) && !projects.some((row) => row.salesProjectId === sales.id) ? [sales] : []),
    listRenamedLinkedProjects: async () => [],
    findProjectByName: async () => null,
    findLiveSalesProjectForUpdate: async (id) => ({ id }),
    createProject: async (data) => { const row = { id: `is-${projects.length + 1}`, createdAt: new Date(), archivedAt: null, ...data }; projects.push(row); return row; },
    listProjects: async () => projects,
    listShootDatesForSalesProjects: async () => [{ projectId: "sales-1", dateCreated: new Date(Date.now() - DAY) }],
    selectionProgressData: async () => ({ publishedProjectIds: [], configs: [], selectedConfigIds: [] }),
  };
  const service = createImageSelectionProjectService(repo, { attention: { attentionProjectIds: async () => new Set() } });
  assert.deepEqual(await service.list({ archived: false }), [], "a booking not started yet is not linked");
  assert.equal(projects.length, 0);
  sales.projectStatus = "In Progress";
  const first = await service.list({ archived: false });
  sales.productionStatus = "WORK_IN_PROGRESS"; // moved into Production
  const second = await service.list({ archived: false });
  sales.projectStatus = "Completed";
  const third = await service.list({ archived: false });
  assert.equal(projects.length, 1, "one Image Selection project for the one Sales project");
  assert.equal(projects[0].salesProjectId, "sales-1");
  for (const listed of [first, second, third]) assert.deepEqual(listed.map((row) => row.id), ["is-1"]);
});
