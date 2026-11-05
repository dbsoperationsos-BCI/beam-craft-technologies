const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Attendance Rules → Irregularity penalty: every working day still Absent costs these extra days of
 * loss of pay on top of the day itself - in payroll's Irregularity Penalty column. Any approval that
 * clears the day clears it. Permissions are never irregularities.
 */

const service = require("../src/modules/hrm/payroll-register/service");
const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", ...parts), "utf8");

test("the penalty adds to Total Leaves, so to loss of pay, beside the absent days", () => {
  const rules = { lopDivisor: "WORKING_DAYS", rounding: "NEAREST_1" };
  const sheet = { baseSalary: 25000, workingDays: 25, attendanceLeaves: 2, casualLeaveDays: 0 };
  const without = service.figuresFor(sheet, rules);
  const withPenalty = service.figuresFor({ ...sheet, irregularityPenaltyDays: 1 }, rules);
  assert.equal(without.totalLeaves, 2);
  assert.equal(withPenalty.totalLeaves, 3);
  // A day's pay is 1,000: two absent days and one penalty day are 3,000.
  assert.equal(Math.round(withPenalty.lopDeduction), 3000);
});

test("attendance works it out as absent days times the penalty, and payroll brings it in", () => {
  assert.match(read("attendance", "calculator.js"), /irregularityPenaltyDays: \(tally\?\.absent \|\| 0\) \* \(Number\(settings\?\.irregularityPenaltyDays\) \|\| 0\),/);
  const PAYROLL = read("payroll-register", "service.js");
  assert.match(PAYROLL, /irregularityPenaltyDays = number\(reading\.irregularityPenaltyDays\);/);
  assert.match(PAYROLL, /\+ number\(entry\.irregularityPenaltyDays\) \+/);
  assert.match(PAYROLL, /compOffTakenDays: true, irregularityPenaltyDays: true,/);
});

test("the setting takes 0 to 3 days, in whole or half days, beside the other Attendance Rules", () => {
  const CONTROLLER = read("attendance", "controller.js");
  assert.match(CONTROLLER, /irregularityPenaltyDays: z\.coerce\.number\(\)\.min\(0, "Use 0 or more\."\)\.max\(3, "Use 3 days or fewer\."\)\s+\.refine\(\(value\) => Number\.isInteger\(value \* 2\), "Use whole or half days\."\),/);
  assert.match(CONTROLLER, /\.merge\(compOffSchema\.partial\(\)\)\.merge\(penaltySchema\.partial\(\)\)/);
  assert.match(CONTROLLER, /irregularityPenaltyDays: numberOf\(stored\.irregularityPenaltyDays\),/);
  const sql = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261014110000_irregularity_penalty", "migration.sql"), "utf8");
  assert.match(sql, /ADD COLUMN `irregularity_penalty_days` DECIMAL\(4, 2\) NOT NULL DEFAULT 0;/);
  assert.match(sql, /`payroll_entry` ADD COLUMN `irregularity_penalty_days` DECIMAL\(6, 2\) NOT NULL DEFAULT 0;/);
});
