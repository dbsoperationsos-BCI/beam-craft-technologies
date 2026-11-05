const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");

/*
 * A project is booked only at a finalized quotation version of its own enquiry, end to end through
 * the handlers and the database - the check the server makes whatever the picker offered, so each
 * refusal here is a request sent by hand.
 *
 * Draft refused; a version never finalized refused; finalize it and it books, holding that exact
 * version; unfinalize it and a new booking is refused while the project already booked keeps it and
 * still saves; another enquiry's finalized version refused; a version that does not exist refused.
 */
const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TQP-${STAMP}-${name}`;
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

const answers = (enquiryId, extra = {}) => ({
  enquiryId,
  vertical: "Dum Dum",
  quotationBrand: "DUM_DUM",
  name: "Booking Client",
  clientName: "Booking Client",
  clientMainNumber: "+919876543210",
  assignedBranch: F.br.name,
  sourceBranch: F.br.name,
  subtotal: 1000,
  discount: 10,
  amount: 900,
  shoots: [{ id: "s1", shoot: "Wedding" }],
  services: [],
  deliverables: [],
  ...extra,
});
let bookings = 0;
const booking = (enquiryId, quotationId, extra = {}) => ({
  enquiryId,
  whatsappGroupName: `${tag("group")}-${(bookings += 1)}`,
  clientMainNumber: "+91 9876543210",
  sourceBranch: F.br.name,
  groupType: "Dum Dum",
  initialConvertedValue: 900,
  quotationId,
  ...extra,
});
const book = (enquiryId, quotationId) => call(controller.createProject, { body: booking(enquiryId, quotationId), feature: "Sales Manager" });
const projectCount = () => prisma.salesProject.count({ where: { eventId: { startsWith: `TQP-${STAMP}` } } });

before(async () => {
  F.br = await prisma.branch.create({ data: { code: tag("BR"), name: `Quotation Book ${STAMP}` } });
  F.login = await prisma.user.create({ data: { name: "Quotation booking tester", email: `${tag("su")}@test.local`.toLowerCase(), username: tag("su").toLowerCase(), password: "x", role: "SUPER_ADMIN", branchId: F.br.id } });
  F.enquiry = tag("ENQ");
  F.otherEnquiry = tag("ENQ2");
  for (const enquiryId of [F.enquiry, F.otherEnquiry]) await prisma.salesCrmLead.create({ data: { enquiryId, name: enquiryId } });
  invalidate();
});

after(async () => {
  await prisma.salesProject.deleteMany({ where: { eventId: { startsWith: `TQP-${STAMP}` } } });
  await prisma.salesQuotation.deleteMany({ where: { quotationNumber: { startsWith: `TQP-${STAMP}` } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { startsWith: `TQP-${STAMP}` } } });
  await prisma.user.deleteMany({ where: { id: F.login.id } });
  await prisma.branch.deleteMany({ where: { code: { startsWith: `TQP-${STAMP}` } } });
  invalidate();
  await prisma.$disconnect();
});

test("only a finalized version of the project's own enquiry can be booked, and the project keeps that exact version", async () => {
  // A draft: refused, and nothing is written.
  const draft = (await call(controller.createQuotationDraft, { body: answers(F.enquiry) })).body.data;
  const fromDraft = await book(F.enquiry, draft.quotationId);
  assert.equal(fromDraft.status, 409);
  assert.match(fromDraft.body.message, /is a draft/);

  // A generated version never finalized: refused.
  const v1 = (await call(controller.createQuotation, { body: answers(F.enquiry) })).body.data;
  const notFinalized = await book(F.enquiry, v1.quotationId);
  assert.equal(notFinalized.status, 409);
  assert.match(notFinalized.body.message, /is not finalized/);

  // Another enquiry's version, finalized: refused - a project books its own enquiry's quotation.
  const elsewhere = (await call(controller.createQuotation, { body: answers(F.otherEnquiry) })).body.data;
  assert.equal((await call(controller.finalizeQuotation, { params: { id: elsewhere.id } })).status, 200);
  const crossed = await book(F.enquiry, elsewhere.quotationId);
  assert.equal(crossed.status, 400);
  assert.match(crossed.body.message, /different enquiry/);

  // A version that does not exist: refused.
  const missing = await book(F.enquiry, `${v1.quotationNumber}-99`);
  assert.equal(missing.status, 400);
  assert.match(missing.body.message, /could not be found/);
  assert.equal(await projectCount(), 0, "no refused booking left a project behind");

  // Finalized: it books, at exactly that version.
  assert.equal((await call(controller.finalizeQuotation, { params: { id: v1.id } })).status, 200);
  const booked = await book(F.enquiry, v1.quotationId);
  assert.equal(booked.status, 201, JSON.stringify(booked.body));
  assert.equal(booked.body.data.quotationId, v1.quotationId);
  F.project = booked.body.data;

  // Unfinalized: no new booking, and the project already booked keeps its version and still saves.
  assert.equal((await call(controller.unfinalizeQuotation, { params: { id: v1.id } })).status, 200);
  const afterUnfinalize = await book(F.enquiry, v1.quotationId);
  assert.equal(afterUnfinalize.status, 409);
  assert.match(afterUnfinalize.body.message, /has been unfinalized/);
  assert.equal(await projectCount(), 1);

  const saved = await call(controller.updateProject, {
    params: { id: F.project.id },
    body: booking(F.enquiry, v1.quotationId, { whatsappGroupName: F.project.whatsappGroupName, salesProductionRemarks: "Edited after unfinalize" }),
    feature: "Sales Manager",
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const stored = await prisma.salesProject.findUnique({ where: { id: F.project.id }, select: { quotationId: true, salesProductionRemarks: true } });
  assert.deepEqual(stored, { quotationId: v1.quotationId, salesProductionRemarks: "Edited after unfinalize" }, "the version it was booked at stays");

  // V2 is raised over the unfinalized V1: until it is finalized, moving the project onto it is refused.
  const v2 = (await call(controller.createQuotationVersion, { params: { id: v1.id }, body: answers(F.enquiry, { subtotal: 1200, amount: 1080 }) })).body.data;
  assert.equal(v2.version, 2);
  const moved = await call(controller.updateProject, {
    params: { id: F.project.id },
    body: booking(F.enquiry, v2.quotationId, { whatsappGroupName: F.project.whatsappGroupName }),
    feature: "Sales Manager",
  });
  assert.equal(moved.status, 409);
  assert.equal((await prisma.salesProject.findUnique({ where: { id: F.project.id } })).quotationId, v1.quotationId);

  // Finalize V2 and it is a version the project may move to - the exact one sent, not the newest.
  assert.equal((await call(controller.finalizeQuotation, { params: { id: v2.id } })).status, 200);
  const movedNow = await call(controller.updateProject, {
    params: { id: F.project.id },
    body: booking(F.enquiry, v2.quotationId, { whatsappGroupName: F.project.whatsappGroupName }),
    feature: "Sales Manager",
  });
  assert.equal(movedNow.status, 200, JSON.stringify(movedNow.body));
  assert.equal((await prisma.salesProject.findUnique({ where: { id: F.project.id } })).quotationId, v2.quotationId);

  // The quotations themselves were never touched by any of it.
  const v1Row = await prisma.salesQuotation.findUnique({ where: { id: v1.id } });
  assert.equal(v1Row.version, 1);
  assert.equal(Number(v1Row.amount), 900);
});

test("the picker's list carries each version's finalization, which is what it offers by", async () => {
  const listed = await call(controller.listQuotations, { query: { enquiryId: F.enquiry } });
  assert.equal(listed.status, 200);
  const versions = listed.body.data.flatMap((chain) => chain.versions || [chain]);
  assert.ok(versions.every((version) => version.enquiryId === undefined || version.enquiryId === F.enquiry), "only this enquiry's quotations");
  const states = Object.fromEntries(versions.map((version) => [version.version, version.finalization?.state || null]));
  assert.deepEqual(states, { 1: "UNFINALIZED", 2: "FINALIZED" });
  assert.ok(!listed.body.data.some((chain) => chain.status === "Draft"), "a draft is not listed unless asked for");

  // Create Project asks for drafts too, to show them disabled beside the rest - this enquiry's only.
  const withDrafts = await call(controller.listQuotations, { query: { enquiryId: F.enquiry, withDrafts: "1" } });
  assert.equal(withDrafts.status, 200);
  const drafts = withDrafts.body.data.filter((chain) => chain.status === "Draft");
  assert.equal(drafts.length, 1, "the enquiry's draft is listed");
  assert.ok(withDrafts.body.data.every((chain) => chain.enquiryId === F.enquiry), "never another enquiry's");
  // Without an enquiry it is the register, and the flag changes nothing.
  assert.equal((await call(controller.listQuotations, { query: { withDrafts: "1" } })).status, 200);
});

test("a blank quotation still books - a project may be booked at no quotation", async () => {
  const resolved = await prisma.$transaction((transaction) => controller.resolveFinalizedQuotation(transaction, "  ", F.enquiry));
  assert.equal(resolved, null);
});
