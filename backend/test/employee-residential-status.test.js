const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { employeeSchema } = require("../src/modules/hrm/employees/controller");

/*
 * Edit Employee → Payslip Details → Personal Details: Residential Status, the one detail the payslip
 * prints that nothing else on the record holds.
 */

test("the record takes Resident or Non-Resident, or no answer, and nothing else", () => {
  const update = employeeSchema.partial();
  assert.equal(update.safeParse({ residentialStatus: "Resident" }).data.residentialStatus, "Resident");
  assert.equal(update.safeParse({ residentialStatus: "Non-Resident" }).success, true);
  assert.equal(update.safeParse({ residentialStatus: null }).success, true);
  assert.equal(update.safeParse({ residentialStatus: "Tourist" }).success, false);
});

test("a nullable column, so it adds to every existing employee as unanswered", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261012230000_employee_residential_status", "migration.sql"), "utf8");
  assert.match(sql, /ALTER TABLE `employee` ADD COLUMN `residential_status` VARCHAR\(30\) NULL;/);
});
