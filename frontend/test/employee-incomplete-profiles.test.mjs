import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { missingPayslipInfo } from "../src/lib/payslipEmployeeDetails.mjs";

/*
 * Employee Repository → Incomplete Profiles: working employees whose Payslip Info lacks something
 * Settings → Payroll rules → Edit Payslip asks for, so HR can find them and fill it in.
 */

const PAGE = fs.readFileSync(path.join(process.cwd(), "src", "components", "employees", "EmployeeVerificationPage.js"), "utf8");
const needs = { listed: new Set(["Emp Code", "PAN", "PF No."]), fields: [{ id: 7, label: "Blood Group", section: "PERSONAL" }, { id: 8, label: "PF Joined", section: "PF" }], withPf: true };

test("what is missing is every listed item left empty, the payslip's own and the added ones", () => {
  const employee = { payslipPersonalDetails: { empCode: "DBS-6", pan: "" }, pfNumber: null, payslipValues: [{ fieldId: 8, value: "2025-06-01" }] };
  assert.deepEqual(missingPayslipInfo(employee, needs), ["PAN", "PF No.", "Blood Group"]);
  // An item Edit Payslip does not list is never asked for, however empty.
  assert.deepEqual(missingPayslipInfo({ payslipPersonalDetails: { empCode: "DBS-6", pan: "ABCDE1234F" }, pfNumber: "TN/1", payslipValues: [{ fieldId: 7, value: "O+" }, { fieldId: 8, value: "x" }] }, needs), []);
  // With personal details only, the PF ones are not asked for.
  assert.deepEqual(missingPayslipInfo(employee, { ...needs, withPf: false }), ["PAN", "Blood Group"]);
  // An added detail turned off is not asked for either.
  assert.deepEqual(missingPayslipInfo(employee, { ...needs, fields: [{ ...needs.fields[0], shownOnPayslip: false }] }), ["PAN", "PF No."]);
});

test("the tab sits after the pending kinds (HR Offboarding Pending last) and lists working employees alone, once the requirements are read", () => {
  const order = [...PAGE.matchAll(/\{ label: "([^"]+)", (?:statuses|filter):/g)].map((match) => match[1]);
  assert.equal(order.indexOf("Incomplete Profiles"), order.indexOf("HR Offboarding Pending") + 1);
  assert.match(PAGE, /\{ label: "Incomplete Profiles", filter: \(row, payslipNeeds\) => Boolean\(payslipNeeds\) && row\?\.type !== "invite" && isWorking\(row\) && missingPayslipInfo\(row, payslipNeeds\)\.length > 0 \}/);
  assert.match(PAGE, /Promise\.all\(\[getBuiltInPayslipItems\(\), getPayslipFields\(\{ active: true \}\), getPayslipDetailsSetting\(\)\]\)/);
  assert.match(PAGE, /const matchesTab = \(tab, row, payslipNeeds\) =>/);
});
