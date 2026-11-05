const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const prisma = require("../src/config/db");

/*
 * Two statuses, each version on its own: FINALIZED or UNFINALIZED. At most one version of a
 * quotation is finalized at a time; finalizing another is refused until that one is unfinalized by
 * hand, and nothing ever unfinalizes a version by itself. A finalized version is read-only; any
 * unfinalized version can be edited and saved as the next version, which starts unfinalized.
 * End to end through the handlers and the database, in the order of the QA list.
 */
const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TQL-${STAMP}-${name}`;
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

const answers = (subtotal) => ({
  enquiryId: F.enquiryId,
  vertical: "Dum Dum",
  quotationBrand: "DUM_DUM",
  name: "Lifecycle Client",
  clientName: "Lifecycle Client",
  clientMainNumber: "+919876543210",
  assignedBranch: F.br.name,
  sourceBranch: F.br.name,
  subtotal,
  discount: 10,
  amount: subtotal * 0.9,
  shoots: [{ id: "s1", shoot: "Wedding" }],
  services: [],
  deliverables: [],
});
const DAY_MS = 24 * 60 * 60 * 1000;
const raise = (id, subtotal) => call(controller.createQuotationVersion, { params: { id }, body: answers(subtotal) });
const finalize = (id) => call(controller.finalizeQuotation, { params: { id } });
const unfinalize = (id) => call(controller.unfinalizeQuotation, { params: { id } });
const chainCount = () => prisma.salesQuotation.count({ where: { quotationNumber: F.number, deletedAt: null } });
// Each version's status, read the way the register, the history and Create Project read it.
async function statuses() {
  const listed = await call(controller.listQuotations, { query: { enquiryId: F.enquiryId } });
  const chain = listed.body.data.find((row) => row.quotationNumber === F.number);
  return Object.fromEntries([...chain.versions].reverse().map((version) => [`V${version.version}`, version.finalization.state]));
}
// The document as it was saved - what no status change may touch.
const snapshot = async (id) => {
  const row = await prisma.salesQuotation.findUnique({ where: { id } });
  return JSON.stringify({ quotationId: row.quotationId, version: row.version, amount: Number(row.amount), subtotal: Number(row.subtotal), discount: Number(row.discount), payload: row.payload, additionalNotes: row.additionalNotes, publicToken: row.publicToken, createdAt: row.createdAt });
};

before(async () => {
  F.br = await prisma.branch.create({ data: { code: tag("BR"), name: `Quotation Life ${STAMP}` } });
  F.login = await prisma.user.create({ data: { name: "Quotation lifecycle tester", email: `${tag("su")}@test.local`.toLowerCase(), username: tag("su").toLowerCase(), password: "x", role: "SUPER_ADMIN", branchId: F.br.id } });
  F.enquiryId = tag("ENQ");
  await prisma.salesCrmLead.create({ data: { enquiryId: F.enquiryId, name: F.enquiryId } });
  invalidate();
});

after(async () => {
  await prisma.salesProject.deleteMany({ where: { eventId: { startsWith: `TQL-${STAMP}` } } });
  await prisma.salesQuotation.deleteMany({ where: { quotationNumber: { startsWith: `TQL-${STAMP}` } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { startsWith: `TQL-${STAMP}` } } });
  await prisma.user.deleteMany({ where: { id: F.login.id } });
  await prisma.branch.deleteMany({ where: { code: { startsWith: `TQL-${STAMP}` } } });
  invalidate();
  await prisma.$disconnect();
});

test("one finalized version at a time, each version's status changed only by hand (QA 1-18)", async () => {
  // 1-2. V1 and V2, both unfinalized.
  const v1 = (await call(controller.createQuotation, { body: answers(1000) })).body.data;
  F.number = v1.quotationNumber;
  assert.equal(v1.finalization.state, "UNFINALIZED");
  const v2 = (await raise(v1.id, 1100)).body.data;
  assert.equal(v2.version, 2);
  assert.deepEqual(await statuses(), { V1: "UNFINALIZED", V2: "UNFINALIZED" });

  // 3. Finalize V1 - an older version may be finalized; no version is raised.
  assert.equal((await finalize(v1.id)).body.data.finalization.state, "FINALIZED");
  assert.equal(await chainCount(), 2);

  // 4-6. Finalizing V2 is refused, and V1 stays finalized: nothing is unfinalized by itself.
  const second = await finalize(v2.id);
  assert.equal(second.status, 409);
  assert.equal(second.body.message, "Another quotation version is already finalized. Please unfinalize that version before finalizing this one.");
  assert.deepEqual(await statuses(), { V1: "FINALIZED", V2: "UNFINALIZED" });

  // 7-9. Unfinalize V1 by hand; then V2 finalizes, and V1 stays unfinalized.
  assert.equal((await unfinalize(v1.id)).body.data.finalization.state, "UNFINALIZED");
  assert.deepEqual(await statuses(), { V1: "UNFINALIZED", V2: "UNFINALIZED" }, "unfinalizing V1 changed nothing else");
  assert.equal((await finalize(v2.id)).status, 200);
  assert.deepEqual(await statuses(), { V1: "UNFINALIZED", V2: "FINALIZED" });

  // 10-12. V3 from V1 (unfinalized) while V2 is finalized: next number, unfinalized, nothing else moved.
  const v2Before = await snapshot(v2.id);
  const v3Raised = await raise(v1.id, 1200);
  assert.equal(v3Raised.status, 201);
  const v3 = v3Raised.body.data;
  assert.equal(v3.version, 3);
  assert.equal(v3.finalization.state, "UNFINALIZED");
  assert.deepEqual(await statuses(), { V1: "UNFINALIZED", V2: "FINALIZED", V3: "UNFINALIZED" });

  // 13-14. Finalizing V3 while V2 is finalized is refused.
  assert.equal((await finalize(v3.id)).status, 409);
  assert.deepEqual(await statuses(), { V1: "UNFINALIZED", V2: "FINALIZED", V3: "UNFINALIZED" });

  // 15-17. Unfinalize V2 by hand, then V3 finalizes: only V3 is finalized.
  assert.equal((await unfinalize(v2.id)).status, 200);
  assert.equal((await finalize(v3.id)).status, 200);
  assert.deepEqual(await statuses(), { V1: "UNFINALIZED", V2: "UNFINALIZED", V3: "FINALIZED" });

  // 18. A finalized version is read-only: no version raised from it, not deleted; and no status
  //     change touched any version's document.
  const fromFinal = await raise(v3.id, 1300);
  assert.equal(fromFinal.status, 409);
  assert.equal(fromFinal.body.message, controller.FINALIZED_LOCKED);
  await assert.rejects(controller.deleteQuotationRecord({ user: { id: F.login.id }, permission: { module: "SALES", feature: "Quotation Management", level: "READ_WRITE" } }, v3.id), /finalized/i);
  assert.equal(await chainCount(), 3);
  assert.equal(await snapshot(v2.id), v2Before);
  F.v1 = v1;
  F.v2 = v2;
  F.v3 = v3;
});

test("public links: a finalized version's never expires, an unfinalized one keeps its clock, and the link's own protection is unchanged (QA 19)", async () => {
  const lapsed = new Date(Date.now() - DAY_MS);
  await prisma.salesQuotation.updateMany({ where: { id: { in: [F.v3.id, F.v1.id] } }, data: { linkExpiresAt: lapsed } });
  const finalOpen = await call(controller.publicQuotation, { params: { token: F.v3.publicToken } });
  assert.equal(finalOpen.status, 200, "the finalized version opens whatever its old expiry said");
  assert.equal(Number(finalOpen.body.data.subtotal), 1200, "and shows its own snapshot");
  assert.equal(finalOpen.body.data.finalization, undefined, "the client's copy carries no status");
  assert.equal(finalOpen.body.data.finalizedChainKey, undefined);
  assert.equal((await call(controller.publicQuotation, { params: { token: F.v1.publicToken } })).status, 410, "an unfinalized lapsed link stays lapsed");
  assert.equal((await call(controller.publicQuotation, { params: { token: "nosuchtk" } })).status, 404);
  // Still rate limited, token-addressed, and never reached through the studio's API.
  const routes = fs.readFileSync(path.join(__dirname, "../src/modules/sales/quotations-public/routes.js"), "utf8");
  assert.match(routes, /router\.get\("\/:token", linkLimiter, publicQuotation\);/);
  await prisma.salesQuotation.update({ where: { id: F.v1.id }, data: { linkExpiresAt: new Date(Date.now() + DAY_MS) } });
});

test("Create Project lists every version with its status and books only the finalized one; a booked project keeps its version (QA 20-21, 23)", async () => {
  const listed = await call(controller.listQuotations, { query: { enquiryId: F.enquiryId, withDrafts: "1" } });
  const versions = listed.body.data.flatMap((chain) => chain.versions);
  assert.equal(versions.length, 3);
  assert.deepEqual(versions.filter((version) => version.finalization.state === "FINALIZED").map((version) => version.version), [3]);

  const book = (quotationId) => call(controller.createProject, { body: { enquiryId: F.enquiryId, whatsappGroupName: `${tag("group")}-${quotationId}`, clientMainNumber: "+91 9876543210", sourceBranch: F.br.name, groupType: "Dum Dum", initialConvertedValue: 1080, quotationId } });
  // 23. An unfinalized version sent by hand is refused, and nothing is written.
  assert.equal((await book(F.v1.quotationId)).status, 409);
  assert.equal(await prisma.salesProject.count({ where: { enquiryId: F.enquiryId } }), 0);
  const booked = await book(F.v3.quotationId);
  assert.equal(booked.status, 201, JSON.stringify(booked.body));
  assert.equal(booked.body.data.quotationId, F.v3.quotationId);
  // 21. Unfinalize V3 and finalize V2: the project still points at V3.
  assert.equal((await unfinalize(F.v3.id)).status, 200);
  assert.equal((await finalize(F.v2.id)).status, 200);
  assert.equal((await prisma.salesProject.findUnique({ where: { id: booked.body.data.id } })).quotationId, F.v3.quotationId);
  assert.equal((await unfinalize(F.v2.id)).status, 200);
});

test("two finalizes of two versions at once: exactly one wins (QA 22)", async () => {
  const results = await Promise.all([finalize(F.v1.id), finalize(F.v2.id)]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409], JSON.stringify(results.map((result) => result.body?.message)));
  const finalized = Object.values(await statuses()).filter((state) => state === "FINALIZED");
  assert.equal(finalized.length, 1);
  // The same version pressed twice is one finalize.
  const winner = results[0].status === 200 ? F.v1 : F.v2;
  const again = await finalize(winner.id);
  assert.equal(again.status, 200);
  assert.equal(again.body.unchanged, true);
  assert.equal((await unfinalize(winner.id)).status, 200);
});

test("the database itself refuses a second finalized version of one quotation (QA 23)", async () => {
  await prisma.salesQuotation.update({ where: { id: F.v1.id }, data: { finalizedAt: new Date(), unfinalizedAt: null } });
  await assert.rejects(
    prisma.salesQuotation.update({ where: { id: F.v2.id }, data: { finalizedAt: new Date(), unfinalizedAt: null } }),
    (error) => error.code === "P2002",
  );
  assert.deepEqual(Object.values(await statuses()).filter((state) => state === "FINALIZED").length, 1);
  await prisma.salesQuotation.update({ where: { id: F.v1.id }, data: { unfinalizedAt: new Date() } });
});

test("version creation: a double press raises one version, and a failed save writes nothing (QA 24)", async () => {
  // Pressed twice with the same document: one new version, the other press gets it back.
  const before = await chainCount();
  const pair = await Promise.all([raise(F.v2.id, 1500), raise(F.v2.id, 1500)]);
  assert.deepEqual(pair.map((result) => result.status).sort(), [200, 201]);
  assert.equal(await chainCount(), before + 1);
  assert.equal(pair.find((result) => result.status === 200).body.unchanged, true);

  // The insert fails inside the transaction (the link token cannot be drawn): no row, and every
  // version's status is what it was.
  const statesBefore = await statuses();
  const delegate = prisma.salesQuotation;
  const original = delegate.findUnique;
  let tokenAsked = false;
  delegate.findUnique = async (args) => {
    if (args?.where?.publicToken) {
      tokenAsked = true;
      throw new Error("simulated failure");
    }
    return original.call(delegate, args);
  };
  let failed;
  try {
    failed = await raise(F.v2.id, 1600);
  } finally {
    delegate.findUnique = original;
  }
  assert.ok(tokenAsked, "the failure happened inside the save");
  assert.equal(failed.status, 500);
  assert.equal(await chainCount(), before + 1);
  assert.deepEqual(await statuses(), statesBefore);
  assert.equal((await raise(F.v2.id, 1600)).status, 201, "and it saves once the failure is gone");
});
