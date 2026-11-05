const test = require("node:test");
const assert = require("node:assert/strict");
const { shootDayHasPassed } = require("../src/modules/image-selection/shoot-visibility");
const { createDeliverableService, DEFAULT_SELECTION_LIMIT } = require("../src/modules/image-selection/deliverables/service");
const { createFolderService } = require("../src/modules/image-selection/folders/service");

// A shoot joins the Image Selection workspace only after its day: a Wedding dated 20 Aug shows
// its folder and selection items from 21 Aug. These tests pin the day boundary and that both
// listings — folders and deliverables — apply it, while shoots already shot are not held back.

test("a shoot's day has passed only from the following day", () => {
  const shootDay = new Date("2026-08-20T00:00:00.000Z");
  assert.equal(shootDayHasPassed(shootDay, new Date("2026-08-20T23:59:59.000Z")), false);
  assert.equal(shootDayHasPassed(shootDay, new Date("2026-08-21T00:00:00.000Z")), true);
  assert.equal(shootDayHasPassed(shootDay, new Date("2026-09-01T12:00:00.000Z")), true);
});

test("a shoot with no date has not happened yet, so it is held back", () => {
  /*
   * A shoot may be added before its date is fixed - a wedding sold months before the family
   * settles the reception date. Answering "passed" for one of those, which is what this did while
   * the date was a required column, would open its folders and selection items the moment the
   * shoot was created.
   */
  assert.equal(shootDayHasPassed(null), false);
  assert.equal(shootDayHasPassed(undefined), false);
});

test("a date nobody can read is not held back, which is the opposite case", () => {
  // Broken data rather than an unscheduled shoot. Holding the folder back for ever would leave no
  // way to reach it, so this errs the other way on purpose.
  assert.equal(shootDayHasPassed("not a date"), true);
});

// The deliverables fixture mirrors image-selection-deliverables.test.js: a repository stub, the
// settings stub, and rows whose definition answers Yes.
function fakeDeliverableRepository(deliverables) {
  const state = { deliverables, configs: [], nextId: 1 };
  const repo = {
    transaction: async (callback) => callback(repo),
    findImageSelectionProject: async (id) => (id === "image-project" ? { id, salesProjectId: "sales-project" } : null),
    listShootDeliverables: async () => state.deliverables,
    listDeliverableDefinitions: async () => [],
    listConfigs: async () => state.configs,
    createConfig: async (data) => { const item = { id: `config-${state.nextId++}`, inactiveAt: null, ...data }; state.configs.push(item); return item; },
    updateConfig: async (id, data) => { const item = state.configs.find((candidate) => candidate.id === id); Object.assign(item, data); return item; },
    clearPublicationSubmitted: async () => ({ count: 0 }),
  };
  return repo;
}
const fakeSettings = { read: async () => ({ defaultSelectionLimit: DEFAULT_SELECTION_LIMIT }) };
const shootDeliverable = (id, shootDate) => ({
  id, projectId: "sales-project", shootId: `shoot-${id}`, deliverableName: `Album ${id}`, quantity: 25,
  createdAt: new Date(), deliverableDefinition: { imageSelectionEnabled: true },
  shoot: { id: `shoot-${id}`, shootId: `DBS-SID-${id}`, shoot: `Shoot ${id}`, dateCreated: shootDate },
});

test("selection items wait for their shoot's day; earlier shoots' items do not", async () => {
  const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const repo = fakeDeliverableRepository([shootDeliverable("done", past), shootDeliverable("coming", future)]);
  const result = await createDeliverableService(repo, fakeSettings).synchronize("image-project");
  assert.deepEqual(result.map((item) => item.name), ["Album done"]);
  // The date rides only on the filter, not on the payload the workspace reads.
  assert.deepEqual(Object.keys(result[0].shoot).sort(), ["id", "shoot", "shootId"]);
});

test("the folder listing holds a shoot folder back, subfolders and all, until its day", async () => {
  const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const folder = (id, overrides = {}) => ({ id, projectId: "project", parentId: null, projectShootId: null, name: id, sortOrder: 0, projectShoot: null, _count: { children: 0 }, ...overrides });
  const repo = {
    findProject: async () => ({ id: "project", projectName: "Test", salesProjectId: "sales-project" }),
    syncProjectShootFolders: async () => {},
    listFolders: async () => [
      folder("wedding", { projectShootId: "shoot-1", projectShoot: { dateCreated: past } }),
      folder("reception", { projectShootId: "shoot-2", projectShoot: { dateCreated: future } }),
      folder("reception-card", { parentId: "reception" }),
      folder("manual"),
    ],
  };
  const { folders, totalFolderCount } = await createFolderService(repo).list("project");
  assert.deepEqual(folders.map((item) => item.name), ["wedding", "manual"]);
  assert.equal(totalFolderCount, 2);
  // The date never leaves the API: the serialized folder keeps its original shape.
  assert.equal("projectShoot" in folders[0], false);
});
