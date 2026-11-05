import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/* Settings → Payroll rules → Payroll starts from, and the Main Page keeping to it. */

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");
const RULES = read("components", "settings", "PayrollRulesPanel.js");
const PANEL = read("components", "settings", "PayrollStartPanel.js");
const SECTION = read("components", "hrm", "PayrollMainSection.js");
const SERVICE = read("services", "hrm", "payrollRegister.service.js");

test("it sits after Salary calculation, on the register's own permission", () => {
  assert.ok(RULES.indexOf("<SalaryRules") < RULES.indexOf("<PayrollStartPanel"), "after Salary calculation");
  assert.ok(RULES.indexOf("<PayrollStartPanel") < RULES.indexOf("<PayslipGenerationPanel"), "before Generate payslips on");
  assert.match(RULES, /\{canReadRules && <section aria-labelledby="payroll-rules-start"/);
  assert.match(RULES, /<PayrollStartPanel canWrite=\{canWrite\}/);
});

test("a month is picked and saved; Read shows it; a chosen one can go back to attendance's start", () => {
  assert.match(PANEL, /<MonthField\s+label="Payroll starts from"/);
  assert.match(PANEL, /disabled=\{!canWrite \|\| busy\}/);
  assert.match(PANEL, /\{canWrite && <Button type="button" variant="primary"/);
  assert.match(PANEL, /\{canWrite && start\.chosen && <Button[^>]*onClick=\{\(\) => run\(\(\) => save\(null\)\)\}>/);
  assert.match(SERVICE, /apiRequest\(`\$\{base\}\/payroll-start`, \{ method: "PUT", body: JSON\.stringify\(\{ startsFrom \}\) \}\)/);
  assert.doesNotMatch(PANEL, /<input|<select|<button|apiRequest|fetch\(/);
});

test("the Main Page says a month before the start is not made, and where the start is set", () => {
  assert.match(SECTION, /startsFrom: response\.data\.beforeStart \? response\.data\.startsFrom : null/);
  assert.match(SECTION, /`Payroll starts from \$\{MONTH_NAMES\[schedule\.startsFrom\.month - 1\]\} \$\{schedule\.startsFrom\.year\} - \$\{monthName\} \$\{period\.year\} is before it, so it is not made\. Settings → Payroll rules sets the start\.`/);
});

test("Attendance Rules: an Irregularity penalty card after Working day; payroll shows it as its own column", () => {
  const RULES_PANEL = read("components", "hrm", "AttendanceRulesPanel.js");
  assert.ok(RULES_PANEL.indexOf('saveButton("workingDay")') < RULES_PANEL.indexOf(">Irregularity penalty<HelpTip"), "after Working day");
  assert.ok(RULES_PANEL.indexOf(">Irregularity penalty<HelpTip") < RULES_PANEL.indexOf('saveButton("casualLeave")'), "before Casual Leave");
  assert.match(RULES_PANEL, /penalty: \{ name: "Irregularity penalty", fields: \["irregularityPenaltyDays"\] \}/);
  assert.match(RULES_PANEL, /\.\.\.\[0\.5, 1, 1\.5, 2, 2\.5, 3\]\.map/);
  assert.match(SECTION, /\{ id: "irregularityPenaltyDays", label: "Irregularity Penalty", value: \(row\) => days\(row\.irregularityPenaltyDays\) \}/);
  assert.match(read("lib", "payrollRegister.mjs"), /\+ number\(entry\.irregularityPenaltyDays\) \+/);
});
