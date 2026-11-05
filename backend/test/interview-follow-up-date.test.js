const test = require("node:test");
const assert = require("node:assert/strict");
const { followUpDateProblem } = require("../src/modules/hrm/interview/controller");

/* A candidate saved in Follow Up needs the day of the call back - a real one. */

test("Follow Up without a next follow-up date is refused", () => {
  for (const nextFollowUpDate of [undefined, null, "", "   "]) {
    assert.equal(followUpDateProblem({ status: "Follow Up", nextFollowUpDate }), "Next follow-up date is required for Follow Up stage.");
  }
});

test("a date that is not a real day is refused; the picker's and a sheet's format are both taken", () => {
  assert.equal(followUpDateProblem({ status: "Follow Up", nextFollowUpDate: "2026-10-05" }), null);
  assert.equal(followUpDateProblem({ status: "Follow Up", nextFollowUpDate: "05/10/2026" }), null);
  for (const bad of ["2026-02-30", "31/04/2026", "tomorrow", "2026-13-01"]) {
    assert.equal(followUpDateProblem({ status: "Follow Up", nextFollowUpDate: bad }), "Enter a valid next follow-up date.", bad);
  }
});

test("no other stage asks for a date", () => {
  for (const status of ["Yet to Connect", "Form Submission Pending", "Form Submitted", "Interview Scheduled", "Selected", "Onboarded", "On Hold", "Rejected"]) {
    assert.equal(followUpDateProblem({ status, nextFollowUpDate: "" }), null, status);
  }
});

test("the rule is on the update endpoint, before the write", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "modules", "hrm", "interview", "controller.js"), "utf8");
  const update = source.slice(source.indexOf("async function update("), source.indexOf("async function remove("));
  assert.ok(update.indexOf("followUpDateProblem(parsed.data)") < update.indexOf("service.updateCandidate("));
  assert.match(update, /return res\.status\(400\)\.json\(\{ message: followUpProblem/);
});
