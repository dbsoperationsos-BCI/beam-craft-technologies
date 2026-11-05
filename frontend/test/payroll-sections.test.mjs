import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * HRM → Payroll's four sections, switched the way Employee Attendance switches its own: one menu
 * beside the heading, the section held in the address. Main Page answers to `HRM / Payroll Register`,
 * Advance Salary to `HRM / Payroll Advance`, Recovery to `HRM / Payroll Recovery` and Policy Breach to
 * `HRM / Payroll Policy Breach`. There is no
 * Payslip section: an employee's own payslips are My Profile → Payslip.
 */

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");
const PAGE = read("components", "hrm", "PayrollPage.js");

test("Payroll has Main Page, Advance Salary, Recovery and Policy Breach, in that order, each asking for its own permission", () => {
  const labels = [...PAGE.matchAll(/\{ label: "([^"]+)", value: SECTION_\w+(?:, permission: [^}]+)? \}/g)].map((match) => match[1]);
  assert.deepEqual(labels, ["Main Page", "Advance Salary", "Recovery", "Policy Breach"]);
  assert.doesNotMatch(PAGE, /SECTION_PAYSLIP|label: "Payslip"/);
  // A login holding none of the four is told so, not shown an empty section.
  assert.match(PAGE, /emptyMessage="Your role has no Payroll section to open/);
  assert.match(PAGE, /\{ label: "Recovery", value: SECTION_RECOVERY, permission: \["HRM", "Payroll Recovery", "READ"\] \}/);
  assert.match(PAGE, /\{ label: "Main Page", value: SECTION_MAIN, permission: \["HRM", "Payroll Register", "READ"\] \}/);
  assert.match(PAGE, /\{ label: "Advance Salary", value: SECTION_ADVANCE_SALARY, permission: \["HRM", "Payroll Advance", "READ"\] \}/);
  assert.match(PAGE, /\{ label: "Policy Breach", value: SECTION_POLICY_BREACH, permission: \["HRM", "Payroll Policy Breach", "READ"\] \}/);
  assert.equal((PAGE.match(/permission: \[/g) || []).length, 4, "every section asks for its own");
  assert.match(PAGE, /<PayrollAdvanceSection\s+titleAccessory=\{sectionSwitch\}\s+canWrite=\{hasPermission\("HRM", "Payroll Advance", "READ_WRITE"\)\}/);
  // Converting writes a recovery too, so it needs both write permissions.
  assert.match(PAGE, /canConvert=\{hasPermission\("HRM", "Payroll Advance", "READ_WRITE"\) && hasPermission\("HRM", "Payroll Recovery", "READ_WRITE"\)\}/);
  assert.match(PAGE, /<PayrollMainSection\s+titleAccessory=\{sectionSwitch\}\s+canWrite=\{hasPermission\("HRM", "Payroll Register", "READ_WRITE"\)\}/);
  // Skipping changes Advance Salary or Recovery too, so each needs that module's write beside the register's.
  assert.match(PAGE, /canSkipAdvance=\{hasPermission\("HRM", "Payroll Register", "READ_WRITE"\) && hasPermission\("HRM", "Payroll Advance", "READ_WRITE"\)\}/);
  assert.match(PAGE, /canSkipRecovery=\{hasPermission\("HRM", "Payroll Register", "READ_WRITE"\) && hasPermission\("HRM", "Payroll Recovery", "READ_WRITE"\)\}/);
  assert.match(PAGE, /canSkipPolicyBreach=\{hasPermission\("HRM", "Payroll Register", "READ_WRITE"\) && hasPermission\("HRM", "Payroll Policy Breach", "READ_WRITE"\)\}/);
  // Policy Breach is the Recovery section under its own kind and permission, with no conversion to undo.
  assert.match(PAGE, /<PayrollRecoverySection\s+kind="policy-breach"\s+titleAccessory=\{sectionSwitch\}\s+canWrite=\{hasPermission\("HRM", "Payroll Policy Breach", "READ_WRITE"\)\}\s+\/>/);
  // Somebody who may not open the Main Page lands on the first section they may.
  assert.match(PAGE, /\? section : sections\[0\]\?\.value;/);
  // Absent without the permission, not disabled - and a link to it opens the Main Page instead.
  assert.match(PAGE, /const sections = SECTIONS\.filter\(\(entry\) => !entry\.permission \|\| hasPermission\(\.\.\.entry\.permission\)\);/);
  assert.match(PAGE, /<PayrollRecoverySection\s+titleAccessory=\{sectionSwitch\}\s+canWrite=\{hasPermission\("HRM", "Payroll Recovery", "READ_WRITE"\)\}/);
  assert.match(PAGE, /canUndoConversion=\{hasPermission\("HRM", "Payroll Recovery", "READ_WRITE"\) && hasPermission\("HRM", "Payroll Advance", "READ_WRITE"\)\}/);
});

test("the switch is the shared section menu beside the heading, and the section lives in the address", () => {
  assert.match(PAGE, /<DropdownMenu ariaLabel="Payroll section" items=\{sections\} value=\{shownSection\} onChange=\{setSection\} sorted=\{false\} \/>/);
  assert.match(PAGE, /router\.replace\(next && next !== SECTION_MAIN \? `\/hrm\/payroll\?section=\$\{next\}` : "\/hrm\/payroll", \{ scroll: false \}\)/);
  // An unknown or missing section opens the Main Page.
  assert.match(PAGE, /const section = DEEP_LINK_SECTIONS\.has\(requestedSection\) \? requestedSection : SECTION_MAIN;/);
  // `useSearchParams` needs its Suspense boundary on the route.
  assert.match(read("app", "(app)", "hrm", "payroll", "page.js"), /<Suspense fallback=\{null\}><PayrollPage \/><\/Suspense>/);
});
