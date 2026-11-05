const test = require("node:test");
const assert = require("node:assert/strict");
const { createStorageRootService } = require("../src/modules/image-selection/storage-roots/service");
const { createStorageRootSchema, updateStorageRootSchema } = require("../src/modules/image-selection/storage-roots/validation");

// Storage roots are names, not paths: the server never learns where a root is mounted. These
// tests pin the identity rules — unique among living roots, soft-deleted, name reusable after
// retirement — that photo records will depend on for years.

function fakeRepository(initial = []) {
  const state = { roots: initial.map((root) => ({ notes: null, deletedAt: null, ...root })), nextId: 1 };
  return {
    state,
    listRoots: async () => state.roots.filter((root) => !root.deletedAt),
    findRoot: async (id) => state.roots.find((root) => root.id === id && !root.deletedAt) || null,
    findRootByName: async (name, excludeId) => state.roots.find((root) => root.name === name && !root.deletedAt && root.id !== excludeId) || null,
    createRoot: async (data) => { const root = { id: `root-${state.nextId++}`, deletedAt: null, ...data }; state.roots.push(root); return root; },
    updateRoot: async (id, data) => { const root = state.roots.find((candidate) => candidate.id === id); Object.assign(root, data); return root; },
  };
}

test("creates, lists, updates and soft-deletes a storage root", async () => {
  const repo = fakeRepository();
  const service = createStorageRootService(repo);
  const created = await service.create({ name: "STUDIO_NAS_MAIN", notes: "Synology in the edit room" });
  assert.equal(created.name, "STUDIO_NAS_MAIN");
  assert.deepEqual((await service.list()).map((root) => root.name), ["STUDIO_NAS_MAIN"]);
  const updated = await service.update(created.id, { notes: "moved to rack 2" });
  assert.equal(updated.notes, "moved to rack 2");
  await service.remove(created.id);
  assert.deepEqual(await service.list(), []);
  // The row survives as a soft-deleted record for the photo rows that point at it.
  assert.ok(repo.state.roots[0].deletedAt);
});

test("refuses a duplicate name among living roots, but a retired name is free again", async () => {
  const repo = fakeRepository([{ id: "root-a", name: "ARCHIVE_HDD" }]);
  const service = createStorageRootService(repo);
  await assert.rejects(() => service.create({ name: "ARCHIVE_HDD" }), { status: 409 });
  await service.remove("root-a");
  const recreated = await service.create({ name: "ARCHIVE_HDD" });
  assert.notEqual(recreated.id, "root-a");
});

test("renaming onto another living root's name is refused; renaming onto your own is not", async () => {
  const repo = fakeRepository([{ id: "root-a", name: "NAS_A" }, { id: "root-b", name: "NAS_B" }]);
  const service = createStorageRootService(repo);
  await assert.rejects(() => service.update("root-b", { name: "NAS_A" }), { status: 409 });
  assert.equal((await service.update("root-a", { name: "NAS_A" })).name, "NAS_A");
});

test("a name the database still holds on a retired root is refused as a 409 that says so, never a 500", async () => {
  // The living-roots check passes (the retired row is filtered out), then the database's own unique
  // index refuses the write: Prisma's P2002 is the only way that collision reaches the service.
  const repo = fakeRepository([{ id: "root-a", name: "ARCHIVE_HDD", deletedAt: new Date() }, { id: "root-b", name: "NAS_B" }]);
  const clash = Object.assign(new Error("Unique constraint failed on the fields: (`name`)"), { code: "P2002" });
  repo.createRoot = async () => { throw clash; };
  repo.updateRoot = async () => { throw clash; };
  const service = createStorageRootService(repo);
  await assert.rejects(() => service.create({ name: "ARCHIVE_HDD" }), (error) => error.status === 409 && /retired storage root/.test(error.message));
  await assert.rejects(() => service.update("root-b", { name: "ARCHIVE_HDD" }), (error) => error.status === 409 && /retired storage root/.test(error.message));
  // Any other database failure is still the 500 it was.
  repo.createRoot = async () => { throw new Error("connection lost"); };
  await assert.rejects(() => service.create({ name: "FRESH" }), (error) => error.status === undefined);
});

test("missing roots answer 404", async () => {
  const service = createStorageRootService(fakeRepository());
  await assert.rejects(() => service.update("nope", { name: "X" }), { status: 404 });
  await assert.rejects(() => service.remove("nope"), { status: 404 });
});

test("validation trims names, refuses blanks, and turns empty notes into null", () => {
  assert.equal(createStorageRootSchema.safeParse({ name: "  NAS  " }).data.name, "NAS");
  assert.equal(createStorageRootSchema.safeParse({ name: "   " }).success, false);
  assert.equal(createStorageRootSchema.safeParse({ name: "NAS", notes: "" }).data.notes, null);
  // An update that names nothing changes nothing — both fields are optional.
  assert.deepEqual(updateStorageRootSchema.safeParse({}).data, {});
});
