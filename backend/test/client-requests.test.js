const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { CLIENT_ROUTES } = require("../src/middleware/authMiddleware");
const requests = require("../src/modules/client/requests/service");

/*
 * Client requests: a client asks, about one of their shoots, to add something from the studio's list,
 * change something, or a question; the team accepts (at a price - an extra quotation on the booking -
 * or free), declines or answers. Another booking's shoot is refused. Real rows, removed at the end.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TCRQ-${STAMP}-${name}`;
const F = {};

const projectData = (name) => ({
  enquiryId: tag(`enq-${name}`), eventId: tag(`ev-${name}`), whatsappGroupName: `WED ${name} ${STAMP}`, clientMainNumber: "+919876543210",
  sourceBranch: "Erode TN", vertical: "WED", deliverables: "[]", initialConvertedValue: 1000, crmName: "Test", projectStatus: "Pre Production",
});

before(async () => {
  for (const name of ["mine", "theirs"]) await prisma.salesCrmLead.upsert({ where: { enquiryId: tag(`enq-${name}`) }, create: { enquiryId: tag(`enq-${name}`), name: tag(`enq-${name}`) }, update: {} });
  F.mine = await prisma.salesProject.create({ data: projectData("mine") });
  F.theirs = await prisma.salesProject.create({ data: projectData("theirs") });
  F.shoot = await prisma.projectShoot.create({ data: { shootId: tag("sh"), projectId: F.mine.id, shoot: "Reception" } });
  F.other = await prisma.projectShoot.create({ data: { shootId: tag("sh2"), projectId: F.theirs.id, shoot: "Wedding" } });
});

after(async () => {
  // The projects take their requests, shoots and extra quotations with them.
  await prisma.salesProject.deleteMany({ where: { eventId: { startsWith: `TCRQ-${STAMP}` } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { startsWith: `TCRQ-${STAMP}` } } });
  await prisma.$disconnect();
});

const input = (extra) => requests.requestSchema.parse({ shootId: F.shoot.id, ...extra });

test("a client token reaches its requests", () => {
  assert.ok(CLIENT_ROUTES.has("GET /api/client/requests"));
  assert.ok(CLIENT_ROUTES.has("POST /api/client/requests"));
});

test("a request needs what it is about, and a question needs words", () => {
  assert.equal(requests.requestSchema.safeParse({ shootId: "x", kind: "add" }).success, false);
  assert.equal(requests.requestSchema.safeParse({ shootId: "x", kind: "question" }).success, false);
  assert.equal(requests.requestSchema.safeParse({ shootId: "x", kind: "question", note: "When is my album ready?" }).success, true);
});

test("a client asks to add something; the team accepts it and no quotation is raised", async () => {
  const made = await requests.createRequest({ projectId: F.mine.id, userId: null, input: input({ kind: "add", itemType: "other", itemName: "Drone coverage", quantity: 2, note: "For the reception entry" }) });
  assert.deepEqual([made.status, made.itemName, made.quantity, made.shootName], ["pending", "Drone coverage", 2, "Reception"]);
  const { requests: listed } = await requests.clientRequests(F.mine.id);
  assert.ok(listed.some((row) => row.id === made.id));
  const accepted = await requests.answerRequest(made.id, null, requests.answerSchema.parse({ action: "accept", price: 15000 }));
  assert.deepEqual([accepted.status, accepted.price, accepted.stage], ["accepted", 15000, "added"]);
  const row = await prisma.clientServiceRequest.findUnique({ where: { id: made.id } });
  assert.equal(row.extraQuotationId, null, "no quotation");
  await assert.rejects(requests.answerRequest(made.id, null, requests.answerSchema.parse({ action: "decline", reply: "No" })), /already been answered/);
});

test("free acceptance raises no extra; a decline needs a reason; a question is answered", async () => {
  const free = await requests.createRequest({ projectId: F.mine.id, userId: null, input: input({ kind: "change", itemName: "Album size" }) });
  await requests.answerRequest(free.id, null, requests.answerSchema.parse({ action: "accept", price: null }));
  assert.equal((await prisma.clientServiceRequest.findUnique({ where: { id: free.id } })).extraQuotationId, null);
  assert.equal(requests.answerSchema.safeParse({ action: "decline" }).success, false);
  const asked = await requests.createRequest({ projectId: F.mine.id, userId: null, input: input({ kind: "question", note: "When is my album ready?" }) });
  const answered = await requests.answerRequest(asked.id, null, requests.answerSchema.parse({ action: "answer", reply: "Next Friday." }));
  assert.deepEqual([answered.status, answered.reply], ["answered", "Next Friday."]);
});

test("a client deletes a request only while it waits, and only their own", async () => {
  const waiting = await requests.createRequest({ projectId: F.mine.id, userId: null, input: input({ kind: "add", itemName: "Second shooter" }) });
  assert.equal(await requests.removeRequest(waiting.id, F.theirs.id), false, "not another booking's");
  assert.equal(await requests.removeRequest(waiting.id, F.mine.id), true);
  assert.equal(await prisma.clientServiceRequest.count({ where: { id: waiting.id } }), 0);
  const answered = await requests.createRequest({ projectId: F.mine.id, userId: null, input: input({ kind: "question", note: "Album size?" }) });
  await requests.answerRequest(answered.id, null, requests.answerSchema.parse({ action: "answer", reply: "12 x 36." }));
  await assert.rejects(requests.removeRequest(answered.id, F.mine.id), (error) => error.status === 409);
});

test("the team approves a client's requests at the prices they were sent with; each joins the project, the client is told once", async () => {
  const definition = await prisma.projectServiceDefinition.findFirst({ where: { isActive: true }, select: { id: true } });
  const { requests: made } = await requests.createRequests({ projectId: F.mine.id, userId: null, input: input({ kind: "add", items: [{ itemType: "other", itemName: "Reels", quantity: 2 }, ...(definition ? [{ itemType: "service", catalogId: definition.id, quantity: 1 }] : [])] }) });
  await prisma.clientServiceRequest.update({ where: { id: made[0].id }, data: { price: 4000 } });
  const before = await prisma.clientNotification.count({ where: { salesProjectId: F.mine.id, title: "Your request is approved" } });
  const done = await requests.approveRequests(null, requests.approveSchema.parse({ ids: made.map((row) => row.id) }));
  assert.equal(done.approved, made.length);
  const rows = await prisma.clientServiceRequest.findMany({ where: { id: { in: made.map((row) => row.id) } }, orderBy: { id: "asc" } });
  assert.deepEqual(rows.map((row) => row.status), made.map(() => "accepted"));
  assert.equal(rows[0].extraQuotationId, null, "no quotation is raised");
  assert.equal((await requests.clientRequests(F.mine.id)).requests.find((row) => row.id === made[0].id).stage, "added");
  if (definition) assert.equal(await prisma.projectPostProductionAllocation.count({ where: { projectId: F.mine.id, shootId: F.shoot.id, serviceDefinitionId: definition.id, deletedAt: null } }), 1, "the list pick is on the shoot");
  assert.equal(await prisma.clientNotification.count({ where: { salesProjectId: F.mine.id, title: "Your request is approved" } }), before + 1, "one notice for them all");
  await assert.rejects(requests.approveRequests(null, requests.approveSchema.parse({ ids: [made[0].id] })), (error) => error.status === 409, "not twice");
});

test("a shoot from another booking is refused", async () => {
  await assert.rejects(requests.createRequest({ projectId: F.mine.id, userId: null, input: input({ shootId: F.other.id, kind: "add", itemName: "x" }) }), (error) => error.status === 404);
});

test("several picks at once are a request each; an answer waits in Action Needed until opened", async () => {
  const { requests: made } = await requests.createRequests({ projectId: F.mine.id, userId: null, input: input({ kind: "add", items: [{ itemType: "other", itemName: "Drone", quantity: 1 }, { itemType: "other", itemName: "Extra album", quantity: 2 }] }) });
  assert.deepEqual(made.map((row) => [row.itemName, row.quantity]), [["Drone", 1], ["Extra album", 2]]);
  await requests.answerRequest(made[1].id, null, requests.answerSchema.parse({ action: "accept", price: 5000 }));
  assert.ok((await requests.unseenAnswers(F.mine.id)).some((row) => row.id === made[1].id), "in Action Needed");
  assert.ok(await prisma.clientNotification.count({ where: { salesProjectId: F.mine.id, title: "Your request is approved" } }) >= 1, "and in the bell");
  await requests.markAnswersSeen(F.mine.id);
  assert.equal((await requests.unseenAnswers(F.mine.id)).length, 0, "gone once opened");
});
