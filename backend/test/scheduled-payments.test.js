const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { paymentStatus, projectAccountsStatus, amountOf, toPayment, saveProjectSchedule } = require("../src/modules/accounts/scheduled-payments/service");
const { holdSchema, partialSchema } = require("../src/modules/accounts/scheduled-payments/controller");
const { saveSchema } = require("../src/modules/sales/projects/paymentSchedule");

/*
 * Accounts -> Scheduled Payments: a project's Schedule Payment, saved, and where each payment stands.
 */
const day = (key) => new Date(`${key}T00:00:00.000Z`);
const TODAY = "2026-10-13";

test("a payment is Cleared, On Hold, Overdue, Due (five days before), or Active; a part payment's remainder is Due", () => {
  const base = { amount: 1000, received: 0, holdAt: null, splitFromId: null };
  assert.equal(paymentStatus({ ...base, received: 1000, dueDate: day("2026-10-01") }, TODAY), "Cleared");
  assert.equal(paymentStatus({ ...base, holdAt: new Date(), dueDate: day("2026-10-01") }, TODAY), "On Hold", "a held payment is never overdue");
  assert.equal(paymentStatus({ ...base, dueDate: day("2026-10-12") }, TODAY), "Overdue");
  assert.equal(paymentStatus({ ...base, dueDate: day("2026-10-13") }, TODAY), "Due");
  assert.equal(paymentStatus({ ...base, dueDate: day("2026-10-18") }, TODAY), "Due");
  assert.equal(paymentStatus({ ...base, dueDate: day("2026-10-19") }, TODAY), "Active");
  assert.equal(paymentStatus({ ...base, dueDate: day("2026-10-30"), splitFromId: "p" }, TODAY), "Due", "the rest of a part payment is owed");
  assert.equal(paymentStatus({ ...base, dueDate: day("2026-10-01"), splitFromId: "p" }, TODAY), "Overdue");
  assert.equal(paymentStatus({ ...base, dueDate: null }, TODAY), "Active", "the settling row has no date");
  assert.equal(paymentStatus({ ...base, amount: 0, dueDate: null }, TODAY), "Active", "nothing to receive is never cleared");
});

test("the project's Accounts status: Hold, Overdue, Due - Active otherwise, nothing owed or no schedule included", () => {
  assert.equal(projectAccountsStatus([]), "Active");
  assert.equal(projectAccountsStatus(["Overdue", "On Hold"]), "Hold");
  assert.equal(projectAccountsStatus(["Due", "Overdue"]), "Overdue");
  assert.equal(projectAccountsStatus(["Active", "Due"]), "Due");
  assert.equal(projectAccountsStatus(["Cleared", "Cleared"]), "Active");
  assert.equal(projectAccountsStatus(["Cleared", "Active"]), "Active");
});

test("a payment comes to its share of the quotation until a split fixes it", () => {
  assert.equal(amountOf({ percentage: 25, amount: null }, 400000), 100000);
  assert.equal(amountOf({ percentage: null, amount: "12500.50" }, 400000), 12500.5);
  const payment = toPayment({ id: "s1", percentage: 10, amount: null, receipts: [{ amount: 15000 }], dueDate: day("2026-10-20"), _count: { splits: 0 } }, 200000, TODAY);
  assert.equal(payment.amount, 20000);
  assert.equal(payment.pending, 5000);
  assert.equal(payment.locked, true, "money received - the project form leaves it alone");
});

test("hold needs remarks, a part payment names the pending amount's due date", () => {
  assert.equal(holdSchema.safeParse({ hold: true }).success, false);
  assert.equal(holdSchema.safeParse({ hold: true, remarks: "Client abroad" }).success, true);
  assert.equal(holdSchema.safeParse({ hold: false }).success, true);
  assert.equal(partialSchema.safeParse({ paidAmount: 5000, entry: {} }).success, false, "the pending due date is required");
  assert.equal(partialSchema.safeParse({ paidAmount: 5000, pendingDueDate: "2999-01-01", entry: { amount: 5000 } }).success, true);
  assert.equal(saveSchema.safeParse({ rows: [{ id: "x", category: "Advance", date: "2026-10-20", percentage: 5 }] }).success, true);
  assert.equal(saveSchema.safeParse({ rows: [], projectId: "other" }).success, false, "nothing else is written");
});

// The categories, filtered by `settlesBalance` when a query asks for it, as the database would.
const CATEGORIES = [{ id: 1, name: "Advance", repeatable: false, settlesBalance: false }, { id: 2, name: "Partial Payment", repeatable: true, settlesBalance: false }, { id: 4, name: "Final Settlement", repeatable: false, settlesBalance: true }];
const categoriesWhere = (args) => CATEGORIES.filter((row) => args?.where?.settlesBalance === undefined || row.settlesBalance === args.where.settlesBalance);

test("re-saving a project updates every payment it lists - one Accounts has worked included - and withdraws what was dropped", async () => {
  const rows = [
    { id: "worked", projectId: "p1", category: "Advance", percentage: 5, amount: null, sortOrder: 1, receipts: [{ amount: 100 }], _count: { splits: 0 } },
    { id: "kept", projectId: "p1", category: "Partial Payment", percentage: 50, amount: null, sortOrder: 2, receipts: [], _count: { splits: 0 } },
    { id: "dropped", projectId: "p1", category: "Extras Services", percentage: 10, amount: null, sortOrder: 3, receipts: [], _count: { splits: 0 } },
  ];
  const calls = { update: [], create: [], updateMany: [], unlink: [] };
  const client = {
    salesProject: { findUnique: async () => ({ initialConvertedValue: 100000 }) },
    cashEntry: { updateMany: async (args) => { calls.unlink.push(args); } },
    paymentScheduleCategory: { findMany: async (args) => categoriesWhere(args) },
    projectPaymentSchedule: {
      findMany: async () => rows,
      update: async (args) => { calls.update.push(args); },
      create: async (args) => { calls.create.push(args); },
      updateMany: async (args) => { calls.updateMany.push(args); },
    },
  };
  await saveProjectSchedule("p1", [
    { id: "worked", category: "Advance", percentage: 50, date: "2026-10-20" },
    { id: "kept", category: "Partial Payment 1", percentage: 40, date: "2026-11-01", remarks: "After the wedding" },
    { id: "schedule-payment-new", category: "Final Settlement", percentage: 10 },
    { id: "schedule-payment-empty", category: "", percentage: "" },
  ], 7, { client });
  // Edit mode opens every payment, so the worked one takes what the form sent too.
  assert.deepEqual(calls.update.map((call) => call.where.id), ["worked", "kept"]);
  assert.equal(calls.update[0].data.percentage, 50);
  assert.equal(calls.update[1].data.categoryId, 2, "Partial Payment 1 is the Partial Payment category");
  assert.equal(calls.update[1].data.dueDate.toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(calls.create.length, 1);
  assert.equal(calls.create[0].data.categoryId, 4);
  assert.equal(calls.create[0].data.dueDate, null);
  assert.deepEqual(calls.updateMany[0].where.id.in, ["dropped"]);
  // Any receipt on a withdrawn payment stays on the books, only unlinked from it.
  assert.deepEqual(calls.unlink[0].where.paymentScheduleId.in, ["dropped"]);
});

test("a payment with no date is refused, before anything is written - but not the one settling the balance, nor one already worked", async () => {
  const worked = { id: "worked", projectId: "p1", category: "Advance", percentage: 5, amount: null, sortOrder: 1, receipts: [{ amount: 100 }], _count: { splits: 0 } };
  const writes = [];
  const client = {
    salesProject: { findUnique: async () => ({ initialConvertedValue: 100000 }) },
    paymentScheduleCategory: { findMany: async (args) => categoriesWhere(args) },
    projectPaymentSchedule: {
      findMany: async () => [worked],
      update: async (args) => { writes.push(args); },
      create: async (args) => { writes.push(args); },
      updateMany: async (args) => { writes.push(args); },
    },
  };
  await assert.rejects(
    saveProjectSchedule("p1", [
      { id: "new-dated", category: "Advance", percentage: 5, date: "2026-10-20" },
      { id: "new-undated", category: "Partial Payment 1", percentage: 45, date: "" },
    ], 7, { client }),
    (error) => error.status === 400 && /Choose a date for every payment/.test(error.message),
  );
  assert.equal(writes.length, 0, "a refused save writes nothing, not even the dated row before it");
  // The settling row takes no date, a worked payment is kept as it is, and the blank row is not a payment.
  await saveProjectSchedule("p1", [
    { id: "worked", category: "Advance", percentage: 5, date: "" },
    { id: "new-dated", category: "Partial Payment 1", percentage: 85, date: "2026-11-01" },
    { id: "settles", category: "final settlement", percentage: 10, date: null },
    { id: "blank", category: "", percentage: "", date: "" },
  ], 7, { client });
  assert.equal(writes.filter((call) => call.data?.projectId).length, 2, "the dated payment and the settlement are created");
});

test("the routes: Accounts Manager's own Cash Management, and only what is still owed is listed", () => {
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "accounts", "scheduled-payments", "routes.js"), "utf8");
  assert.match(routes, /router\.use\(requireModule\("ACCOUNTS", "Cash Management"\)\);/);
  const projects = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "projects", "routes.js"), "utf8");
  // The save is on `editsASchedule`: `SALES / Booking Edit`, or the plan's pair - see `routes.js`.
  assert.match(projects, /router\.put\("\/projects\/:id\/payment-schedule", editsASchedule, saveProjectPaymentSchedule\);/);
  assert.match(projects, /router\.post\("\/projects\/:id\/payment-schedule", salesManager, saveProjectPaymentSchedule\);/);
  // Every read narrows to the projects this screen's grant reaches.
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "accounts", "scheduled-payments", "controller.js"), "utf8");
  assert.match(controller, /projectAccessWhere\(\{ userId: Number\(req\.user\.id\), permissions: req\.permission, forWrite \}\)/);
  assert.match(controller, /\.filter\(\(row\) => row\.status !== "Cleared"\)/);
});

test("clear and part payment lock the payment and read it again, so a second press is refused, not paid twice", async () => {
  const prisma = require("../src/config/db");
  const service = require("../src/modules/accounts/scheduled-payments/service");
  const original = prisma.$transaction;
  const row = { id: "s1", projectId: "p1", category: "Advance", categoryId: 1, percentage: 10, amount: null, sortOrder: 1, receipts: [{ amount: 10000 }], _count: { splits: 0 }, project: { initialConvertedValue: 100000 } };
  const locked = [];
  const tx = {
    $queryRaw: async (strings, id) => { locked.push(id); },
    projectPaymentSchedule: { findUnique: async () => row, update: async () => {}, create: async () => {} },
  };
  prisma.$transaction = async (work) => work(tx);
  try {
    // Already received in full: the second Clear finds it cleared under the lock.
    await assert.rejects(() => service.clearPayment("s1", { amount: 10000 }, 1), (error) => error.status === 409);
    row.receipts = [];
    await assert.rejects(() => service.clearPayment("s1", { amount: 5000 }, 1), (error) => error.status === 400 && /whole pending amount/.test(error.message));
    await assert.rejects(() => service.partPayPayment("s1", { paidAmount: 10000, pendingDueDate: "2999-01-01", entry: { amount: 10000 } }, 1), (error) => error.status === 400 && /less than the pending/.test(error.message));
    await assert.rejects(() => service.partPayPayment("s1", { paidAmount: 4000, pendingDueDate: "2999-01-01", entry: { amount: 3000 } }, 1), (error) => error.status === 400);
    row.receipts = [{ amount: 10000 }];
    await assert.rejects(() => service.setPaymentHold("s1", { hold: true, remarks: "x" }, 1), (error) => error.status === 409);
    assert.ok(locked.length >= 5 && locked.every((id) => id === "s1"), "every write locks the payment's row first");
  } finally {
    prisma.$transaction = original;
  }
});

test("Create Project's save lays down a first schedule only; changing one is Edit Project's", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "projects", "paymentSchedule.js"), "utf8");
  assert.match(source, /creating: req\.method === "POST"/);
  assert.match(source, /if \(creating && await prisma\.projectPaymentSchedule\.count\(\{ where: \{ projectId: project\.id, deletedAt: null \} \}\)\) \{\s*return res\.status\(409\)/);
  assert.equal(saveSchema.safeParse({ rows: [{ date: "2026-02-30" }] }).success, false, "not a calendar day");
  assert.equal(saveSchema.safeParse({ rows: [{ percentage: "abc" }] }).success, false);
});

test("across the project: Overdue when any payment owed is, else Due; a held one is the hold's, not this", async () => {
  const { projectPaymentsDue } = require("../src/services/projectHolds");
  const past = new Date(Date.now() - 10 * 86400000);
  const soon = new Date(Date.now() + 2 * 86400000);
  const later = new Date(Date.now() + 60 * 86400000);
  const row = (projectId, dueDate, extra = {}) => ({ projectId, dueDate, percentage: 10, amount: null, receipts: [], holdAt: null, splitFromId: null, _count: { splits: 0 }, project: { initialConvertedValue: 100000 }, ...extra });
  let asked;
  const client = { projectPaymentSchedule: { findMany: async (args) => { asked = args.where; return [
    row("both", soon), row("both", past),
    row("due", soon),
    row("paid", past, { receipts: [{ amount: 10000 }] }),
    row("later", later),
  ]; } } };
  assert.deepEqual(await projectPaymentsDue(["both", "due", "paid", "later"], { client }), { both: "Overdue", due: "Due" });
  assert.equal(asked.holdAt, null, "held payments are left to the hold badge");
});
