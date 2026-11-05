const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");

/*
 * Sale Extras at booking: the shoots a finalized quotation brought into Create Project - and their
 * services and deliverables - are the project's baseline; a shoot added by hand at booking is an extra
 * from the start. The flag is only honoured with a finalized quotation, and never for more shoots than
 * the quotation holds. Re-linking another quotation once extras are published is refused.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TSK-${STAMP}-${name}`;
let identifiers = 0;
const identifierService = require("../src/services/identifiers");
identifierService.nextIdentifier = async () => tag(`id${(identifiers += 1)}`);
const controller = require("../src/modules/sales/projects/controller");
const { invalidate } = require("../src/services/referenceMatchers");

const F = {};

function call(handler, { body = {}, params = {}, query = {}, feature = "Quotation Management" } = {}) {
  return new Promise((resolve) => {
    const req = { accepts: () => "json", user: { id: F.login.id, role: "SUPER_ADMIN" }, body, params, query, headers: {}, permission: { module: "SALES", feature, level: "READ_WRITE" } };
    const res = {
      statusCode: 200,
      locals: {},
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
      send(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
      set() { return this; },
    };
    handler(req, res);
  });
}

const answers = (enquiryId) => ({
  enquiryId, vertical: "Dum Dum", quotationBrand: "DUM_DUM", name: "Booking Client", clientName: "Booking Client", clientMainNumber: "+919876543210",
  assignedBranch: F.br.name, sourceBranch: F.br.name, subtotal: 1000, discount: 10, amount: 900,
  shoots: [{ id: "s1", shoot: "Wedding" }],
  // The quoted shoot's own lines: what the booking may mark as baseline under it.
  services: [{ shootId: "s1", serviceDefinitionId: F.service.id, quantity: 1 }],
  deliverables: [{ shootId: "s1", deliverableDefinitionId: F.deliverable.id, quantity: 1 }],
});
const shoot = (name, extra = {}) => ({
  shoot: name, shootPlace: "Erode", shootTypes: ["Outdoor / On-Location"], sessionTimings: ["Full Session"], preference: "Both", dateCreated: "2026-12-12",
  services: [{ serviceDefinitionId: F.service.id, quantity: 1 }],
  deliverables: [{ deliverableDefinitionId: F.deliverable.id, quantity: 1 }],
  ...extra,
});
let bookings = 0;
const booking = (enquiryId, quotationId, shoots) => ({
  enquiryId, whatsappGroupName: `${tag("group")}-${(bookings += 1)}`, clientMainNumber: "+91 9876543210",
  sourceBranch: F.br.name, groupType: "Dum Dum", initialConvertedValue: 900, quotationId, shoots,
});
const book = (enquiryId, quotationId, shoots) => call(controller.createProject, { body: booking(enquiryId, quotationId, shoots), feature: "Sales Manager" });

async function finalizedQuotation(enquiryId) {
  const quotation = (await call(controller.createQuotation, { body: answers(enquiryId) })).body.data;
  assert.equal((await call(controller.finalizeQuotation, { params: { id: quotation.id } })).status, 200);
  return quotation;
}

const planOf = async (projectId) => prisma.projectShoot.findMany({
  where: { projectId }, orderBy: { createdAt: "asc" },
  select: { shoot: true, saleBaseline: true, deliverables: { select: { saleBaseline: true } }, postProductionAllocations: { select: { saleBaseline: true } } },
});

before(async () => {
  F.br = await prisma.branch.create({ data: { code: tag("BR"), name: `Sale Extras Book ${STAMP}` } });
  F.login = await prisma.user.create({ data: { name: "Sale extras booking tester", email: `${tag("su")}@test.local`.toLowerCase(), username: tag("su").toLowerCase(), password: "x", role: "SUPER_ADMIN", branchId: F.br.id } });
  F.service = await prisma.projectServiceDefinition.findFirst({ where: { isActive: true }, select: { id: true } });
  F.deliverable = await prisma.projectDeliverableDefinition.findFirst({ where: { isActive: true }, select: { id: true } });
  F.enquiries = [tag("E1"), tag("E2"), tag("E3")];
  for (const enquiryId of F.enquiries) await prisma.salesCrmLead.create({ data: { enquiryId, name: enquiryId } });
  invalidate();
});

// Cleanup runs while other test files write the same tables, so InnoDB may pick it as a deadlock
// victim (P2034) - run again, as `reconcile.js` does for the app's own Sale Extras writes.
async function retried(write, attempts = 3) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await write();
    } catch (error) {
      if (error?.code !== "P2034" || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
    }
  }
}

after(async () => {
  await retried(() => prisma.projectSaleExtraRevision.deleteMany({ where: { project: { eventId: { startsWith: `TSK-${STAMP}` } } } }));
  await prisma.salesProject.deleteMany({ where: { eventId: { startsWith: `TSK-${STAMP}` } } });
  await prisma.salesQuotation.deleteMany({ where: { quotationNumber: { startsWith: `TSK-${STAMP}` } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { startsWith: `TSK-${STAMP}` } } });
  await prisma.user.deleteMany({ where: { id: { in: [F.login?.id].filter(Boolean) } } });
  await prisma.branch.deleteMany({ where: { code: { startsWith: `TSK-${STAMP}` } } });
  invalidate();
  await prisma.$disconnect();
});

test("the quoted shoot and its lines are baseline; a shoot added by hand at booking is not", async () => {
  const quotation = await finalizedQuotation(F.enquiries[0]);
  const booked = await book(F.enquiries[0], quotation.quotationId, [shoot("Wedding", { fromQuotation: true }), shoot("Reception")]);
  assert.equal(booked.status, 201, JSON.stringify(booked.body));
  const [quoted, added] = await planOf(booked.body.data.id);
  assert.deepEqual(quoted.saleBaseline, {});
  assert.ok(quoted.postProductionAllocations.every((row) => row.saleBaseline && row.saleBaseline.quantity === 1));
  assert.ok(quoted.deliverables.every((row) => row.saleBaseline && row.saleBaseline.quantity === 1));
  assert.equal(added.saleBaseline, null);
  assert.ok(added.postProductionAllocations.every((row) => row.saleBaseline === null));
  F.project = booked.body.data;
  F.quotation = quotation;
});

test("never more baseline shoots than the quotation holds", async () => {
  const quotation = await finalizedQuotation(F.enquiries[1]);
  const booked = await book(F.enquiries[1], quotation.quotationId, [shoot("Wedding", { fromQuotation: true }), shoot("Haldi", { fromQuotation: true })]);
  assert.equal(booked.status, 201, JSON.stringify(booked.body));
  const plan = await planOf(booked.body.data.id);
  assert.equal(plan.filter((row) => row.saleBaseline).length, 1, "the quotation holds one shoot");
});

test("with no quotation the flag means nothing", async () => {
  const booked = await book(F.enquiries[2], undefined, [shoot("Wedding", { fromQuotation: true })]);
  assert.equal(booked.status, 201, JSON.stringify(booked.body));
  const [only] = await planOf(booked.body.data.id);
  assert.equal(only.saleBaseline, null);
});

test("a project with published sale extras keeps its quotation", async () => {
  await prisma.projectSaleExtraRevision.create({ data: { projectId: F.project.id, salesQuotationId: F.quotation.id, revisionNumber: 1, originalAmount: 900, netAdjustment: 0, updatedTotal: 900, gstPercent: 18, lines: [], publishedByName: tag("pub") } });
  const other = (await call(controller.createQuotationVersion, { params: { id: F.quotation.id }, body: answers(F.enquiries[0]) })).body.data;
  const moved = await call(controller.updateProject, {
    params: { id: F.project.id },
    body: { ...booking(F.enquiries[0], other?.quotationId || "x", undefined), whatsappGroupName: F.project.whatsappGroupName },
    feature: "Sales Manager",
  });
  assert.equal(moved.status, 409, JSON.stringify(moved.body));
  assert.match(moved.body.message, /published/i);
});

test("linking a quotation to a project later makes its plan at that moment the baseline", async () => {
  const project = await prisma.salesProject.findFirst({ where: { enquiryId: F.enquiries[2] }, select: { id: true, whatsappGroupName: true } });
  const quotation = await finalizedQuotation(F.enquiries[2]);
  const linked = await call(controller.updateProject, {
    params: { id: project.id },
    body: { ...booking(F.enquiries[2], quotation.quotationId, undefined), whatsappGroupName: project.whatsappGroupName },
    feature: "Sales Manager",
  });
  assert.equal(linked.status, 200, JSON.stringify(linked.body));
  const [only] = await planOf(project.id);
  assert.deepEqual(only.saleBaseline, {});
  assert.ok(only.postProductionAllocations.every((row) => row.saleBaseline));
  assert.ok(only.deliverables.every((row) => row.saleBaseline));
});

test("only the lines the quotation itself lists under a quoted shoot are baseline", async () => {
  const enquiryId = tag("E4");
  await prisma.salesCrmLead.create({ data: { enquiryId, name: enquiryId } });
  const quotation = (await call(controller.createQuotation, { body: { ...answers(enquiryId), services: [{ shootId: "s1", serviceDefinitionId: F.service.id, quantity: 1 }], deliverables: [] } })).body.data;
  assert.equal((await call(controller.finalizeQuotation, { params: { id: quotation.id } })).status, 200);
  const other = await prisma.projectServiceDefinition.findFirst({ where: { isActive: true, id: { not: F.service.id } }, select: { id: true } });
  const booked = await book(enquiryId, quotation.quotationId, [shoot("Wedding", { fromQuotation: true, services: [{ serviceDefinitionId: F.service.id, quantity: 1 }, { serviceDefinitionId: other.id, quantity: 1 }] })]);
  assert.equal(booked.status, 201, JSON.stringify(booked.body));
  const services = await prisma.projectPostProductionAllocation.findMany({ where: { projectId: booked.body.data.id }, select: { serviceDefinitionId: true, saleBaseline: true } });
  assert.notEqual(services.find((row) => row.serviceDefinitionId === F.service.id).saleBaseline, null, "the quoted service");
  assert.equal(services.find((row) => row.serviceDefinitionId === other.id).saleBaseline, null, "a service the quotation never listed is an extra");
  const [deliverable] = await prisma.projectShootDeliverable.findMany({ where: { projectId: booked.body.data.id }, select: { saleBaseline: true } });
  assert.equal(deliverable.saleBaseline, null, "the quotation listed no deliverables");
});
