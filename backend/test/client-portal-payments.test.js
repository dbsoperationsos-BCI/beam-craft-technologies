const { test, before, after } = require("node:test");
// CI has no .env: the token this suite signs and checks needs a key of its own, as every other suite sets.
process.env.JWT_SECRET = process.env.JWT_SECRET || "client-portal-payments-test-secret";
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { CLIENT_ROUTES } = require("../src/middleware/authMiddleware");
const { getClientPayments, getClientQuotationPdf, getClientReceipt } = require("../src/modules/client/portal/controller");

/*
 * The client portal's money: a client reads what its own project is signed for and what it has
 * paid - added up as Edit Project → Payments adds them - and downloads only its own receipts. Never
 * the studio's spending, entry descriptions, remarks or extras still waiting. Real rows, removed at
 * the end. The PDFs themselves are not rendered here (that needs the headless browser); every
 * refusal in front of them is.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TCPP-${STAMP}-${name}`;
const F = {};

const leadFor = (enquiryId) => prisma.salesCrmLead.upsert({ where: { enquiryId }, create: { enquiryId, name: enquiryId }, update: {} });
const projectData = (name, value) => ({
  enquiryId: tag(`enq-${name}`), eventId: tag(`ev-${name}`), whatsappGroupName: `WED ${name} ${STAMP}`, clientMainNumber: "+919876543210",
  sourceBranch: "Erode TN", vertical: "WED", deliverables: "[]", initialConvertedValue: value, crmName: "Test",
  projectStatus: "Work in Progress - Post Production",
});
const cash = (project, name, entryType, amount, entryDate) => prisma.cashEntry.create({ data: {
  entryId: tag(name), entryType, clientName: "Client", category: entryType === "Received" ? "Advance" : "Other",
  amount, entryDate: new Date(entryDate), branch: "Erode TN", paymentMode: "UPI", projectId: project.id,
  description: "internal: received at the Erode desk", handlerName: "Desk",
} });
const extra = (project, name, status, amount) => prisma.projectExtraQuotation.create({ data: {
  requestCode: tag(name), projectId: project.id, service: `Extra ${name}`, amount, status,
  requestedByName: "Manager", remarks: "internal remark", decidedAt: status === "APPROVED" ? new Date("2026-09-01T06:30:00.000Z") : null,
} });

before(async () => {
  await leadFor(tag("enq-mine"));
  await leadFor(tag("enq-theirs"));
  F.mine = await prisma.salesProject.create({ data: projectData("mine", 125000) });
  F.theirs = await prisma.salesProject.create({ data: projectData("theirs", 90000) });
  await cash(F.mine, "rec-1", "Received", "25000.00", "2026-08-01T06:30:00.000Z");
  await cash(F.mine, "rec-2", "Received", "50000.00", "2026-09-10T06:30:00.000Z");
  F.spent = await cash(F.mine, "spent-1", "Spent", "8000.00", "2026-09-12T06:30:00.000Z");
  F.deleted = await cash(F.mine, "rec-deleted", "Received", "999.00", "2026-09-13T06:30:00.000Z");
  await prisma.cashEntry.update({ where: { id: F.deleted.id }, data: { deletedAt: new Date() } });
  F.theirReceipt = await cash(F.theirs, "rec-theirs", "Received", "40000.00", "2026-08-05T06:30:00.000Z");
  await extra(F.mine, "ex-approved", "APPROVED", "10000.00");
  await extra(F.mine, "ex-pending", "PENDING", "7000.00");
  // Neither counts on Edit Project → Payments, so neither counts here.
  await extra(F.mine, "ex-rejected", "REJECTED", "3000.00");
  F.deletedExtra = await extra(F.mine, "ex-deleted", "APPROVED", "4000.00");
  await prisma.projectExtraQuotation.update({ where: { id: F.deletedExtra.id }, data: { deletedAt: new Date() } });
  // The signed quotations the project may point at: a draft, a deleted one, one whose link has lapsed.
  const quotation = (name, data) => prisma.salesQuotation.create({ data: {
    quotationNumber: tag(`q-${name}`), quotationId: tag(`q-${name}-01`), publicToken: `${name}${STAMP}`.slice(0, 8),
    payload: {}, sourceBranch: "Erode TN", followedBy: "Test", status: "Generated", ...data,
  } });
  F.qDraft = await quotation("dr", { status: "Draft", linkExpiresAt: new Date(Date.now() + 86400000) });
  F.qDeleted = await quotation("dl", { deletedAt: new Date(), linkExpiresAt: new Date(Date.now() + 86400000) });
  F.qLapsed = await quotation("lp", { linkExpiresAt: new Date(Date.now() - 86400000), quotationDate: new Date("2026-06-16T06:30:00.000Z") });
  F.client = await prisma.user.create({ data: { name: "Client", email: null, username: tag("client").toLowerCase(), password: "x", role: "CLIENT", status: "ACTIVE", clientProjectId: F.mine.id } });
});

after(async () => {
  await prisma.salesQuotation.deleteMany({ where: { quotationNumber: { startsWith: `TCPP-${STAMP}` } } });
  await prisma.cashEntry.deleteMany({ where: { entryId: { startsWith: `TCPP-${STAMP}` } } });
  await prisma.projectExtraQuotation.deleteMany({ where: { requestCode: { startsWith: `TCPP-${STAMP}` } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: `tcpp-${STAMP}` } } });
  await prisma.salesProject.deleteMany({ where: { eventId: { startsWith: `TCPP-${STAMP}` } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { startsWith: `TCPP-${STAMP}` } } });
  await prisma.$disconnect();
});

/** Calls a handler and says what it answered: `{ code, body, headers }`. */
async function answer(handler, req) {
  const out = { code: 200, body: null, headers: {} };
  const res = {
    headersSent: false,
    set: (name, value) => { out.headers[name] = value; return res; },
    setHeader: (name, value) => { out.headers[name] = value; return res; },
    status: (code) => { out.code = code; return res; },
    json: (body) => { out.body = body; return res; },
    end: (body) => { out.body = body; return res; },
  };
  await handler(req, res);
  return out;
}
const asClient = (extraReq = {}) => ({ user: { id: F.client.id, role: "CLIENT" }, params: {}, query: {}, ...extraReq });

test("the portal's money routes are reachable by a client token", () => {
  for (const route of ["GET /api/client/payments", "GET /api/client/quotation/pdf", "GET /api/client/receipt"]) {
    assert.ok(CLIENT_ROUTES.has(route), `${route} must be on the client's list or protect refuses it`);
  }
});

test("a client reads its own money, added up as Edit Project → Payments adds it", async () => {
  // An id in the request is never what is read: the account decides.
  const { code, body, headers } = await answer(getClientPayments, asClient({ params: { id: F.theirs.id }, query: { id: F.theirs.id } }));
  assert.equal(code, 200);
  assert.equal(headers["Cache-Control"], "no-store");
  assert.deepEqual(body.data.summary, { totalQuotation: 125000, totalExtra: 10000, totalSigned: 135000, totalReceived: 75000 });
  // Received only, newest first; no Spent entry, no deleted one, nobody else's.
  assert.deepEqual(body.data.received.map((row) => row.id), [tag("rec-2"), tag("rec-1")]);
  assert.deepEqual(body.data.received[0], { id: tag("rec-2"), category: "Advance", date: "2026-09-10", amount: 50000, mode: "UPI" });
  // Approved extras only - one still waiting is a proposal, not something the client owes.
  assert.deepEqual(body.data.extras, [{ id: tag("ex-approved"), service: "Extra ex-approved", amount: 10000, approvedOn: "2026-09-01" }]);
  // A project signed on no quotation says so rather than inventing one.
  assert.equal(body.data.quotation, null);
  // Nothing internal travels: descriptions, remarks, who took the money, what was spent.
  const text = JSON.stringify(body);
  for (const leak of ["internal", "Desk", "spent", "Spent", "remark", "8000"]) assert.ok(!text.includes(leak), `"${leak}" must not reach the client`);
});

test("a client with no project of its own is told so", async () => {
  const orphan = await prisma.user.create({ data: { name: "Orphan", email: null, username: tag("orphan").toLowerCase(), password: "x", role: "CLIENT", status: "ACTIVE" } });
  const { code } = await answer(getClientPayments, { user: { id: orphan.id, role: "CLIENT" }, params: {}, query: {} });
  assert.equal(code, 404);
});

test("no quotation to download answers 404, not a file", async () => {
  const { code, body } = await answer(getClientQuotationPdf, asClient());
  assert.equal(code, 404);
  assert.match(body.message, /No quotation/);
});

test("a receipt is only ever the client's own money received", async () => {
  // Somebody else's receipt, money spent, a deleted entry, a made-up number, a malformed one: all 404.
  for (const entry of [F.theirReceipt.entryId, F.spent.entryId, F.deleted.entryId, tag("nope"), "../../etc", ""]) {
    const { code, body } = await answer(getClientReceipt, asClient({ query: { entry } }));
    assert.equal(code, 404, `receipt ${entry} must not be served`);
    assert.equal(body.message, "Receipt not found.");
  }
});

test("a client whose project was deleted reads no money", async () => {
  await leadFor(tag("enq-gone"));
  const gone = await prisma.salesProject.create({ data: { ...projectData("gone", 50000), deletedAt: new Date() } });
  const client = await prisma.user.create({ data: { name: "Gone", email: null, username: tag("gone").toLowerCase(), password: "x", role: "CLIENT", status: "ACTIVE", clientProjectId: gone.id } });
  const req = { user: { id: client.id, role: "CLIENT" }, params: {}, query: {} };
  assert.equal((await answer(getClientPayments, req)).code, 404);
  assert.equal((await answer(getClientQuotationPdf, req)).code, 404);
});

test("a signed-in client may always download their own signed quotation", async () => {
  const pointAt = (quotation) => prisma.salesProject.update({ where: { id: F.mine.id }, data: { quotationId: quotation?.quotationId ?? null } });
  try {
    // A draft or a deleted quotation is no quotation: nothing to show, nothing to download.
    for (const quotation of [F.qDraft, F.qDeleted]) {
      await pointAt(quotation);
      assert.equal((await answer(getClientPayments, asClient())).body.data.quotation, null);
      assert.equal((await answer(getClientQuotationPdf, asClient())).code, 404);
    }
    // A lapsed link no longer stops the client's own copy: it is printed with a one-time pass.
    await pointAt(F.qLapsed);
    const { body } = await answer(getClientPayments, asClient());
    assert.deepEqual(body.data.quotation, { id: F.qLapsed.quotationId, date: "2026-06-16", downloadable: true });
  } finally {
    await pointAt(null);
  }
});

test("the print pass opens one lapsed quotation, for two minutes, and nothing else", async () => {
  const { signPrintPass, hasPrintPass, PRINT_PASS_HEADER } = require("../src/services/quotationPrintPass");
  const jwt = require("jsonwebtoken");
  const pass = signPrintPass(F.qLapsed.publicToken);
  const withPass = (value) => ({ headers: { [PRINT_PASS_HEADER]: value } });
  assert.equal(hasPrintPass(withPass(pass), F.qLapsed.publicToken), true);
  assert.equal(hasPrintPass(withPass(pass), F.qDraft.publicToken), false, "scoped to its own quotation");
  assert.equal(hasPrintPass({ headers: {} }, F.qLapsed.publicToken), false);
  assert.equal(hasPrintPass(withPass("nonsense"), F.qLapsed.publicToken), false);
  const stale = jwt.sign({ scope: "quotation-print", token: F.qLapsed.publicToken, exp: Math.floor(Date.now() / 1000) - 1 }, process.env.JWT_SECRET);
  assert.equal(hasPrintPass(withPass(stale), F.qLapsed.publicToken), false, "expired");
  const client = jwt.sign({ id: 1, role: "CLIENT", token: F.qLapsed.publicToken }, process.env.JWT_SECRET);
  assert.equal(hasPrintPass(withPass(client), F.qLapsed.publicToken), false, "a login token is not a print pass");

  // The public quotation answers the lapsed link only with the pass.
  const { publicQuotation } = require("../src/modules/sales/projects/controller");
  const run = async (headers) => {
    const out = { code: 200 };
    const res = { status: (c) => { out.code = c; return res; }, json: () => res, set: () => res, setHeader: () => res, send: () => res, end: () => res };
    await publicQuotation({ params: { token: F.qLapsed.publicToken }, headers }, res);
    return out.code;
  };
  assert.equal(await run({}), 410);
  assert.equal(await run({ [PRINT_PASS_HEADER]: pass }), 200);
});
