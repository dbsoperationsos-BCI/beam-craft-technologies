import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL(`../src/components/employees/${p}`, import.meta.url), "utf8");

test("an employee's row offers their own resignation form, only while they are working and not leaving", () => {
  const table = read("EmployeeTable.js");
  assert.match(table, /\.\.\.\(onSendOffboardingForm && isWorking\(employee\) && !isOnboarding\(employee\) && !offboarded && !isResignationPending\(employee\)\n\s+\? \[\{ label: "Resignation Form", onSelect: \(\) => onSendOffboardingForm\(employee\) \}\]/);
});

test("it opens the resignation form with that employee chosen, for a reader who may write", () => {
  const page = read("EmployeeVerificationPage.js");
  assert.match(page, /onSendOffboardingForm: canWrite \? sendOffboardingForm : undefined/);
  assert.match(page, /const sendOffboardingForm = useCallback\(\(employee\) => \{ setOffboardingEmployee\(employee\); setOffboarding\("create"\); \}, \[\]\);/);
  assert.match(page, /employee=\{offboardingEmployee\}/);
  const dialog = read("OffboardingInviteDialog.js");
  assert.match(dialog, /employeeId: employee\?\.id \? String\(employee\.id\) : ""/);
  // One who cannot be sent a form is said so, and shown the register where their open form is.
  assert.match(dialog, /already has an open resignation form, or cannot be sent one\. Their form is in the list\./);
});

test("opened from a row, the form shows the employee's name instead of a picker, with no back arrow or extra notes", () => {
  const dialog = read("OffboardingInviteDialog.js");
  assert.match(dialog, /const fixedEmployee = screen === "create" && Boolean\(employee\?\.id\) && draft\.employeeId === String\(employee\.id\);/);
  assert.match(dialog, /\{fixedEmployee\n\s+\? <TextField\n\s+label="Employee"[\s\S]{0,140}readOnly/);
  assert.match(dialog, /screen === "create" && !fixedEmployee \? \{ onBack:/);
  assert.doesNotMatch(dialog, /They will be asked when their notice starts/);
  assert.doesNotMatch(dialog, /Pick the employee, say how long their notice is/);
});

test("HR's form asks the resignation date under the notice period and shows the last day it comes to", async () => {
  const dialog = read("OffboardingInviteDialog.js");
  assert.match(dialog, /<DateField\n\s+required\n\s+label="Resignation date"/);
  assert.match(dialog, /label="Proposed last working day"[\s\S]{0,120}readOnly/);
  assert.match(dialog, /resignationDate: draft\.resignationDate \|\| undefined,/);
  const { lastWorkingDayFrom } = await import("../src/lib/offboardingNotice.mjs");
  assert.equal(lastWorkingDayFrom("2026-10-29", 30), "2026-11-27");
});

test("the employee's form shows HR's resignation date read-only and asks only the reason, comments and letter", () => {
  const form = fs.readFileSync(new URL("../src/components/offboarding/PublicOffboardingForm.js", import.meta.url), "utf8");
  assert.match(form, /\{details\?\.resignationDateFixed \? <TextField\n\s+label="Resignation date"[\s\S]{0,160}readOnly/);
});

test("Start Offboarding opens filled in from the employee's offboarding form when nothing is recorded yet", () => {
  const panel = read("SeparationFormPanel.js");
  assert.match(panel, /if \(existing\) \{ setForm\(toForm\(existing\)\); return; \}/);
  assert.match(panel, /setForm\(formFromOffboardingForm\(offboardingFormFor\(invites, employee\.id\)\)\)/);
  for (const line of [/separationType: "Resignation",/, /separationReason: invite\.reason \|\| "",/, /detailedReason: invite\.detailedReason \|\| "",/, /resignationDate: toDateInput\(invite\.resignationDate\),/, /proposedLastWorkingDate: toDateInput\(invite\.proposedLastWorkingDate\),/, /noticePeriodRequired: toNumberInput\(invite\.noticePeriodDays\),/, /hrRemarks: invite\.hrNote \|\| "",/]) {
    assert.match(panel, line);
  }
  // The answered form first; a cancelled, rejected or expired one is not used.
  assert.match(panel, /const FORM_STATUSES = \["Submitted", "Approved", "Verified", "Sent"\];/);
});
