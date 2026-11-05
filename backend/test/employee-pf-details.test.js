const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { employeeSchema } = require("../src/modules/hrm/employees/controller");

/*
 * Edit Employee → Payslip Details → PF Details: the PF No., UAN, EPS No. and ESI No. the payslip
 * prints, typed by HR and checked to the same shapes the form checks.
 */

const update = employeeSchema.partial();
const parsed = (values) => update.safeParse(values);

test("each number in its own shape, or no answer", () => {
  assert.equal(parsed({ pfNumber: " tn/mas/0012345/000/0000123 " }).data.pfNumber, "TN/MAS/0012345/000/0000123");
  assert.equal(parsed({ epsNumber: "TNMAS00123450000000123" }).success, true);
  assert.equal(parsed({ uanNumber: "100123456789" }).success, true);
  assert.equal(parsed({ esiNumber: "3100123456" }).success, true);
  assert.equal(parsed({ esiNumber: "31001234567890123" }).success, true);
  for (const key of ["pfNumber", "uanNumber", "epsNumber", "esiNumber"]) assert.equal(parsed({ [key]: null }).success, true);
});

test("a number in the wrong shape is refused, saying what it should be", () => {
  assert.equal(parsed({ uanNumber: "12345" }).error.issues[0].message, "UAN must be 12 digits");
  assert.equal(parsed({ esiNumber: "123456789012" }).error.issues[0].message, "ESI No. must be 10 or 17 digits");
  assert.match(parsed({ pfNumber: "TN MAS 123" }).error.issues[0].message, /letters, digits and \/ only/);
});

test("four nullable columns, so every existing employee starts unanswered", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261012240000_employee_pf_details", "migration.sql"), "utf8");
  for (const column of ["`pf_number` VARCHAR(30) NULL", "`uan_number` VARCHAR(12) NULL", "`eps_number` VARCHAR(30) NULL", "`esi_number` VARCHAR(17) NULL"]) {
    assert.ok(sql.includes(`ADD COLUMN ${column}`), column);
  }
});
