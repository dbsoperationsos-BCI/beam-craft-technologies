import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isServingNotice, isWorking, servingNoticeMessage } from "../src/lib/employmentStatus.mjs";

/*
 * Employee Repository → Serving Notice: somebody whose offboarding names a last working day still to
 * come keeps working, and sits under Serving Notice - not Active - until the server relieves them.
 */

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");

test("serving notice is a working status with a last working day on record", () => {
  assert.equal(isServingNotice({ employmentStatus: "Active", dateOfRelieving: "2026-10-31T00:00:00.000Z" }), true);
  assert.equal(isServingNotice({ employmentStatus: "PIP", dateOfRelieving: "2026-10-31T00:00:00.000Z" }), true);
  assert.equal(isServingNotice({ employmentStatus: "Active", dateOfRelieving: null }), false);
  // Relieved: the server has already moved them on - InActive, not Serving Notice.
  assert.equal(isServingNotice({ employmentStatus: "Relieved", dateOfRelieving: "2026-10-01T00:00:00.000Z" }), false);
  // Still working, for every picker, until the day after.
  assert.equal(isWorking({ employmentStatus: "Active", dateOfRelieving: "2026-10-31T00:00:00.000Z" }), true);
});

test("saving says how long the notice runs", () => {
  assert.equal(servingNoticeMessage("Ravi", "2026-10-31"), "Ravi is serving notice until 31 Oct 2026, and moves to InActive the day after.");
});

test("the tab sits after Active, which still holds them, and their row opens the offboarding on record", () => {
  const page = read("components", "employees", "EmployeeVerificationPage.js");
  assert.match(page, /\{ label: "Active", filter: isWorking \},[\s\S]{0,300}\{ label: "Serving Notice", filter: isServingNotice \},/);
  const table = read("components", "employees", "EmployeeTable.js");
  assert.match(table, /const offboarded = \["Relieved", "Absconded", "Fired"\]\.includes\(employee\.employmentStatus\) \|\| isServingNotice\(employee\);/);
  const panel = read("components", "employees", "SeparationFormPanel.js");
  assert.match(panel, /saved\?\.data && !saved\.data\.relievedAt\s+\? servingNoticeMessage\(employee\.employeeName, form\.proposedLastWorkingDate\)/);
});

test("a notice can be withdrawn from the row, with a reason", () => {
  const table = read("components", "employees", "EmployeeTable.js");
  assert.match(table, /onReactivate && isServingNotice\(employee\) \? \[\{ label: "Withdraw Notice", onSelect: \(\) => onReactivate\(employee\) \}\]/);
  const dialog = read("components", "employees", "EmployeeActionDialog.js");
  assert.match(dialog, /const withdrawing = isServingNotice\(employee\);/);
  assert.match(dialog, /title=\{withdrawing \? "Withdraw notice\?" : "Move back to Active\?"\}/);
  assert.match(dialog, /fields\.check\(\{ reason: reason\.trim\(\) \? "" : "Enter a reason\." \}\)/);
});
