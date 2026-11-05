const test = require("node:test");
const assert = require("node:assert/strict");

const skips = require("../src/modules/hrm/payroll-register/skips");
const advances = require("../src/modules/hrm/payroll-advance/service");
const recoveries = require("../src/modules/hrm/payroll-recovery/service");
const monthLock = require("../src/modules/hrm/payroll-register/monthLock");

// These months are fixtures, not dates: the payable-date lock (`payroll-month-lock.test.js`) is not
// what is tested here, so it lets every month through.
test.beforeEach((t) => { t.mock.method(monthLock, "assertFigureOpen", async () => {}); });

/*
 * HRM → Payroll → Main Page → Skip: a month's Salary Advance moves to the next month not skipped; a
 * recovery's instalment is left out and the run ends a month later. Undo puts either back.
 */

test("a run passes over its skipped months: the same instalments, one month later per skip", () => {
  const run = recoveries.scheduleOf(2026, 7, 4, [{ year: 2026, month: 8 }]);
  assert.deepEqual(run.instalments, [{ year: 2026, month: 7 }, { year: 2026, month: 9 }, { year: 2026, month: 10 }, { year: 2026, month: 11 }]);
  assert.deepEqual(run.skipped, [{ year: 2026, month: 8 }]);
  assert.deepEqual(run.end, { year: 2026, month: 12 });
  assert.equal(run.span.length, 5);
  // A skip outside the run changes nothing; none at all is the run as entered.
  assert.deepEqual(recoveries.scheduleOf(2026, 7, 4, [{ year: 2027, month: 1 }]).end, { year: 2026, month: 11 });
  const recovery = { recoveryId: "RECO-ID-0001", totalAmount: 20000, startYear: 2026, startMonth: 7, months: 4, skips: [{ year: 2026, month: 8 }] };
  assert.deepEqual(recoveries.recoveryDueIn(2026, 8, [recovery]), { amount: 0, recoveryIds: [] });
  assert.deepEqual(recoveries.recoveryDueIn(2026, 11, [recovery]), { amount: 5000, recoveryIds: ["RECO-ID-0001"] });
  assert.deepEqual(recoveries.recoverySkippedIn(2026, 8, [recovery]), ["RECO-ID-0001"]);
  const row = recoveries.toRow({ ...recovery, id: 1, employeeId: 17 });
  // The end date moves on a month; the instalment does not change.
  assert.deepEqual([row.endDate, row.skippedMonths, row.monthlyDeduction], ["2026-12-01", ["2026-08-01"], 5000]);
});

test("an advance skipped in its month comes off the next month not skipped, and its From Month says so", () => {
  const advance = { advanceId: "ADV-ID-0001", amount: 3000, deductYear: 2026, deductMonth: 10, skips: [{ year: 2026, month: 10 }] };
  assert.deepEqual(advances.takenIn(advance), { year: 2026, month: 11 });
  assert.deepEqual(advances.takenIn({ ...advance, skips: [{ year: 2026, month: 10 }, { year: 2026, month: 11 }] }), { year: 2026, month: 12 });
  assert.deepEqual(advances.advanceDueIn(2026, 10, [advance]), { amount: 0, advanceIds: [] });
  assert.deepEqual(advances.advanceDueIn(2026, 11, [advance]), { amount: 3000, advanceIds: ["ADV-ID-0001"] });
  assert.deepEqual(advances.advanceSkippedIn(2026, 10, [advance]), ["ADV-ID-0001"]);
  const row = advances.toRow({ ...advance, id: 1, employeeId: 17, advanceDate: new Date("2026-10-01T00:00:00Z") });
  assert.deepEqual([row.deductMonth, row.deductYear, row.status, row.skippedMonths], [11, 2026, "Pending", ["2026-10-01"]]);
});

/** A database just big enough for a skip: an employee's advances, recoveries, skips and payroll rows. */
function fakeClient({ advanceRows = [], recoveryRows = [], policyBreachRows = [], entries = [], employees = [{ id: 17, branchId: 1 }] } = {}) {
  const ownersOf = (kind) => ({ advance: advanceRows, recovery: recoveryRows, "policy-breach": policyBreachRows })[kind];
  const skipTable = (kind, key) => ({
    create: async ({ data }) => {
      const owner = ownersOf(kind).find((row) => row.id === data[key]);
      owner.skips = owner.skips || [];
      if (owner.skips.some((skip) => skip.year === data.year && skip.month === data.month)) throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
      owner.skips.push({ year: data.year, month: data.month });
      return data;
    },
    deleteMany: async ({ where }) => {
      let count = 0;
      for (const owner of ownersOf(kind).filter((row) => where[key].in.includes(row.id))) {
        const before = (owner.skips || []).length;
        owner.skips = (owner.skips || []).filter((skip) => !(skip.year === where.year && skip.month === where.month));
        count += before - owner.skips.length;
      }
      return { count };
    },
  });
  const client = {
    entries,
    locked: [],
    $transaction: async (work) => work(client),
    $queryRaw: async (strings, ...values) => { client.locked.push({ sql: strings.join("?"), values }); return []; },
    employee: {
      findFirst: async ({ where }) => employees.find((employee) => employee.id === where.id && (!where.branchId || where.branchId.in.includes(employee.branchId))) || null,
    },
    payrollEntry: {
      findFirst: async ({ where }) => entries.find((row) => (where.id !== undefined
        ? row.id === where.id && (!where.employee?.branchId || where.employee.branchId.in.includes(employees.find((employee) => employee.id === row.employeeId)?.branchId))
        : row.employeeId === where.employeeId && row.year === where.year && row.month === where.month)) || null,
      updateMany: async ({ where, data }) => {
        const row = entries.find((entry) => entry.id === where.id && entry.paymentStatus !== where.paymentStatus.not);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    payrollAdvance: { findMany: async ({ where }) => advanceRows.filter((row) => row.employeeId === where.employeeId && !row.deletedAt && !row.convertedRecoveryId) },
    payrollRecovery: { findMany: async ({ where }) => recoveryRows.filter((row) => row.employeeId === where.employeeId && !row.deletedAt) },
    payrollAdvanceSkip: skipTable("advance", "advanceId"),
    payrollRecoverySkip: skipTable("recovery", "recoveryId"),
    payrollPolicyBreach: { findMany: async ({ where }) => policyBreachRows.filter((row) => row.employeeId === where.employeeId && !row.deletedAt) },
    payrollPolicyBreachSkip: skipTable("policy-breach", "policyBreachId"),
  };
  return client;
}
const rowsFor = (months, extra = {}) => months.map(([year, month], index) => ({ id: index + 1, employeeId: 17, year, month, paymentStatus: "Pending", salaryAdvance: 0, recoveryDeduction: 0, ...extra }));
const at = (client, year, month) => client.entries.find((row) => row.year === year && row.month === month);

test("Skip on a Salary Advance moves it to the next month, and Undo brings it back", async () => {
  const client = fakeClient({
    advanceRows: [{ id: 1, advanceId: "ADV-ID-0001", employeeId: 17, amount: 3000, deductYear: 2026, deductMonth: 10 }],
    entries: rowsFor([[2026, 10], [2026, 11]]),
  });
  at(client, 2026, 10).salaryAdvance = 3000;
  const skipped = await skips.skipDeduction(1, "advance", 9, { client });
  assert.deepEqual(skipped, { kind: "advance", year: 2026, month: 10, items: [{ id: "ADV-ID-0001", takenIn: "2026-11-01" }] });
  // The employee's row is locked first, with the id bound - one change to their deductions at a time.
  assert.deepEqual(client.locked, [{ sql: "SELECT id FROM employee WHERE id = ? FOR UPDATE", values: [17] }]);
  assert.deepEqual([at(client, 2026, 10).salaryAdvance, at(client, 2026, 11).salaryAdvance], [0, 3000]);
  await assert.rejects(skips.skipDeduction(1, "advance", 9, { client }), /No salary advance comes off the October 2026 payroll/);
  const undone = await skips.undoSkip(1, "advance", 9, { client });
  assert.deepEqual(undone.items, [{ id: "ADV-ID-0001" }]);
  assert.deepEqual([at(client, 2026, 10).salaryAdvance, at(client, 2026, 11).salaryAdvance], [3000, 0]);
  await assert.rejects(skips.undoSkip(1, "advance", 9, { client }), /Nothing was skipped in the October 2026 payroll/);
});

test("Skip on a Recovery Deduction leaves the month out and ends the run a month later; Undo puts it back", async () => {
  const client = fakeClient({
    recoveryRows: [{ id: 4, recoveryId: "RECO-ID-0004", employeeId: 17, totalAmount: 15000, startYear: 2026, startMonth: 10, months: 3 }],
    entries: rowsFor([[2026, 10], [2026, 11], [2026, 12], [2027, 1]]),
  });
  [[2026, 10], [2026, 11], [2026, 12]].forEach(([year, month]) => { at(client, year, month).recoveryDeduction = 5000; });
  const skipped = await skips.skipDeduction(1, "recovery", 9, { client });
  assert.deepEqual(skipped.items, [{ id: "RECO-ID-0004", endDate: "2027-02-01" }]);
  assert.deepEqual(client.entries.map((row) => row.recoveryDeduction), [0, 5000, 5000, 5000]);
  await skips.undoSkip(1, "recovery", 9, { client });
  assert.deepEqual(client.entries.map((row) => row.recoveryDeduction), [5000, 5000, 5000, 0]);
});

test("Skip on a Policy Breach Deduction runs as a recovery's does, and touches only its own column", async () => {
  const client = fakeClient({
    policyBreachRows: [{ id: 2, policyBreachId: "PB-ID-0002", employeeId: 17, totalAmount: 3000, startYear: 2026, startMonth: 10, months: 3 }],
    entries: rowsFor([[2026, 10], [2026, 11], [2026, 12], [2027, 1]], { policyBreachDeduction: 0, recoveryDeduction: 400 }),
  });
  [[2026, 10], [2026, 11], [2026, 12]].forEach(([year, month]) => { at(client, year, month).policyBreachDeduction = 1000; });
  const skipped = await skips.skipDeduction(1, "policy-breach", 9, { client });
  assert.deepEqual(skipped.items, [{ id: "PB-ID-0002", endDate: "2027-02-01" }]);
  assert.deepEqual(client.entries.map((row) => row.policyBreachDeduction), [0, 1000, 1000, 1000]);
  assert.deepEqual(client.entries.map((row) => row.recoveryDeduction), [400, 400, 400, 400], "the recovery column is left alone");
  await assert.rejects(skips.skipDeduction(1, "policy-breach", 9, { client }), /No policy breach instalment comes off the October 2026 payroll/);
  const undone = await skips.undoSkip(1, "policy-breach", 9, { client });
  assert.deepEqual(undone.items, [{ id: "PB-ID-0002" }]);
  assert.deepEqual(client.entries.map((row) => row.policyBreachDeduction), [1000, 1000, 1000, 0]);
});

test("Skip is refused on a paid month, into or out of a paid month, and outside either reach", async () => {
  const advanceRows = [{ id: 1, advanceId: "ADV-ID-0001", employeeId: 17, amount: 3000, deductYear: 2026, deductMonth: 10 }];
  let client = fakeClient({ advanceRows, entries: rowsFor([[2026, 10]], { paymentStatus: "Paid", salaryAdvance: 3000 }) });
  await assert.rejects(skips.skipDeduction(1, "advance", 9, { client }), /October 2026 payroll for this employee is paid/);
  // The month it would move into is paid: what that month took would change.
  client = fakeClient({ advanceRows: [{ ...advanceRows[0], skips: [] }], entries: rowsFor([[2026, 10], [2026, 11]]) });
  at(client, 2026, 10).salaryAdvance = 3000;
  at(client, 2026, 11).paymentStatus = "Paid";
  await assert.rejects(skips.skipDeduction(1, "advance", 9, { client }), /November 2026 payroll for this employee is already paid/);
  // Out of the register's reach, or the Advance permission's: not there.
  client = fakeClient({ advanceRows: [{ ...advanceRows[0], skips: [] }], entries: rowsFor([[2026, 10]]) });
  await assert.rejects(skips.skipDeduction(1, "advance", 9, { client, reach: [3] }), /could not be found/);
  await assert.rejects(skips.skipDeduction(1, "advance", 9, { client, kindReach: [3] }), /could not be found/);
});

test("the routes ask for the register's write and the skipped module's, and know only advance, recovery and policy breach", async () => {
  const iamService = require("../src/services/iam.service");
  const router = require("../src/modules/hrm/payroll-register/routes");
  const layer = router.stack.find((entry) => entry.route?.path === "/:id/skip/:kind" && entry.route.methods.post);
  assert.ok(router.stack.find((entry) => entry.route?.path === "/:id/skip/:kind" && entry.route.methods.delete));
  const guard = layer.route.stack[0].handle;
  const original = iamService.hasPermission;
  const answer = async (kind, held) => {
    iamService.hasPermission = async (userId, module, feature, level) => module === "HRM" && held.includes(`${feature}:${level}`);
    let code = 200;
    let passed = false;
    const res = { status(value) { code = value; return this; }, json() { return this; } };
    await guard({ method: "POST", user: { id: 7 }, params: { id: "1", kind } }, res, () => { passed = true; });
    return passed ? "next" : code;
  };
  try {
    assert.equal(await answer("advance", ["Payroll Recovery:READ_WRITE"]), 403);
    assert.equal(await answer("advance", ["Payroll Advance:READ_WRITE"]), "next");
    assert.equal(await answer("recovery", ["Payroll Advance:READ_WRITE"]), 403);
    assert.equal(await answer("recovery", ["Payroll Recovery:READ_WRITE"]), "next");
    assert.equal(await answer("policy-breach", ["Payroll Recovery:READ_WRITE"]), 403);
    assert.equal(await answer("policy-breach", ["Payroll Policy Breach:READ_WRITE"]), "next");
    assert.equal(await answer("bonus", ["Payroll Advance:READ_WRITE", "Payroll Recovery:READ_WRITE"]), 404);
  } finally {
    iamService.hasPermission = original;
  }
});

test("payment history reads each month of a run from the payroll: Deducted once Paid, Due (Pending or not generated yet), On Hold, Skipped", async () => {
  const entries = [
    { year: 2026, month: 10, paymentStatus: "Paid", paymentDate: new Date("2026-11-10T00:00:00Z"), paymentMode: { name: "Bank Transfer" } },
    { year: 2026, month: 12, paymentStatus: "On Hold", paymentDate: null, paymentMode: null },
    { year: 2027, month: 1, paymentStatus: "Pending", paymentDate: null, paymentMode: null },
  ];
  const client = { payrollEntry: { findMany: async ({ where }) => entries.filter((row) => where.OR.some((at) => at.year === row.year && at.month === row.month)) } };
  // October to February over four instalments, November skipped.
  const schedule = recoveries.scheduleOf(2026, 10, 4, [{ year: 2026, month: 11 }]);
  const history = await recoveries.paymentHistory(client, 17, schedule, () => 1500);
  assert.deepEqual(history.map((entry) => [entry.month, entry.status, entry.amount]), [
    ["2026-10-01", "Deducted", 1500], ["2026-11-01", "Skipped", 1500], ["2026-12-01", "On Hold", 1500], ["2027-01-01", "Due", 1500], ["2027-02-01", "Due", 1500],
  ]);
  assert.deepEqual([history[0].paidOn, history[0].paymentMode], ["2026-11-10", "Bank Transfer"]);
  assert.deepEqual(recoveries.historyTotals(6000, history), { recovered: 1500, balance: 4500 });
});

test("each register answers its own history, under its own guard", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", ...parts), "utf8");
  assert.match(read("payroll-advance", "routes.js"), /router\.use\(requireModule\("HRM", "Payroll Advance"\)\);[\s\S]*router\.get\("\/:id\/history", controller\.history\);/);
  assert.match(read("payroll-recovery", "routes.js"), /router\.use\(requireModule\("HRM", "Payroll Recovery"\)\);[\s\S]*router\.get\("\/:id\/history", controller\.history\);/);
});

test("a history is refused for a record out of reach, and adds up what came back for one in it", async () => {
  const none = { payrollAdvance: { findFirst: async () => null }, payrollRecovery: { findFirst: async () => null } };
  await assert.rejects(advances.advanceHistory(5, [3], { client: none }), /This advance could not be found/);
  await assert.rejects(recoveries.recoveryHistory(5, [3], { client: none }), /This recovery could not be found/);
  const client = {
    payrollRecovery: { findFirst: async () => ({ id: 5, recoveryId: "RECO-ID-0005", employeeId: 17, totalAmount: 3000, startYear: 2026, startMonth: 10, months: 2 }) },
    payrollRecoverySkip: { findMany: async () => [] },
    payrollEntry: { findMany: async () => [{ year: 2026, month: 10, paymentStatus: "Paid", paymentDate: new Date("2026-11-10T00:00:00Z"), paymentMode: null }] },
  };
  const history = await recoveries.recoveryHistory(5, null, { client });
  assert.deepEqual(
    [history.recoveryId, history.monthlyDeduction, history.instalmentsDeducted, history.recovered, history.balance, history.history.map((entry) => entry.status)],
    ["RECO-ID-0005", 1500, 1, 1500, 1500, ["Deducted", "Due"]],
  );
});

test("a frozen month is settled: nothing is skipped in it, and nothing lands in it", async () => {
  const advanceRows = [{ id: 1, advanceId: "ADV-ID-0001", employeeId: 17, amount: 3000, deductYear: 2026, deductMonth: 10 }];
  let client = fakeClient({ advanceRows, entries: rowsFor([[2026, 10]], { frozen: true, salaryAdvance: 3000 }) });
  await assert.rejects(skips.skipDeduction(1, "advance", 9, { client }), /October 2026 payroll for this employee is frozen/);
  client = fakeClient({ advanceRows: [{ ...advanceRows[0], skips: [] }], entries: rowsFor([[2026, 10], [2026, 11]]) });
  at(client, 2026, 10).salaryAdvance = 3000;
  at(client, 2026, 11).frozen = true;
  await assert.rejects(skips.skipDeduction(1, "advance", 9, { client }), /November 2026 payroll for this employee is already on hold/);
});

test("Skip on an LOP policy breach moves its days too - and a paid month its days would change refuses it", async () => {
  const lop = () => [{ id: 3, policyBreachId: "PB-ID-0003", employeeId: 17, deductBy: "LOP", totalAmount: 0, totalDays: 10, startYear: 2026, startMonth: 10, months: 3 }];
  let client = fakeClient({ policyBreachRows: lop(), entries: rowsFor([[2026, 10], [2026, 11], [2026, 12], [2027, 1]], { policyBreachDeduction: 0, policyBreachLopDays: 0 }) });
  [[2026, 10, 3.5], [2026, 11, 3.5], [2026, 12, 3]].forEach(([year, month, days]) => { at(client, year, month).policyBreachLopDays = days; });
  const skipped = await skips.skipDeduction(1, "policy-breach", 9, { client });
  assert.deepEqual(skipped.items, [{ id: "PB-ID-0003", endDate: "2027-02-01" }]);
  // October takes nothing; each share moves a month on, the last landing in January.
  assert.deepEqual(client.entries.map((row) => row.policyBreachLopDays), [0, 3.5, 3.5, 3]);
  assert.deepEqual(client.entries.map((row) => row.policyBreachDeduction), [0, 0, 0, 0], "an LOP breach takes no amount");
  await skips.undoSkip(1, "policy-breach", 9, { client });
  assert.deepEqual(client.entries.map((row) => row.policyBreachLopDays), [3.5, 3.5, 3, 0]);
  // January already paid without these days: the skip would put 3 days into it, so it is refused.
  client = fakeClient({ policyBreachRows: lop(), entries: rowsFor([[2026, 10], [2026, 11], [2026, 12], [2027, 1]], { policyBreachDeduction: 0, policyBreachLopDays: 0 }) });
  [[2026, 10, 3.5], [2026, 11, 3.5], [2026, 12, 3]].forEach(([year, month, days]) => { at(client, year, month).policyBreachLopDays = days; });
  at(client, 2027, 1).paymentStatus = "Paid";
  await assert.rejects(skips.skipDeduction(1, "policy-breach", 9, { client }), /January 2027 payroll for this employee is already paid/);
});
