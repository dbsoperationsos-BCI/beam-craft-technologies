const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { removeProjectClientStorage, PROJECT_DELETED_REASON } = require("../src/modules/assets/client-storage.service");

/*
 * A deleted project takes its hard discs off the Client Storage register.
 *
 * The bug this exists for is quiet and structural: a project is *soft*-deleted, so its row never
 * actually goes and the foreign key's `ON DELETE SET NULL` never fires, and the storage register
 * filters on its own `is_deleted` and never looks at the project's. The result was a disc listed
 * against a project that had disappeared from Bookings & Converted and from every other screen -
 * visible only to somebody who happened to look at both lists at once, which is why it stood.
 *
 * Real rows, removed at the end.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TCD-${STAMP}-${name}`;
const F = {};

before(async () => {
  const project = (name) => prisma.salesProject.create({ data: {
    enquiryId: tag(`enq-${name}`), eventId: tag(name), whatsappGroupName: `WED ${name}`, clientMainNumber: "+919876543210",
    sourceBranch: "Erode TN", deliverables: "[]", initialConvertedValue: 0, crmName: "Test",
  } });
  F.deleted = await project("p-deleted");
  F.kept = await project("p-kept");

  const disc = (name, data) => prisma.clientStorage.create({ data: { storageId: tag(name), ...data } });
  F.onDeleted = await disc("on-deleted", { projectId: F.deleted.id });
  // A second disc on the same project: a project may raise more than one over its life.
  F.alsoOnDeleted = await disc("also-on-deleted", { projectId: F.deleted.id });
  // Already removed by hand, with a reason of its own that must survive.
  F.alreadyGone = await disc("already-gone", {
    projectId: F.deleted.id, isDeleted: true, deletedReason: "Disc sold to the client.", deletedAt: new Date(),
  });
  F.onKept = await disc("on-kept", { projectId: F.kept.id });
  // No project at all — raised against a shoot, or before it had one. Nothing here may touch it.
  F.unattached = await disc("unattached", {});
});

after(async () => {
  await prisma.clientStorage.deleteMany({ where: { storageId: { startsWith: `TCD-${STAMP}-` } } });
  await prisma.salesProject.deleteMany({ where: { eventId: { startsWith: `TCD-${STAMP}-` } } });
});

const read = (id) => prisma.clientStorage.findUnique({ where: { id }, select: { isDeleted: true, deletedReason: true, deletedAt: true, updatedBy: true } });

test("every record on the project goes, and says why", async () => {
  const count = await removeProjectClientStorage(prisma, F.deleted.id, { userId: 1 });
  assert.equal(count, 2, "both live records on the project, and only those");

  for (const id of [F.onDeleted.id, F.alsoOnDeleted.id]) {
    const row = await read(id);
    assert.equal(row.isDeleted, true);
    // The reason is the whole point: a record removed by nobody has to account for itself, or it
    // reads as though whoever last touched it took the disc off the register.
    assert.equal(row.deletedReason, PROJECT_DELETED_REASON);
    assert.ok(row.deletedAt instanceof Date);
    assert.equal(row.updatedBy, 1);
  }
});

test("a record already removed keeps its own reason", async () => {
  // That reason is the true account of why the disc went. Overwriting it would rewrite history,
  // and would do so on exactly the records where somebody had bothered to explain themselves.
  const row = await read(F.alreadyGone.id);
  assert.equal(row.isDeleted, true);
  assert.equal(row.deletedReason, "Disc sold to the client.");
});

test("another project's records are left alone", async () => {
  const row = await read(F.onKept.id);
  assert.equal(row.isDeleted, false);
  assert.equal(row.deletedReason, null);
});

test("a record on no project is left alone", async () => {
  // `projectId` is null on a record raised before its project had a shoot, and a `where` that
  // matched null against null would take every one of them the first time any project was deleted.
  const row = await read(F.unattached.id);
  assert.equal(row.isDeleted, false);
});

test("running it again changes nothing", async () => {
  // The delete endpoint answers 404 rather than reaching here twice, but a re-run must be harmless:
  // the second pass finds nothing live and must not restamp the reasons written by the first.
  const before = await read(F.onDeleted.id);
  const count = await removeProjectClientStorage(prisma, F.deleted.id, { userId: 2 });
  assert.equal(count, 0);
  assert.deepEqual(await read(F.onDeleted.id), before);
});

test("a project with no storage is not an error", async () => {
  assert.equal(await removeProjectClientStorage(prisma, F.kept.id + "-nope", { userId: 1 }), 0);
});
