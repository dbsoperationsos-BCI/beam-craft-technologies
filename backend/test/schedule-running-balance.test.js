const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const service = require("../src/modules/accounts/scheduled-payments/service");

/*
 * Schedule Payment's Balance Amount (`projectLedger`): the Updated Total Amount less the money
 * actually received, plus refunds - read from the books, never from what is merely scheduled.
 *
 * The books here are a fake client holding cash entries; the schedule rows are built with the
 * screens' own `toPayment`, so a row's `received` and status are what the real read would give.
 */
const TODAY = "2026-11-04";
const SIGNED = 100000;

// One payment as the database holds it, with its live receipts.
const payment = (id, { percentage = null, amount = null, dueDate = null, receipts = [], splitFromId = null, holdAt = null } = {}) => ({
  id, projectId: "p1", category: "Advance", categoryId: 1, percentage, amount, sortOrder: 1, splitFromId, holdAt,
  dueDate: dueDate ? new Date(`${dueDate}T00:00:00.000Z`) : null,
  receipts: receipts.map((value) => ({ amount: value })), _count: { splits: 0 },
});
const schedule = (rows) => rows.map((row) => service.toPayment(row, SIGNED, TODAY));

/**
 * The project's books: `entries` are cash entries ({ entryType, category, amount, deletedAt }),
 * `extraQuotations` the approved ones' amounts, `saleExtras` the published Sale Extras' net.
 */
function books({ entries = [], extraQuotations = [], saleExtras = 0, signed = SIGNED } = {}) {
  const sum = (rows) => rows.reduce((total, row) => total + Number(row.amount), 0);
  return {
    salesProject: { findUnique: async () => ({ initialConvertedValue: signed }) },
    projectExtraQuotation: { aggregate: async ({ where }) => {
      assert.equal(where.status, "APPROVED", "only approved Extra Quotations count");
      return { _sum: { amount: extraQuotations.length ? sum(extraQuotations.map((amount) => ({ amount }))) : null } };
    } },
    projectSaleExtra: { aggregate: async ({ where }) => {
      assert.equal(where.status, "PUBLISHED", "only published Sale Extras count");
      return { _sum: { amount: saleExtras || null } };
    } },
    cashEntry: { aggregate: async ({ where }) => {
      const live = entries.filter((row) => !row.deletedAt && row.entryType === where.entryType && (!where.category || row.category === where.category));
      return { _sum: { amount: live.length ? sum(live) : null } };
    } },
  };
}
const received = (amount, extra = {}) => ({ entryType: "Received", category: "Advance", amount, ...extra });
const refund = (amount) => ({ entryType: "Spent", category: service.REFUND_CATEGORY, amount });
const ledgerOf = (rows, bookOptions) => service.projectLedger("p1", schedule(rows), { client: books(bookOptions) });
const receivedOn = (ledger) => ledger.rows.map((row) => row.received);

test("1. a fully paid payment takes what was received off the balance", async () => {
  const ledger = await ledgerOf([payment("a", { percentage: 10, receipts: [10000] }), payment("b", { percentage: 90, dueDate: "2027-01-01" })], { entries: [received(10000)] });
  assert.equal(schedule([payment("a", { percentage: 10, receipts: [10000] })])[0].status, "Cleared");
  assert.deepEqual(receivedOn(ledger), [10000, 0]);
  assert.equal(ledger.updatedTotal, 100000);
  assert.equal(ledger.received, 10000);
  assert.equal(ledger.balance, 90000);
});

test("2. a pending payment takes nothing off", async () => {
  const ledger = await ledgerOf([payment("a", { percentage: 20, dueDate: "2026-11-06" })]);
  assert.equal(schedule([payment("a", { percentage: 20, dueDate: "2026-11-06" })])[0].status, "Due");
  assert.deepEqual(receivedOn(ledger), [0]);
  assert.equal(ledger.balance, 100000);
});

test("3. an overdue payment is not money received, and takes nothing off", async () => {
  const rows = [payment("a", { percentage: 5, receipts: [5000] }), payment("b", { percentage: 25, dueDate: "2026-10-01" })];
  assert.equal(schedule(rows)[1].status, "Overdue");
  const ledger = await ledgerOf(rows, { entries: [received(5000)] });
  assert.deepEqual(receivedOn(ledger), [5000, 0]);
  assert.equal(ledger.balance, 95000);
});

test("4. a part payment takes off only what was received; the rest it split off takes nothing", async () => {
  // ₹30,000 due, ₹12,000 paid: the payment is fixed at ₹12,000 and ₹18,000 is a payment of its own.
  const rows = [payment("a", { amount: 12000, receipts: [12000] }), payment("a2", { amount: 18000, dueDate: "2026-12-01", splitFromId: "a" })];
  const ledger = await ledgerOf(rows, { entries: [received(12000)] });
  assert.deepEqual(receivedOn(ledger), [12000, 0]);
  assert.equal(ledger.balance, 88000);
});

test("5. several receipts against one payment are each counted once", async () => {
  const rows = [payment("a", { amount: 12000, receipts: [12000] }), payment("a2", { amount: 18000, receipts: [8000, 10000], splitFromId: "a" }), payment("b", { percentage: 70, dueDate: "2027-02-01" })];
  const ledger = await ledgerOf(rows, { entries: [received(12000), received(8000), received(10000)] });
  assert.equal(schedule(rows)[1].status, "Cleared");
  assert.deepEqual(receivedOn(ledger), [12000, 18000, 0]);
  assert.equal(ledger.received, 30000);
  assert.equal(ledger.balance, 70000);
});

test("6. a refund is owed again, and a withdrawn receipt no longer counts", async () => {
  const rows = [payment("a", { percentage: 30, receipts: [30000] })];
  const refunded = await ledgerOf(rows, { entries: [received(30000), refund(5000)] });
  assert.equal(refunded.refunded, 5000);
  assert.equal(refunded.balance, 75000, "₹70,000 left plus the ₹5,000 paid back");
  // Withdrawn in Accounts (deleted_at set): gone from the row's receipts and from the books alike.
  const reversed = await ledgerOf([payment("a", { percentage: 30 })], { entries: [received(30000, { deletedAt: new Date() })] });
  assert.deepEqual(receivedOn(reversed), [0]);
  assert.equal(reversed.received, 0);
  assert.equal(reversed.balance, 100000);
});

test("7. a project paid in full reads a balance of zero", async () => {
  const rows = [payment("a", { percentage: 40, receipts: [40000] }), payment("b", { percentage: 60, receipts: [60000] })];
  const ledger = await ledgerOf(rows, { entries: [received(40000), received(60000)] });
  assert.deepEqual(receivedOn(ledger), [40000, 60000]);
  assert.equal(ledger.balance, 0);
  assert.equal(ledger.overpaid, 0);
});

test("8. a payment already cleared cannot be received again, so nothing is taken off twice", async () => {
  const row = { ...payment("a", { percentage: 30, receipts: [30000] }), deletedAt: null, project: { initialConvertedValue: SIGNED } };
  const tx = { $queryRaw: async () => {}, projectPaymentSchedule: { findUnique: async () => row } };
  await assert.rejects(() => service.settleInTx(tx, "a", { mode: "FULL", projectId: "p1" }, { amount: 30000 }, 1), (error) => error.status === 409 && /already cleared/.test(error.message));
  // And every write locks the payment's row first, so two presses cannot both find it open.
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "accounts", "scheduled-payments", "service.js"), "utf8");
  assert.match(source, /FOR UPDATE/);
});

test("9. approved extras raise the Updated Total Amount, and the balance with it", async () => {
  const rows = [payment("a", { percentage: 10, receipts: [10000] })];
  const ledger = await ledgerOf(rows, { entries: [received(10000)], saleExtras: 10176, extraQuotations: [5000] });
  assert.equal(ledger.saleExtras, 10176);
  assert.equal(ledger.extraQuotations, 5000);
  assert.equal(ledger.updatedTotal, 115176);
  assert.deepEqual(receivedOn(ledger), [10000]);
  assert.equal(ledger.balance, 105176);
});

test("money paid past the total is kept apart; the balance never reads below zero", async () => {
  const ledger = await ledgerOf([payment("a", { percentage: 100, receipts: [100000] })], { entries: [received(100000), received(2500)] });
  assert.equal(ledger.balance, 0);
  assert.equal(ledger.overpaid, 2500);
  assert.ok(ledger.balance >= 0);
});

test("money received on no payment counts in the balance and is reported apart", async () => {
  const ledger = await ledgerOf([payment("a", { percentage: 10, receipts: [10000] })], { entries: [received(10000), received(4000)] });
  assert.deepEqual(receivedOn(ledger), [10000]);
  assert.equal(ledger.unscheduledReceived, 4000);
  assert.equal(ledger.balance, 86000);
});

test("the schedule's read hands the ledger back beside its rows", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "projects", "paymentSchedule.js"), "utf8");
  assert.match(source, /res\.json\(\{ data, ledger: await projectLedger\(project\.id, data\) \}\)/);
});
