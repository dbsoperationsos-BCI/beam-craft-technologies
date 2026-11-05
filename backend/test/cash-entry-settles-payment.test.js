const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const prisma = require("../src/config/db");
const service = require("../src/modules/accounts/scheduled-payments/service");
const { settlesSchema } = require("../src/modules/accounts/cash-entries/controller");
const { studioDateKey } = require("../src/services/studioTime");

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", ...parts), "utf8");

// A payment of ₹30,000 (30% of ₹1,00,000) on project p1, nothing received yet.
function fakeTx(overrides = {}) {
  const row = { id: "s1", projectId: "p1", category: "Advance", categoryId: 1, percentage: 30, amount: null, sortOrder: 1, receipts: [], _count: { splits: 0 }, deletedAt: null, holdAt: null, project: { initialConvertedValue: 100000 }, ...overrides };
  const writes = [];
  const tx = {
    $queryRaw: async () => {},
    projectPaymentSchedule: {
      findUnique: async () => row,
      update: async (args) => writes.push(["update", args]),
      create: async (args) => writes.push(["create", args]),
    },
  };
  return { tx, row, writes };
}

test("settles is optional on a receipt and says which payment, and Full or Partial", () => {
  assert.equal(settlesSchema.safeParse({ paymentScheduleId: "s1", mode: "FULL" }).success, true);
  assert.equal(settlesSchema.safeParse({ paymentScheduleId: "s1", mode: "PARTIAL" }).success, false, "a partial payment needs the date the rest is due");
  assert.equal(settlesSchema.safeParse({ paymentScheduleId: "s1", mode: "PARTIAL", pendingDueDate: "2999-01-01" }).success, true);
  assert.equal(settlesSchema.safeParse({ paymentScheduleId: "s1", mode: "HALF" }).success, false);
  assert.equal(settlesSchema.safeParse({ mode: "FULL" }).success, false);
});

test("the payment must be the entry's project's, still open, and the amount must fit the choice", async () => {
  const { tx } = fakeTx();
  const entry = { amount: 30000 };
  await assert.rejects(() => service.settleInTx(tx, "s1", { mode: "FULL", projectId: "p2" }, entry, 1), (error) => error.status === 400 && /not one of this project's/.test(error.message));
  await assert.rejects(() => service.settleInTx(tx, "s1", { mode: "FULL", projectId: "p1" }, { amount: 20000 }, 1), (error) => error.status === 400 && /whole pending amount, ₹30000/.test(error.message));
  await assert.rejects(() => service.settleInTx(tx, "s1", { mode: "PARTIAL", projectId: "p1", pendingDueDate: "2999-01-01" }, { amount: 30000 }, 1), (error) => error.status === 400 && /less than the pending/.test(error.message));
  await assert.rejects(() => service.settleInTx(tx, "s1", { mode: "PARTIAL", projectId: "p1", pendingDueDate: "2000-01-01" }, { amount: 10000 }, 1), (error) => error.status === 400 && /past/.test(error.message));
  await assert.rejects(() => service.settleInTx(tx, "s1", { mode: "PARTIAL", projectId: "p1" }, { amount: 10000 }, 1), (error) => error.status === 400 && /date the rest is due/.test(error.message));
  await assert.rejects(() => service.settleInTx(tx, "s1", { mode: "SOME", projectId: "p1" }, entry, 1), (error) => error.status === 400);
  // Received in full already, or withdrawn: nothing to settle.
  await assert.rejects(() => service.settleInTx(fakeTx({ receipts: [{ amount: 30000 }] }).tx, "s1", { mode: "FULL", projectId: "p1" }, entry, 1), (error) => error.status === 409);
  await assert.rejects(() => service.settleInTx(fakeTx({ deletedAt: new Date() }).tx, "s1", { mode: "FULL", projectId: "p1" }, entry, 1), (error) => error.status === 404);
});

test("a partial payment fixes this payment at what was received and splits the rest off, due on the date given", async () => {
  // Against a real database inside a transaction that is rolled back: the receipt is written through
  // the cash book's own recorder, so this needs a project with a schedule to settle against.
  const payment = await prisma.projectPaymentSchedule.findFirst({ where: { deletedAt: null, receipts: { none: {} }, amount: null, percentage: { gt: 0 }, project: { deletedAt: null, initialConvertedValue: { gt: 0 } } }, select: { id: true, projectId: true } });
  const actor = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true } });
  if (!payment || !actor) return;
  const [scheduled] = (await service.projectSchedule(payment.projectId)).filter((row) => row.id === payment.id);
  const handler = await prisma.employee.findFirst({ select: { id: true } });
  const ROLLBACK = new Error("rollback");
  const due = studioDateKey();
  await assert.rejects(prisma.$transaction(async (tx) => {
    const created = await service.settleInTx(tx, payment.id, { mode: "PARTIAL", pendingDueDate: due, projectId: payment.projectId }, {
      entryType: "Received", entryDate: due, category: "Advance", amount: 1, paymentMode: "Cash", handlerEmployeeId: handler?.id, description: "settle test",
    }, actor.id);
    assert.equal(created.paymentScheduleId, payment.id);
    const [kept] = (await service.projectSchedule(payment.projectId, { client: tx })).filter((row) => row.id === payment.id);
    assert.equal(kept.status, "Cleared", "fixed at what was received, so it reads Cleared");
    const rest = await tx.projectPaymentSchedule.findFirst({ where: { splitFromId: payment.id, deletedAt: null }, select: { amount: true, dueDate: true } });
    assert.equal(Number(rest.amount), scheduled.pending - 1);
    assert.equal(rest.dueDate.toISOString().slice(0, 10), due);
    throw ROLLBACK;
  }), (error) => error === ROLLBACK);
});

test("Add Entry, the booking advance and the CSV import all settle through the one rule", () => {
  const cash = read("modules", "accounts", "cash-entries", "controller.js");
  assert.match(cash, /scheduledPayments\(\)\.settleInTx\(tx, settles\.data\.paymentScheduleId, \{ \.\.\.settles\.data, projectId: body\.projectId \|\| null \}, body, actorId, \{ schema: formEntrySchema, source \}\)/);
  assert.match(cash, /if \(settles && body\.entryType !== "Received"\)/);
  assert.match(cash, /scheduledPayments\(\)\.settleInTx\(tx, paymentScheduleId, settles, \{ \.\.\.input, projectId: project\.id \}, actorId, \{ source: "CSV Import", schema: importEntrySchema \}\)/);
  assert.match(cash, /\{ field: "scheduledPayment", label: "Scheduled Payment" \}/);
  assert.match(cash, /\{ field: "balanceDueDate", label: "Balance Due Date" \}/);
  const sales = read("modules", "sales", "projects", "controller.js");
  assert.match(sales, /settleScheduledPayment\(tx, settles\.data\.paymentScheduleId, \{ \.\.\.settles\.data, projectId: project\.id \}, entry, actorId, \{ schema: cashFormEntrySchema \}\)/);
  const scheduled = read("modules", "accounts", "scheduled-payments", "service.js");
  assert.match(scheduled, /async function clearPayment\(id, entry, actorId\) \{\s*return settlePayment\(id, \{ mode: "FULL" \}, entry, actorId\);/);
  assert.match(scheduled, /return settleInTx\(tx, id, \{ mode: "PARTIAL", pendingDueDate \}, entry, actorId\);/);
});

test("a receipt that settled a payment keeps its amount and project on edit", () => {
  const cash = read("modules", "accounts", "cash-entries", "controller.js");
  assert.match(cash, /if \(existing\.paymentScheduleId && \(Number\(data\.amount\) !== Number\(existing\.amount\) \|\| data\.projectId !== existing\.projectId\)\)/);
});

test("a project's open payments are offered under Cash Management, above the payment route", () => {
  const routes = read("modules", "accounts", "scheduled-payments", "routes.js");
  assert.ok(routes.indexOf('router.get("/project/:projectId/open"') < routes.indexOf('router.get("/:id"'));
  assert.match(routes, /router\.use\(requireModule\("ACCOUNTS", "Cash Management"\)\);/);
});

test("settling asks whether the caller may work that project, on Add Entry and on the CSV import", () => {
  const cash = read("modules", "accounts", "cash-entries", "controller.js");
  assert.match(cash, /if \(settles && !\(await maySettleFor\(req, body\.projectId\)\)\) return res\.status\(404\)/);
  assert.match(cash, /if \(!\(await maySettleFor\(req, project\.id\)\)\) throw badRequest\(/);
  // Cash Management's reach for writing - what Clear asks - or the project on the caller's board.
  assert.match(cash, /projectAccessWhere\(\{ userId: Number\(req\.user\.id\), permissions: req\.permission, forWrite: true \}\)/);
  assert.match(cash, /return Boolean\(reached\) \|\| onVisibleProject\(req, projectId\);/);
});
