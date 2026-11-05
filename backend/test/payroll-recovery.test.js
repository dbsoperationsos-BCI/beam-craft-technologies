const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const service = require("../src/modules/hrm/payroll-recovery/service");
const { recoverySchema, removeSchema } = require("../src/modules/hrm/payroll-recovery/controller");
const { formatIdentifier, parseIdentifier } = require("../src/services/identifiers");

/*
 * HRM → Payroll → Recovery: only what is entered is stored; the monthly deduction, the start and end
 * dates and the status are worked out from it. The rows below are the studio's own sheet.
 */

test("the figures are worked out from what was entered, as the studio's sheet has them", () => {
  // [total, start month, start year, months] -> [monthly deduction, start date, end date]
  const sheet = [
    [7000, 6, 2026, 1, 7000, "2026-06-01", "2026-07-01"],
    [125000, 7, 2026, 25, 5000, "2026-07-01", "2028-08-01"],
    [20000, 7, 2026, 4, 5000, "2026-07-01", "2026-11-01"],
    [18000, 6, 2026, 6, 3000, "2026-06-01", "2026-12-01"],
    [26000, 6, 2026, 5, 5200, "2026-06-01", "2026-11-01"],
    [30000, 7, 2026, 3, 10000, "2026-07-01", "2026-10-01"],
  ];
  for (const [total, month, year, months, monthly, start, end] of sheet) {
    assert.equal(service.monthlyDeduction(total, months), monthly, `${total} over ${months}`);
    assert.equal(service.startDateOf(year, month), start);
    assert.equal(service.endDateOf(year, month, months), end);
  }
  // Rounded to the paisa, and a December start rolls into the next year.
  assert.equal(service.monthlyDeduction(10000, 3), 3333.33);
  assert.equal(service.endDateOf(2026, 12, 1), "2027-01-01");
});

test("a recovery is Completed once every instalment's payroll is Paid, Active until then - never by the calendar", () => {
  assert.equal(service.statusOf(5, 4), "Active");
  assert.equal(service.statusOf(5, 5), "Completed");
  const recovery = { id: 2, recoveryId: "RECO-ID-0002", employeeId: 17, totalAmount: 2500, startYear: 2026, startMonth: 10, months: 5 };
  const paidUpTo = (count) => new Set(["17:2026:10", "17:2026:11", "17:2026:12", "17:2027:1", "17:2027:2"].slice(0, count));
  // Past its end date with February not paid: still Active, 4 of 5 deducted.
  assert.deepEqual([service.toRow(recovery, paidUpTo(4)).status, service.toRow(recovery, paidUpTo(4)).instalmentsDeducted], ["Active", 4]);
  // February's payroll paid: Completed, whatever the date.
  assert.deepEqual([service.toRow(recovery, paidUpTo(5)).status, service.toRow(recovery, paidUpTo(5)).instalmentsDeducted], ["Completed", 5]);
  // A skipped month is passed over: the run's fifth instalment is March.
  const skipped = { ...recovery, skips: [{ year: 2026, month: 11 }] };
  assert.equal(service.toRow(skipped, new Set(["17:2026:10", "17:2026:11", "17:2026:12", "17:2027:1", "17:2027:2"])).status, "Active");
  // Today is still the studio's day in India, whatever zone the server runs in.
  assert.equal(service.todayInIndia(new Date("2026-10-07T20:00:00Z")), "2026-10-08");
});

test("the ID reads RECO-ID-0001 - the studio's own numbering, without the DBS mark", () => {
  assert.equal(formatIdentifier("PAYROLL_RECOVERY", {}, 1), "RECO-ID-0001");
  assert.equal(formatIdentifier("PAYROLL_RECOVERY", {}, 15), "RECO-ID-0015");
  // Every other scheme keeps its DBS mark.
  assert.equal(formatIdentifier("SPEAK_UP", {}, 1), "DBS-SPK-00001");
  // And it reads back, as the backfill and renumbering tools read every scheme.
  assert.deepEqual(parseIdentifier("PAYROLL_RECOVERY", "RECO-ID-0007"), { value: 7 });
  assert.equal(parseIdentifier("PAYROLL_RECOVERY", "DBS-RECO-ID-0007"), null);
});

test("a row reads the employee through the link, and carries the worked-out figures", () => {
  const row = service.toRow({
    id: 3, recoveryId: "RECO-ID-0003", employeeId: 17, totalAmount: "20000.00", startMonth: 7, startYear: 2026, months: 4,
    reason: "Salary advance", employee: { id: 17, employeeId: "DBS017", employeeName: "Kavya" },
  });
  assert.deepEqual(
    { employeeCode: row.employeeCode, employeeName: row.employeeName, totalAmount: row.totalAmount, monthlyDeduction: row.monthlyDeduction, startDate: row.startDate, endDate: row.endDate, status: row.status },
    { employeeCode: "DBS017", employeeName: "Kavya", totalAmount: 20000, monthlyDeduction: 5000, startDate: "2026-07-01", endDate: "2026-11-01", status: "Active" },
  );
});

/** A database just big enough for the service: one transaction, employees and recoveries. */
function fakeClient({ employees = [], recoveries = [], advances = [], entries = [] } = {}) {
  const sequences = new Map();
  const client = {
    recoveries,
    entries,
    payrollRecoverySkip: {
      findMany: async ({ where }) => recoveries.find((row) => row.id === where.recoveryId)?.skips || [],
      deleteMany: async ({ where }) => {
        const row = recoveries.find((entry) => entry.id === where.recoveryId);
        const before = (row?.skips || []).length;
        if (row) row.skips = (row.skips || []).filter((skip) => !(skip.year === where.year && skip.month === where.month));
        return { count: before - (row?.skips || []).length };
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
    payrollAdvance: {
      findMany: async ({ where }) => advances.filter((row) => row.convertedRecoveryId === where.convertedRecoveryId && !row.deletedAt),
    },
    $transaction: async (work) => work(client),
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
    payrollRecovery: {
      findFirst: async ({ where }) => recoveries.find((row) => row.id === where.id && !row.deletedAt
        && (!where.employee?.branchId || where.employee.branchId.in.includes(row.employee?.branchId))) || null,
      findMany: async ({ where }) => recoveries.filter((row) => row.employeeId === where.employeeId && !row.deletedAt),
      updateMany: async ({ where, data }) => {
        const row = recoveries.find((entry) => entry.id === where.id && !entry.deletedAt
          && (!where.employee?.branchId || where.employee.branchId.in.includes(entry.employee?.branchId)));
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      create: async ({ data }) => {
        const row = { id: recoveries.length + 1, ...data, employee: employees.find((employee) => employee.id === data.employeeId) };
        recoveries.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = recoveries.find((entry) => entry.id === where.id);
        Object.assign(row, data, data.employeeId ? { employee: employees.find((employee) => employee.id === data.employeeId) } : {});
        return row;
      },
    },
  };
  return client;
}
const statuses = async () => ["Active"];
const kavya = { id: 17, employeeId: "DBS017", employeeName: "Kavya", working: true, branchId: 1 };
const left = { id: 9, employeeId: "DBS009", employeeName: "Left", working: false, branchId: 1 };
const arun = { id: 30, employeeId: "DBS030", employeeName: "Arun", working: true, branchId: 3 };
const input = { employeeId: 17, totalAmount: 20000, startMonth: 7, startYear: 2026, months: 4, reason: "Salary advance" };

test("creating mints the next RECO-ID and stores only what was entered", async () => {
  const client = fakeClient({ employees: [kavya] });
  const first = await service.createRecovery(input, 2, { client, statuses });
  const second = await service.createRecovery({ ...input, months: 2 }, 2, { client, statuses });
  assert.equal(first.recoveryId, "RECO-ID-0001");
  assert.equal(second.recoveryId, "RECO-ID-0002");
  assert.equal(first.employeeCode, "DBS017");
  const stored = client.recoveries[0];
  assert.deepEqual(Object.keys(stored).filter((key) => /monthly|endDate|status/i.test(key)), [], "nothing worked out is stored");
  assert.equal(stored.createdById, 2);
});

test("a recovery names a working employee - except one it already names, which an edit may keep", async () => {
  const client = fakeClient({ employees: [kavya, left] });
  await assert.rejects(service.createRecovery({ ...input, employeeId: 9 }, 2, { client, statuses }), /still working here/);
  client.recoveries.push({ id: 1, recoveryId: "RECO-ID-0001", ...input, employeeId: 9, employee: left });
  const corrected = await service.updateRecovery(1, { ...input, employeeId: 9, months: 5 }, 2, { client, statuses });
  assert.equal(corrected.months, 5);
  assert.equal(corrected.recoveryId, "RECO-ID-0001", "the ID never changes");
});

test("removing keeps the row, with who removed it and why; a removed one cannot be edited", async () => {
  const client = fakeClient({ employees: [kavya] });
  await service.createRecovery(input, 2, { client, statuses });
  await service.removeRecovery(1, "Entered twice", 2, { client });
  assert.ok(client.recoveries[0].deletedAt);
  assert.equal(client.recoveries[0].deleteReason, "Entered twice");
  await assert.rejects(service.updateRecovery(1, input, 2, { client, statuses }), /could not be found/);
  // Removing it again finds nothing - the one conditional write cannot land twice.
  await assert.rejects(service.removeRecovery(1, "Again", 2, { client }), /could not be found/);
  assert.equal(client.recoveries[0].deleteReason, "Entered twice");
});

test("a recovery converted from advances stays with its employee and is removed only by undoing the conversion", async () => {
  const client = fakeClient({ employees: [kavya, arun], advances: [{ id: 5, advanceId: "ADV-ID-0005", convertedRecoveryId: 1 }] });
  await service.createRecovery(input, 2, { client, statuses });
  await assert.rejects(service.removeRecovery(1, "Not needed", 2, { client }), /converted from ADV-ID-0005\. Undo the conversion instead/);
  assert.equal(client.recoveries[0].deletedAt, undefined);
  await assert.rejects(service.updateRecovery(1, { ...input, employeeId: arun.id }, 2, { client, statuses }), /its employee and total stay theirs/);
  await assert.rejects(service.updateRecovery(1, { ...input, totalAmount: Number(input.totalAmount) + 1 }, 2, { client, statuses }), /its employee and total stay theirs/);
  // Its months can move - across unpaid months only, the payroll following.
  await service.updateRecovery(1, { ...input, months: 6 }, 2, { client, statuses });
  assert.equal(client.recoveries[0].months, 6);
  assert.deepEqual(service.toRow({ ...client.recoveries[0], convertedAdvances: [{ advanceId: "ADV-ID-0005" }] }).advanceIds, ["ADV-ID-0005"]);
});

test("moving a converted recovery's months re-totals the unpaid payroll, and never crosses a paid month", async () => {
  const start = { year: input.startYear, month: input.startMonth };
  const monthAfter = (offset) => { const index = (start.year * 12) + (start.month - 1) + offset; return { year: Math.floor(index / 12), month: (index % 12) + 1 }; };
  const entries = [0, 1, 2, 3, 4, 5, 6, 7].map((offset) => ({ employeeId: kavya.id, ...monthAfter(offset), paymentStatus: "Pending", recoveryDeduction: 0 }));
  const client = fakeClient({ employees: [kavya], advances: [{ id: 5, advanceId: "ADV-ID-0005", convertedRecoveryId: 1 }], entries });
  await service.createRecovery({ ...input, months: 2 }, 2, { client, statuses });
  // Two months later and over one more: the old run's months lose it, the new run's take it.
  const moved = monthAfter(2);
  await service.updateRecovery(1, { ...input, startYear: moved.year, startMonth: moved.month, months: 3 }, 2, { client, statuses });
  const per = Math.round((Number(input.totalAmount) / 3) * 100) / 100;
  assert.deepEqual(entries.map((entry) => entry.recoveryDeduction), [0, 0, per, per, per, 0, 0, 0]);
  // A paid month in either run stops the move.
  entries[3].paymentStatus = "Paid";
  await assert.rejects(service.updateRecovery(1, { ...input, startYear: monthAfter(5).year, startMonth: monthAfter(5).month, months: 3 }, 2, { client, statuses }), /already paid or frozen, so RECO-ID-0001's months can't move across it/);
});

test("a recovery never newly covers a month already paid - that payroll never took its instalment", async () => {
  const start = { year: input.startYear, month: input.startMonth };
  const entries = [{ employeeId: kavya.id, ...start, paymentStatus: "Paid" }];
  const client = fakeClient({ employees: [kavya], entries });
  await assert.rejects(service.createRecovery(input, 2, { client, statuses }), /already paid or frozen, so a recovery can't take an instalment from it/);
  assert.equal(client.recoveries.length, 0);
  // Started a month later it is fine - and moving it back over the paid month is refused.
  const later = start.month === 12 ? { startYear: start.year + 1, startMonth: 1 } : { startYear: start.year, startMonth: start.month + 1 };
  await service.createRecovery({ ...input, ...later }, 2, { client, statuses });
  await assert.rejects(service.updateRecovery(1, input, 2, { client, statuses }), /already paid/);
  // Its own reason can still be corrected.
  await service.updateRecovery(1, { ...input, ...later, reason: "Corrected" }, 2, { client, statuses });
  assert.equal(client.recoveries[0].reason, "Corrected");
});

test("correcting a recovery's run clears the skips it no longer covers, so they never wake later", async () => {
  const client = fakeClient({ employees: [kavya] });
  await service.createRecovery({ ...input, months: 3 }, 2, { client, statuses });
  const inside = { year: input.startYear, month: input.startMonth };
  const later = { year: input.startYear + 1, month: input.startMonth };
  client.recoveries[0].skips = [inside, later];
  await service.updateRecovery(1, { ...input, months: 3 }, 2, { client, statuses });
  assert.deepEqual(client.recoveries[0].skips, [inside]);
});

test("branch reach belongs to the permission: a reader limited to a branch reaches only its employees", async () => {
  const client = fakeClient({ employees: [kavya, arun] });
  // Branch 1 only: Kavya (branch 1) may be named, Arun (branch 3) may not.
  await service.createRecovery(input, 2, { client, reach: [1], statuses });
  await assert.rejects(service.createRecovery({ ...input, employeeId: 30 }, 2, { client, reach: [1], statuses }), /still working here/);
  await service.createRecovery({ ...input, employeeId: 30 }, 2, { client, reach: null, statuses });
  // A recovery outside the reach is not there to correct or remove.
  await assert.rejects(service.updateRecovery(2, { ...input, employeeId: 30 }, 2, { client, reach: [1], statuses }), /could not be found/);
  await assert.rejects(service.removeRecovery(2, "No", 2, { client, reach: [1] }), /could not be found/);
  // The reach is asked of the permission, not of the person.
  let asked = null;
  await service.reachFor(5, { reachableBranchIds: async (userId, scope) => { asked = { userId, scope }; return [1]; } });
  assert.deepEqual(asked, { userId: 5, scope: { module: "HRM", feature: "Payroll Recovery" } });
  // And the register and the form's employees are narrowed by it.
  const SERVICE = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "payroll-recovery", "service.js"), "utf8");
  assert.match(SERVICE, /where: \{ deletedAt: null, \.\.\.\(reach \? \{ employee: employeeInReach\(reach\) \} : \{\}\) \}/);
  assert.match(SERVICE, /employmentStatus: \{ in: await statuses\(\) \}, \.\.\.employeeInReach\(reach\) \}/);
});

test("the guard refuses: no grant is a 403 on reading, Read alone is a 403 on every write", async () => {
  const iamService = require("../src/services/iam.service");
  const router = require("../src/modules/hrm/payroll-recovery/routes");
  const guard = router.stack.find((layer) => !layer.route && layer.handle.name !== "protect" && layer.handle.length === 3 && layer !== router.stack[0]).handle;
  const original = iamService.hasPermission;
  const answer = async (method, held) => {
    iamService.hasPermission = async (userId, module, feature, level) => module === "HRM" && feature === "Payroll Recovery"
      && (held === "READ_WRITE" || (held === "READ" && level === "READ"));
    let code = 200;
    let passed = false;
    const res = { status(value) { code = value; return this; }, json() { return this; } };
    await guard({ method, user: { id: 7 } }, res, () => { passed = true; });
    return passed ? "next" : code;
  };
  try {
    assert.equal(await answer("GET", null), 403);
    assert.equal(await answer("GET", "READ"), "next");
    for (const method of ["POST", "PUT", "DELETE"]) {
      assert.equal(await answer(method, "READ"), 403, method);
      assert.equal(await answer(method, "READ_WRITE"), "next", method);
    }
  } finally {
    iamService.hasPermission = original;
  }
});

test("what the form may send: a positive total, a real month, 1 to 60 months; removing needs a reason", () => {
  assert.equal(recoverySchema.safeParse(input).success, true);
  for (const bad of [{ totalAmount: 0 }, { startMonth: 13 }, { months: 0 }, { months: 61 }, { employeeId: null }]) {
    assert.equal(recoverySchema.safeParse({ ...input, ...bad }).success, false, JSON.stringify(bad));
  }
  assert.equal(removeSchema.safeParse({}).success, false);
  assert.equal(removeSchema.safeParse({ reason: "Duplicate" }).success, true);
});

test("the routes answer for their own permission, which ships in the catalogue and a migration for SUPER_ADMIN only", () => {
  const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
  assert.match(read("src", "modules", "hrm", "payroll-recovery", "routes.js"), /router\.use\(protect\);[\s\S]*router\.use\(requireModule\("HRM", "Payroll Recovery"\)\);/);
  assert.match(read("src", "server.js"), /app\.use\("\/api\/hrm\/payroll-recoveries", hrmPayrollRecoveryRoutes\);/);
  const catalogue = read("prisma", "seeds", "permission-catalogue.js");
  assert.match(catalogue, /feature: "Payroll Recovery",\s+level: "PAYROLL_RECOVERY"/);
  const migration = read("prisma", "migrations", "20261008230000_hrm_payroll_recovery", "migration.sql");
  assert.match(migration, /'HRM', 'Payroll Recovery', 'PAYROLL_RECOVERY'/);
  assert.match(migration, /WHERE `role`\.`name` = 'SUPER_ADMIN'/);
  assert.doesNotMatch(migration, /DROP TABLE|ALTER TABLE `(?!payroll_recovery)/, "nothing but the new table and its permission");
});
