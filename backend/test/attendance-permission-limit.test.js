const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { permissionUsage } = require("../src/modules/hrm/attendance/service");

/*
 * Attendance Rules → Permissions: how many permissions a month - or pay cycle - allows. Pending, sent
 * back and approved ones count; a request past the limit is refused. 0 is no limit.
 */

const DIR = path.join(__dirname, "..", "src", "modules", "hrm", "attendance");
const CONTROLLER = fs.readFileSync(path.join(DIR, "controller.js"), "utf8");
const ROUTES = fs.readFileSync(path.join(DIR, "routes.js"), "utf8");

// A stand-in database: the requests it holds, counted the way Prisma's `count` would.
function fakeClient(requests) {
  return {
    payrollRuleVersion: { findMany: async () => [] },
    hrmSettings: { findUnique: async () => ({ payCycleDay: 25, paybackDay: 10 }) },
    attendanceRequest: {
      count: async ({ where }) => requests.filter((request) => request.employeeId === where.employeeId
        && request.type === where.type
        && where.status.in.includes(request.status)
        && request.fromDate >= where.fromDate.gte && request.fromDate <= where.fromDate.lte
        && (!where.id || request.id !== where.id.not)).length,
    },
  };
}
const permission = (id, date, status = "APPROVED") => ({ id, employeeId: 7, type: "PERMISSION", status, fromDate: new Date(`${date}T00:00:00.000Z`) });

test("no limit set is no limit", async () => {
  assert.deepEqual(await permissionUsage(7, "2026-10-12", { client: fakeClient([]), settings: { permissionsPerPeriod: 0 } }), { limit: 0 });
});

test("a calendar month counts the pending, sent back and approved permissions in it - and nothing else", async () => {
  const client = fakeClient([
    permission(1, "2026-10-03"), permission(2, "2026-10-20", "PENDING"), permission(3, "2026-10-21", "SENT_BACK"),
    permission(4, "2026-10-22", "REJECTED"), permission(5, "2026-10-23", "REVERTED"), permission(6, "2026-09-30"),
  ]);
  const usage = await permissionUsage(7, "2026-10-12", { client, settings: { permissionsPerPeriod: 3, permissionPeriod: "CALENDAR_MONTH" } });
  assert.deepEqual(usage, { limit: 3, used: 3, label: "October 2026", from: "2026-10-01", to: "2026-10-31" });
  // An edit does not count against itself.
  assert.equal((await permissionUsage(7, "2026-10-12", { client, settings: { permissionsPerPeriod: 3 }, ignoreId: 2 })).used, 2);
});

test("on the pay cycle, a permission counts in the payroll month whose cycle holds its date", async () => {
  // 25 Sep to 24 Oct is November 2026's pay cycle with the cycle on the 25th.
  const client = fakeClient([permission(1, "2026-09-26"), permission(2, "2026-10-24"), permission(3, "2026-10-25"), permission(4, "2026-09-24")]);
  const usage = await permissionUsage(7, "2026-10-12", { client, settings: { permissionsPerPeriod: 2, permissionPeriod: "PAY_CYCLE" } });
  /*
   * Named "this pay cycle" rather than "November 2026's pay cycle".
   *
   * The month in it was the *payroll* month, which is not the month the dates are in - 25 Sep to 24
   * Oct is November's cycle - so the one thing the name said was the thing most likely to be read
   * wrong. The screen shows the dates beside it anyway, and the only question somebody has of this
   * figure is how many permissions are left in the period they are in now.
   */
  assert.deepEqual(usage, { limit: 2, used: 2, label: "this pay cycle", from: "2026-09-25", to: "2026-10-24" });
});

test("counted by the calendar month, the period is still named by its month", async () => {
  // Nothing changed there: "December 2026" is the month the dates are in and reads correctly.
  const client = fakeClient([permission(1, "2026-10-02")]);
  const usage = await permissionUsage(7, "2026-10-12", { client, settings: { permissionsPerPeriod: 2 } });
  assert.equal(usage.label, "October 2026");
});

test("a permission past the limit is refused, saying the period; the form can ask how many are used", () => {
  assert.match(CONTROLLER, /if \(usage\.limit && usage\.used >= usage\.limit\) \{\s+throw badRequest\(`You have already used the \$\{usage\.limit\}/);
  assert.match(CONTROLLER, /permissionsPerPeriod: z\.coerce\.number\(\)\.int\("Use a whole number\."\)\.min\(0\)\.max\(31\),/);
  assert.match(CONTROLLER, /permissionPeriod: z\.enum\(CASUAL_LEAVE_PERIODS\),/);
  assert.match(ROUTES, /router\.get\("\/requests\/permission-usage", requestGuard, controller\.getPermissionUsage\);/);
  const handler = CONTROLLER.slice(CONTROLLER.indexOf("async function getPermissionUsage("), CONTROLLER.indexOf("async function listMyCompOffOptions("));
  assert.match(handler, /const employee = await requireEmployee\(req\.user\);/);
  const MIGRATION = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261010200000_attendance_permission_limit", "migration.sql"), "utf8");
  assert.match(MIGRATION, /ADD COLUMN `permissions_per_period` INTEGER NOT NULL DEFAULT 0,/);
  assert.match(MIGRATION, /ADD COLUMN `permission_period` VARCHAR\(20\) NOT NULL DEFAULT 'CALENDAR_MONTH';/);
});
