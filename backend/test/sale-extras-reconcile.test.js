const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { reconcileSaleExtras, RECONCILE_TX } = require("../src/modules/sales/sale-extras/reconcile");
const { scopeOf } = require("../src/modules/sales/sale-extras/rules");

/*
 * Reconcile: the project's rows compared with what the finalized quotation booked (their baseline
 * snapshot) and with what has already been published, into draft Extra lines - added, removed,
 * modified, and the lines included in another's price. Real rows, removed at the end.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TSR-${STAMP}-${name}`;
const F = { projects: [], quotations: [] };
const later = (seconds) => new Date(Date.now() + seconds * 1000);

async function run(projectId) {
  return prisma.$transaction((tx) => reconcileSaleExtras(tx, projectId, { userId: F.admin.id }), RECONCILE_TX);
}
const lines = (projectId, where = {}) => prisma.projectSaleExtra.findMany({ where: { projectId, ...where }, orderBy: { createdAt: "asc" } });
const open = (projectId) => lines(projectId, { status: { in: ["DRAFT", "PUBLISHED"] } });

async function booked(name, { quotation = true } = {}) {
  const q = quotation ? await prisma.salesQuotation.create({ data: {
    quotationNumber: tag(`q${name}`), quotationId: tag(`q${name}-01`), publicToken: `${name}${STAMP}`.padEnd(8, "r").slice(0, 8), payload: { rates: { gstPercent: 18 } },
    sourceBranch: "Erode TN", followedBy: "Test", status: "Generated", amount: 235000, version: 1, enquiryId: F.lead.enquiryId, finalizedAt: new Date(), finalizedByUserId: F.admin.id,
  } }) : null;
  if (q) F.quotations.push(q.id);
  const project = await prisma.salesProject.create({ data: {
    enquiryId: F.lead.enquiryId, eventId: tag(`p${name}`), whatsappGroupName: `WED ${tag(name)}`, clientMainNumber: "+919876543210",
    sourceBranch: "Erode TN", deliverables: "[]", initialConvertedValue: 235000, crmName: "Test", quotationId: q?.quotationId || null,
  } });
  F.projects.push(project.id);
  // As booking writes it: the quoted shoot, a quoted service and a quoted deliverable, all baseline.
  const shoot = await prisma.projectShoot.create({ data: { shootId: tag(`${name}-sh`), projectId: project.id, shoot: "Wedding", dateCreated: new Date("2026-12-12"), saleBaseline: {} } });
  const service = await prisma.projectPostProductionAllocation.create({ data: { projectId: project.id, shootId: shoot.id, serviceName: "Candid Video", quantity: 1, saleBaseline: scopeOf("SERVICE", { quantity: 1 }) } });
  const deliverable = await prisma.projectShootDeliverable.create({ data: { projectId: project.id, shootId: shoot.id, deliverableName: "Signature Album", quantity: 1, size: "12x36", saleBaseline: scopeOf("DELIVERABLE", { quantity: 1, size: "12x36" }) } });
  return { project, shoot, service, deliverable, quotation: q };
}

async function publishAll(projectId, number) {
  const revision = await prisma.projectSaleExtraRevision.create({ data: { projectId, salesQuotationId: F.quotations[F.quotations.length - 1], revisionNumber: number, originalAmount: 0, netAdjustment: 0, updatedTotal: 0, gstPercent: 18, lines: [], publishedByName: tag("pub") } });
  await prisma.projectSaleExtra.updateMany({ where: { projectId, status: "DRAFT" }, data: { status: "PUBLISHED", publishedRevisionId: revision.id, amount: 0 } });
}

before(async () => {
  F.admin = await prisma.user.create({ data: { name: tag("admin"), email: `${tag("admin")}@test.local`.toLowerCase(), username: tag("admin").toLowerCase(), password: "x", role: "SUPER_ADMIN" } });
  F.lead = await prisma.salesCrmLead.create({ data: { enquiryId: tag("enq"), name: tag("enq"), status: "Converted", crm: "Test" } });
});

after(async () => {
  await prisma.projectSaleExtra.deleteMany({ where: { projectId: { in: F.projects } } });
  await prisma.salesProject.deleteMany({ where: { id: { in: F.projects } } });
  await prisma.salesQuotation.deleteMany({ where: { id: { in: F.quotations } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { in: [F.lead?.enquiryId].filter(Boolean) } } });
  await prisma.user.deleteMany({ where: { id: { in: [F.admin?.id].filter(Boolean) } } });
  await prisma.$disconnect();
});

test("a project as booked has no extras; one with no quotation is not tracked at all", async () => {
  const A = await booked("a");
  assert.equal((await run(A.project.id)).tracked, true);
  assert.deepEqual(await lines(A.project.id), []);
  const B = await booked("b", { quotation: false });
  await prisma.projectShoot.create({ data: { shootId: tag("b-new"), projectId: B.project.id, shoot: "Reception", dateCreated: new Date("2026-12-14") } });
  assert.equal((await run(B.project.id)).tracked, false);
  assert.deepEqual(await lines(B.project.id), []);
});

test("a new shoot and each of its services and deliverables are lines of their own", async () => {
  const A = await booked("c");
  const shoot = await prisma.projectShoot.create({ data: { shootId: tag("c-rec"), projectId: A.project.id, shoot: "Reception", dateCreated: new Date("2026-12-14") } });
  await prisma.projectPostProductionAllocation.create({ data: { projectId: A.project.id, shootId: shoot.id, serviceName: "Candid Photo", quantity: 1 } });
  await prisma.projectShootDeliverable.create({ data: { projectId: A.project.id, shootId: shoot.id, deliverableName: "Mini Album", quantity: 1 } });
  await run(A.project.id);
  const all = await lines(A.project.id);
  const parent = all.find((row) => row.category === "SHOOT");
  assert.equal(parent.kind, "ADDED");
  assert.equal(parent.itemName, "Reception");
  assert.ok(all.every((row) => row.parentExtraId === null && row.kind === "ADDED"), "each is priced on its own");
  assert.deepEqual(all.map((row) => row.itemName).sort(), ["Candid Photo", "Mini Album", "Reception"]);
  // Running again changes nothing.
  const firstCodes = all.map((row) => `${row.code}:${row.status}`);
  await run(A.project.id);
  assert.deepEqual((await lines(A.project.id)).map((row) => `${row.code}:${row.status}`), firstCodes);
});

test("a service added to a quoted shoot and the deliverables it brought are lines of their own", async () => {
  const A = await booked("d");
  const serviceName = "Indoor Photo Only";
  const service = await prisma.projectPostProductionAllocation.create({ data: { projectId: A.project.id, shootId: A.shoot.id, serviceName, quantity: 1 } });
  await prisma.projectShootDeliverable.create({ data: { projectId: A.project.id, shootId: A.shoot.id, deliverableName: "Retouches", quantity: 1 } });
  await prisma.projectShootDeliverable.create({ data: { projectId: A.project.id, shootId: A.shoot.id, deliverableName: "Magnet Frame", quantity: 1 } });
  await run(A.project.id);
  const all = await open(A.project.id);
  const own = all.find((row) => row.serviceAllocationId === service.id);
  assert.equal(own.kind, "ADDED");
  assert.equal(own.parentExtraId, null);
  assert.equal(all.find((row) => row.itemName === "Retouches").parentExtraId, null, "a deliverable the service brought is priced on its own");
  assert.equal(all.find((row) => row.itemName === "Magnet Frame").parentExtraId, null);
});

test("removing a quoted shoot removes it and what went with it, each a line of its own", async () => {
  const A = await booked("e");
  const now = new Date();
  await prisma.projectShoot.update({ where: { id: A.shoot.id }, data: { deletedAt: now } });
  await prisma.projectPostProductionAllocation.update({ where: { id: A.service.id }, data: { deletedAt: now } });
  await prisma.projectShootDeliverable.update({ where: { id: A.deliverable.id }, data: { deletedAt: now } });
  await run(A.project.id);
  const all = await open(A.project.id);
  const parent = all.find((row) => row.category === "SHOOT");
  assert.equal(parent.kind, "REMOVED");
  assert.deepEqual(all.map((row) => `${row.category}:${row.kind}:${row.parentExtraId}`).sort(), ["DELIVERABLE:REMOVED:null", "SERVICE:REMOVED:null", "SHOOT:REMOVED:null"]);
  // Restored (as the Pre Production import does): the removal draft goes away.
  await prisma.projectShoot.update({ where: { id: A.shoot.id }, data: { deletedAt: null } });
  await prisma.projectPostProductionAllocation.update({ where: { id: A.service.id }, data: { deletedAt: null } });
  await prisma.projectShootDeliverable.update({ where: { id: A.deliverable.id }, data: { deletedAt: null } });
  await run(A.project.id);
  assert.deepEqual(await open(A.project.id), []);
});

test("removing a quoted service on its own is its own line", async () => {
  const A = await booked("f");
  await prisma.projectPostProductionAllocation.update({ where: { id: A.service.id }, data: { deletedAt: new Date() } });
  await run(A.project.id);
  const all = await open(A.project.id);
  assert.equal(all.length, 1);
  assert.equal(all[0].kind, "REMOVED");
  assert.equal(all[0].category, "SERVICE");
  assert.equal(all[0].parentExtraId, null);
});

test("a scope edit is one Modified draft; changing it back cancels it", async () => {
  const A = await booked("g");
  await prisma.projectShootDeliverable.update({ where: { id: A.deliverable.id }, data: { quantity: 2 } });
  await run(A.project.id);
  await prisma.projectShootDeliverable.update({ where: { id: A.deliverable.id }, data: { quantity: 3 } });
  await run(A.project.id);
  let all = await open(A.project.id);
  assert.equal(all.length, 1);
  assert.equal(all[0].kind, "MODIFIED");
  assert.equal(all[0].details.before.quantity, 1);
  assert.equal(all[0].details.after.quantity, 3);
  await prisma.projectShootDeliverable.update({ where: { id: A.deliverable.id }, data: { quantity: 1 } });
  await run(A.project.id);
  assert.deepEqual(await open(A.project.id), []);
  // A remark or a shoot reschedule is not an extra.
  await prisma.projectShootDeliverable.update({ where: { id: A.deliverable.id }, data: { remarks: "rush" } });
  await prisma.projectShoot.update({ where: { id: A.shoot.id }, data: { dateCreated: new Date("2026-12-20") } });
  await run(A.project.id);
  assert.deepEqual(await open(A.project.id), []);
});

test("an addition removed before publishing leaves nothing; after publishing it is a removal to price", async () => {
  const A = await booked("h");
  const service = await prisma.projectPostProductionAllocation.create({ data: { projectId: A.project.id, shootId: A.shoot.id, serviceName: "Drone", quantity: 1 } });
  await run(A.project.id);
  await prisma.projectPostProductionAllocation.update({ where: { id: service.id }, data: { deletedAt: new Date() } });
  await run(A.project.id);
  assert.deepEqual(await open(A.project.id), []);

  const second = await prisma.projectPostProductionAllocation.create({ data: { projectId: A.project.id, shootId: A.shoot.id, serviceName: "Drone 2", quantity: 1 } });
  await run(A.project.id);
  await publishAll(A.project.id, 1);
  await prisma.projectPostProductionAllocation.update({ where: { id: second.id }, data: { deletedAt: new Date() } });
  await run(A.project.id);
  const drafts = await lines(A.project.id, { status: "DRAFT" });
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].kind, "REMOVED");
  assert.equal(drafts[0].serviceAllocationId, second.id);
});

test("a published scope edit edited again opens a new draft from the published scope", async () => {
  const A = await booked("i");
  await prisma.projectPostProductionAllocation.update({ where: { id: A.service.id }, data: { quantity: 2 } });
  await run(A.project.id);
  await publishAll(A.project.id, 1);
  await run(A.project.id);
  assert.equal((await lines(A.project.id, { status: "DRAFT" })).length, 0, "published state matches: nothing new");
  await prisma.projectPostProductionAllocation.update({ where: { id: A.service.id }, data: { quantity: 4 } });
  await run(A.project.id);
  const drafts = await lines(A.project.id, { status: "DRAFT" });
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].details.before.quantity, 2);
  assert.equal(drafts[0].details.after.quantity, 4);
});

test("a quoted line replaced by the same item in one operation is not an extra", async () => {
  const A = await booked("j");
  await prisma.projectPostProductionAllocation.update({ where: { id: A.service.id }, data: { deletedAt: new Date() } });
  const replacement = await prisma.projectPostProductionAllocation.create({ data: { projectId: A.project.id, shootId: A.shoot.id, serviceName: "Candid Video", serviceDefinitionId: A.service.serviceDefinitionId, quantity: 1 } });
  await run(A.project.id);
  assert.deepEqual(await open(A.project.id), []);
  assert.notEqual((await prisma.projectPostProductionAllocation.findUnique({ where: { id: replacement.id } })).saleBaseline, null, "the baseline moved to the new row");
});

test("a draft folded under another by the earlier recorder becomes its own line; a published one is untouched", async () => {
  const A = await booked("fold");
  const shoot = await prisma.projectShoot.create({ data: { shootId: tag("fold-rec"), projectId: A.project.id, shoot: "Reception", dateCreated: new Date("2026-12-14") } });
  await prisma.projectPostProductionAllocation.create({ data: { projectId: A.project.id, shootId: shoot.id, serviceName: "Candid Photo", quantity: 1 } });
  await run(A.project.id);
  const rows = await lines(A.project.id);
  const shootLine = rows.find((row) => row.category === "SHOOT");
  const serviceLine = rows.find((row) => row.category === "SERVICE");
  await prisma.projectSaleExtra.update({ where: { id: serviceLine.id }, data: { parentExtraId: shootLine.id } });
  await run(A.project.id);
  assert.equal((await prisma.projectSaleExtra.findUnique({ where: { id: serviceLine.id } })).parentExtraId, null);

  await prisma.projectSaleExtra.update({ where: { id: serviceLine.id }, data: { parentExtraId: shootLine.id, status: "PUBLISHED" } });
  await prisma.projectSaleExtra.update({ where: { id: shootLine.id }, data: { status: "PUBLISHED", amount: "1000.00" } });
  await run(A.project.id);
  assert.equal((await prisma.projectSaleExtra.findUnique({ where: { id: serviceLine.id } })).parentExtraId, shootLine.id, "a published line is never rewritten");
});

test("a Sale Extras transaction picked as a deadlock victim runs again; any other failure does not", async () => {
  const { runLocked } = require("../src/modules/sales/sale-extras/reconcile");
  const clientFailing = (errors) => {
    let calls = 0;
    return { calls: () => calls, $transaction: async (work) => { calls += 1; if (errors.length) throw errors.shift(); return work("tx"); } };
  };
  const deadlocked = clientFailing([Object.assign(new Error("deadlock"), { code: "P2034" }), Object.assign(new Error("deadlock"), { code: "P2034" })]);
  assert.equal(await runLocked(deadlocked, async (tx) => `ran on ${tx}`), "ran on tx");
  assert.equal(deadlocked.calls(), 3);
  const refused = clientFailing([Object.assign(new Error("stale"), { status: 409 })]);
  await assert.rejects(runLocked(refused, async () => "never"), { status: 409 });
  assert.equal(refused.calls(), 1, "a refusal is not retried");
});
