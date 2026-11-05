const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");

/*
 * Finalize / Unfinalize on a quotation version, end to end through the handlers and the database.
 *
 * V1 → Save as New Version → V2; Finalize V2 (no V3, its link never expires, the chain is locked);
 * Unfinalize V2 (kept exactly as it was, no version raised); edit → V3; Finalize V3. Plus the edges:
 * a double press, a stale screen, a lapsed link, an old version, a draft, a direct delete.
 */
const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TQF-${STAMP}-${name}`;
let chains = 0;
const identifiers = require("../src/services/identifiers");
identifiers.nextIdentifier = async () => tag(`chain${(chains += 1)}`);
const controller = require("../src/modules/sales/projects/controller");
const { invalidate } = require("../src/services/referenceMatchers");

const F = {};

function call(handler, { body = {}, params = {}, query = {} } = {}) {
  return new Promise((resolve) => {
    const req = { accepts: () => "json", user: { id: F.login.id }, body, params, query, headers: {}, permission: { module: "SALES", feature: "Quotation Management", level: "READ_WRITE" } };
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

const answers = (extra = {}) => ({
  enquiryId: F.enquiryId,
  vertical: "Dum Dum",
  quotationBrand: "DUM_DUM",
  name: "Finalize Client",
  clientName: "Finalize Client",
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
const row = (id) => prisma.salesQuotation.findUnique({ where: { id } });
const chainCount = (quotationNumber) => prisma.salesQuotation.count({ where: { quotationNumber, deletedAt: null } });
const DAY_MS = 24 * 60 * 60 * 1000;

before(async () => {
  F.br = await prisma.branch.create({ data: { code: tag("BR"), name: `Quotation Final ${STAMP}` } });
  F.login = await prisma.user.create({ data: { name: "Quotation finalize tester", email: `${tag("su")}@test.local`.toLowerCase(), username: tag("su").toLowerCase(), password: "x", role: "SUPER_ADMIN", branchId: F.br.id } });
  F.enquiryId = tag("ENQ");
  await prisma.salesCrmLead.create({ data: { enquiryId: F.enquiryId, name: F.enquiryId } });
  invalidate();
});

after(async () => {
  await prisma.salesQuotation.deleteMany({ where: { quotationNumber: { startsWith: `TQF-${STAMP}` } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { startsWith: `TQF-${STAMP}` } } });
  await prisma.user.deleteMany({ where: { id: F.login.id } });
  await prisma.branch.deleteMany({ where: { code: { startsWith: `TQF-${STAMP}` } } });
  invalidate();
  await prisma.$disconnect();
});

test("the whole lifecycle: V1, V2, finalize V2, unfinalize, V3, finalize V3", async () => {
  // V1, then Save as New Version → V2.
  const v1 = (await call(controller.createQuotation, { body: answers() })).body.data;
  assert.equal(v1.version, 1);
  assert.equal(v1.finalization.state, "UNFINALIZED", "a new version is not finalized");
  const raised = await call(controller.createQuotationVersion, { params: { id: v1.id }, body: answers({ discount: 15, amount: 850 }) });
  assert.equal(raised.status, 201);
  const v2 = raised.body.data;
  assert.equal(v2.version, 2);
  const chain = v2.quotationNumber;

  // Finalize V2: no V3, the link holds for good, V2 is read-only.
  const finalized = await call(controller.finalizeQuotation, { params: { id: v2.id }, body: { payload: answers({ discount: 15, amount: 850 }) } });
  assert.equal(finalized.status, 200, finalized.body.message);
  assert.equal(finalized.body.data.finalization.state, "FINALIZED");
  assert.equal(finalized.body.data.finalization.finalizedByUserId, F.login.id);
  assert.equal(finalized.body.data.finalization.finalizedByName, "Quotation finalize tester");
  assert.equal(finalized.body.data.linkActive, true);
  assert.equal(finalized.body.data.linkExpiresAt, null);
  assert.equal(finalized.body.data.linkNeverExpires, true);
  assert.equal(finalized.body.data.version, 2, "finalizing raises no version");
  assert.equal(await chainCount(chain), 2);
  const v2Saved = await row(v2.id);
  assert.equal(v2Saved.publicToken, v2.publicToken, "the link's token is kept");

  // Read-only: no version raised from V2, and V2 and the chain are not deleted. (V1 is unfinalized,
  // so it could still be edited and saved - `sales-quotation-lifecycle.test.js`.)
  const fromV2 = await call(controller.createQuotationVersion, { params: { id: v2.id }, body: answers({ subtotal: 1200, discount: 10, amount: 1080 }) });
  assert.equal(fromV2.status, 409);
  assert.match(fromV2.body.message, /finalized/i);
  assert.equal(await chainCount(chain), 2);
  assert.equal((await call(controller.deleteQuotation, { params: { id: v2.id } })).status, 409);
  await assert.rejects(controller.deleteQuotationChainRecord({ user: { id: F.login.id }, permission: { module: "SALES", feature: "Quotation Management", level: "READ_WRITE" } }, v2.id), /finalized/i);

  // The public link opens even past the date it would have lapsed, and says nothing of who finalized it.
  await prisma.salesQuotation.update({ where: { id: v2.id }, data: { linkExpiresAt: new Date(Date.now() - DAY_MS) } });
  const opened = await call(controller.publicQuotation, { params: { token: v2.publicToken } });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.data.version, 2);
  for (const key of ["finalization", "finalizedByUserId", "unfinalizedByUserId", "unfinalizedAt"]) assert.equal(key in opened.body.data, false, key);

  // Unfinalize V2: kept as it was, no version raised, link back on a five-day clock.
  const before = await row(v2.id);
  const unfinalized = await call(controller.unfinalizeQuotation, { params: { id: v2.id } });
  assert.equal(unfinalized.status, 200);
  assert.equal(unfinalized.body.data.finalization.state, "UNFINALIZED");
  assert.equal(unfinalized.body.data.version, 2);
  assert.equal(await chainCount(chain), 2, "unfinalizing raises no version");
  const after = await row(v2.id);
  assert.equal(JSON.stringify(after.payload), JSON.stringify(before.payload), "the finalized document is untouched");
  assert.equal(String(after.amount), String(before.amount));
  const left = after.linkExpiresAt.getTime() - Date.now();
  assert.ok(left > 4.9 * DAY_MS && left <= 5 * DAY_MS, "five days from now");
  assert.equal((await call(controller.unfinalizeQuotation, { params: { id: v2.id } })).body.unchanged, true, "unfinalizing again changes nothing");

  // A screen with unsaved changes cannot finalize what is saved.
  const stale = await call(controller.finalizeQuotation, { params: { id: v2.id }, body: { payload: answers({ subtotal: 1300, discount: 10, amount: 1170 }) } });
  assert.equal(stale.status, 409);
  assert.match(stale.body.message, /not saved/);

  // Edit → Save as New Version → V3; V2 stays exactly as it was.
  const v3 = (await call(controller.createQuotationVersion, { params: { id: v2.id }, body: answers({ subtotal: 1200, discount: 10, amount: 1080 }) })).body.data;
  assert.equal(v3.version, 3);
  assert.equal(JSON.stringify((await row(v2.id)).payload), JSON.stringify(before.payload));

  // V3 finalizes without raising V4 (any one version may be finalized while no other is).
  const v3Final = await call(controller.finalizeQuotation, { params: { id: v3.id } });
  assert.equal(v3Final.status, 200);
  assert.equal(v3Final.body.data.finalization.state, "FINALIZED");
  assert.equal(await chainCount(chain), 3, "no V4");
  // The versions keep their own states.
  const states = await Promise.all([v1.id, v2.id, v3.id].map(async (id) => controller.quotationFinalization(await row(id)).state));
  assert.deepEqual(states, ["UNFINALIZED", "UNFINALIZED", "FINALIZED"]);
});

test("a double press finalizes once; the second answers unchanged", async () => {
  const v1 = (await call(controller.createQuotation, { body: answers() })).body.data;
  const [a, b] = await Promise.all([
    call(controller.finalizeQuotation, { params: { id: v1.id } }),
    call(controller.finalizeQuotation, { params: { id: v1.id } }),
  ]);
  assert.ok([a.status, b.status].every((status) => status === 200 || status === 409), `${a.status} ${b.status}`);
  assert.equal([a, b].filter((answer) => answer.status === 200 && !answer.body.unchanged).length, 1, "exactly one finalize took effect");
  assert.equal((await call(controller.finalizeQuotation, { params: { id: v1.id } })).body.unchanged, true);
  assert.equal(await chainCount(v1.quotationNumber), 1);
});

test("a lapsed link is re-enabled first - finalizing never reopens it on its own", async () => {
  const v1 = (await call(controller.createQuotation, { body: answers() })).body.data;
  await prisma.salesQuotation.update({ where: { id: v1.id }, data: { linkExpiresAt: new Date(Date.now() - DAY_MS) } });
  const refused = await call(controller.finalizeQuotation, { params: { id: v1.id } });
  assert.equal(refused.status, 409);
  assert.match(refused.body.message, /Re-enable/);
  assert.equal((await row(v1.id)).finalizedAt, null);
  assert.equal((await call(controller.publicQuotation, { params: { token: v1.publicToken } })).status, 410, "still lapsed");
  assert.equal((await call(controller.renewQuotationLink, { params: { id: v1.id } })).status, 200);
  assert.equal((await call(controller.finalizeQuotation, { params: { id: v1.id } })).status, 200);
});

test("a draft cannot be finalized, and a version never finalized keeps its five-day link", async () => {
  const draft = (await call(controller.createQuotationDraft, { body: answers() })).body.data;
  assert.equal((await call(controller.finalizeQuotation, { params: { id: draft.id } })).status, 409);
  const plain = (await call(controller.createQuotation, { body: answers() })).body.data;
  assert.equal(plain.linkNeverExpires, undefined);
  assert.ok(new Date(plain.linkExpiresAt).getTime() > Date.now());
  await prisma.salesQuotation.update({ where: { id: plain.id }, data: { linkExpiresAt: new Date(Date.now() - DAY_MS) } });
  assert.equal((await call(controller.publicQuotation, { params: { token: plain.publicToken } })).status, 410, "an unfinalized lapsed link stays lapsed");
});

test("a link from before links had a clock still reads as expired; only finalizing changes that", () => {
  assert.equal(controller.quotationLinkState({ linkExpiresAt: null }).linkExpired, true);
  assert.equal(controller.quotationLinkState({ linkExpiresAt: null, finalizedAt: new Date() }).linkActive, true);
  assert.equal(controller.quotationLinkState({ linkExpiresAt: null, finalizedAt: new Date(), unfinalizedAt: new Date() }).linkExpired, true, "unfinalized: its own clock again");
});
