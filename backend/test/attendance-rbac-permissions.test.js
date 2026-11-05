const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { PERMISSIONS } = require("../prisma/seeds/permission-catalogue");

/*
 * Of what used to be "administrators only" in the attendance flow, two are permissions of their own,
 * granted in Role Management: Attendance Rules and All Requests. Two more - Attendance Logs and
 * Attendance Calculator - were for a while, and were taken back off (20260929110000): what they open
 * is an administrator's alone again.
 */

const KEPT = [
  ["Attendance Rules", "ATTENDANCE_RULES"],
  ["All Requests", "ATTENDANCE_ALL_REQUESTS"],
];
const REMOVED = [
  ["Attendance Logs", "ATTENDANCE_LOGS"],
  ["Attendance Calculator", "ATTENDANCE_CALCULATOR"],
];
const MODULE = path.join(__dirname, "..", "src", "modules", "hrm", "attendance");
const SERVICE = fs.readFileSync(path.join(MODULE, "service.js"), "utf8");
const MIGRATION = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20260928120000_attendance_admin_permissions", "migration.sql"), "utf8");

test("the catalogue offers the two kept, and not the two taken off", () => {
  for (const [feature, level] of KEPT) {
    const row = PERMISSIONS.find((entry) => entry.module === "HRM" && entry.feature === feature);
    assert.ok(row, `${feature} is not in the catalogue`);
    assert.equal(row.level, level);
  }
  for (const [feature] of REMOVED) {
    assert.equal(PERMISSIONS.some((entry) => entry.module === "HRM" && entry.feature === feature), false, `${feature} is back in Role Management`);
  }
  // And a migration deletes them, so an environment that had them loses them and their grants.
  const removal = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20260929110000_remove_attendance_calculator_and_logs_permissions", "migration.sql"), "utf8");
  for (const [feature, level] of REMOVED) assert.match(removal, new RegExp(`\\('${feature}', '${level}'\\)`));
  assert.match(removal, /DELETE FROM `permission`/);
});

test("the migration that added them grants them to administrator roles only", () => {
  for (const [feature, level] of [...KEPT, ...REMOVED]) {
    assert.match(MIGRATION, new RegExp(`'${feature}'[^\\n]*'${level}'`), `${feature} is not added`);
  }
  assert.match(MIGRATION, /WHERE \(`role`\.`name` = 'SUPER_ADMIN' OR \(`role`\.`is_admin` = 1 AND `role`\.`is_active` = 1\)\)/);
  // Idempotent: neither a permission nor a grant is written twice.
  assert.match(MIGRATION, /WHERE NOT EXISTS \(\s*SELECT 1 FROM `permission`/);
  assert.match(MIGRATION, /AND NOT EXISTS \(\s*SELECT 1 FROM `role_permission`/);
});

test("the rules and all requests ask the permission; the logs ask for an administrator", () => {
  assert.match(SERVICE, /const canManageRules = \(user\) => iamService\.hasPermission\(user\?\.id, "HRM", RULES_FEATURE, "READ_WRITE"\);/);
  assert.match(SERVICE, /const seesAllRequests = \(user\) => iamService\.hasPermission\(user\?\.id, "HRM", ALL_REQUESTS_FEATURE, "READ"\);/);
  assert.match(SERVICE, /const seesAttendanceLogs = \(user\) => isAdministrator\(user\?\.id\);/);
  assert.doesNotMatch(SERVICE, /"Attendance Logs"/);
});
