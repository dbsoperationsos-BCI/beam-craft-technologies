const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { CLIENT_ROUTES } = require("../src/middleware/authMiddleware");
const { getClientProjects, getClientProject, getClientPayments } = require("../src/modules/client/portal/controller");

/*
 * One client, several events: the studio saves a new project (a new Event ID) with the same Client
 * Main Number, and the client's one login reads every one of them - and never a project with another
 * number. Real rows, removed at the end.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TCPE-${STAMP}-${name}`;
const F = {};

const leadFor = (enquiryId) => prisma.salesCrmLead.upsert({ where: { enquiryId }, create: { enquiryId, name: enquiryId }, update: {} });
const projectData = (name, number) => ({
  enquiryId: tag(`enq-${name}`), eventId: tag(`ev-${name}`), whatsappGroupName: `WED ${name} ${STAMP}`, clientMainNumber: number,
  sourceBranch: "Erode TN", vertical: "WED", deliverables: "[]", initialConvertedValue: 1000, crmName: "Test",
  projectStatus: "Yet to Start",
});

before(async () => {
  // Named by phone number, which the fixture sweep cannot find: a run killed before `after` left it.
  await prisma.user.deleteMany({ where: { username: "9000012345", role: "CLIENT" } });
  for (const name of ["first", "second", "deleted", "stranger"]) await leadFor(tag(`enq-${name}`));
  F.first = await prisma.salesProject.create({ data: projectData("first", "+91 9000012345") });
  F.second = await prisma.salesProject.create({ data: projectData("second", "+91 90000 12345") });
  F.deleted = await prisma.salesProject.create({ data: { ...projectData("deleted", "+91 9000012345"), deletedAt: new Date() } });
  F.stranger = await prisma.salesProject.create({ data: projectData("stranger", "+91 9000099999") });
  F.client = await prisma.user.create({ data: { name: "Client", email: null, username: "9000012345", password: "x", role: "CLIENT", status: "ACTIVE", clientProjectId: F.first.id } });
});

after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [F.client?.id].filter(Boolean) } } });
  await prisma.salesProject.deleteMany({ where: { eventId: { startsWith: `TCPE-${STAMP}` } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { startsWith: `TCPE-${STAMP}` } } });
  await prisma.$disconnect();
});

async function answer(handler, query = {}) {
  const out = { code: 200, body: null };
  const res = { set: () => res, status: (code) => { out.code = code; return res; }, json: (body) => { out.body = body; return res; } };
  await handler({ user: { id: F.client.id, role: "CLIENT" }, params: {}, query }, res);
  return out;
}

test("the client's events route is open to a client token", () => {
  assert.ok(CLIENT_ROUTES.has("GET /api/client/projects"));
});

test("one login lists every live event saved with its number, oldest first - not a deleted one, not another number", async () => {
  const { code, body } = await answer(getClientProjects);
  assert.equal(code, 200);
  assert.deepEqual(body.data.events, [F.first.eventId, F.second.eventId], "spacing in the saved number does not matter");
});

test("an event is read by its Event ID - only the client's own", async () => {
  assert.equal((await answer(getClientProject, { event: F.second.eventId })).body.data.eventId, F.second.eventId);
  assert.equal((await answer(getClientProject)).body.data.eventId, F.first.eventId, "no event asked: the login's own project, as before");
  assert.equal((await answer(getClientProject, { event: F.stranger.eventId })).code, 404, "another client's event is not found");
  assert.equal((await answer(getClientProject, { event: F.deleted.eventId })).code, 404, "a deleted event is gone");
  assert.equal((await answer(getClientPayments, { event: F.stranger.eventId })).code, 404, "money too");
});

test("a returning client keeps one login: a new project with the same number makes none, and says so", async () => {
  const { clientLoginFor, existingClientLoginFor } = require("../src/modules/sales/projects/controller");
  assert.deepEqual(await existingClientLoginFor("+91 90000 12345"), { username: "9000012345", active: true, passwordChanged: false });
  assert.equal(await existingClientLoginFor("+91 9000077777"), null, "a new client's number has no login");
  // Create Project with Client Credentials filled in for the returning client: no second login, no error.
  const req = { user: { id: 1 }, body: { clientLogin: { temporaryPassword: "abcd-efgh-jkmn" } } };
  assert.equal(await clientLoginFor(req, { clientMainNumber: "+91 9000012345" }), null);
});
