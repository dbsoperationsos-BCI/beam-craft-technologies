const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const service = require("../src/modules/sales/sale-extras/service");
const projects = require("../src/modules/sales/projects/controller");
const { outstandingFor } = require("../src/modules/accounts/cash-entries/receiptMessage");
const { scopeOf } = require("../src/modules/sales/sale-extras/rules");

/*
 * What a published Sale Extra moves: the project's signed value and outstanding balance (once, a
 * removal lowering it), and the client's existing quotation link, which gains the original / extra /
 * updated total block from the latest revision only. Drafts move nothing; the payment schedule and
 * receipts are never written; without a revision the client's quotation is exactly what it was.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TSM-${STAMP}-${name}`;
const F = {};

async function answer(handler, req) {
  let out = null;
  const res = { status: (code) => ({ json: (body) => { out = { code, body }; } }), json: (body) => { out = { code: 200, body }; } };
  await handler({ query: {}, params: {}, body: {}, headers: {}, user: { id: F.admin.id, role: "SUPER_ADMIN" }, ...req }, res);
  return out;
}
const openLink = (token) => answer(projects.publicQuotation, { params: { token }, user: undefined });
const withoutBranding = ({ brandSnapshot: _brand, ...rest }) => rest;

before(async () => {
  F.admin = await prisma.user.create({ data: { name: tag("admin"), email: `${tag("admin")}@test.local`.toLowerCase(), username: tag("admin").toLowerCase(), password: "x", role: "SUPER_ADMIN" } });
  F.lead = await prisma.salesCrmLead.create({ data: { enquiryId: tag("enq"), name: tag("enq"), status: "Converted", crm: "Test" } });
  F.quotation = await prisma.salesQuotation.create({ data: {
    quotationNumber: tag("q"), quotationId: tag("q-01"), publicToken: `m${STAMP}x`.padEnd(8, "m").slice(0, 8), payload: { rates: { gstPercent: 18 } },
    sourceBranch: "Erode TN", followedBy: "Test", status: "Generated", amount: 235000, version: 1, enquiryId: F.lead.enquiryId,
    finalizedAt: new Date(), finalizedByUserId: F.admin.id, linkExpiresAt: new Date(Date.now() + 86400000),
  } });
  F.project = await prisma.salesProject.create({ data: {
    enquiryId: F.lead.enquiryId, eventId: tag("p"), whatsappGroupName: `WED ${tag("p")}`, clientMainNumber: "+919876543210",
    sourceBranch: "Erode TN", deliverables: "[]", initialConvertedValue: 235000, crmName: "Test", quotationId: F.quotation.quotationId,
  } });
  F.shoot = await prisma.projectShoot.create({ data: { shootId: tag("sh"), projectId: F.project.id, shoot: "Pre-wedding", dateCreated: new Date("2026-12-10"), saleBaseline: {} } });
  await prisma.projectPostProductionAllocation.create({ data: { projectId: F.project.id, shootId: F.shoot.id, serviceName: "Candid Video", quantity: 1, saleBaseline: scopeOf("SERVICE", { quantity: 1 }) } });
  await prisma.cashEntry.create({ data: { entryId: tag("rcp"), entryType: "Received", category: "Advance", amount: 50000, entryDate: new Date(), branch: "Erode TN", paymentMode: "Cash", projectId: F.project.id, clientName: "x" } });
});

after(async () => {
  await prisma.cashEntry.deleteMany({ where: { projectId: { in: [F.project?.id].filter(Boolean) } } });
  await prisma.salesProject.deleteMany({ where: { id: { in: [F.project?.id].filter(Boolean) } } });
  await prisma.salesQuotation.deleteMany({ where: { id: { in: [F.quotation?.id].filter(Boolean) } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { in: [F.lead?.enquiryId].filter(Boolean) } } });
  await prisma.user.deleteMany({ where: { id: { in: [F.admin?.id].filter(Boolean) } } });
  await prisma.$disconnect();
});

test("drafts move nothing: not the money, not the client's quotation", async () => {
  F.before = await openLink(F.quotation.publicToken);
  assert.equal(F.before.code, 200);
  assert.ok(!("saleExtras" in F.before.body.data));
  await prisma.projectShoot.create({ data: { shootId: tag("rec"), projectId: F.project.id, shoot: "Reception", dateCreated: new Date("2026-12-14") } });
  // As deleting a shoot does: the shoot and its services together.
  const removedAt = new Date();
  await prisma.projectShoot.update({ where: { id: F.shoot.id }, data: { deletedAt: removedAt } });
  await prisma.projectPostProductionAllocation.updateMany({ where: { shootId: F.shoot.id }, data: { deletedAt: removedAt } });
  const state = await service.saleExtrasState(F.project.id, { userId: F.admin.id });
  assert.ok(state.lines.length > 0);
  assert.equal(await outstandingFor(F.project.id), 185000);
  const withDrafts = await openLink(F.quotation.publicToken);
  assert.deepEqual(withoutBranding(withDrafts.body.data), withoutBranding(F.before.body.data));
});

test("publishing counts once in the money and shows on the same client link", async () => {
  const state = await service.saleExtrasState(F.project.id, { userId: F.admin.id });
  const drafts = state.lines.filter((line) => line.status === "DRAFT");
  const scheduleBefore = await prisma.projectPaymentSchedule.count({ where: { projectId: F.project.id } });
  // Each item its own line: the shoot added, the shoot removed, and the service that went with it (₹0).
  const amountOf = (line) => (line.kind === "ADDED" ? 15000 : line.category === "SHOOT" ? 10000 : 0);
  await service.publish(F.project.id, { draftIds: drafts.map((line) => line.id), reviewed: Object.fromEntries(drafts.map((line) => [line.id, line.updatedAt])), expectedRevision: 0, lines: drafts.map((line) => ({ id: line.id, amount: amountOf(line) })) }, { id: F.admin.id });

  assert.equal(await outstandingFor(F.project.id), 185000 + 5000);
  const payments = await answer(projects.listProjectPayments, { params: { id: F.project.id } });
  assert.equal(payments.code, 200, JSON.stringify(payments.body));
  assert.equal(payments.body.data.summary.totalSaleExtras, 5000);
  assert.equal(payments.body.data.summary.totalSigned, 240000);
  assert.equal(await prisma.projectPaymentSchedule.count({ where: { projectId: F.project.id } }), scheduleBefore);
  assert.equal(await prisma.cashEntry.count({ where: { projectId: F.project.id } }), 1);

  const view = await openLink(F.quotation.publicToken);
  const extras = view.body.data.saleExtras;
  assert.equal(extras.updatedTotal, 240000);
  assert.equal(extras.gstPercent, 18);
  assert.ok(extras.publishedAt);
  // Every published line once, split into added and removed - the shoot and what it took with it.
  assert.deepEqual(extras.added.map((item) => [item.item, item.category, item.relatedShoot]), [["Reception", "SHOOT", "Reception"]]);
  assert.deepEqual(extras.removed.map((item) => [item.item, item.category]).sort(), [["Candid Video", "SERVICE"], ["Pre-wedding", "SHOOT"]]);
  assert.ok([...extras.added, ...extras.removed].every((item) => item.createdDate), "each item carries the date it happened");
  // No price per item, no net, no revision number, no internal id reaches the client.
  for (const hidden of ["amount", "netAdjustment", "originalAmount", "revision", "extraId", "SXT-"]) assert.ok(!JSON.stringify(extras).includes(hidden), hidden);
  assert.equal(view.body.data.amount, 235000, "the original figure is untouched");
});
