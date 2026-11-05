import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { daysBetween, workHistorySteps, workStints } from "../src/lib/workHistory.mjs";

const TODAY = "2026-10-31";

test("somebody who never left: Joined in their role, then Working here now", () => {
  const steps = workHistorySteps({ dateOfJoining: "2025-08-09T00:00:00Z", employmentStatus: "Active", designation: "Videographer", department: "Production" }, TODAY);
  assert.deepEqual(steps.map((step) => step.kind), ["joined", "present"]);
  assert.equal(steps[0].designation, "Videographer");
  assert.equal(steps[0].servedDays, daysBetween("2025-08-09", TODAY));
});

test("each return: the last day in the old role and why, then the rejoin in the new role, with the time away", () => {
  const employee = {
    dateOfJoining: "2025-01-02", employmentStatus: "Active", designation: "Senior Videographer", department: "Production",
    rejoins: [{ leftOn: "2026-10-10", separationType: "Resignation", separationReason: "Better Opportunity", designation: "Videographer", department: "Production", rejoinedOn: "2026-10-31" }],
  };
  const steps = workHistorySteps(employee, TODAY);
  assert.deepEqual(steps.map((step) => step.kind), ["joined", "left", "rejoined", "present"]);
  assert.equal(steps[0].designation, "Videographer", "the first stint was worked in the role kept on the rejoin row");
  assert.equal(steps[1].note, "Resignation · Better Opportunity");
  assert.equal(steps[2].designation, "Senior Videographer", "the current stint is in the record's own role");
  assert.equal(steps[2].awayDays, 20, "11-30 Oct: the days strictly between");
});

test("somebody serving their notice ends on Serving notice period, dated with their last working day", () => {
  const employee = { dateOfJoining: "2026-10-21", employmentStatus: "Active", dateOfRelieving: "2026-12-15T00:00:00.000Z", designation: "Others", department: "Others" };
  const steps = workHistorySteps(employee, TODAY);
  assert.deepEqual(steps.map((step) => step.kind), ["joined", "notice"]);
  assert.equal(steps[1].date, "2026-12-15");
  assert.equal(steps[0].servedDays, daysBetween("2026-10-21", TODAY), "still counted to today: they are working");
  const flow = fs.readFileSync(new URL("../src/components/employees/WorkHistoryFlow.js", import.meta.url), "utf8");
  assert.match(flow, /notice: \{ label: "Serving notice period"/);
});

test("somebody who has left again ends on their last working day, with no Present step", () => {
  const steps = workHistorySteps({ dateOfJoining: "2025-04-29", employmentStatus: "Relieved", dateOfRelieving: "2026-11-04", designation: "Designer" }, TODAY);
  assert.deepEqual(steps.map((step) => step.kind), ["joined", "left"]);
  assert.equal(steps[1].note, "Relieved");
  assert.deepEqual(workStints({ dateOfJoining: "2025-04-29", employmentStatus: "Relieved", dateOfRelieving: "2026-11-04" }).at(-1).to, "2026-11-04");
});

test("Work History is a tab on the employee record and on My Profile", () => {
  const read = (p) => fs.readFileSync(new URL(`../src/components/${p}`, import.meta.url), "utf8");
  assert.match(read("employees/EmployeeVerificationPage.js"), /\{ id: "work-history", label: "Work History", render: \(\) => <WorkHistoryFlow employee=\{viewingRow\} \/> \}/);
  const profile = read("profile/ProfilePage.js");
  assert.match(profile, /\[\{ id: "work-history", label: "Work History" \}\]/);
  assert.match(profile, /<WorkHistoryFlow employee=\{profile\.employment\} \/>/);
});
