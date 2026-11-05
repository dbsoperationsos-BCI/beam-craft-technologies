import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isResignationPending, isServingNotice } from "../src/lib/employmentStatus.mjs";

const submitted = { submittedAt: "2026-10-31T09:00:00.000Z", proposedLastWorkingDate: "2026-11-30T00:00:00.000Z" };

test("a submitted resignation is waiting for approval - HR Offboarding Pending - not yet Serving Notice", () => {
  const waiting = { employmentStatus: "Active", dateOfRelieving: null, resignationPending: submitted };
  assert.equal(isResignationPending(waiting), true);
  assert.equal(isServingNotice(waiting), false, "their employment is untouched until HR approves");
});

test("once HR approves it is ordinary notice, and no longer waiting", () => {
  assert.equal(isResignationPending({ employmentStatus: "Active", dateOfRelieving: "2026-11-30", resignationPending: submitted }), false);
  assert.equal(isServingNotice({ employmentStatus: "Active", dateOfRelieving: "2026-11-30" }), true);
  assert.equal(isServingNotice({ employmentStatus: "Active", dateOfRelieving: null, resignationPending: null }), false);
  assert.equal(isResignationPending({ employmentStatus: "Relieved", dateOfRelieving: null, resignationPending: submitted }), false);
});

test("the repository's tabs, board and row menu read it", () => {
  const read = (p) => fs.readFileSync(new URL(`../src/components/employees/${p}`, import.meta.url), "utf8");
  const page = read("EmployeeVerificationPage.js");
  assert.match(page, /\{ label: "Active", filter: isWorking \}/);
  // Serving Notice is an approved notice only; one waiting for approval is in Pending → HR Offboarding Pending.
  assert.match(page, /\{ label: "Serving Notice", filter: isServingNotice \}/);
  assert.match(page, /\{ label: "HR Offboarding Pending", filter: isResignationPending, pendingOnly: true \}/);
  assert.match(page, /if \(isServingNotice\(row\)\) return "Serving Notice";/);
  const table = read("EmployeeTable.js");
  assert.match(table, /isResignationPending\(employee\) \? \[\{ label: "Review Resignation"/);
  assert.match(table, /!offboarded && !isResignationPending\(employee\)\n/);
});
