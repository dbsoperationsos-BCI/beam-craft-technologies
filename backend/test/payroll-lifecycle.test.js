const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const service = require("../src/modules/hrm/payroll-register/service");

/*
 * The Payroll Main Page through an employee's life: a leaver's last, part month; a row removed that
 * stays removed; a salary that changed inside a cycle; and a late change to a closed month, waiting
 * for approval before it lands in the next open one.
 */

const day = (iso) => new Date(`${iso}T00:00:00.000Z`);
const DIR = path.join(__dirname, "..", "src", "modules", "hrm");

function fakeClient({ employees = [], entries = [], lopDivisor = "WORKING_DAYS" } = {}) {
  const matchesRow = (row, where = {}) => Object.entries(where).every(([key, value]) => {
    if (key === "OR") return value.some((clause) => matchesRow(row, clause));
    if (key === "removedAt") return value === null ? !row.removedAt : Boolean(row.removedAt);
    if (key === "paymentStatus") return value?.not ? row.paymentStatus !== value.not : row.paymentStatus === value;
    if (key === "employee") return true;
    return row[key] === value;
  });
  let nextId = 100;
  const client = {
    entries,
    hrmSettings: { findUnique: async () => ({ payrollLopDivisor: lopDivisor, payrollRounding: "NEAREST_1", payCycleDay: 25, paybackDay: 10 }) },
    payrollRuleVersion: { findMany: async () => [] },
    // Nobody here resigned with their salary held (payroll-notice-hold.test.js).
    employeeSeparation: { findMany: async () => [] },
    employee: {
      findMany: async ({ where }) => employees.filter((employee) => {
        const ok = (clause) => Object.entries(clause).every(([key, value]) => {
          if (key === "OR") return value.some(ok);
          if (key === "AND") return value.every(ok);
          if (key === "employmentStatus") return value.in.includes(employee.employmentStatus || "Active");
          if (key === "dateOfRelieving") return Boolean(employee.dateOfRelieving) && employee.dateOfRelieving >= value.gte;
          if (key === "dateOfJoining") return value === null ? !employee.dateOfJoining : Boolean(employee.dateOfJoining) && employee.dateOfJoining < value.lt;
          return true;
        });
        return ok(where);
      }),
      findUnique: async ({ where }) => employees.find((employee) => employee.id === where.id) || null,
    },
    payrollEntry: {
      findMany: async ({ where }) => entries.filter((row) => matchesRow(row, where)),
      findFirst: async ({ where }) => entries.find((row) => matchesRow(row, where)) || null,
      create: async ({ data }) => { const row = { id: nextId += 1, paymentStatus: "Pending", frozen: false, removedAt: null, ...data }; entries.push(row); return row; },
      updateMany: async ({ where, data }) => {
        const hit = entries.filter((row) => matchesRow(row, where));
        hit.forEach((row) => Object.assign(row, data));
        return { count: hit.length };
      },
    },
  };
  return client;
}

// June's pay cycle is 25 Apr - 24 May 2026, Sundays off: 25 working days.
const sundaysOff = async (from, to) => {
  let count = 0;
  for (let at = day(from); at <= day(to); at.setUTCDate(at.getUTCDate() + 1)) if (at.getUTCDay() !== 0) count += 1;
  return count;
};
const sources = { attendance: async () => ({ awayDays: 0, days: {} }), workingDaysIn: sundaysOff };
const statuses = async () => ["Active"];
const person = (extra = {}) => ({ id: 4, employeeName: "Meena", totalSalary: "30000", branchId: 1, dateOfJoining: day("2024-01-01"), payrollRecoveries: [], payrollAdvances: [], ...extra });

test("a leaver gets their last, part month - paid up to their relieving date - and no month after it", async () => {
  const leaver = person({ employmentStatus: "Relieved", dateOfRelieving: day("2026-05-09") });
  const longGone = person({ id: 5, employmentStatus: "Relieved", dateOfRelieving: day("2026-04-20") });
  const client = fakeClient({ employees: [leaver, longGone] });
  await service.generateMonth({ year: 2026, month: 6 }, 9, null, { client, statuses, sources });
  assert.deepEqual(client.entries.map((row) => row.employeeId), [4], "relieved before the cycle began: no June row");
  // 10 - 24 May after the 9 May last day: 15 days, three of them Sundays - 12 working days unpaid.
  const row = client.entries[0];
  assert.equal(row.daysAfterRelieving, 12);
  // Paid for the 13 working days of 25 they were employed: 30,000 x 13 / 25.
  assert.equal(service.figuresFor({ ...row, workingDays: 25 }, { lopDivisor: "WORKING_DAYS", rounding: "NEAREST_1" }).roundedSalary, 15600);
});

test("before joining and after relieving together never pass 30 under a fixed 30", async () => {
  const brief = person({ employmentStatus: "Relieved", dateOfJoining: day("2026-05-01"), dateOfRelieving: day("2026-05-02") });
  const client = fakeClient({ employees: [brief], lopDivisor: "FIXED_30" });
  await service.generateMonth({ year: 2026, month: 6 }, 9, null, { client, statuses, sources });
  const row = client.entries[0];
  assert.equal(row.daysBeforeJoining + row.daysAfterRelieving, 28, "6 days before, 22 after - the two days worked are paid");
  assert.equal(service.figuresFor(row, { lopDivisor: "FIXED_30", rounding: "NEAREST_1" }).roundedSalary, 2000);
});

test("a removed row stays removed - the month's update does not add it back - until it is restored", async () => {
  const client = fakeClient({ employees: [person()], entries: [{ id: 1, employeeId: 4, year: 2026, month: 6, paymentStatus: "Pending", frozen: false, removedAt: null }] });
  await service.removeEntry(1, null, { client, userId: 9, reason: "Left before payroll" });
  assert.ok(client.entries[0].removedAt instanceof Date);
  assert.deepEqual([client.entries[0].removedByUserId, client.entries[0].removedReason], [9, "Left before payroll"]);
  const generated = await service.generateMonth({ year: 2026, month: 6 }, 9, null, { client, statuses, sources });
  assert.equal(generated.added, 0, "a removed row counts as there");
  await service.restoreEntry(1, null, { client, userId: 9 });
  assert.equal(client.entries[0].removedAt, null);
  // The Main Page's guard: Remove needs a reason; bulk Delete gives one of its own.
  const { removeSchema } = require("../src/modules/hrm/payroll-register/controller");
  assert.equal(removeSchema.safeParse({ reason: "  " }).success, false);
  const CONTROLLER = fs.readFileSync(path.join(DIR, "payroll-register", "controller.js"), "utf8");
  assert.match(CONTROLLER, /reason: "Removed with the other ticked rows\."/);
});

test("Base Salary is the employee's Total Salary each month - not split by a review inside the cycle", async () => {
  const raised = person({ totalSalary: "35000", dateOfJoining: day("2024-01-01") });
  const client = fakeClient({ employees: [raised], entries: [] });
  const values = await service.broughtIn(raised, { year: 2026, month: 6, from: "2026-04-25", to: "2026-05-24", workingDays: 25, lopDivisor: "WORKING_DAYS" }, { client, ...sources });
  assert.equal(values.baseSalary, 35000);
  assert.ok(!("baseSalaryBreakdown" in values));
  // A Base Salary typed on June's row is June's alone: July's new row starts from the Total Salary again.
  const typed = fakeClient({ employees: [raised], entries: [{ id: 1, employeeId: 4, year: 2026, month: 6, paymentStatus: "Pending", frozen: false, removedAt: null, baseSalary: 20000, baseSalaryTyped: true }] });
  await service.generateMonth({ year: 2026, month: 7 }, 9, null, { client: typed, statuses, sources });
  const july = typed.entries.find((row) => row.month === 7);
  assert.equal(Number(july.baseSalary), 35000);
  assert.ok(!july.baseSalaryTyped);
  assert.equal(typed.entries.find((row) => row.month === 6).baseSalary, 20000, "June keeps what was typed");
});
