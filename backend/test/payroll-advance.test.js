const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const service = require("../src/modules/hrm/payroll-advance/service");
const { advanceSchema, removeSchema, convertSchema } = require("../src/modules/hrm/payroll-advance/controller");
const { formatIdentifier, parseIdentifier } = require("../src/services/identifiers");

/*
 * HRM → Payroll → Advance Salary: an amount paid ahead of salary, taken back in full from one
 * month's payroll - and that month's row on the Main Page follows every change to it.
 */

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");

test("an advance is Pending until the payroll it comes off is Paid, Deducted from then - never by the calendar", () => {
  assert.equal(service.statusOf(false), "Pending");
  assert.equal(service.statusOf(true), "Deducted");
  const advance = { id: 2, advanceId: "ADV-ID-0002", employeeId: 17, amount: 1000, deductYear: 2026, deductMonth: 10, advanceDate: new Date("2026-09-20T00:00:00Z") };
  // October has begun, but its payroll is not paid: still Pending.
  assert.equal(service.toRow(advance, new Set()).status, "Pending");
  assert.equal(service.toRow(advance, new Set(["17:2026:9"])).status, "Pending", "another month's payroll paid changes nothing");
  // October's payroll marked Paid: Deducted.
  assert.equal(service.toRow(advance, new Set(["17:2026:10"])).status, "Deducted");
  // Skipped in October, it comes off November: October paid no longer counts.
  assert.equal(service.toRow({ ...advance, skips: [{ year: 2026, month: 10 }] }, new Set(["17:2026:10"])).status, "Pending");
});

test("a month takes back every live advance due in it, and names them", () => {
  const advances = [
    { advanceId: "ADV-ID-0001", amount: "3000.00", deductYear: 2026, deductMonth: 10 },
    { advanceId: "ADV-ID-0002", amount: "1500.50", deductYear: 2026, deductMonth: 10 },
    { advanceId: "ADV-ID-0003", amount: "9999", deductYear: 2026, deductMonth: 11 },
    { advanceId: "ADV-ID-0004", amount: "500", deductYear: 2026, deductMonth: 10, deletedAt: new Date() },
  ];
  assert.deepEqual(service.advanceDueIn(2026, 10, advances), { amount: 4500.5, advanceIds: ["ADV-ID-0001", "ADV-ID-0002"] });
  assert.deepEqual(service.advanceDueIn(2026, 12, advances), { amount: 0, advanceIds: [] });
});

test("the ID reads ADV-ID-0001 - numbered the way recoveries are, without the DBS mark", () => {
  assert.equal(formatIdentifier("PAYROLL_ADVANCE", {}, 1), "ADV-ID-0001");
  assert.equal(formatIdentifier("PAYROLL_ADVANCE", {}, 42), "ADV-ID-0042");
  assert.deepEqual(parseIdentifier("PAYROLL_ADVANCE", "ADV-ID-0007"), { value: 7 });
});

test("a row reads the employee through the link", () => {
  const row = service.toRow({
    id: 2, advanceId: "ADV-ID-0002", employeeId: 17, advanceDate: new Date("2026-10-05T00:00:00Z"), amount: "5000.00",
    deductMonth: 11, deductYear: 2026, reason: "Medical", employee: { id: 17, employeeId: "DBS017", employeeName: "Kavya" },
  });
  assert.deepEqual(
    { employeeCode: row.employeeCode, employeeName: row.employeeName, advanceDate: row.advanceDate, amount: row.amount, status: row.status },
    { employeeCode: "DBS017", employeeName: "Kavya", advanceDate: "2026-10-05", amount: 5000, status: "Pending" },
  );
});

/** A database just big enough for the service: employees, advances and payroll rows. */
function fakeClient({ employees = [], advances = [], entries = [], recoveries = [] } = {}) {
  const sequences = new Map();
  const inReach = (row, where) => !where.employee?.branchId || where.employee.branchId.in.includes(row.employee?.branchId);
  // A Prisma `where` of plain fields, `{ in }` lists, nulls and the employee's branch.
  const matches = (row, where = {}) => Object.entries(where).every(([key, want]) => {
    if (key === "employee") return inReach(row, where);
    if (want && typeof want === "object" && "in" in want) return want.in.includes(row[key]);
    if (want === null) return row[key] == null;
    return row[key] === want;
  });
  const client = {
    advances,
    entries,
    recoveries,
    // Skips sit on their advance or recovery, as the services read them back.
    payrollAdvanceSkip: {
      deleteMany: async ({ where }) => {
        const row = advances.find((entry) => entry.id === where.advanceId);
        const count = (row?.skips || []).length;
        if (row) row.skips = [];
        return { count };
      },
    },
    payrollRecoverySkip: {
      findMany: async ({ where }) => recoveries.find((row) => row.id === where.recoveryId)?.skips || [],
    },
    payrollRecovery: {
      create: async ({ data }) => {
        const row = { id: recoveries.length + 1, ...data, employee: employees.find((employee) => employee.id === data.employeeId) };
        recoveries.push(row);
        return row;
      },
      findFirst: async ({ where }) => recoveries.find((row) => matches(row, where)) || null,
      findMany: async ({ where }) => recoveries.filter((row) => matches(row, where)),
      updateMany: async ({ where, data }) => {
        const rows = recoveries.filter((row) => matches(row, where));
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
    },
    $transaction: async (work) => work(client),
    $queryRaw: async () => [],
    appSequence: {
      upsert: async ({ where }) => {
        const next = (sequences.get(where.key) || 0) + 1;
        sequences.set(where.key, next);
        return { key: where.key, currentValue: next };
      },
    },
    employee: {
      findFirst: async ({ where }) => employees.find((employee) => employee.id === where.id && employee.working
        && (!where.branchId || where.branchId.in.includes(employee.branchId))) || null,
    },
    payrollAdvance: {
      findFirst: async ({ where }) => advances.find((row) => row.id === where.id && !row.deletedAt && inReach(row, where)) || null,
      findMany: async ({ where }) => advances.filter((row) => matches(row, where)),
      updateMany: async ({ where, data }) => {
        const rows = advances.filter((row) => matches(row, where));
        rows.forEach((row) => Object.assign(row, data, data.employeeId ? { employee: employees.find((employee) => employee.id === data.employeeId) } : {}));
        return { count: rows.length };
      },
      create: async ({ data }) => {
        const row = { id: advances.length + 1, ...data, employee: employees.find((employee) => employee.id === data.employeeId) };
        advances.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = advances.find((entry) => entry.id === where.id);
        Object.assign(row, data, data.employeeId ? { employee: employees.find((employee) => employee.id === data.employeeId) } : {});
        return row;
      },
    },
    payrollEntry: {
      findMany: async ({ where }) => entries.filter((row) => where.employeeId.in.includes(row.employeeId) && row.paymentStatus === where.paymentStatus),
      findFirst: async ({ where }) => entries.find((row) => row.employeeId === where.employeeId && row.year === where.year
        && row.month === where.month && (where.OR ? where.OR.some((either) => (either.paymentStatus && row.paymentStatus === either.paymentStatus) || (either.frozen && row.frozen)) : row.paymentStatus === where.paymentStatus)) || null,
      updateMany: async ({ where, data }) => {
        const rows = entries.filter((row) => row.employeeId === where.employeeId && row.year === where.year && row.month === where.month
          && row.paymentStatus !== where.paymentStatus.not && !(where.frozen === false && row.frozen));
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
    },
  };
  return client;
}
const statuses = async () => ["Active"];
const kavya = { id: 17, employeeId: "DBS017", employeeName: "Kavya", working: true, branchId: 1 };
const arun = { id: 30, employeeId: "DBS030", employeeName: "Arun", working: true, branchId: 3 };
const input = { advanceDate: "2026-10-05", employeeId: 17, amount: 3000, deductMonth: 10, deductYear: 2026, reason: "Festival" };

test("creating mints the next ADV-ID and hands the month's unpaid payroll row its Salary Advance", async () => {
  const client = fakeClient({ employees: [kavya], entries: [{ id: 1, employeeId: 17, year: 2026, month: 10, paymentStatus: "Pending", salaryAdvance: 0 }] });
  const first = await service.createAdvance(input, 2, { client, statuses });
  await service.createAdvance({ ...input, amount: 1500 }, 2, { client, statuses });
  assert.equal(first.advanceId, "ADV-ID-0001");
  assert.equal(client.advances[1].advanceId, "ADV-ID-0002");
  assert.equal(client.entries[0].salaryAdvance, 4500, "both advances due in October");
  assert.equal(client.advances[0].createdById, 2);
});

test("moving an advance to another month takes it off the first and onto the second", async () => {
  const client = fakeClient({
    employees: [kavya],
    entries: [
      { id: 1, employeeId: 17, year: 2026, month: 10, paymentStatus: "Pending", salaryAdvance: 0 },
      { id: 2, employeeId: 17, year: 2026, month: 11, paymentStatus: "On Hold", salaryAdvance: 0 },
    ],
  });
  await service.createAdvance(input, 2, { client, statuses });
  const moved = await service.updateAdvance(1, { ...input, deductMonth: 11 }, 2, { client, statuses });
  assert.equal(moved.advanceId, "ADV-ID-0001", "the ID never changes");
  assert.deepEqual(client.entries.map((row) => row.salaryAdvance), [0, 3000]);
  // Removing it takes it off the month too, and keeps the row with who and why.
  await service.removeAdvance(1, "Paid back in cash", 2, { client });
  assert.equal(client.entries[1].salaryAdvance, 0);
  assert.equal(client.advances[0].deleteReason, "Paid back in cash");
  await assert.rejects(service.removeAdvance(1, "Again", 2, { client }), /could not be found/);
});

test("a month already paid is settled: no advance is recorded into, moved out of or removed from it", async () => {
  const client = fakeClient({ employees: [kavya], entries: [{ id: 1, employeeId: 17, year: 2026, month: 10, paymentStatus: "Paid", salaryAdvance: 2000 }] });
  await assert.rejects(service.createAdvance(input, 2, { client, statuses }), /October 2026 payroll for this employee is already paid/);
  client.advances.push({ id: 1, advanceId: "ADV-ID-0001", ...input, advanceDate: new Date("2026-10-05T00:00:00Z"), employee: kavya });
  await assert.rejects(service.updateAdvance(1, { ...input, deductMonth: 11 }, 2, { client, statuses }), /already paid/);
  await assert.rejects(service.removeAdvance(1, "No", 2, { client }), /already paid/);
  assert.equal(client.entries[0].salaryAdvance, 2000, "the paid row is untouched");
});

test("a month marked Paid between the check and the write refuses the change rather than skipping it", async () => {
  const client = fakeClient({ employees: [kavya], entries: [{ id: 1, employeeId: 17, year: 2026, month: 10, paymentStatus: "Pending", salaryAdvance: 0 }] });
  const original = client.payrollEntry.updateMany;
  client.payrollEntry.updateMany = async (args) => { client.entries[0].paymentStatus = "Paid"; return original(args); };
  await assert.rejects(service.createAdvance(input, 2, { client, statuses }), /already paid/);
  assert.equal(client.entries[0].salaryAdvance, 0);
});

test("branch reach belongs to the permission: a reader limited to a branch reaches only its employees", async () => {
  const client = fakeClient({ employees: [kavya, arun] });
  await service.createAdvance(input, 2, { client, reach: [1], statuses });
  await assert.rejects(service.createAdvance({ ...input, employeeId: 30 }, 2, { client, reach: [1], statuses }), /still working here/);
  await service.createAdvance({ ...input, employeeId: 30 }, 2, { client, reach: null, statuses });
  await assert.rejects(service.updateAdvance(2, { ...input, employeeId: 30 }, 2, { client, reach: [1], statuses }), /could not be found/);
  await assert.rejects(service.removeAdvance(2, "No", 2, { client, reach: [1] }), /could not be found/);
  let asked = null;
  await service.reachFor(5, { reachableBranchIds: async (userId, scope) => { asked = { userId, scope }; return [1]; } });
  assert.deepEqual(asked, { userId: 5, scope: { module: "HRM", feature: "Payroll Advance" } });
});

/** Kavya's October and November advances, with her October to January payroll rows. */
async function twoAdvances() {
  const entries = [10, 11, 12].map((month, index) => ({ id: index + 1, employeeId: 17, year: 2026, month, paymentStatus: "Pending", salaryAdvance: 0, recoveryDeduction: 0 }));
  entries.push({ id: 4, employeeId: 17, year: 2027, month: 1, paymentStatus: "Pending", salaryAdvance: 0, recoveryDeduction: 0 });
  const client = fakeClient({ employees: [kavya, arun], entries });
  await service.createAdvance(input, 2, { client, statuses });
  await service.createAdvance({ ...input, amount: 1500, deductMonth: 11 }, 2, { client, statuses });
  return client;
}
const conversion = { advanceIds: [1, 2], startYear: 2026, startMonth: 11, months: 3, reason: "Spread over three months" };
const row = (client, month, year = 2026) => client.entries.find((entry) => entry.year === year && entry.month === month);

test("Convert to Recovery turns one employee's advances into one recovery, and moves the payroll with it", async () => {
  const client = await twoAdvances();
  assert.deepEqual([row(client, 10).salaryAdvance, row(client, 11).salaryAdvance], [3000, 1500]);
  const result = await service.convertToRecovery(conversion, 2, { client, statuses });
  assert.deepEqual(result.advanceIds, ["ADV-ID-0001", "ADV-ID-0002"]);
  assert.deepEqual(
    { recoveryId: result.recovery.recoveryId, totalAmount: result.recovery.totalAmount, monthlyDeduction: result.recovery.monthlyDeduction, advanceIds: result.recovery.advanceIds },
    { recoveryId: "RECO-ID-0001", totalAmount: 4500, monthlyDeduction: 1500, advanceIds: ["ADV-ID-0001", "ADV-ID-0002"] },
  );
  assert.deepEqual(client.advances.map((advance) => advance.convertedRecoveryId), [1, 1]);
  // The advances leave their own months, and the recovery takes November to January instead.
  assert.deepEqual(client.entries.map((entry) => [entry.month, entry.salaryAdvance, entry.recoveryDeduction]), [[10, 0, 0], [11, 0, 1500], [12, 0, 1500], [1, 0, 1500]]);
  // They are the recovery's now: off this register, never deducted in their own month again, nor changed or converted twice.
  assert.deepEqual(await service.listAdvances(null, { client }), []);
  assert.deepEqual(service.advanceDueIn(2026, 10, client.advances), { amount: 0, advanceIds: [] });
  await assert.rejects(service.updateAdvance(1, input, 2, { client, statuses }), /converted to a recovery\. Undo the conversion on Payroll → Recovery first/);
  await assert.rejects(service.removeAdvance(1, "Twice", 2, { client }), /converted to a recovery/);
  await assert.rejects(service.convertToRecovery(conversion, 2, { client, statuses }), /already converted/);
});

test("converting is refused across employees, from a paid month, or into a paid month - and nothing changes", async () => {
  let client = await twoAdvances();
  await service.createAdvance({ ...input, employeeId: arun.id }, 2, { client, statuses });
  await assert.rejects(service.convertToRecovery({ ...conversion, advanceIds: [1, 3] }, 2, { client, statuses }), /one employee/);
  client = await twoAdvances();
  row(client, 10).paymentStatus = "Paid";
  // A recovery may not take an instalment from a paid month...
  await assert.rejects(service.convertToRecovery({ ...conversion, advanceIds: [2], startMonth: 10 }, 2, { client, statuses }), /October 2026 payroll for this employee is already paid/);
  assert.equal(client.recoveries.length, 0);
  assert.equal(client.advances[1].convertedRecoveryId, undefined);
  // ...and an advance whose own month is paid already came back.
  await assert.rejects(service.convertToRecovery(conversion, 2, { client, statuses }), /ADV-ID-0001 was already taken back in the October 2026 payroll/);
});

test("converting answers for both reaches: the advances through Advance, the employee through Recovery", async () => {
  const client = await twoAdvances();
  await assert.rejects(service.convertToRecovery(conversion, 2, { client, statuses, reach: [3] }), /could not be found/);
  await assert.rejects(service.convertToRecovery(conversion, 2, { client, statuses, reach: [1], recoveryReach: [3] }), /A recovery can't be raised for this employee/);
  assert.equal(client.recoveries.length, 0);
});

test("undoing answers for both reaches too: a foreign advance or recovery is not there", async () => {
  const client = await twoAdvances();
  await service.convertToRecovery(conversion, 2, { client, statuses });
  // Undo is the recovery's: it must be in Recovery reach, and every advance in it in Advance reach.
  await assert.rejects(service.undoConversion(1, 5, { client, reach: [3] }), /This recovery could not be found/);
  await assert.rejects(service.undoConversion(1, 5, { client, recoveryReach: [3] }), /This recovery could not be found/);
  assert.equal(client.recoveries[0].deletedAt, undefined);
});

test("undoing is refused once an advance's own month is paid", async () => {
  const client = await twoAdvances();
  await service.convertToRecovery({ ...conversion, startMonth: 12, months: 1 }, 2, { client, statuses });
  row(client, 10).paymentStatus = "Paid";
  await assert.rejects(service.undoConversion(1, 5, { client }), /October 2026 payroll is already paid or frozen, so its advances can't go back to it/);
});

test("two conversions at once cannot both take an advance, nor can an edit change one under a conversion", async () => {
  let client = await twoAdvances();
  // Another conversion took one of them between the read and the write.
  const original = client.payrollAdvance.updateMany;
  client.payrollAdvance.updateMany = async (args) => { if (args.data.convertedRecoveryId) client.advances[1].convertedRecoveryId = 99; return original(args); };
  await assert.rejects(service.convertToRecovery(conversion, 2, { client, statuses }), /changed while you were working/);
  client = await twoAdvances();
  // An edit landed after the read: the re-read under the write's lock finds a different amount.
  const read = client.payrollAdvance.findMany;
  let first = true;
  client.payrollAdvance.findMany = async (args) => {
    const rows = await read(args);
    if (first && args.where.id) { first = false; return rows.map((entry) => ({ ...entry })); }
    return rows;
  };
  const write = client.payrollAdvance.updateMany;
  client.payrollAdvance.updateMany = async (args) => { if (args.data.convertedRecoveryId) client.advances[0].amount = 9999; return write(args); };
  await assert.rejects(service.convertToRecovery(conversion, 2, { client, statuses }), /changed while you were working/);
  // And an edit after a conversion finds the advance taken.
  client = await twoAdvances();
  await service.convertToRecovery(conversion, 2, { client, statuses });
  client.advances[0].convertedRecoveryId = 1;
  await assert.rejects(service.updateAdvance(1, input, 2, { client, statuses }), /converted to a recovery/);
});

test("converting is refused at the route to somebody without Recovery Read / Write", async () => {
  const iamService = require("../src/services/iam.service");
  const router = require("../src/modules/hrm/payroll-advance/routes");
  const route = router.stack.find((layer) => layer.route?.path === "/convert-to-recovery").route;
  const guard = route.stack[0].handle;
  const original = iamService.hasPermission;
  const answer = async (held) => {
    iamService.hasPermission = async (userId, module, feature, level) => module === "HRM" && held.includes(`${feature}:${level}`);
    let code = 200;
    let passed = false;
    const res = { status(value) { code = value; return this; }, json() { return this; } };
    await guard({ method: "POST", user: { id: 7 } }, res, () => { passed = true; });
    return passed ? "next" : code;
  };
  try {
    assert.equal(await answer(["Payroll Advance:READ_WRITE"]), 403);
    assert.equal(await answer(["Payroll Advance:READ_WRITE", "Payroll Recovery:READ"]), 403);
    assert.equal(await answer(["Payroll Advance:READ_WRITE", "Payroll Recovery:READ_WRITE"]), "next");
  } finally {
    iamService.hasPermission = original;
  }
});

test("undoing a conversion removes the recovery and hands each advance back to its own month", async () => {
  const client = await twoAdvances();
  await service.convertToRecovery(conversion, 2, { client, statuses });
  const undone = await service.undoConversion(1, 5, { client });
  assert.deepEqual(undone, { recoveryId: "RECO-ID-0001", advanceIds: ["ADV-ID-0001", "ADV-ID-0002"] });
  assert.ok(client.recoveries[0].deletedAt);
  assert.equal(client.recoveries[0].deletedById, 5);
  assert.match(client.recoveries[0].deleteReason, /Conversion undone/);
  assert.deepEqual(client.advances.map((advance) => advance.convertedRecoveryId), [null, null]);
  assert.deepEqual(client.entries.map((entry) => [entry.month, entry.salaryAdvance, entry.recoveryDeduction]), [[10, 3000, 0], [11, 1500, 0], [12, 0, 0], [1, 0, 0]]);
  // Back on this register, and the recovery gone - Pending, their months' payroll not paid.
  assert.deepEqual((await service.listAdvances(null, { client })).map((advance) => [advance.advanceId, advance.status]), [["ADV-ID-0001", "Pending"], ["ADV-ID-0002", "Pending"]]);
  // October's payroll marked Paid: the October advance reads Deducted on the list.
  row(client, 10).paymentStatus = "Paid";
  assert.deepEqual((await service.listAdvances(null, { client })).map((advance) => advance.status), ["Deducted", "Pending"]);
  await assert.rejects(service.undoConversion(1, 5, { client }), /This recovery could not be found/);
});

test("a conversion whose recovery has taken a paid instalment cannot be undone", async () => {
  const client = await twoAdvances();
  await service.convertToRecovery(conversion, 2, { client, statuses });
  row(client, 12).paymentStatus = "Paid";
  await assert.rejects(service.undoConversion(1, 5, { client }), /December 2026 payroll already took an instalment of RECO-ID-0001/);
  assert.equal(client.recoveries[0].deletedAt, undefined);
  assert.deepEqual(client.advances.map((advance) => advance.convertedRecoveryId), [1, 1]);
});

test("what the form may send: a real date, a positive amount, a real month; removing needs a reason", () => {
  assert.equal(advanceSchema.safeParse(input).success, true);
  for (const bad of [{ amount: 0 }, { deductMonth: 13 }, { advanceDate: "2026-02-31" }, { advanceDate: "" }, { employeeId: null }]) {
    assert.equal(advanceSchema.safeParse({ ...input, ...bad }).success, false, JSON.stringify(bad));
  }
  assert.equal(removeSchema.safeParse({}).success, false);
  assert.equal(removeSchema.safeParse({ reason: "Duplicate" }).success, true);
});

test("converting sends advances, a real start month and 1 to 60 months, and needs Recovery Read / Write as well", () => {
  assert.equal(convertSchema.safeParse(conversion).success, true);
  assert.equal(convertSchema.safeParse({ ...conversion, advanceIds: [] }).success, false);
  assert.equal(convertSchema.safeParse({ ...conversion, months: 0 }).success, false);
  assert.equal(convertSchema.safeParse({ ...conversion, months: 61 }).success, false);
  assert.equal(convertSchema.safeParse({ ...conversion, employeeId: 30 }).success, false, "the employee is the advances', never sent");
  const routes = read("src", "modules", "hrm", "payroll-advance", "routes.js");
  assert.match(routes, /const writesRecovery = checkPermission\("HRM", "Payroll Recovery", "READ_WRITE"\);/);
  assert.match(routes, /router\.use\(requireModule\("HRM", "Payroll Advance"\)\);[\s\S]*router\.post\("\/convert-to-recovery", writesRecovery, controller\.convertToRecovery\);/);
  // Undo is offered on the recovery: the Recovery router, asking for Advance Read / Write beside its own.
  assert.doesNotMatch(routes, /undo-conversion/);
  assert.match(read("src", "modules", "hrm", "payroll-recovery", "routes.js"), /router\.use\(requireModule\("HRM", "Payroll Recovery"\)\);[\s\S]*router\.post\("\/:id\/undo-conversion", checkPermission\("HRM", "Payroll Advance", "READ_WRITE"\), controller\.undoConversion\);/);
  // The register never reads a converted advance as one.
  assert.match(read("src", "modules", "hrm", "payroll-register", "service.js"), /const advanceSelect = \{ where: \{ deletedAt: null, convertedRecoveryId: null \}/);
  assert.match(read("prisma", "migrations", "20261009200000_hrm_payroll_advance_conversion", "migration.sql"), /FOREIGN KEY \(`converted_recovery_id`\) REFERENCES `payroll_recovery`\(`id`\) ON DELETE RESTRICT/);
});

test("the routes answer for their own permission, which ships in the catalogue and a migration for SUPER_ADMIN only", () => {
  assert.match(read("src", "modules", "hrm", "payroll-advance", "routes.js"), /router\.use\(protect\);[\s\S]*router\.use\(requireModule\("HRM", "Payroll Advance"\)\);/);
  assert.match(read("src", "server.js"), /app\.use\("\/api\/hrm\/payroll-advances", hrmPayrollAdvanceRoutes\);/);
  assert.match(read("prisma", "seeds", "permission-catalogue.js"), /feature: "Payroll Advance",\s+level: "PAYROLL_ADVANCE"/);
  const migration = read("prisma", "migrations", "20261009120000_hrm_payroll_advance", "migration.sql");
  assert.match(migration, /'HRM', 'Payroll Advance', 'PAYROLL_ADVANCE'/);
  assert.match(migration, /WHERE `role`\.`name` = 'SUPER_ADMIN'/);
  assert.doesNotMatch(migration, /DROP TABLE|ALTER TABLE `(?!payroll_advance)/, "nothing but the new table and its permission");
});

test("an advance is never recorded into, or moved into, a month whose payroll is frozen", async () => {
  const client = fakeClient({ employees: [kavya], entries: [{ id: 1, employeeId: 17, year: 2026, month: 10, paymentStatus: "Pending", frozen: true, salaryAdvance: 0 }] });
  await assert.rejects(service.createAdvance(input, 2, { client, statuses }), /October 2026 payroll for this employee is already paid or frozen/);
  assert.equal(client.entries[0].salaryAdvance, 0);
});
