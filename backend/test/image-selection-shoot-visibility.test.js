const test = require("node:test");
const assert = require("node:assert/strict");
const { shootDayReached, shootDayKey, reachedShootWhere, reachedConfigWhere, heldShootFolderIds, salesProjectsWithShootDayReached, projectsWithAShootReached } = require("../src/modules/image-selection/shoot-visibility");
const { createDeliverableService, DEFAULT_SELECTION_LIMIT } = require("../src/modules/image-selection/deliverables/service");
const { createFolderService } = require("../src/modules/image-selection/folders/service");
const { createFolderRepository } = require("../src/modules/image-selection/folders/repository");

// A shoot joins the Image Selection workspace on its own day, studio time (Asia/Kolkata): a Wedding
// dated 28 Oct shows its folder, photos and selection items from 00:00 on 28 Oct India time, and a
// Reception dated 29 Oct from the 29th - each shoot on its own, whatever the project's status.

// 00:00 on a day in India is 18:30 UTC the day before.
const IST = (day, time = "00:00:00") => new Date(`${day}T${time}+05:30`);
// The Add Shoot form stores the date at midnight UTC.
const stored = (day) => new Date(`${day}T00:00:00.000Z`);

test("a shoot is reached from 00:00 India time on its own date", () => {
  const wedding = stored("2026-10-28");
  assert.equal(shootDayReached(wedding, IST("2026-10-27", "23:59:59")), false, "the evening before");
  assert.equal(shootDayReached(wedding, IST("2026-10-28", "00:00:00")), true, "midnight on the day, India time");
  assert.equal(shootDayReached(wedding, IST("2026-10-28", "05:29:00")), true, "before UTC midnight has even come round");
  assert.equal(shootDayReached(wedding, IST("2026-11-15", "12:00:00")), true, "and every day after");
});

test("a date stored as India's own midnight is the same day as one stored at UTC midnight", () => {
  // 2026-10-27T18:30Z is 28 Oct 00:00 in India - the date the studio typed.
  assert.equal(shootDayKey(new Date("2026-10-27T18:30:00.000Z")), "2026-10-28");
  assert.equal(shootDayKey(stored("2026-10-28")), "2026-10-28");
  assert.equal(shootDayReached(new Date("2026-10-27T18:30:00.000Z"), IST("2026-10-27", "23:59:59")), false);
  assert.equal(shootDayReached(new Date("2026-10-27T18:30:00.000Z"), IST("2026-10-28")), true);
});

test("a shoot with no date, or one nobody can read, is never treated as reached", () => {
  assert.equal(shootDayReached(null), false);
  assert.equal(shootDayReached(undefined), false);
  assert.equal(shootDayReached(""), false);
  assert.equal(shootDayReached("not a date"), false);
});

test("the database condition draws the same line: stored before tomorrow's first moment, studio time", () => {
  const now = IST("2026-10-28", "09:00:00");
  // Tomorrow (29 Oct) starts at 2026-10-28T18:30Z.
  assert.equal(reachedShootWhere(now).dateCreated.lt.toISOString(), "2026-10-28T18:30:00.000Z");
  const cutoff = reachedShootWhere(now).dateCreated.lt;
  assert.ok(stored("2026-10-28") < cutoff, "the Wedding on the 28th is reached");
  assert.ok(!(stored("2026-10-29") < cutoff), "the Reception on the 29th is not");
  // A studio-typed item has no shoot to wait for; a derived one waits on its shoot's date.
  assert.deepEqual(reachedConfigWhere(now), {
    OR: [{ projectShootDeliverableId: null }, { shootDeliverable: { is: { shoot: { is: { dateCreated: { lt: cutoff } } } } } }],
  });
});

// The deliverables fixture mirrors image-selection-deliverables.test.js: a repository stub, the
// settings stub, and rows whose definition answers Yes.
function fakeDeliverableRepository(deliverables, configs = []) {
  const state = { deliverables, configs, nextId: 1 };
  const repo = {
    state,
    transaction: async (callback) => callback(repo),
    findImageSelectionProject: async (id) => (id === "image-project" ? { id, salesProjectId: "sales-project" } : null),
    listShootDeliverables: async () => state.deliverables,
    listDeliverableDefinitions: async () => [],
    listConfigs: async () => state.configs,
    createConfig: async (data) => { const item = { id: `config-${state.nextId++}`, inactiveAt: null, selectionSubmittedAt: null, ...data }; state.configs.push(item); return item; },
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
const DAY = 24 * 60 * 60 * 1000;

test("selection items wait for their shoot's day; earlier shoots' items do not", async () => {
  const repo = fakeDeliverableRepository([shootDeliverable("done", new Date(Date.now() - 3 * DAY)), shootDeliverable("coming", new Date(Date.now() + 3 * DAY))]);
  const result = await createDeliverableService(repo, fakeSettings).synchronize("image-project");
  assert.deepEqual(result.map((item) => item.name), ["Album done"]);
  // The date rides only on the filter, not on the payload the workspace reads.
  assert.deepEqual(Object.keys(result[0].shoot).sort(), ["id", "shoot", "shootId"]);
});

test("a selection item already picked from is kept untouched while its shoot is moved to a later date, and offered again as it was", async () => {
  const deliverable = shootDeliverable("reception", new Date(Date.now() - 3 * DAY));
  const repo = fakeDeliverableRepository([deliverable]);
  const service = createDeliverableService(repo, fakeSettings);
  const [offered] = await service.synchronize("image-project");
  // The client picks and submits.
  const config = repo.state.configs.find((item) => item.id === offered.id);
  config.selectionSubmittedAt = new Date("2026-10-20T10:00:00Z");

  // The shoot is moved to next week: no longer offered - and not retired, not reset, not re-made.
  deliverable.shoot.dateCreated = new Date(Date.now() + 7 * DAY);
  assert.deepEqual(await service.synchronize("image-project"), []);
  assert.equal(repo.state.configs.length, 1, "no second config is made for it");
  assert.equal(config.inactiveAt, null, "a date change does not deactivate the client's item");
  assert.ok(config.selectionSubmittedAt, "the submission stands");

  // Its date comes round again: the same item, with its submission.
  deliverable.shoot.dateCreated = new Date(Date.now() - DAY);
  const [back] = await service.synchronize("image-project");
  assert.equal(back.id, offered.id);
  assert.ok(back.selectionSubmittedAt);
  assert.equal(repo.state.configs.length, 1);
});

test("a shoot whose date is cleared keeps its selection items untouched too", async () => {
  const deliverable = shootDeliverable("haldi", new Date(Date.now() - DAY));
  const repo = fakeDeliverableRepository([deliverable]);
  const service = createDeliverableService(repo, fakeSettings);
  await service.synchronize("image-project");
  deliverable.shoot.dateCreated = null;
  assert.deepEqual(await service.synchronize("image-project"), [], "no date is not a reached day");
  assert.equal(repo.state.configs[0].inactiveAt, null);
});

test("a deliverable taken off the project is still retired, as before", async () => {
  const repo = fakeDeliverableRepository([shootDeliverable("album", new Date(Date.now() - DAY))]);
  const service = createDeliverableService(repo, fakeSettings);
  await service.synchronize("image-project");
  repo.state.deliverables = [];
  await service.synchronize("image-project");
  assert.ok(repo.state.configs[0].inactiveAt, "a removed deliverable's item is retired; only a waiting one is left alone");
});

const folder = (id, overrides = {}) => ({ id, projectId: "project", parentId: null, projectShootId: null, name: id, sortOrder: 0, projectShoot: null, _count: { children: 0 }, ...overrides });

test("the folder listing holds a shoot folder back, subfolders and all, until its day", async () => {
  const repo = {
    findProject: async () => ({ id: "project", projectName: "Test", salesProjectId: "sales-project" }),
    syncProjectShootFolders: async () => {},
    listFolders: async () => [
      folder("wedding", { projectShootId: "shoot-1", projectShoot: { dateCreated: new Date(Date.now() - 3 * DAY) } }),
      folder("reception", { projectShootId: "shoot-2", projectShoot: { dateCreated: new Date(Date.now() + 3 * DAY) } }),
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

test("a Wedding on the 28th shows on the 28th while the Reception on the 29th waits for its own day", () => {
  const folders = [
    folder("wedding", { projectShootId: "shoot-wedding", projectShoot: { dateCreated: stored("2026-10-28") } }),
    folder("wedding-candid", { parentId: "wedding" }),
    folder("reception", { projectShootId: "shoot-reception", projectShoot: { dateCreated: stored("2026-10-29") } }),
    folder("reception-candid", { parentId: "reception" }),
    folder("manual"),
  ];
  assert.deepEqual([...heldShootFolderIds(folders, IST("2026-10-27", "20:00:00"))].sort(), ["reception", "reception-candid", "wedding", "wedding-candid"]);
  assert.deepEqual([...heldShootFolderIds(folders, IST("2026-10-28", "10:00:00"))].sort(), ["reception", "reception-candid"], "the Wedding is not held back by the Reception");
  assert.deepEqual([...heldShootFolderIds(folders, IST("2026-10-29", "00:00:00"))], [], "the Reception arrives on its own day");
});

test("a Sales project counts as ready once any one of its shoots has reached its day, by the same rule", () => {
  const now = IST("2026-10-11", "08:00:00");
  const ready = salesProjectsWithShootDayReached([
    { projectId: "a", dateCreated: "2026-10-10T00:00:00Z" }, // yesterday
    { projectId: "a", dateCreated: "2026-10-20T00:00:00Z" },
    { projectId: "b", dateCreated: "2026-10-11T00:00:00Z" }, // today: reached
    { projectId: "c", dateCreated: "2026-10-12T00:00:00Z" }, // tomorrow
    { projectId: "d", dateCreated: null }, // unscheduled
  ], now);
  assert.deepEqual([...ready].sort(), ["a", "b"]);
  assert.equal(salesProjectsWithShootDayReached([], now).size, 0);
});

test("whether a linked project is listed reads its shoots' dates only - never a Production or Pre Production status", async () => {
  const now = IST("2026-10-28", "10:00:00");
  const shoots = [{ projectId: "sales-1", dateCreated: stored("2026-10-29") }];
  const row = { id: "is-1", salesProjectId: "sales-1", archivedAt: null };
  // The same project, before and after it moved into Production: the board fields ride along and
  // change nothing - a future shoot stays held back, and the project is listed on its shoot's day.
  const before = await projectsWithAShootReached([{ ...row, preProductionStatus: null, productionStatus: null }], async () => shoots, now);
  const after = await projectsWithAShootReached([{ ...row, preProductionStatus: "PLANNED", productionStatus: "WORK_IN_PROGRESS" }], async () => shoots, now);
  assert.deepEqual(before, []);
  assert.deepEqual(after, []);
  const onTheDay = await projectsWithAShootReached([{ ...row, productionStatus: "WORK_IN_PROGRESS" }], async () => shoots, IST("2026-10-29"));
  assert.deepEqual(onTheDay.map((item) => item.id), ["is-1"]);
  // The module never names those statuses at all.
  const source = require("node:fs").readFileSync(require.resolve("../src/modules/image-selection/shoot-visibility"), "utf8");
  assert.doesNotMatch(source.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, ""), /productionStatus|preProductionStatus|projectProduction|planSubmitted/);
});

// The folder sync, against a stub of the Prisma calls it makes.
function fakeFolderClient({ shoots, folders }) {
  const created = [];
  const transaction = {
    projectShoot: { findMany: async () => shoots },
    imageSelectionFolder: {
      findMany: async ({ where }) => (where.projectShootId ? folders.filter((item) => where.projectShootId.in.includes(item.projectShootId)) : folders.filter((item) => !item.parentId && !item.deletedAt)),
      create: async ({ data }) => { const row = { id: `folder-${created.length + 1}`, ...data }; created.push(row); folders.push(row); return row; },
    },
  };
  return { created, client: { $transaction: (callback) => callback(transaction) } };
}

test("a shoot's folder is made once, on its day, and found by the shoot's id ever after - a rename does not make another", async () => {
  const shoot = { id: "shoot-wedding", shoot: "Wedding", dateCreated: new Date(Date.now() - DAY) };
  const folders = [];
  const { created, client } = fakeFolderClient({ shoots: [shoot], folders });
  const repo = createFolderRepository(client);
  await repo.syncProjectShootFolders({ id: "is-1", salesProjectId: "sales-1", albumProofing: false });
  assert.deepEqual(created.map((row) => [row.projectShootId, row.name]), [["shoot-wedding", "Wedding"]]);
  shoot.shoot = "Wedding Ceremony";
  await repo.syncProjectShootFolders({ id: "is-1", salesProjectId: "sales-1", albumProofing: false });
  assert.equal(created.length, 1, "the renamed shoot keeps its folder, matched by id");
});

test("a future shoot gets no folder yet, and an undated one none at all", async () => {
  const folders = [];
  const { created, client } = fakeFolderClient({ shoots: [
    { id: "shoot-reception", shoot: "Reception", dateCreated: new Date(Date.now() + 3 * DAY) },
    { id: "shoot-unscheduled", shoot: "Rituals", dateCreated: null },
  ], folders });
  await createFolderRepository(client).syncProjectShootFolders({ id: "is-1", salesProjectId: "sales-1", albumProofing: false });
  assert.deepEqual(created, []);
});
