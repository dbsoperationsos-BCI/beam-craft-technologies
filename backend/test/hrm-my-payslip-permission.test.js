const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { PERMISSIONS } = require("../prisma/seeds/permission-catalogue");

/* HRM → Payslip's permission: in the catalogue and in a migration, granted to SUPER_ADMIN alone. */

test("HRM / My Payslip is catalogued and migrated, granted to SUPER_ADMIN only", () => {
  assert.ok(PERMISSIONS.some((row) => row.module === "HRM" && row.feature === "My Payslip" && row.level === "HRM_MY_PAYSLIP"));
  const sql = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261012250000_hrm_my_payslip_permission", "migration.sql"), "utf8");
  assert.match(sql, /SELECT UUID\(\), 'HRM', 'My Payslip', 'HRM_MY_PAYSLIP', 'My Payslip',/);
  assert.match(sql, /WHERE `role`\.`name` = 'SUPER_ADMIN'/);
  assert.equal((sql.match(/INSERT INTO `role_permission`/g) || []).length, 1);
});
