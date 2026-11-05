const test = require("node:test");
const assert = require("node:assert/strict");
const { createModuleLinks, pairKey, stateFrom } = require("../src/modules/image-selection/projects/moduleLinks");

/*
 * Edit Project's Linked Modules (`projects/moduleLinks.js`): unticking unlinks one pair and keeps
 * both projects; ticking again reconnects the same project; a module with no project gets one; every
 * change answers to the viewer's Read / Write on that module; a client still holding the other
 * project's link stops the unlink; nothing is written unless all of it can be.
 */

function fakeClient({ workspace, records = [], links = [], publication = null, album = null } = {}) {
  const state = { workspace: { ...workspace }, records: records.map((record) => ({ ...record })), links: links.map((link) => ({ ...link })), writes: 0 };
  let codes = 0;
  const client = {
    state,
    imageSelectionProject: {
      findFirst: async ({ where }) => (where.id === state.workspace.id ? { ...state.workspace } : null),
      update: async ({ data }) => { state.writes += 1; Object.assign(state.workspace, data); return { ...state.workspace }; },
    },
    visualCurationModuleProject: {
      findMany: async ({ where }) => state.records.filter((record) => (where.imageSelectionProjectId?.in || [where.imageSelectionProjectId]).includes(record.imageSelectionProjectId)),
      create: async ({ data }) => { state.writes += 1; const record = { ...data }; state.records.push(record); return { module: record.module, projectCode: record.projectCode, projectName: record.projectName }; },
      update: async ({ where, data }) => { state.writes += 1; const record = state.records.find((entry) => entry.id === where.id); Object.assign(record, data); return record; },
    },
    visualCurationModuleLink: {
      findMany: async ({ where }) => state.links.filter((link) => where.imageSelectionProjectId.in.includes(link.imageSelectionProjectId) && link.unlinkedAt),
      upsert: async ({ where, create, update }) => {
        state.writes += 1;
        const key = where.imageSelectionProjectId_moduleA_moduleB;
        const found = state.links.find((link) => link.imageSelectionProjectId === key.imageSelectionProjectId && link.moduleA === key.moduleA && link.moduleB === key.moduleB);
        if (found) Object.assign(found, update); else state.links.push({ ...create });
      },
    },
    imageSelectionGalleryPublication: { findUnique: async () => publication },
    signatureAlbum: { findUnique: async () => album },
    $transaction: async (callback) => {
      // All or nothing: a throw inside puts every row back as it was.
      const before = JSON.stringify({ workspace: state.workspace, records: state.records, links: state.links });
      try { return await callback(client); } catch (error) { Object.assign(state, JSON.parse(before)); throw error; }
    },
  };
  const nextIdentifier = async (scheme) => `${scheme}-${String(++codes).padStart(6, "0")}`;
  return { client, state, nextIdentifier };
}

const WORKSPACE = { id: "w1", projectCode: "DBS-VCIS-000001", projectName: "Wedding", clientName: "Asha", clientMainNumber: "+91 9876543210", salesProjectId: null, photoSelectionTab: true, photoCullingTab: true, aiEditingTab: true, signatureAlbumTab: false };
const RECORDS = [
  { id: "r-cull", imageSelectionProjectId: "w1", module: "culling", projectCode: "DBS-VCAC-000001", projectName: "Wedding" },
  { id: "r-edit", imageSelectionProjectId: "w1", module: "editing", projectCode: "DBS-VCAE-000001", projectName: "Wedding" },
];
const everything = async () => true;

function links(setup = {}, { hasPermission = everything } = {}) {
  const fake = fakeClient({ workspace: WORKSPACE, records: RECORDS, ...setup });
  const service = createModuleLinks(fake.client, { hasPermission, nextIdentifier: fake.nextIdentifier, now: () => new Date("2026-11-03T10:00:00Z") });
  return { ...fake, service };
}
const linkedOf = (state) => Object.fromEntries(state.map((entry) => [entry.module, entry.linked]));

test("projects made together are linked with no row; a pair is keyed in alphabetical order", async () => {
  const { service } = links();
  assert.deepEqual(linkedOf(await service.linkState(WORKSPACE, "culling")), { editing: true, photos: true, album: false });
  assert.equal(pairKey("photos", "culling"), "culling:photos");
});

test("unticking unlinks that pair only - both projects, and every other link, stay", async () => {
  const { service, state } = links();
  const result = await service.apply("w1", "culling", { editing: false }, 7);
  assert.deepEqual(result, { linked: [], unlinked: ["editing"], created: [] });
  assert.equal(state.records.length, 2, "the AI Editing project is kept");
  assert.equal(state.workspace.aiEditingTab, true, "and stays in its own module");
  assert.deepEqual(state.links, [{ imageSelectionProjectId: "w1", moduleA: "culling", moduleB: "editing", unlinkedAt: new Date("2026-11-03T10:00:00Z"), unlinkedByUserId: 7 }]);
  const after = linkedOf(await service.linkState(state.workspace, "culling"));
  assert.deepEqual(after, { editing: false, photos: true, album: false });
  // Per pair: AI Editing is still linked to Photo Selection.
  assert.equal((await service.linkState(state.workspace, "editing")).find((entry) => entry.module === "photos").linked, true);
});

test("ticking again reconnects the very same project - no second one is made", async () => {
  const { service, state } = links({ links: [{ imageSelectionProjectId: "w1", moduleA: "culling", moduleB: "editing", unlinkedAt: new Date(), unlinkedByUserId: 7 }] });
  const result = await service.apply("w1", "culling", { editing: true }, 7);
  assert.deepEqual(result, { linked: ["editing"], unlinked: [], created: [] });
  assert.equal(state.records.filter((record) => record.module === "editing").length, 1);
  assert.equal(state.links[0].unlinkedAt, null);
  assert.equal((await service.linkState(state.workspace, "culling")).find((entry) => entry.module === "editing").projectCode, "DBS-VCAE-000001");
});

test("ticking a module with no project makes one, linked to this project and to nothing else", async () => {
  const { service, state } = links();
  const result = await service.apply("w1", "culling", { album: true }, 7);
  assert.deepEqual(result.created, [{ module: "album", projectCode: "VC_SIGNATURE_ALBUM-000001", projectName: "Wedding" }]);
  assert.equal(state.workspace.signatureAlbumTab, true);
  const album = linkedOf(await service.linkState(state.workspace, "album"));
  assert.deepEqual(album, { culling: true, editing: false, photos: false });
});

test("two modules ticked in one save are linked to each other too, as Create Project links them", async () => {
  const fake = fakeClient({ workspace: { ...WORKSPACE, photoSelectionTab: false, aiEditingTab: false }, records: [RECORDS[0]] });
  const service = createModuleLinks(fake.client, { hasPermission: everything, nextIdentifier: fake.nextIdentifier });
  await service.apply("w1", "culling", { editing: true, album: true }, 7);
  assert.equal((await service.linkState(fake.state.workspace, "editing")).find((entry) => entry.module === "album").linked, true);
  // Photo Selection was never ticked: still not a member, so its box stays unticked.
  assert.equal((await service.linkState(fake.state.workspace, "culling")).find((entry) => entry.module === "photos").member, false);
});

test("a module left out of the save is left exactly as it is", async () => {
  const { service, state } = links();
  await service.apply("w1", "culling", {}, 7);
  assert.equal(state.writes, 0);
});

test("every change needs Read / Write on that module - refused before anything is written", async () => {
  const onlyCulling = async (_userId, module, level) => module === "culling" || level === "READ";
  const { service, state } = links({}, { hasPermission: onlyCulling });
  await assert.rejects(service.apply("w1", "culling", { editing: false }, 7), (error) => error.status === 403 && error.details.code === "MODULE_LINK_FORBIDDEN");
  assert.equal(state.writes, 0);
});

test("a client still holding the other project's link stops the unlink, and nothing is saved", async () => {
  const published = links({ publication: { status: "PUBLISHED" } });
  let written = false;
  await assert.rejects(published.service.apply("w1", "culling", { photos: false }, 7, { alsoWrite: async () => { written = true; } }), (error) => error.status === 409 && error.details.code === "CLIENT_LINK_ACTIVE" && error.details.module === "photos");
  assert.equal(written, false, "the name is not saved either");
  assert.equal(published.state.writes, 0);
  // Unpublished, it goes through.
  const unpublished = links({ publication: { status: "UNPUBLISHED" } });
  assert.deepEqual((await unpublished.service.apply("w1", "culling", { photos: false }, 7)).unlinked, ["photos"]);
  // A published album, still in date, likewise; an expired one does not hold it.
  const album = { workspace: { ...WORKSPACE, signatureAlbumTab: true }, records: [...RECORDS, { id: "r-album", imageSelectionProjectId: "w1", module: "album", projectCode: "DBS-VCSA-000001", projectName: "Wedding" }] };
  await assert.rejects(links({ ...album, album: { status: "PUBLISHED", expiresAt: null } }).service.apply("w1", "culling", { album: false }, 7), (error) => error.details.code === "CLIENT_LINK_ACTIVE");
  assert.deepEqual((await links({ ...album, album: { status: "PUBLISHED", expiresAt: new Date("2026-01-01") } }).service.apply("w1", "culling", { album: false }, 7)).unlinked, ["album"]);
});

test("a failure inside the save puts every link back - no half-saved change", async () => {
  const { service, state } = links();
  await assert.rejects(service.apply("w1", "culling", { editing: false, album: true }, 7, { alsoWrite: async () => { throw new Error("name refused"); } }));
  assert.equal(state.links.length, 0);
  assert.equal(state.records.length, 2);
});

test("a project from Project Management is always linked and is not linked or unlinked here", async () => {
  const { service } = links({ workspace: { ...WORKSPACE, salesProjectId: "s1" } });
  await assert.rejects(service.apply("w1", "culling", { editing: false }, 7), (error) => error.status === 409);
});

test("a list row names only the modules the viewer may open, and says which they may change", () => {
  const state = stateFrom(WORKSPACE, "culling", RECORDS, new Set([pairKey("culling", "editing")]));
  assert.deepEqual(state.map(({ module, member, linked, projectCode }) => [module, member, linked, projectCode]), [
    ["photos", true, true, "DBS-VCIS-000001"],
    ["editing", true, false, "DBS-VCAE-000001"],
    ["album", false, false, null],
  ]);
});
