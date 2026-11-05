const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");

/*
 * Save Draft on the Quotation Generator, end to end through the handlers.
 *
 * A draft is a quotation saved before it was generated: numbered on its first save, rewritten in
 * place on every later one, and turned into a generated version - same row, same number - by
 * Generate Quotation. Until then nobody outside the studio can reach it: no public page, no PDF, no
 * link to renew, no project booked against it, and no second version raised over it.
 *
 * The counter is replaced before the controller is loaded, so the suite numbers its own chains with
 * its own prefix rather than taking real quotation numbers from the local counter.
 */
const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TQD-${STAMP}-${name}`;
let chains = 0;
const identifiers = require("../src/services/identifiers");
identifiers.nextIdentifier = async () => tag(`chain${(chains += 1)}`);
const controller = require("../src/modules/sales/projects/controller");
const { invalidate } = require("../src/services/referenceMatchers");

const F = {};

/** A request and a response thin enough to call a handler with, and read what it answered. */
function call(handler, { body = {}, params = {}, query = {} } = {}) {
  return new Promise((resolve) => {
    const req = { accepts: () => "json", user: { id: F.login.id }, body, params, query, permission: { module: "SALES", feature: "Quotation Management", level: "READ_WRITE" } };
    const res = {
      statusCode: 200,
      locals: {},
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); return this; },
      send(body) { resolve({ status: this.statusCode, body }); return this; },
      set() { return this; },
    };
    handler(req, res);
  });
}

/** What the generator sends, cut down to the answers a draft is about. */
const answers = (extra = {}) => ({
  enquiryId: F.enquiryId,
  vertical: "Dum Dum",
  quotationBrand: "DUM_DUM",
  name: "Draft Client",
  clientName: "Draft Client",
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

before(async () => {
  F.br = await prisma.branch.create({ data: { code: tag("BR"), name: `Quotation Draft Branch ${STAMP}` } });
  F.login = await prisma.user.create({ data: { name: "Quotation draft tester", email: `${tag("su")}@test.local`.toLowerCase(), username: tag("su").toLowerCase(), password: "x", role: "SUPER_ADMIN", branchId: F.br.id } });
  F.enquiryId = tag("ENQ");
  await prisma.salesCrmLead.create({ data: { enquiryId: F.enquiryId, name: F.enquiryId } });
  invalidate();
});

after(async () => {
  await prisma.salesQuotation.deleteMany({ where: { quotationNumber: { startsWith: `TQD-${STAMP}` } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { startsWith: `TQD-${STAMP}` } } });
  await prisma.user.deleteMany({ where: { id: F.login.id } });
  await prisma.branch.deleteMany({ where: { code: { startsWith: `TQD-${STAMP}` } } });
  invalidate();
  await prisma.$disconnect();
});

test("a draft is refused without the Assigned Branch its number is drawn from, and nothing is written", async () => {
  const before = chains;
  const { status, body } = await call(controller.createQuotationDraft, { body: answers({ assignedBranch: "", sourceBranch: "" }) });
  assert.equal(status, 400);
  assert.match(body.message, /Assigned Branch/);
  assert.equal(chains, before, "no number was taken");
});

test("the whole draft lifecycle: save, reopen, save again, generate", async () => {
  // 1. Save Draft on a new quotation: version 01 of a new chain, with no live link.
  const created = await call(controller.createQuotationDraft, { body: answers() });
  assert.equal(created.status, 201);
  const draft = created.body.data;
  assert.equal(draft.status, "Draft");
  assert.equal(draft.version, 1);
  assert.equal(draft.quotationId, `${draft.quotationNumber}-01`);
  assert.equal(draft.linkExpiresAt, null);
  assert.equal(draft.linkActive, false);
  assert.equal(draft.quotationBrand, "DUM_DUM");
  assert.equal(draft.enquiryId, F.enquiryId);

  // 2. The register lists it as a draft; the project's version picker never offers it.
  const register = await call(controller.listQuotations);
  const row = register.body.data.find((entry) => entry.id === draft.id);
  assert.equal(row?.status, "Draft");
  const picker = await call(controller.listQuotations, { query: { enquiryId: F.enquiryId } });
  assert.ok(!picker.body.data.some((entry) => entry.id === draft.id), "a draft cannot be booked");

  // 3. Saving over somebody else's newer save is refused, not silently undone.
  const stale = await call(controller.updateQuotationDraft, { params: { id: draft.id }, body: answers({ clientName: "Stale", draftUpdatedAt: "2000-01-01T00:00:00.000Z" }) });
  assert.equal(stale.status, 409);

  // 4. Save Draft again: the same row and number, the new answers, and the brand it was numbered under.
  const saved = await call(controller.updateQuotationDraft, {
    params: { id: draft.id },
    body: answers({ clientName: "Edited Client", name: "Edited Client", discount: 15, vertical: "Qua Qua", quotationBrand: "QUA_QUA", draftUpdatedAt: draft.updatedAt }),
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.data.id, draft.id);
  assert.equal(saved.body.data.quotationId, draft.quotationId);
  assert.equal(saved.body.data.clientName, "Edited Client");
  assert.equal(saved.body.data.discount, 15);
  assert.equal(saved.body.data.quotationBrand, "DUM_DUM", "the brand stays the one the number was drawn under");
  assert.equal(saved.body.data.payload.vertical, "Dum Dum");
  assert.equal(saved.body.data.payload.draftUpdatedAt, undefined, "the save's own token is not kept as an answer");
  assert.equal(saved.body.data.status, "Draft");
  assert.equal(await prisma.salesQuotation.count({ where: { quotationNumber: draft.quotationNumber } }), 1, "no duplicate row");

  // 5. Generate Quotation: the draft becomes a generated version in place, with a live link.
  const generated = await call(controller.generateQuotationDraft, { params: { id: draft.id }, body: answers({ clientName: "Edited Client", draftUpdatedAt: saved.body.data.updatedAt }) });
  assert.equal(generated.status, 200);
  assert.equal(generated.body.data.id, draft.id);
  assert.equal(generated.body.data.quotationId, draft.quotationId);
  assert.equal(generated.body.data.status, "Generated");
  assert.equal(generated.body.data.linkActive, true);
  assert.equal(await prisma.salesQuotation.count({ where: { quotationNumber: draft.quotationNumber } }), 1);

  // 6. Once generated it is no longer a draft: saving or generating it again is refused...
  const late = await call(controller.updateQuotationDraft, { params: { id: draft.id }, body: answers({ draftUpdatedAt: generated.body.data.updatedAt }) });
  assert.equal(late.status, 409);
  const again = await call(controller.generateQuotationDraft, { params: { id: draft.id }, body: answers({ draftUpdatedAt: generated.body.data.updatedAt }) });
  assert.equal(again.status, 409);
  // ...and the project's version picker now offers it.
  const pickerAfter = await call(controller.listQuotations, { query: { enquiryId: F.enquiryId } });
  assert.ok(pickerAfter.body.data.some((entry) => entry.id === draft.id));
});

test("nothing outside the studio can reach a draft, and no version is raised over one", async () => {
  const { body } = await call(controller.createQuotationDraft, { body: answers() });
  const draft = body.data;

  const page = await call(controller.publicQuotation, { params: { token: draft.publicToken } });
  assert.equal(page.status, 404, "the client's page answers as if there were nothing there");
  const publicPdf = await call(controller.publicQuotationPdf, { params: { token: draft.publicToken } });
  assert.equal(publicPdf.status, 404);
  const payment = await call(require("../src/modules/sales/quotations-public/controller").publicQuotationPayment, { params: { token: draft.publicToken } });
  assert.equal(payment.status, 404);
  const pdf = await call(controller.quotationPdf, { params: { id: draft.id } });
  assert.equal(pdf.status, 409);
  const renew = await call(controller.renewQuotationLink, { params: { id: draft.id } });
  assert.equal(renew.status, 409);
  const version = await call(controller.createQuotationVersion, { params: { id: draft.id }, body: answers() });
  assert.equal(version.status, 409);
  const duplicate = await call(controller.duplicateQuotation, { params: { id: draft.id }, body: { enquiryId: F.enquiryId } });
  assert.equal(duplicate.status, 409);

  const row = await prisma.salesQuotation.findUnique({ where: { id: draft.id } });
  assert.equal(row.status, "Draft");
  assert.equal(row.linkExpiresAt, null, "renewing did not start a clock");
});

test("a save or generate without the version it was opened at is refused, so nothing is overwritten blind", async () => {
  const { body } = await call(controller.createQuotationDraft, { body: answers() });
  for (const handler of [controller.updateQuotationDraft, controller.generateQuotationDraft]) {
    const { status } = await call(handler, { params: { id: body.data.id }, body: answers() });
    assert.equal(status, 400);
  }
  const blank = await call(controller.generateQuotationDraft, { params: { id: body.data.id }, body: answers({ assignedBranch: "", sourceBranch: "", draftUpdatedAt: body.data.updatedAt }) });
  assert.equal(blank.status, 400, "the branch the number came from cannot be emptied on generate");
  assert.equal((await prisma.salesQuotation.findUnique({ where: { id: body.data.id } })).status, "Draft");
});

test("Generate Quotation on a new quotation is unchanged: generated at once, link live", async () => {
  const { status, body } = await call(controller.createQuotation, { body: answers() });
  assert.equal(status, 201);
  assert.equal(body.data.status, "Generated");
  assert.equal(body.data.linkActive, true);
});
