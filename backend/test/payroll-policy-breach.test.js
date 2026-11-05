const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const service = require("../src/modules/hrm/payroll-policy-breach/service");
const { policyBreachSchema, removeSchema } = require("../src/modules/hrm/payroll-policy-breach/controller");
const { formatIdentifier, parseIdentifier } = require("../src/services/identifiers");

/*
 * HRM → Payroll → Policy Breach: a fine taken from salary over months, run exactly as a recovery is -
 * only what is entered is stored, and what each month takes is worked out from it. It is the Main
 * Page's Policy Breach Deduction, not its Policy Breach Leaves.
 */

const breach = { id: 1, policyBreachId: "PB-ID-0001", employeeId: 17, totalAmount: "3000.00", startYear: 2026, startMonth: 10, months: 3 };

test("each month of the run takes the amount over the months, passing over skipped months; removed ones take nothing", () => {
  assert.deepEqual(service.policyBreachDueIn(2026, 10, [breach]), { amount: 1000, lopDays: 0, policyBreachIds: ["PB-ID-0001"] });
  assert.deepEqual(service.policyBreachDueIn(2027, 1, [breach]), { amount: 0, lopDays: 0, policyBreachIds: [] });
  // Two at once add up.
  const second = { ...breach, id: 2, policyBreachId: "PB-ID-0002", totalAmount: 500, months: 1 };
  assert.deepEqual(service.policyBreachDueIn(2026, 10, [breach, second]), { amount: 1500, lopDays: 0, policyBreachIds: ["PB-ID-0001", "PB-ID-0002"] });
  // November skipped: nothing that month, and the run reaches January.
  const skipped = { ...breach, skips: [{ year: 2026, month: 11 }] };
  assert.equal(service.policyBreachDueIn(2026, 11, [skipped]).amount, 0);
  assert.equal(service.policyBreachDueIn(2027, 1, [skipped]).amount, 1000);
  assert.deepEqual(service.policyBreachSkippedIn(2026, 11, [skipped]), ["PB-ID-0001"]);
  assert.deepEqual(service.policyBreachDueIn(2026, 10, [{ ...breach, deletedAt: new Date() }]).amount, 0);
});

test("a row reads the employee through the link, and its figures and status are worked out", () => {
  const row = service.toRow({ ...breach, reason: "Late to shoot", employee: { id: 17, employeeId: "DBS017", employeeName: "Kavya" } }, new Set(["17:2026:10"]));
  assert.deepEqual(
    { policyBreachId: row.policyBreachId, employeeCode: row.employeeCode, employeeName: row.employeeName, totalAmount: row.totalAmount, monthlyDeduction: row.monthlyDeduction, startDate: row.startDate, endDate: row.endDate, status: row.status, instalmentsDeducted: row.instalmentsDeducted },
    { policyBreachId: "PB-ID-0001", employeeCode: "DBS017", employeeName: "Kavya", totalAmount: 3000, monthlyDeduction: 1000, startDate: "2026-10-01", endDate: "2027-01-01", status: "Active", instalmentsDeducted: 1 },
  );
  assert.equal(service.toRow(breach, new Set(["17:2026:10", "17:2026:11", "17:2026:12"])).status, "Completed");
});

test("the ID reads PB-ID-0001, numbered the way recoveries are", () => {
  assert.equal(formatIdentifier("PAYROLL_POLICY_BREACH", {}, 1), "PB-ID-0001");
  assert.deepEqual(parseIdentifier("PAYROLL_POLICY_BREACH", "PB-ID-0042"), { value: 42 });
});

/** A database just big enough for the service: one transaction, employees, policy breaches and payroll rows. */
function fakeClient({ employees = [], breaches = [], entries = [] } = {}) {
  const sequences = new Map();
  const inReach = (where, row) => !where.employee?.branchId || where.employee.branchId.in.includes(row.employee?.branchId);
  const client = {
    breaches,
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
    payrollEntry: {
      findMany: async ({ where }) => entries.filter((row) => where.employeeId.in.includes(row.employeeId) && row.paymentStatus === where.paymentStatus),
      findFirst: async ({ where }) => entries.find((row) => row.employeeId === where.employeeId && row.year === where.year && row.month === where.month
        && where.OR.some((either) => (either.paymentStatus && row.paymentStatus === either.paymentStatus) || (either.frozen && row.frozen))) || null,
    },
    payrollPolicyBreachSkip: {
      findMany: async ({ where }) => breaches.find((row) => row.id === where.policyBreachId)?.skips || [],
      deleteMany: async ({ where }) => {
        const row = breaches.find((entry) => entry.id === where.policyBreachId);
        if (row) row.skips = (row.skips || []).filter((skip) => !(skip.year === where.year && skip.month === where.month));
        return { count: 1 };
      },
    },
    payrollPolicyBreach: {
      findFirst: async ({ where }) => breaches.find((row) => row.id === where.id && !row.deletedAt && inReach(where, row)) || null,
      updateMany: async ({ where, data }) => {
        const row = breaches.find((entry) => entry.id === where.id && !entry.deletedAt && inReach(where, entry));
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      create: async ({ data }) => {
        const row = { id: breaches.length + 1, ...data, employee: employees.find((employee) => employee.id === data.employeeId) };
        breaches.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = breaches.find((entry) => entry.id === where.id);
        Object.assign(row, data, data.employeeId ? { employee: employees.find((employee) => employee.id === data.employeeId) } : {});
        return row;
      },
    },
  };
  return client;
}
const statuses = async () => ["Active"];
const kavya = { id: 17, employeeId: "DBS017", employeeName: "Kavya", working: true, branchId: 1 };
const arun = { id: 30, employeeId: "DBS030", employeeName: "Arun", working: true, branchId: 3 };
const input = { employeeId: 17, totalAmount: 3000, startMonth: 10, startYear: 2026, months: 3, reason: "Late to shoot" };

test("creating mints the next PB-ID and stores only what was entered", async () => {
  const client = fakeClient({ employees: [kavya] });
  const first = await service.createPolicyBreach(input, 2, { client, statuses });
  const second = await service.createPolicyBreach({ ...input, months: 1 }, 2, { client, statuses });
  assert.deepEqual([first.policyBreachId, second.policyBreachId], ["PB-ID-0001", "PB-ID-0002"]);
  assert.equal(first.monthlyDeduction, 1000);
  assert.deepEqual(Object.keys(client.breaches[0]).filter((key) => /monthly|endDate|status/i.test(key)), [], "nothing worked out is stored");
  assert.equal(client.breaches[0].createdById, 2);
});

test("a policy breach never newly covers a month already paid, and a correction clears skips it no longer covers", async () => {
  const client = fakeClient({ employees: [kavya], entries: [{ employeeId: 17, year: 2026, month: 10, paymentStatus: "Paid" }] });
  await assert.rejects(service.createPolicyBreach(input, 2, { client, statuses }), /already paid or frozen, so a policy breach can't take an instalment from it/);
  await service.createPolicyBreach({ ...input, startMonth: 11 }, 2, { client, statuses });
  await assert.rejects(service.updatePolicyBreach(1, input, 2, { client, statuses }), /already paid/);
  client.breaches[0].skips = [{ year: 2026, month: 12 }, { year: 2027, month: 6 }];
  await service.updatePolicyBreach(1, { ...input, startMonth: 11 }, 2, { client, statuses });
  assert.deepEqual(client.breaches[0].skips, [{ year: 2026, month: 12 }]);
});

test("removing keeps the row, with who removed it and why; branch reach belongs to the permission", async () => {
  const client = fakeClient({ employees: [kavya, arun] });
  await service.createPolicyBreach(input, 2, { client, reach: [1], statuses });
  await assert.rejects(service.createPolicyBreach({ ...input, employeeId: 30 }, 2, { client, reach: [1], statuses }), /still working here/);
  await service.createPolicyBreach({ ...input, employeeId: 30 }, 2, { client, statuses });
  await assert.rejects(service.removePolicyBreach(2, "No", 2, { client, reach: [1] }), /could not be found/);
  await service.removePolicyBreach(1, "Entered twice", 2, { client, reach: [1] });
  assert.equal(client.breaches[0].deleteReason, "Entered twice");
  await assert.rejects(service.removePolicyBreach(1, "Again", 2, { client }), /could not be found/);
  let asked = null;
  await service.reachFor(5, { reachableBranchIds: async (userId, scope) => { asked = { userId, scope }; return [1]; } });
  assert.deepEqual(asked, { userId: 5, scope: { module: "HRM", feature: "Payroll Policy Breach" } });
});

test("the guard refuses: no grant is a 403 on reading, Read alone is a 403 on every write", async () => {
  const iamService = require("../src/services/iam.service");
  const router = require("../src/modules/hrm/payroll-policy-breach/routes");
  const guard = router.stack.find((layer) => !layer.route && layer.handle.name !== "protect" && layer.handle.length === 3 && layer !== router.stack[0]).handle;
  const original = iamService.hasPermission;
  const answer = async (method, held) => {
    iamService.hasPermission = async (userId, module, feature, level) => module === "HRM" && feature === "Payroll Policy Breach"
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

test("what the form may send: a positive amount, a real month, 1 to 60 months; removing needs a reason", () => {
  assert.equal(policyBreachSchema.safeParse(input).success, true);
  for (const bad of [{ totalAmount: 0 }, { startMonth: 13 }, { months: 0 }, { months: 61 }, { employeeId: null }]) {
    assert.equal(policyBreachSchema.safeParse({ ...input, ...bad }).success, false, JSON.stringify(bad));
  }
  assert.equal(removeSchema.safeParse({}).success, false);
  assert.equal(removeSchema.safeParse({ reason: "Duplicate" }).success, true);
});

test("the routes answer for their own permission, which ships in the catalogue and a migration for SUPER_ADMIN only", () => {
  const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
  assert.match(read("src", "modules", "hrm", "payroll-policy-breach", "routes.js"), /router\.use\(protect\);[\s\S]*router\.use\(requireModule\("HRM", "Payroll Policy Breach"\)\);/);
  assert.match(read("src", "server.js"), /app\.use\("\/api\/hrm\/payroll-policy-breaches", hrmPayrollPolicyBreachRoutes\);/);
  assert.match(read("prisma", "seeds", "permission-catalogue.js"), /feature: "Payroll Policy Breach",\s+level: "PAYROLL_POLICY_BREACH"/);
  const migration = read("prisma", "migrations", "20261024120000_hrm_payroll_policy_breach", "migration.sql");
  assert.match(migration, /'HRM', 'Payroll Policy Breach', 'PAYROLL_POLICY_BREACH'/);
  assert.match(migration, /WHERE `role`\.`name` = 'SUPER_ADMIN'/);
  assert.doesNotMatch(migration, /DROP |ALTER TABLE `payroll_entry` (?!ADD COLUMN `policy_breach_deduction`)/, "only the new tables, the one column and the permission");
});
