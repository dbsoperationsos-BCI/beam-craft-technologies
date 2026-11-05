const test = require("node:test");
const assert = require("node:assert/strict");
const { createDeliverableService, DEFAULT_SELECTION_LIMIT } = require("../src/modules/image-selection/deliverables/service");
const { saveOverridesSchema } = require("../src/modules/image-selection/deliverables/validation");

// `rootFolders` are the manual project's active root folders - its shoots - as `{ id, name }`.
function fakeRepository({ deliverables = [], configs = [], definitions = [], rootFolders = [] } = {}) {
  const state = { deliverables, configs: configs.map((item) => ({ ...item })), definitions, rootFolders, nextId: 1 };
  // An item's folder relation, as the real select reads it: the folder's live name.
  const withFolder = (item) => ({ ...item, manualShootFolder: item.manualShootFolderId ? state.rootFolders.find((row) => row.id === item.manualShootFolderId) || null : null });
  const repo = {
    state,
    transaction: async (callback) => callback(repo),
    // "manual-project" stands in for a project created from a typed name rather than a saved
    // Sales Manager group name: it exists, but there is no Project Management job behind it.
    findImageSelectionProject: async (id) => id === "image-project" ? { id, salesProjectId: "sales-project" } : id === "manual-project" ? { id, salesProjectId: null } : null,
    listShootDeliverables: async () => state.deliverables,
    listDeliverableDefinitions: async () => state.definitions,
    listConfigs: async () => state.configs,
    createConfig: async (data) => { const item = { id: `config-${state.nextId++}`, inactiveAt: null, createdAt: new Date(), updatedAt: new Date(), ...data }; state.configs.push(item); return item; },
    updateConfig: async (id, data) => { const item = state.configs.find((candidate) => candidate.id === id); Object.assign(item, data); return item; },
    findConfig: async (projectId, id) => state.configs.find((item) => item.id === id && item.imageSelectionProjectId === projectId) || null,
    listManualConfigs: async (projectId) => state.configs.filter((item) => item.imageSelectionProjectId === projectId && !item.projectPostProductionAllocationId && !item.projectShootDeliverableId && !item.inactiveAt).map(withFolder),
    findRootFolder: async (projectId, folderId) => state.rootFolders.find((row) => row.id === folderId) || null,
    listRootFolders: async () => state.rootFolders,
    countSelections: async (configId) => state.selectionsByConfig?.[configId] || 0,
    // Image Selection writing back into Project Management's row, which is the whole point of the
    // shared limit: the stub mutates the same deliverable the sources are built from.
    setDeliverableSelectionLimit: async (id, selectionLimit) => { const item = state.deliverables.find((candidate) => candidate.id === id); item.selectionLimit = selectionLimit; return { id, selectionLimit }; },
    deleteConfig: async (id) => { const index = state.configs.findIndex((item) => item.id === id); return state.configs.splice(index, 1)[0]; },
    clearPublicationSubmitted: async (projectId) => { state.publicationCleared = [...(state.publicationCleared || []), projectId]; return { count: 1 }; },
  };
  return repo;
}

// Studio-wide settings are a database read, so they are stubbed here for the same reason the
// repository is: these are unit tests and must not need a database to run. The stub answers with
// the shipped default, which is what an unconfigured studio would get anyway.
const fakeSettings = (defaultSelectionLimit = DEFAULT_SELECTION_LIMIT) => ({ read: async () => ({ defaultSelectionLimit }) });
const serviceFor = (repo, settings = fakeSettings()) => createDeliverableService(repo, settings);

// Selection items are whatever the Deliverables table says Yes to, so the fixture row carries a
// definition that says it; a test about exclusion hands in `deliverableDefinition: null` instead.
const deliverable = (overrides = {}) => ({ id: "deliverable-1", projectId: "sales-project", shootId: "shoot-1", deliverableName: "Album Selection", quantity: 25, createdAt: new Date(), deliverableDefinition: { imageSelectionEnabled: true }, ...overrides });
const notOffered = { deliverableDefinition: null };

test("lists every post production allocation deliverable checked by default", async () => {
  const repo = fakeRepository({ deliverables: [deliverable(), deliverable({ id: "deliverable-2", deliverableName: "Prints Only", quantity: 10 })] });
  const result = await serviceFor(repo).synchronize("image-project");
  assert.deepEqual(result.map((item) => item.name), ["Album Selection", "Prints Only"]);
  assert.ok(result.every((item) => item.enabled));
});

test("leaves out allocated services the client never picks photos for", async () => {
  const repo = fakeRepository({ deliverables: [
    deliverable(),
    deliverable({ id: "deliverable-2", deliverableName: "Cinematic Highlights", ...notOffered }),
    deliverable({ id: "deliverable-3", deliverableName: "HDD Delivery", ...notOffered }),
    deliverable({ id: "deliverable-4", deliverableName: "Reels", ...notOffered }),
    deliverable({ id: "deliverable-5", deliverableName: "Album Printing", deliverableDefinition: { imageSelectionEnabled: false } }),
  ] });
  const result = await serviceFor(repo).synchronize("image-project");
  assert.deepEqual(result.map((item) => item.name), ["Album Selection"]);
});

// All three stay allocatable in Post Production Allocation and earn a workspace tab when
// allocated with their row answered Yes; they just never reach the client as selection items —
// not even then, because they are the workspace's own tabs. Matching covers the spellings they
// are allocated under.
test("keeps Photo Selection, Photo Culling and Signature Album out of the selection items, whatever the table says", async () => {
  const repo = fakeRepository({ deliverables: [
    deliverable(),
    deliverable({ id: "deliverable-2", deliverableName: "Photo Culling", deliverableDefinition: { imageSelectionEnabled: true } }),
    deliverable({ id: "deliverable-3", deliverableName: "Signature Album (Soft Copy)", deliverableDefinition: { imageSelectionEnabled: true } }),
    deliverable({ id: "deliverable-4", deliverableName: "Photo Selection", deliverableDefinition: { imageSelectionEnabled: true } }),
  ] });
  const result = await serviceFor(repo).synchronize("image-project");
  assert.deepEqual(result.map((item) => item.name), ["Album Selection"]);
});

// The workspace tabs need what Selection Items filters out, so this read is intentionally
// unfiltered and reports the table's answer rather than applying it: `selectable` says whether
// the client picks photos against it, and `imageSelectionEnabled` carries the raw Yes/No/unset.
// The workspace shows a tab only for an explicit Yes.
test("reports every allocated service with the table's answer", async () => {
  const repo = fakeRepository({ deliverables: [
    deliverable(),
    deliverable({ id: "deliverable-2", deliverableName: "Photo Culling", ...notOffered }),
    deliverable({ id: "deliverable-3", deliverableName: "Signature Album (Soft Copy)", deliverableDefinition: { imageSelectionEnabled: false } }),
    deliverable({ id: "deliverable-4", deliverableName: "Reels", ...notOffered }),
  ] });
  const result = await serviceFor(repo).listAllocatedServices("image-project");
  assert.deepEqual(result.map((item) => item.name), ["Album Selection", "Photo Culling", "Signature Album (Soft Copy)", "Reels"]);
  assert.deepEqual(result.map((item) => item.selectable), [true, false, false, false]);
  assert.deepEqual(result.map((item) => item.imageSelectionEnabled), [true, null, false, null]);
});

// One entry per service, but the shoots it was allocated to travel with it: the workspace tab
// and the desktop app both need to know *which* shoots carry the work, not only that some shoot
// does. A shoot allocated the same service twice is still listed once.
test("reports an allocated service once even when several shoots share it, listing those shoots", async () => {
  const engagement = { id: "shoot-1", shootId: "DBS-SID-001", shoot: "Engagement", dateCreated: new Date("2020-01-10") };
  const wedding = { id: "shoot-2", shootId: "DBS-SID-002", shoot: "Wedding", dateCreated: new Date("2020-01-20") };
  const repo = fakeRepository({ deliverables: [
    deliverable({ deliverableName: "Photo Culling", shoot: engagement }),
    deliverable({ id: "deliverable-2", shootId: "shoot-2", deliverableName: "photo culling", shoot: wedding }),
    deliverable({ id: "deliverable-3", shootId: "shoot-2", deliverableName: "Photo Culling", shoot: wedding }),
  ] });
  const result = await serviceFor(repo).listAllocatedServices("image-project");
  assert.deepEqual(result.map((item) => item.key), ["photoculling"]);
  assert.deepEqual(result[0].shoots, [
    { id: "shoot-1", shootId: "DBS-SID-001", shoot: "Engagement" },
    { id: "shoot-2", shootId: "DBS-SID-002", shoot: "Wedding" },
  ]);
});

// The same day-gate the folder tree and selection items apply: a shoot joins a service's list
// only after its shoot date, so a tab never offers a shoot whose root folder does not exist yet.
// The service itself still reports — the tab shows as soon as any of its shoots has happened.
test("keeps a shoot out of a service's list until its day has passed", async () => {
  const shot = { id: "shoot-1", shootId: "DBS-SID-001", shoot: "Engagement", dateCreated: new Date("2020-01-10") };
  const future = { id: "shoot-2", shootId: "DBS-SID-002", shoot: "Wedding", dateCreated: new Date("2999-01-01") };
  const repo = fakeRepository({ deliverables: [
    deliverable({ deliverableName: "Photo Culling", shoot: shot }),
    deliverable({ id: "deliverable-2", shootId: "shoot-2", deliverableName: "Photo Culling", shoot: future }),
  ] });
  const result = await serviceFor(repo).listAllocatedServices("image-project");
  assert.deepEqual(result[0].shoots.map((item) => item.shoot), ["Engagement"]);
});

// A row allocated before deliverables were linked to their definition carries no
// `deliverableDefinition`, so it is matched to the Deliverables table by name — ignoring case,
// spacing and punctuation, the way older projects spelled the same service several ways.
test("a row with no definition link is matched to the table by name", async () => {
  const repo = fakeRepository({
    deliverables: [deliverable({ deliverableName: "Maxi Print", ...notOffered }), deliverable({ id: "deliverable-2", deliverableName: "prints only", ...notOffered }), deliverable({ id: "deliverable-3", deliverableName: "Reels", ...notOffered })],
    definitions: [{ id: "def-1", name: "Maxiprint", imageSelectionEnabled: true }, { id: "def-2", name: "Prints Only", imageSelectionEnabled: true }, { id: "def-3", name: "Reels", imageSelectionEnabled: null }],
  });
  const result = await serviceFor(repo).synchronize("image-project");
  assert.deepEqual(result.map((item) => item.name), ["Maxi Print", "prints only"]);
});

test("retires configurations whose allocated service is no longer a selection item", async () => {
  const config = { id: "config-reels", imageSelectionProjectId: "image-project", projectPostProductionAllocationId: null, projectShootDeliverableId: "deliverable-2", enabled: true, selectionLimitOverride: null, displayOrder: 0, inactiveAt: null, createdAt: new Date() };
  const repo = fakeRepository({ deliverables: [deliverable(), deliverable({ id: "deliverable-2", deliverableName: "Reels", ...notOffered })], configs: [config] });
  await serviceFor(repo).synchronize("image-project");
  assert.ok(repo.state.configs.find((item) => item.id === "config-reels").inactiveAt);
});

test("uses the deliverable quantity as the selection limit", async () => {
  const result = await serviceFor(fakeRepository({ deliverables: [deliverable({ quantity: 25 })] })).synchronize("image-project");
  assert.equal(result[0].selectionLimit, 25);
});

// Only an explicit Yes in the Deliverables table admits a deliverable: No and unanswered both
// keep it out, whatever the deliverable is called.
test("only the definition's Yes admits a deliverable", async () => {
  const repo = fakeRepository({ deliverables: [
    deliverable({ id: "d-1", deliverableName: "Hard Disc", deliverableDefinition: { imageSelectionEnabled: true } }),
    deliverable({ id: "d-2", deliverableName: "Album Selection", deliverableDefinition: { imageSelectionEnabled: false } }),
    deliverable({ id: "d-3", deliverableName: "Retouches", deliverableDefinition: { imageSelectionEnabled: null } }),
  ] });
  const result = await serviceFor(repo).synchronize("image-project");
  assert.deepEqual(result.map((item) => item.name), ["Hard Disc"]);
});

// One retouched album is quantity 1 however many photos go into it. The No of Photos typed on the
// Post Production Allocation is the count the client actually picks against, so with no limit of
// its own the item shows that number, not the order count.
test("uses the allocation's No of Photos over the quantity ordered", async () => {
  const result = await serviceFor(fakeRepository({ deliverables: [deliverable({ quantity: 1, numberOfPhotos: 300 })] })).synchronize("image-project");
  assert.equal(result[0].selectionLimit, 300);
  assert.equal(result[0].fallbackSelectionLimit, 300);
});

test("a limit set on the deliverable still outranks the No of Photos", async () => {
  const result = await serviceFor(fakeRepository({ deliverables: [deliverable({ quantity: 1, numberOfPhotos: 300, selectionLimit: 120 })] })).synchronize("image-project");
  assert.equal(result[0].selectionLimit, 120);
});

test("includes the linked ProjectShoot details with each selectable item", async () => {
  // What the item carries: which shoot it belongs to, by id and by name.
  const details = { id: "shoot-1", shootId: "SH-001", shoot: "Wedding" };
  // The shoot itself is dated, and in the past, because that is what a shoot with selectable items
  // is - an undated one has not happened yet and `shootDayReached` holds it back before it can
  // reach this list. The date is not part of what travels onto the item, which is what the
  // assertion below pins.
  const shoot = { ...details, dateCreated: new Date("2026-01-10T00:00:00.000Z") };
  const result = await serviceFor(fakeRepository({ deliverables: [deliverable({ shoot })] })).synchronize("image-project");
  assert.deepEqual(result[0].shoot, details);
});

test("uses the isolated backend default when no quantity is available", async () => {
  const result = await serviceFor(fakeRepository({ deliverables: [deliverable({ quantity: null })] })).synchronize("image-project");
  assert.equal(result[0].selectionLimit, DEFAULT_SELECTION_LIMIT);
});

test("prefers the studio-wide default selection limit over the shipped constant", async () => {
  const repo = fakeRepository({ deliverables: [deliverable({ quantity: null })] });
  const result = await serviceFor(repo, fakeSettings(80)).synchronize("image-project");
  assert.equal(result[0].selectionLimit, 80);
});

// The allocation's own number is the more specific answer, so a studio-wide default never
// overrides a deliverable that already says how many photos it is worth.
test("leaves a deliverable with its own quantity untouched by the studio-wide default", async () => {
  const repo = fakeRepository({ deliverables: [deliverable({ quantity: 25 })] });
  const result = await serviceFor(repo, fakeSettings(80)).synchronize("image-project");
  assert.equal(result[0].selectionLimit, 25);
});

// Synchronising keeps what belongs to Image Selection — the checkbox — and takes the limit from the
// allocation, which is the one place it lives. An override still on the row is reported so it can be
// seen, but it no longer decides anything for a derived item.
test("synchronization creates configurations and preserves the Image Selection checkbox", async () => {
  const config = { id: "config-existing", imageSelectionProjectId: "image-project", projectPostProductionAllocationId: null, projectShootDeliverableId: "deliverable-1", enabled: false, selectionLimitOverride: 40, displayOrder: 9, inactiveAt: null, createdAt: new Date() };
  const result = await serviceFor(fakeRepository({ deliverables: [deliverable({ quantity: 25 })], configs: [config] })).synchronize("image-project");
  assert.equal(result[0].enabled, false, "the studio unchecked this item and that is Image Selection's own answer");
  assert.equal(result[0].selectionLimit, 25, "the limit comes from the allocation, not the stale override");
  assert.equal(result[0].selectionLimitOverride, 40, "which is still reported, so the leftover is visible");
});

test("marks configurations for removed deliverables inactive without deleting history", async () => {
  const config = { id: "config-old", imageSelectionProjectId: "image-project", projectPostProductionAllocationId: null, projectShootDeliverableId: "deliverable-removed", enabled: true, selectionLimitOverride: null, displayOrder: 0, inactiveAt: null, createdAt: new Date() };
  const repo = fakeRepository({ configs: [config] }); await serviceFor(repo).synchronize("image-project");
  assert.ok(repo.state.configs[0].inactiveAt); assert.equal(repo.state.configs.length, 1);
});

test("retires configurations left over from Production Creation services", async () => {
  const config = { id: "config-service", imageSelectionProjectId: "image-project", projectPostProductionAllocationId: "allocation-1", projectShootDeliverableId: null, enabled: true, selectionLimitOverride: null, displayOrder: 0, inactiveAt: null, createdAt: new Date() };
  const repo = fakeRepository({ deliverables: [deliverable()], configs: [config] });
  const result = await serviceFor(repo).synchronize("image-project");
  assert.deepEqual(result.map((item) => item.name), ["Album Selection"]);
  assert.ok(repo.state.configs.find((item) => item.id === "config-service").inactiveAt);
});

// The service takes items that have already been through `saveOverridesSchema`, which is where the
// older `selectionLimitOverride` field name is translated — so this posts what the service is handed:
// `selectionLimit`, the number the studio wants.
test("saves the checkbox on its own row and the limit onto the deliverable", async () => {
  const repo = fakeRepository({ deliverables: [deliverable()] }); const service = serviceFor(repo);
  const mapped = await service.synchronize("image-project");
  await service.saveOverrides("image-project", [{ configId: mapped[0].id, enabled: false, selectionLimit: 30 }]);
  assert.equal(repo.state.configs[0].enabled, false, "the checkbox is Image Selection's own business");
  assert.equal(repo.state.deliverables[0].selectionLimit, 30, "the limit goes to Project Management's row");
  assert.equal(repo.state.configs[0].selectionLimitOverride, null, "and is not copied onto this one");
  assert.equal(repo.state.deliverables[0].quantity, 25, "how much was ordered is left alone");
});

test("rejects selection limits outside the accepted integer business range", () => {
  assert.equal(saveOverridesSchema.safeParse({ items: [{ configId: "config-1", enabled: true, selectionLimitOverride: 0 }] }).success, false);
  assert.equal(saveOverridesSchema.safeParse({ items: [{ configId: "config-1", enabled: true, selectionLimitOverride: 100001 }] }).success, false);
  assert.equal(saveOverridesSchema.safeParse({ items: [{ configId: "config-1", enabled: true, selectionLimitOverride: 20.5 }] }).success, false);
});

// A project with no linked Project Management job simply has no selection items. Throwing here
// used to take the whole Selection Settings panel down with it, hiding the validity toggles,
// the client link, the PIN and the expiry date that work perfectly well without deliverables.
test("reports no selection items for a project with no linked Project Management job", async () => {
  const service = serviceFor(fakeRepository({ deliverables: [deliverable()] }));
  assert.deepEqual(await service.list("manual-project"), []);
  assert.deepEqual(await service.synchronize("manual-project"), []);
  assert.deepEqual(await service.listAllocatedServices("manual-project"), []);
});

// A manually named project has no allocation to derive selection items from, so Selection Settings
// is where they are typed: a name and how many photos the client may pick for it.
test("adds a typed selection item to a project with no linked Project Management job", async () => {
  const repo = fakeRepository(); const service = serviceFor(repo);
  const items = await service.addManualItem("manual-project", { name: "Retouches", selectionLimit: 30 });
  assert.deepEqual(items.map((item) => [item.name, item.selectionLimit, item.enabled]), [["Retouches", 30, true]]);
  // Stored as a row belonging to no allocation, which is what marks it as the studio's own.
  assert.equal(repo.state.configs[0].projectShootDeliverableId, null);
  assert.equal(repo.state.configs[0].projectPostProductionAllocationId, null);
  assert.equal(repo.state.configs[0].name, "Retouches");
  // And it is what the project lists from then on.
  assert.deepEqual((await service.list("manual-project")).map((item) => item.name), ["Retouches"]);
});

test("keeps typed selection items in the order they were added", async () => {
  const service = serviceFor(fakeRepository());
  await service.addManualItem("manual-project", { name: "Retouches", selectionLimit: 30 });
  const items = await service.addManualItem("manual-project", { name: "Frames", selectionLimit: 12 });
  assert.deepEqual(items.map((item) => item.name), ["Retouches", "Frames"]);
  assert.deepEqual(items.map((item) => item.selectionLimit), [30, 12]);
});

test("refuses a second selection item with the same name, however it was capitalised", async () => {
  const service = serviceFor(fakeRepository());
  await service.addManualItem("manual-project", { name: "Retouches", selectionLimit: 30 });
  await assert.rejects(() => service.addManualItem("manual-project", { name: " retouches ", selectionLimit: 10 }), { status: 409 });
});

// A shoot is always one of the project's root folders. An item filed under a name no folder has
// would be an orphan - no folder delete could ever reach it - so it is refused; an item under no
// shoot at all is still a project-wide one.
test("refuses a shoot name no folder has; an item under no shoot stays project-wide", async () => {
  const repo = fakeRepository();
  const service = serviceFor(repo);
  await assert.rejects(() => service.addManualItem("manual-project", { name: "Album", selectionLimit: 30, shootName: "Pre Wedding" }), { status: 404 });
  assert.equal(repo.state.configs.length, 0);
  const items = await service.addManualItem("manual-project", { name: "Frames", selectionLimit: 12 });
  assert.deepEqual(items.map((item) => [item.name, item.shootId, item.shoot?.shoot ?? null]), [["Frames", null, null]]);
});

test("the same item name lives in two shoot folders, but not twice in one", async () => {
  const service = serviceFor(fakeRepository({ rootFolders: [{ id: "f-pre", name: "Pre Wedding" }, { id: "f-wedding", name: "Wedding" }] }));
  await service.addManualItem("manual-project", { name: "Album", selectionLimit: 30, shootFolderId: "f-pre" });
  const items = await service.addManualItem("manual-project", { name: "Album", selectionLimit: 20, shootFolderId: "f-wedding" });
  assert.equal(items.length, 2);
  await assert.rejects(
    () => service.addManualItem("manual-project", { name: " album ", selectionLimit: 10, shootName: "pre-wedding" }),
    { status: 409 },
  );
});

/*
 * A manual project's shoot IS one of its root folders, linked by id: an item filed under it carries
 * `folder:<id>` as its shoot key and the folder's live name, so renaming the folder keeps the item
 * in the same shoot under the new name - never a second shoot.
 */
test("files a typed item under its shoot's folder by id, and follows the folder's rename", async () => {
  const repo = fakeRepository({ rootFolders: [{ id: "f-wedding", name: "wedding" }] });
  const service = serviceFor(repo);
  const items = await service.addManualItem("manual-project", { name: "Album", selectionLimit: 30, shootFolderId: "f-wedding" });
  assert.deepEqual([items[0].shootId, items[0].shoot.shoot, items[0].shoot.folderId], ["folder:f-wedding", "wedding", "f-wedding"]);
  assert.equal(repo.state.configs[0].manualShootFolderId, "f-wedding");
  repo.state.rootFolders[0].name = "wedding 02";
  const after = await service.list("manual-project");
  assert.deepEqual([after[0].shootId, after[0].shoot.shoot, after[0].selectionLimit], ["folder:f-wedding", "wedding 02", 30]);
});

test("a shoot name that matches a root folder files the item under that folder by id", async () => {
  const repo = fakeRepository({ rootFolders: [{ id: "f-pre", name: "pre wedding" }] });
  const items = await serviceFor(repo).addManualItem("manual-project", { name: "Album", selectionLimit: 10, shootName: "Pre-Wedding" });
  assert.equal(items[0].shootId, "folder:f-pre");
  assert.equal(repo.state.configs[0].manualShootFolderId, "f-pre");
});

test("refuses a shoot folder that is not in the project, and a second item of one name in one folder", async () => {
  const service = serviceFor(fakeRepository({ rootFolders: [{ id: "f-wedding", name: "wedding" }] }));
  await assert.rejects(() => service.addManualItem("manual-project", { name: "Album", selectionLimit: 10, shootFolderId: "gone" }), { status: 404 });
  await service.addManualItem("manual-project", { name: "Album", selectionLimit: 10, shootFolderId: "f-wedding" });
  await assert.rejects(() => service.addManualItem("manual-project", { name: "album", selectionLimit: 5, shootName: "Wedding" }), { status: 409 });
});

// A linked project's items are the allocation's, and a second, typed copy would be a second answer
// to what the client is choosing photos for.
test("refuses typed selection items on a project linked to Project Management", async () => {
  const service = serviceFor(fakeRepository({ deliverables: [deliverable()] }));
  await assert.rejects(() => service.addManualItem("image-project", { name: "Retouches", selectionLimit: 30 }), { status: 409 });
});

test("removes a typed selection item the client has not picked photos for", async () => {
  const repo = fakeRepository(); const service = serviceFor(repo);
  await service.addManualItem("manual-project", { name: "Retouches", selectionLimit: 30 });
  const added = await service.addManualItem("manual-project", { name: "Frames", selectionLimit: 12 });
  const remaining = await service.removeManualItem("manual-project", added[1].id);
  assert.deepEqual(remaining.map((item) => item.name), ["Retouches"]);
  assert.equal(repo.state.configs.length, 1);
});

test("keeps a selection item the client has already picked photos for", async () => {
  const repo = fakeRepository(); const service = serviceFor(repo);
  const added = await service.addManualItem("manual-project", { name: "Retouches", selectionLimit: 30 });
  repo.state.selectionsByConfig = { [added[0].id]: 4 };
  await assert.rejects(() => service.removeManualItem("manual-project", added[0].id), { status: 409 });
  assert.equal(repo.state.configs.length, 1);
});

test("refuses to remove a selection item that came from the allocation", async () => {
  const repo = fakeRepository({ deliverables: [deliverable()] }); const service = serviceFor(repo);
  const mapped = await service.synchronize("image-project");
  await assert.rejects(() => service.removeManualItem("image-project", mapped[0].id), { status: 409 });
});

test("still reports a missing project as not found rather than as an empty list", async () => {
  const service = serviceFor(fakeRepository());
  await assert.rejects(() => service.list("no-such-project"), { status: 404 });
  await assert.rejects(() => service.listAllocatedServices("no-such-project"), { status: 404 });
});

// --- One selection limit, shared with Post Production Allocation ------------------------------
//
// The limit lives on the allocated deliverable. Project Management sets it there and Image Selection
// sets it there, so neither keeps a copy the other cannot see. Before this, Selection Settings stored
// the number on its own row as an override — and because that panel posts every row on Save, not only
// the edited ones, the first save pinned every item and nothing changed in Project Management could
// reach Image Selection again.

test("a limit set in Post Production Allocation is what Image Selection shows", async () => {
  const repo = fakeRepository({ deliverables: [deliverable({ quantity: 25, selectionLimit: 30 })] });
  const [item] = await serviceFor(repo).list("image-project");
  assert.equal(item.selectionLimit, 30, "the deliverable's own limit wins over the quantity ordered");
  assert.equal(item.derivedSelectionLimit, 30);
});

// Unchecking a submitted item and checking it again is the studio's reopen gesture: the
// submitted lock lifts (the client may select again, earlier picks intact), the publication's
// own all-submitted stamp lifts with it, and the next client submit locks the item once more.
// Unchecking alone, or re-saving an already-enabled item, never touches the stamp.
test("re-enabling a submitted item reopens it for the client", async () => {
  const repo = fakeRepository({ deliverables: [deliverable()] }); const service = serviceFor(repo);
  const [item] = await service.synchronize("image-project");
  repo.state.configs[0].selectionSubmittedAt = new Date("2026-09-01");
  // The first synchronize created the config, which itself lifts the stamp (a new item means the
  // project cannot be wholly submitted) — reset the ledger so what follows measures only reopens.
  repo.state.publicationCleared = [];

  // Unchecking keeps the submitted record.
  await service.saveOverrides("image-project", [{ configId: item.id, enabled: false, selectionLimit: item.selectionLimit }]);
  assert.ok(repo.state.configs[0].selectionSubmittedAt);
  assert.deepEqual(repo.state.publicationCleared, []);

  // Checking again lifts it, and clears the publication-level stamp.
  await service.saveOverrides("image-project", [{ configId: item.id, enabled: true, selectionLimit: item.selectionLimit }]);
  assert.equal(repo.state.configs[0].selectionSubmittedAt, null);
  assert.deepEqual(repo.state.publicationCleared, ["image-project"]);

  // Re-saving the now-open enabled item is not a reopen and clears nothing further.
  await service.saveOverrides("image-project", [{ configId: item.id, enabled: true, selectionLimit: item.selectionLimit }]);
  assert.equal(repo.state.publicationCleared.length, 1);
});

test("a change in Post Production Allocation reaches Image Selection with no further action", async () => {
  const repo = fakeRepository({ deliverables: [deliverable({ quantity: 25, selectionLimit: 30 })] });
  const service = serviceFor(repo);
  const [before] = await service.list("image-project");
  assert.equal(before.selectionLimit, 30);
  // Saving the panel in between is what used to pin the number and sever the link.
  await service.saveOverrides("image-project", [{ configId: before.id, enabled: true, selectionLimit: 30 }]);

  repo.state.deliverables[0].selectionLimit = 45;
  const [after] = await service.list("image-project");
  assert.equal(after.selectionLimit, 45);
});

test("a change in Image Selection reaches Post Production Allocation", async () => {
  const repo = fakeRepository({ deliverables: [deliverable({ quantity: 25, selectionLimit: 30 })] });
  const service = serviceFor(repo);
  const [item] = await service.list("image-project");
  await service.saveOverrides("image-project", [{ configId: item.id, enabled: true, selectionLimit: 19 }]);
  assert.equal(repo.state.deliverables[0].selectionLimit, 19, "written where Project Management reads it");
  const [after] = await service.list("image-project");
  assert.equal(after.selectionLimit, 19);
});

test("only ticking a checkbox never changes the limit", async () => {
  const repo = fakeRepository({ deliverables: [deliverable({ quantity: 25, selectionLimit: 30 })] });
  const service = serviceFor(repo);
  const [item] = await service.list("image-project");
  await service.saveOverrides("image-project", [{ configId: item.id, enabled: false, selectionLimit: 30 }]);
  assert.equal(repo.state.configs[0].enabled, false);
  assert.equal(repo.state.deliverables[0].selectionLimit, 30, "unchanged, because 30 is what it already was");
});

test("an override left by an earlier version cannot hide the allocation", async () => {
  // The exact shape of the bug: Album Selection allocated for 5000 photos, with a stale 50 pinned on
  // the Image Selection row. The allocation has to win — honouring the override is what hid the 5000,
  // and saving the panel would then have written the 50 back onto the deliverable as the real answer.
  const config = { id: "config-legacy", imageSelectionProjectId: "image-project", projectPostProductionAllocationId: null, projectShootDeliverableId: "deliverable-1", enabled: true, selectionLimitOverride: 50, displayOrder: 0, inactiveAt: null, createdAt: new Date() };
  const repo = fakeRepository({ deliverables: [deliverable({ deliverableName: "Album Selection", quantity: 5000, selectionLimit: null })], configs: [config] });
  const [item] = await serviceFor(repo).list("image-project");
  assert.equal(item.selectionLimit, 5000);
});

test("a typed item still reads its own number, which is the only thing the column is for now", async () => {
  const config = { id: "config-typed", imageSelectionProjectId: "manual-project", projectPostProductionAllocationId: null, projectShootDeliverableId: null, name: "Reception Frames", enabled: true, selectionLimitOverride: 35, displayOrder: 0, inactiveAt: null, createdAt: new Date() };
  const repo = fakeRepository({ configs: [config] });
  const [item] = await serviceFor(repo, fakeSettings(50)).list("manual-project");
  assert.equal(item.selectionLimit, 35);
});

test("falls back to the quantity, then the studio default, for a deliverable with no limit set", async () => {
  const withQuantity = fakeRepository({ deliverables: [deliverable({ quantity: 25, selectionLimit: null })] });
  assert.equal((await serviceFor(withQuantity, fakeSettings(50)).list("image-project"))[0].selectionLimit, 25);

  const withNeither = fakeRepository({ deliverables: [deliverable({ quantity: null, selectionLimit: null })] });
  assert.equal((await serviceFor(withNeither, fakeSettings(50)).list("image-project"))[0].selectionLimit, 50);
});

test("a typed selection item keeps its own number, having no deliverable to share one with", async () => {
  const repo = fakeRepository();
  const service = serviceFor(repo, fakeSettings(50));
  await service.addManualItem("manual-project", { name: "Reception Frames", selectionLimit: 40 });
  const [item] = await service.list("manual-project");
  assert.equal(item.selectionLimit, 40);
  await service.saveOverrides("manual-project", [{ configId: item.id, enabled: true, selectionLimit: 35 }]);
  assert.equal(repo.state.configs[0].selectionLimitOverride, 35);
  assert.equal((await service.list("manual-project"))[0].selectionLimit, 35);
});

test("the older selectionLimitOverride field name is still accepted", () => {
  const parsed = saveOverridesSchema.parse({ items: [{ configId: "config-1", enabled: true, selectionLimitOverride: 20 }] });
  assert.equal(parsed.items[0].selectionLimit, 20);
  const direct = saveOverridesSchema.parse({ items: [{ configId: "config-1", enabled: true, selectionLimit: 25 }] });
  assert.equal(direct.items[0].selectionLimit, 25);
});

// --- The displayed number must not become a hard limit ----------------------------------------
//
// Selection Settings posts every row on Save. Writing each number as it stands would turn a quantity
// that was merely being displayed into a limit of its own, and a quantity changed in Post Production
// Allocation could then never reach Image Selection — the same bug, moved to the shared column.

test("saving the quantity that was on screen does not pin it", async () => {
  const repo = fakeRepository({ deliverables: [deliverable({ quantity: 5000, selectionLimit: null })] });
  const service = serviceFor(repo, fakeSettings(50));
  const [item] = await service.list("image-project");
  assert.equal(item.selectionLimit, 5000);
  await service.saveOverrides("image-project", [{ configId: item.id, enabled: true, selectionLimit: 5000 }]);
  assert.equal(repo.state.deliverables[0].selectionLimit, null, "left following the allocation");
  repo.state.deliverables[0].quantity = 4000;
  assert.equal((await service.list("image-project"))[0].selectionLimit, 4000, "so the allocation still governs");
});

test("saving the No of Photos that was on screen does not pin it either", async () => {
  const repo = fakeRepository({ deliverables: [deliverable({ quantity: 1, numberOfPhotos: 300, selectionLimit: null })] });
  const service = serviceFor(repo, fakeSettings(50));
  const [item] = await service.list("image-project");
  assert.equal(item.selectionLimit, 300);
  await service.saveOverrides("image-project", [{ configId: item.id, enabled: true, selectionLimit: 300 }]);
  assert.equal(repo.state.deliverables[0].selectionLimit, null, "left following the allocation");
  repo.state.deliverables[0].numberOfPhotos = 450;
  assert.equal((await service.list("image-project"))[0].selectionLimit, 450, "so a No of Photos change still reaches Image Selection");
});

test("saving a different number does pin it", async () => {
  const repo = fakeRepository({ deliverables: [deliverable({ quantity: 5000, selectionLimit: null })] });
  const service = serviceFor(repo, fakeSettings(50));
  const [item] = await service.list("image-project");
  await service.saveOverrides("image-project", [{ configId: item.id, enabled: true, selectionLimit: 200 }]);
  assert.equal(repo.state.deliverables[0].selectionLimit, 200);
  repo.state.deliverables[0].quantity = 4000;
  assert.equal((await service.list("image-project"))[0].selectionLimit, 200, "a chosen limit outranks the quantity");
});

test("typing the quantity again hands a pinned limit back to the allocation", async () => {
  const repo = fakeRepository({ deliverables: [deliverable({ quantity: 30, selectionLimit: 19 })] });
  const service = serviceFor(repo, fakeSettings(50));
  const [item] = await service.list("image-project");
  assert.equal(item.selectionLimit, 19);
  await service.saveOverrides("image-project", [{ configId: item.id, enabled: true, selectionLimit: 30 }]);
  assert.equal(repo.state.deliverables[0].selectionLimit, null);
  repo.state.deliverables[0].quantity = 45;
  assert.equal((await service.list("image-project"))[0].selectionLimit, 45);
});

test("re-saving a pinned limit keeps it pinned", async () => {
  const repo = fakeRepository({ deliverables: [deliverable({ quantity: 30, selectionLimit: 19 })] });
  const service = serviceFor(repo, fakeSettings(50));
  const [item] = await service.list("image-project");
  await service.saveOverrides("image-project", [{ configId: item.id, enabled: true, selectionLimit: 19 }]);
  assert.equal(repo.state.deliverables[0].selectionLimit, 19, "19 is not the fallback, so it stays");
});
