const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { CLIENT_ROUTES } = require("../src/middleware/authMiddleware");
const { getClientPackage } = require("../src/modules/client/portal/controller");

/*
 * What a client's booking includes: its services and deliverables, shoot by shoot, in the order the
 * shoots run - what was sold, and nothing the studio keeps for itself (remarks). Another client's
 * booking answers nothing. Real rows, removed at the end.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TCPK-${STAMP}-${name}`;
const F = {};

const projectData = (name) => ({
  enquiryId: tag(`enq-${name}`), eventId: tag(`ev-${name}`), whatsappGroupName: `WED ${name} ${STAMP}`, clientMainNumber: "+919876543210",
  sourceBranch: "Erode TN", vertical: "WED", deliverables: "[]", initialConvertedValue: 1000, crmName: "Test", projectStatus: "Pre Production",
});

before(async () => {
  for (const name of ["mine", "theirs"]) await prisma.salesCrmLead.upsert({ where: { enquiryId: tag(`enq-${name}`) }, create: { enquiryId: tag(`enq-${name}`), name: tag(`enq-${name}`) }, update: {} });
  F.mine = await prisma.salesProject.create({ data: projectData("mine") });
  F.theirs = await prisma.salesProject.create({ data: projectData("theirs") });
  // Added out of order: the client reads them in the order they run.
  F.reception = await prisma.projectShoot.create({ data: { shootId: tag("sh-rec"), projectId: F.mine.id, shoot: "Reception", dateCreated: new Date("2026-12-12") } });
  F.haldi = await prisma.projectShoot.create({ data: { shootId: tag("sh-hal"), projectId: F.mine.id, shoot: "Haldi", dateCreated: new Date("2026-12-10") } });
  await prisma.projectPostProductionAllocation.create({ data: { projectId: F.mine.id, shootId: F.reception.id, serviceName: "Candid Photo", quantity: 2, durationHours: 4, remarks: "internal: send Arun" } });
  await prisma.projectShootDeliverable.create({ data: { projectId: F.mine.id, shootId: F.reception.id, deliverableName: "Signature Album", numberOfPhotos: 60, size: "12x36", remarks: "internal: rush" } });
  await prisma.projectShootDeliverable.create({ data: { projectId: F.mine.id, shootId: F.haldi.id, deliverableName: "Retouches", numberOfPhotos: 25 } });
  F.gone = await prisma.projectShootDeliverable.create({ data: { projectId: F.mine.id, shootId: F.haldi.id, deliverableName: "Removed", deletedAt: new Date() } });
  F.client = await prisma.user.create({ data: { name: "Client", email: null, username: tag("client").toLowerCase(), password: "x", role: "CLIENT", status: "ACTIVE", clientProjectId: F.mine.id } });
});

after(async () => {
  await prisma.user.deleteMany({ where: { username: { startsWith: `tcpk-${STAMP}` } } });
  // The project takes its shoots, services and deliverables with it.
  await prisma.salesProject.deleteMany({ where: { eventId: { startsWith: `TCPK-${STAMP}` } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { startsWith: `TCPK-${STAMP}` } } });
  await prisma.$disconnect();
});

async function answer(req) {
  const out = { code: 200, body: null };
  const res = { set: () => res, status: (code) => { out.code = code; return res; }, json: (body) => { out.body = body; return res; } };
  await getClientPackage(req, res);
  return out;
}

test("a client token reaches its booking's services and deliverables", () => {
  assert.ok(CLIENT_ROUTES.has("GET /api/client/package"));
});

test("a client reads what its booking includes, shoot by shoot, as the shoots run - and no remarks", async () => {
  const { code, body } = await answer({ user: { id: F.client.id, role: "CLIENT" }, query: {} });
  assert.equal(code, 200);
  const { shoots } = body.data;
  assert.deepEqual(shoots.map((shoot) => shoot.name), ["Haldi", "Reception"]);
  const [haldi, reception] = shoots;
  assert.deepEqual(haldi.deliverables.map((d) => d.name), ["Retouches"], "a removed deliverable is not listed");
  assert.equal(haldi.deliverables[0].photos, 25);
  assert.deepEqual(reception.services, [{ id: reception.services[0].id, name: "Candid Photo", quantity: 2, timing: "4 hrs", details: null }]);
  assert.equal(reception.deliverables[0].details, "12x36");
  assert.ok(!JSON.stringify(body).includes("internal"), "nothing the studio wrote for itself");
});

test("another client's booking answers nothing", async () => {
  const { code } = await answer({ user: { id: F.client.id, role: "CLIENT" }, query: { event: F.theirs.eventId } });
  assert.equal(code, 404);
});
