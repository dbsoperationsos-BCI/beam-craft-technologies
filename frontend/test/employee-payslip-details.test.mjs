import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PAYSLIP_PERSONAL_FIELDS, RESIDENTIAL_STATUSES, payslipPersonalForm, payslipPersonalKey, payslipPersonalPayload } from "../src/lib/payslipEmployeeDetails.mjs";
import { fieldError, fieldFormatByName } from "../src/constants/fieldValidation.js";

/*
 * Edit Employee → Payslip Details → Personal Details: what the payslip prints about the employee,
 * typed here by HR - nothing filled in from the record - plus Residential Status.
 */

const PANEL = fs.readFileSync(path.join(process.cwd(), "src", "components", "employees", "EmployeeFormPanel.js"), "utf8");

test("Personal Details start empty and are typed by HR - nothing is filled in from the record", () => {
  assert.deepEqual(PAYSLIP_PERSONAL_FIELDS.map(([, label]) => label), ["Emp Code", "Emp Name", "Department", "Designation", "Location", "Date Of Birth", "Date of Joining", "PAN", "Bank A/c No."]);
  // Nothing typed yet: every input empty, whatever the record holds.
  assert.ok(Object.values(payslipPersonalForm(null)).every((value) => value === ""));
  // What was typed comes back; an empty answer goes as null.
  const form = payslipPersonalForm({ empName: "Karthik S", pan: "ABCDE1234F" });
  assert.equal(form[payslipPersonalKey("empName")], "Karthik S");
  assert.deepEqual(payslipPersonalPayload({ ...form, [payslipPersonalKey("department")]: "  " }), { empCode: null, empName: "Karthik S", department: null, designation: null, location: null, dateOfBirth: null, dateOfJoining: null, pan: "ABCDE1234F", bankAccount: null });
  assert.deepEqual(RESIDENTIAL_STATUSES, ["Resident", "Non-Resident"]);
});

test("typed inputs, each required, with Residential Status beside them", () => {
  assert.match(PANEL, /payslipPersonalFields\.filter\(\(\[, label\]\) => payslipListed\.has\(label\)\)\.map\(\(\[key, label, type\]\) => <FormField key=\{key\} label=\{label\}(?: helperText=\{fieldHelp\[key\]\})? field=\{key\} type=\{type\} required error=\{fieldErrors\[key\]\} value=\{form\[key\]\} onChange=\{update\} \/>\)/);
  assert.doesNotMatch(PANEL, /payslipPersonalDetails\(form|Not filled in yet|fill it in where it lives|PAYSLIP_SOURCE_FIELDS/);
  assert.match(PANEL, /\.\.\.payslipPersonalForm\(employee\.payslipPersonalDetails\),/);
  assert.match(PANEL, /if \(mode === "edit"\) payload\.payslipPersonalDetails = payslipPersonalPayload\(form\);/);
  assert.match(PANEL, /\.\.\.payslipPersonalFields\.filter\(\(\[, label\]\) => listed\.has\(label\)\)\.map\(\(\[key, label, type\]\) => \[key, label, type, true\]\),/);
  // Only what Edit Payslip lists and has on is asked for - the four it starts with are none of these.
  assert.match(PANEL, /getBuiltInPayslipItems\(\)\s+\.then\(\(response\) => \{ if \(live\) setPayslipListed\(new Set\(\(response\?\.data \|\| \[\]\)\.filter\(\(item\) => item\.shown && !item\.deleted\)\.map\(\(item\) => item\.label\)\)\); \}\)/);
  assert.deepEqual([fieldFormatByName.payslipPersonal_pan, fieldFormatByName.payslipPersonal_bankAccount], ["pan", "accountNumber"]);
  assert.match(PANEL, /<FormField label="Residential Status"(?: helperText=\{fieldHelp\.residentialStatus\})? field="residentialStatus" type="select" required error=\{fieldErrors\.residentialStatus\} options=\{RESIDENTIAL_STATUSES\} value=\{form\.residentialStatus\} onChange=\{update\} \/>/);
  // One section for all of it; the PF details follow the personal ones inside it.
  assert.equal((PANEL.match(/<SchemaFormSection id="payslip-/g) || []).length, 1);
  assert.ok(PANEL.indexOf("payslipPersonalFields.filter(([, label]) => payslipListed.has(label)).map(([key, label, type]) => <FormField") < PANEL.indexOf("payslipPfFields.filter(([, label]) => payslipListed.has(label)).map(([key, label, type]) => <FormField"));
});

test("PF Details asks HR for the payslip's PF No., UAN, EPS No. and ESI No.", () => {
  assert.match(PANEL, /const payslipPfFields = \[\["pfNumber", "PF No\.", "pfNumber"\], \["uanNumber", "UAN", "uan"\], \["epsNumber", "EPS No\.", "pfNumber"\], \["esiNumber", "ESI No\.", "esi"\]\];/);
  // Required when the payslip carries them; disabled, and not asked for, when it carries personal details only.
  assert.match(PANEL, /payslipPfFields\.filter\(\(\[, label\]\) => payslipListed\.has\(label\)\)\.map\(\(\[key, label, type\]\) => <FormField key=\{key\} label=\{label\}(?: helperText=\{fieldHelp\[key\]\})? field=\{key\} type=\{type\} required=\{payslipWithPf\} disabled=\{!payslipWithPf\} error=\{fieldErrors\[key\]\} value=\{form\[key\]\} onChange=\{update\} \/>\)/);
  assert.match(PANEL, /getPayslipDetailsSetting\(\)\s+\.then\(\(response\) => \{ if \(live\) setPayslipWithPf\(response\?\.data\?\.details !== "PERSONAL"\); \}\)/);
  // Only those on in Edit Payslip are asked for.
  assert.match(PANEL, /getPayslipFields\(\{ active: true \}\)[\s\S]{0,200}setPayslipFields\(\(response\?\.data \|\| \[\]\)\.filter\(\(field\) => field\.shownOnPayslip !== false\)\)/);
  // Saving from Payslip Details checks its own required fields: Residential Status, and the PF ones when carried.
  assert.match(PANEL, /\.\.\.\(listed\.has\("Residential Status"\) \? \[\["residentialStatus", "Residential Status", "select", true\]\] : \[\]\),\s+\.\.\.\(withPf \? payslipPfFields\.filter\(\(\[, label\]\) => listed\.has\(label\)\)\.map\(\(\[key, label, type\]\) => \[key, label, type, true\]\) : \[\]\),/);
  assert.match(PANEL, /\.\.\.\(mode === "edit" && page === PAYSLIP_PAGE \? \[\.\.\.payslipRequiredFields\(payslipWithPf, payslipListed\), \.\.\.addedPayslipFields\(payslipFields, payslipWithPf\)\] : \[\]\)\]\.map\(\(field\) => \[field\[0\], field\]\)\)\.values\(\)\]/);
  // The details added in Settings → Payroll rules → Edit Payslip: Personal always required, PF when carried.
  assert.match(PANEL, /const addedPayslipFields = \(fields, withPf\) => fields\.map\(\(field\) => \[payslipKey\(field\.id\), field\.label, PAYSLIP_INPUT_TYPES\[field\.inputType\] \|\| "text", field\.section === "PERSONAL" \|\| withPf\]\);/);
  assert.match(PANEL, /payslipFields\.filter\(\(field\) => field\.section === "PF"\)\.map\(\(field\) => <FormField [^\n]*required=\{payslipWithPf\} disabled=\{!payslipWithPf\}/);
  assert.match(PANEL, /payload\.payslipValues = Object\.fromEntries\(payslipFields\.map\(\(field\) => \[field\.id, String\(form\[payslipKey\(field\.id\)\] \?\? ""\)\]\)\);/);
  // Checked as typed, to the same shapes the server holds them to.
  assert.deepEqual([fieldFormatByName.pfNumber, fieldFormatByName.uanNumber, fieldFormatByName.epsNumber, fieldFormatByName.esiNumber], ["pfNumber", "uan", "pfNumber", "esi"]);
  assert.equal(fieldError("pfNumber", "tn/mas/0012345/000/0000123"), "");
  assert.equal(fieldError("uan", "100123456789"), "");
  assert.equal(fieldError("uan", "12345"), "UAN must be 12 digits.");
  assert.equal(fieldError("esi", "3100123456"), "");
  assert.equal(fieldError("esi", "123"), "ESI No. must be 10 or 17 digits.");
  assert.equal(fieldError("uan", ""), "", "empty passes - none of them is required");
});
