const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const prisma = require("../src/config/db");
const projects = require("../src/modules/sales/projects/controller");
const bin = require("../src/modules/assets/recycling-bin.service");
const binController = require("../src/modules/assets/recycling-bin.controller");
const imageSelectionProjects = require("../src/modules/image-selection/projects/service");
const { requireModule } = require("../src/middleware/permissionMiddleware");
const { PROJECT_DELETED_REASON } = require("../src/modules/assets/client-storage.service");

/*
 * Resource Management → Recycling Bin. Deleting a project - one at a time or a ticked set - only
 * moves it to the bin; Restore brings back exactly what the delete touched; Delete permanently is the
 * old hard delete plus the photo purge. Real rows, removed at the end; the photo purge is stubbed.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TRB-${STAMP}-${name}`;
const F = {};
const purged = [];
const realPurge = imageSelectionProjects.purgeData;

/** Calls a handler and says what it answered: `{ code, body }`. */
async function answer(handler, req) {
  let out = null;
  const res = { status: (code) => ({ json: (body) => { out = { code, body }; } }), json: (body) => { out = { code: 200, body }; } };
  await handler({ query: {}, params: {}, body: {}, headers: {}, ...req }, res);
  return out;
}

/** Runs a guard and says whether it let the request through, or what it answered. */
async function guard(middleware, req) {
  let out = null;
  const res = { status: (code) => ({ json: (body) => { out = { code, body }; } }) };
  await middleware(req, res, () => { out = { code: "next" }; });
  return out;
}

const leadFor = (enquiryId) => prisma.salesCrmLead.upsert({ where: { enquiryId }, create: { enquiryId, name: enquiryId }, update: {} });

before(async () => {
  imageSelectionProjects.purgeData = async (id) => { purged.push(id); return {}; };
  F.admin = await prisma.user.create({ data: { name: "Bin admin", email: `${tag("admin")}@test.local`.toLowerCase(), username: tag("admin").toLowerCase(), password: "x", role: "SUPER_ADMIN" } });
  F.nobody = await prisma.user.create({ data: { name: "Bin nobody", email: `${tag("nobody")}@test.local`.toLowerCase(), username: tag("nobody").toLowerCase(), password: "x", role: "EMPLOYEE" } });
  const project = async (name) => { await leadFor(tag(`enq-${name}`)); return prisma.salesProject.create({ data: {
    enquiryId: tag(`enq-${name}`), eventId: tag(name), whatsappGroupName: `WED ${tag(name)}`, clientMainNumber: "+919876543210",
    sourceBranch: "Erode TN", deliverables: "[]", initialConvertedValue: 0, crmName: "Test",
  } }); };
  F.single = await project("single");
  F.bulk = await project("bulk");
  F.login = await prisma.user.create({ data: { name: "Bin client", email: `${tag("client")}@test.local`.toLowerCase(), username: tag("client").toLowerCase(), password: "x", role: "CLIENT", status: "ACTIVE", clientProjectId: F.single.id } });
  // Switched off by an admin before its project was deleted: Restore must leave it off.
  F.offLogin = await prisma.user.create({ data: { name: "Bin client off", email: `${tag("client-off")}@test.local`.toLowerCase(), username: tag("client-off").toLowerCase(), password: "x", role: "CLIENT", status: "INACTIVE", clientProjectId: F.bulk.id } });
  F.gallery = await prisma.imageSelectionProject.create({ data: { projectName: tag("gallery"), salesProjectId: F.single.id } });
  // Deleted on its own, earlier: Restore must leave it deleted.
  F.oldGallery = await prisma.imageSelectionProject.create({ data: { projectName: tag("old-gallery"), salesProjectId: F.single.id, albumProofing: true, deletedAt: new Date(Date.now() - 86400000) } });
  F.bulkGallery = await prisma.imageSelectionProject.create({ data: { projectName: tag("bulk-gallery"), salesProjectId: F.bulk.id } });
  F.disc = await prisma.clientStorage.create({ data: { storageId: tag("disc"), projectId: F.single.id } });
  F.handRemoved = await prisma.clientStorage.create({ data: { storageId: tag("hand"), projectId: F.single.id, isDeleted: true, deletedReason: "Disc sold to the client.", deletedAt: new Date(Date.now() - 86400000) } });
});

after(async () => {
  imageSelectionProjects.purgeData = realPurge;
  await prisma.clientStorage.deleteMany({ where: { storageId: { in: [F.disc?.storageId, F.handRemoved?.storageId].filter(Boolean) } } });
  await prisma.imageSelectionProject.deleteMany({ where: { id: { in: [F.gallery?.id, F.oldGallery?.id, F.bulkGallery?.id].filter(Boolean) } } });
  await prisma.user.deleteMany({ where: { id: { in: [F.login?.id, F.offLogin?.id].filter(Boolean) } } });
  await prisma.salesProject.deleteMany({ where: { id: { in: [F.single?.id, F.bulk?.id].filter(Boolean) } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { in: [tag("enq-single"), tag("enq-bulk")] } } });
  await prisma.user.deleteMany({ where: { id: { in: [F.admin?.id, F.nobody?.id].filter(Boolean) } } });
  await prisma.$disconnect();
});

const adminReq = () => ({ user: { id: F.admin.id, role: "SUPER_ADMIN" } });
const inBin = async () => (await bin.listDeletedProjects(F.admin.id)).map((row) => row.id);

test("the single Delete moves the project to the bin, and erases no photos", async () => {
  const out = await answer(projects.deleteProject, { ...adminReq(), params: { id: F.single.id } });
  assert.equal(out.code, 200, JSON.stringify(out));
  assert.match(out.body.message, /Project Vault/);

  // Off every register (they all read `deletedAt: null`), in the bin with who deleted it.
  assert.equal(await prisma.salesProject.count({ where: { id: F.single.id, deletedAt: null } }), 0);
  const row = (await bin.listDeletedProjects(F.admin.id)).find((item) => item.id === F.single.id);
  assert.ok(row, "the deleted project is listed in the bin");
  assert.equal(row.eventId, tag("single"));
  assert.equal(row.deletedBy?.id, F.admin.id);

  // What went with it, recorded the way Restore reads it back.
  const project = await prisma.salesProject.findUnique({ where: { id: F.single.id }, select: { deletedAt: true } });
  const login = await prisma.user.findUnique({ where: { id: F.login.id } });
  assert.equal(login.status, "INACTIVE");
  assert.equal(login.deactivatedWithProjectAt.getTime(), project.deletedAt.getTime(), "the login this delete switched off is stamped");
  assert.equal((await prisma.imageSelectionProject.findUnique({ where: { id: F.gallery.id } })).deletedAt.getTime(), project.deletedAt.getTime());
  const disc = await prisma.clientStorage.findUnique({ where: { id: F.disc.id } });
  assert.equal(disc.isDeleted, true);
  assert.equal(disc.deletedReason, PROJECT_DELETED_REASON);
  assert.deepEqual(purged, [], "no photos are purged by a delete");
});

test("the tick boxes' bulk delete is the same soft move, under the same per-project rule", async () => {
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "projects", "routes.js"), "utf8");
  assert.match(routes, /path: "\/projects\/bulk",[\s\S]*?deleteOne: \(id, req\) => deleteProjectRecord\(req, String\(id\)\)/);
  assert.doesNotMatch(routes, /hardDeleteProjectRecord/);

  const removed = await projects.deleteProjectRecord(adminReq(), F.bulk.id);
  assert.equal(removed.id, F.bulk.id);
  const row = await prisma.salesProject.findUnique({ where: { id: F.bulk.id }, select: { deletedAt: true, deletedByUserId: true } });
  assert.ok(row, "the row is still there");
  assert.ok(row.deletedAt);
  assert.equal(row.deletedByUserId, F.admin.id);
  assert.ok((await inBin()).includes(F.bulk.id));
  assert.deepEqual(purged, []);
  // Already off before the delete: left off, and not stamped as this delete's doing.
  const off = await prisma.user.findUnique({ where: { id: F.offLogin.id } });
  assert.equal(off.status, "INACTIVE");
  assert.equal(off.deactivatedWithProjectAt, null);
});

test("a person without ASSET / Recycling Bin is refused, reading and writing", async () => {
  const gate = requireModule("ASSET", "Recycling Bin");
  const user = { id: F.nobody.id, role: "EMPLOYEE" };
  assert.equal((await guard(gate, { method: "GET", user })).code, 403);
  assert.equal((await guard(gate, { method: "POST", user })).code, 403);
  assert.equal((await guard(gate, { method: "DELETE", user })).code, 403);
  assert.equal((await guard(gate, { method: "POST", user: { id: F.admin.id, role: "SUPER_ADMIN" } })).code, "next");
  // And the service itself answers nothing to somebody not holding it.
  assert.deepEqual((await bin.listDeletedProjects(F.nobody.id)).filter((row) => [F.single.id, F.bulk.id].includes(row.id)), []);
});

test("Restore brings back the project, its gallery, its client login and its storage record - and nothing else", async () => {
  const out = await answer(binController.restoreProject, { ...adminReq(), params: { id: F.single.id } });
  assert.equal(out.code, 200, JSON.stringify(out));

  const project = await prisma.salesProject.findUnique({ where: { id: F.single.id }, select: { deletedAt: true, deletedByUserId: true, purgingAt: true } });
  assert.deepEqual(project, { deletedAt: null, deletedByUserId: null, purgingAt: null });
  assert.equal((await prisma.imageSelectionProject.findUnique({ where: { id: F.gallery.id } })).deletedAt, null);
  const login = await prisma.user.findUnique({ where: { id: F.login.id } });
  assert.equal(login.status, "ACTIVE");
  assert.equal(login.deactivatedWithProjectAt, null);
  const disc = await prisma.clientStorage.findUnique({ where: { id: F.disc.id } });
  assert.equal(disc.isDeleted, false);
  assert.equal(disc.deletedReason, null);

  // Deleted on their own, before: still deleted.
  assert.ok((await prisma.imageSelectionProject.findUnique({ where: { id: F.oldGallery.id } })).deletedAt);
  const hand = await prisma.clientStorage.findUnique({ where: { id: F.handRemoved.id } });
  assert.equal(hand.isDeleted, true);
  assert.equal(hand.deletedReason, "Disc sold to the client.");
  assert.ok(!(await inBin()).includes(F.single.id));

  // Not in the bin any more, so a second Restore is a 404 rather than a second write.
  assert.equal((await answer(binController.restoreProject, { ...adminReq(), params: { id: F.single.id } })).code, 404);
});

test("Restore refuses when a live project now holds the Event ID", async () => {
  // A deleted project carrying the Event ID that F.single - live again - now holds.
  const clash = await bin.restoreClash(prisma, { id: F.bulk.id, eventId: tag("single"), sheetEventId: null });
  assert.equal(clash?.id, F.single.id);
  assert.equal(await bin.restoreClash(prisma, { id: F.bulk.id, eventId: tag("bulk"), sheetEventId: null }), null);

  // Through the service: a clash is a 409 with a sentence, and nothing is restored.
  const service = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "assets", "recycling-bin.service.js"), "utf8");
  const restore = service.slice(service.indexOf("async function restoreDeletedProject"), service.indexOf("async function purgeDeletedProject"));
  assert.ok(restore.indexOf("restoreClash(prisma, project)") < restore.indexOf("prisma.$transaction"));
  assert.match(restore, /throw httpError\(409, CLASH_MESSAGE\(project\)\)/);
  assert.match(restore, /error\?\.code === "P2002"/);
});

test("a login an admin switched off before the delete stays off after Restore", async () => {
  // Restore the bulk project and put it back in the bin, so the purge tests below still have it.
  assert.equal((await answer(binController.restoreProject, { ...adminReq(), params: { id: F.bulk.id } })).code, 200);
  assert.equal((await prisma.user.findUnique({ where: { id: F.offLogin.id } })).status, "INACTIVE");
  await projects.deleteProjectRecord(adminReq(), F.bulk.id);
});

test("the bin's router is guarded and mounted at /api/recycling-bin", () => {
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "assets", "recycling-bin.routes.js"), "utf8");
  assert.match(routes, /router\.use\(protect\);\s*router\.use\(requireModule\("ASSET", "Recycling Bin"\)\);/);
  assert.ok(routes.indexOf("requireModule(") < routes.indexOf("router.get("), "the guard is mounted before every route");
  const server = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");
  assert.match(server, /app\.use\("\/api\/recycling-bin", recyclingBinRoutes\);/);
  assert.match(server, /const recyclingBinRoutes = require\("\.\/modules\/assets\/recycling-bin\.routes"\);/);
});

test("Delete permanently refuses a request that does not confirm the project's Event ID", async () => {
  for (const body of [{}, { confirmEventId: tag("single") }, { confirmEventId: "" }]) {
    const out = await answer(binController.deleteProjectPermanently, { ...adminReq(), params: { id: F.bulk.id }, body });
    assert.equal(out.code, 400, JSON.stringify(body));
  }
  assert.equal(await prisma.salesProject.count({ where: { id: F.bulk.id, purgingAt: null } }), 1, "nothing claimed, nothing erased");
});

test("a photo purge that fails leaves the project in the bin, unclaimed, and says so", async () => {
  imageSelectionProjects.purgeData = async () => { throw new Error("bucket down"); };
  try {
    const out = await answer(binController.deleteProjectPermanently, { ...adminReq(), params: { id: F.bulk.id }, body: { confirmEventId: tag("bulk") } });
    assert.equal(out.code, 502, JSON.stringify(out));
  } finally {
    imageSelectionProjects.purgeData = async (id) => { purged.push(id); return {}; };
  }
  const row = await prisma.salesProject.findUnique({ where: { id: F.bulk.id }, select: { deletedAt: true, purgingAt: true } });
  assert.ok(row.deletedAt, "still in the bin");
  assert.equal(row.purgingAt, null, "the claim is released so it can be tried again");
});

test("Restore is refused while a Delete permanently holds the project", async () => {
  await prisma.salesProject.update({ where: { id: F.bulk.id }, data: { purgingAt: new Date() } });
  try {
    const out = await answer(binController.restoreProject, { ...adminReq(), params: { id: F.bulk.id } });
    assert.equal(out.code, 409, JSON.stringify(out));
    // And so is a second Delete permanently - a double-click.
    const again = await answer(binController.deleteProjectPermanently, { ...adminReq(), params: { id: F.bulk.id }, body: { confirmEventId: tag("bulk") } });
    assert.equal(again.code, 409, JSON.stringify(again));
    assert.ok((await prisma.salesProject.findUnique({ where: { id: F.bulk.id }, select: { deletedAt: true } })).deletedAt, "still in the bin");
  } finally {
    await prisma.salesProject.update({ where: { id: F.bulk.id }, data: { purgingAt: null } });
  }
});

test("Delete permanently erases the project and purges its photos", async () => {
  const out = await answer(binController.deleteProjectPermanently, { ...adminReq(), params: { id: F.bulk.id }, body: { confirmEventId: tag("bulk") } });
  assert.equal(out.code, 200, JSON.stringify(out));
  assert.equal(await prisma.salesProject.count({ where: { id: F.bulk.id } }), 0);
  assert.deepEqual(purged, [F.bulkGallery.id], "the bin's Delete permanently is where the photos are purged");
  assert.ok(!(await inBin()).includes(F.bulk.id));

  // A live project is not in the bin, so it can be neither erased nor "restored" from here.
  assert.equal((await answer(binController.deleteProjectPermanently, { ...adminReq(), params: { id: F.single.id }, body: { confirmEventId: tag("single") } })).code, 404);
  assert.equal(await prisma.salesProject.count({ where: { id: F.single.id } }), 1);
});
