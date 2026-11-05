import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { WORKING_STATUSES, isWorking, workingEmployees } from "../src/lib/employmentStatus.mjs";

/*
 * Who an employee picker may offer.
 *
 * The repository holds nine employment statuses and shows a tab per status, which is right for a
 * table and wrong for every dropdown fed from the same list: naming somebody still onboarding as a
 * manager, or somebody Fired as a leave approver, records a decision against a person who cannot
 * act on it — and the record then reads as though somebody chose them.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

const PANEL = read("components", "employees", "EmployeeFormPanel.js");
const HOOK = read("components", "employees", "useCredentialForm.js");
const PAGE = read("components", "employees", "EmployeeVerificationPage.js");

test("working here is the three statuses the backend and the Active tab already mean", () => {
  assert.deepEqual(WORKING_STATUSES, ["Active", "in Training", "PIP"]);
});

test("nobody who has not started, and nobody who has left, is offered", () => {
  for (const status of ["HR Onboarding Pending", "Employee Submission Pending", "Relieved", "Absconded", "Fired", "Long Leave"]) {
    assert.equal(isWorking({ employmentStatus: status }), false, `${status} is offered by every picker`);
  }
  for (const status of WORKING_STATUSES) {
    assert.equal(isWorking({ employmentStatus: status }), true);
  }
  // Long Leave is the deliberate one: they have not left, and they are not there to take the work.
  assert.equal(isWorking({ employmentStatus: "Long Leave" }), false);
});

test("an invitation is not a person a form can name", () => {
  // The repository lists invites beside employees, so they arrive in the same array. An invite is
  // somebody who has not filled the form in yet and has no employee to point at.
  const rows = [
    { id: 1, type: "invite", employmentStatus: "Active" },
    { id: 2, employmentStatus: "Active" },
    { id: 3, employmentStatus: "HR Onboarding Pending" },
  ];
  assert.deepEqual(workingEmployees(rows).map((row) => row.id), [2]);
  assert.deepEqual(workingEmployees(null), []);
});

test("the three pickers on the employee form all read it", () => {
  /*
   * These were the ones left: the repository page fetches everybody, correctly, because its table
   * has a tab per status — and handed that same array straight to the form's dropdowns.
   *
   * Reports To offered anyone but yourself. Cover and Leave Approval dropped the three departed
   * statuses by name, which let through everybody else — onboarding, submission pending, long leave.
   */
  assert.match(PANEL, /const reportingOptions = useMemo\(\(\) => workingEmployees\(employees\)/);
  assert.match(HOOK, /const coverCandidates = \(employees, employee\) => workingEmployees\(employees\)/);
  assert.doesNotMatch(HOOK, /const DEPARTED = /, "cover is decided by who has left rather than by who is here");
});

test("the Active tab and the pickers cannot drift apart", () => {
  // One list, read by both (`isWorking` reads WORKING_STATUSES), so a fourth status added to the enum
  // is considered once. Whoever is leaving is still working, so Active holds them too.
  assert.match(PAGE, /\{ label: "Active", filter: isWorking \}/);
  assert.doesNotMatch(PAGE, /statuses: \["Active", "in Training", "PIP"\]/);
});

test("the repository table still asks for everybody", () => {
  /*
   * The exception, and it has to stay one: the table has a tab per status, so a row that never
   * arrives lands in none of them — and HR could not review an onboarding submission at all.
   */
  assert.match(PAGE, /const firstPage = await getEmployees\(\);/);
});
