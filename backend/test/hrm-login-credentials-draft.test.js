const test = require("node:test");
const assert = require("node:assert/strict");
const { credentialDraftSchema, withoutCredentialsDraft } = require("../src/modules/hrm/employees/controller");

/*
 * The Login Credentials page, put down half-finished.
 *
 * Two rules here, pulling opposite ways, and both fail quietly if they are wrong. The draft has to
 * accept work that is *not yet valid* — that is the whole point of it, and a schema that insisted on
 * a username and a role would refuse to keep the page until the page no longer needed keeping. But
 * it must stay a draft of this page rather than a place to park arbitrary JSON on an employee.
 *
 * And the column itself must never ride along on an ordinary employee row: it holds the password
 * the account will start on, and the repository is readable by anyone signed in.
 */

test("a page nobody has finished is kept exactly as it stands", () => {
  // No username, no roles, no branch — a page somebody stopped part-way down.
  const parsed = credentialDraftSchema.safeParse({ username: "", roleIds: [], branchId: "" });
  assert.equal(parsed.success, true);
});

test("an empty draft is a draft: none of these fields is required", () => {
  assert.equal(credentialDraftSchema.safeParse({}).success, true);
});

test("ids arrive as the strings the form uses and come back as numbers", () => {
  const parsed = credentialDraftSchema.safeParse({ alternative1EmployeeId: "6", leaveApproverIds: ["7", "8"] });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.alternative1EmployeeId, 6);
});

test("an empty picker is kept as empty rather than refused", () => {
  // "No alternative" is an answer, and one somebody may have deliberately gone back and cleared.
  assert.equal(credentialDraftSchema.safeParse({ alternative1EmployeeId: "" }).success, true);
  assert.equal(credentialDraftSchema.safeParse({ alternative2EmployeeId: null }).success, true);
});

test("anything that is not part of this page is refused rather than stored", () => {
  // The column is on the employee row, so a schema that accepted unknown keys would make it a
  // general-purpose store somebody could write anything into through this one endpoint.
  assert.equal(credentialDraftSchema.safeParse({ username: "x", employmentStatus: "Active" }).success, false);
  assert.equal(credentialDraftSchema.safeParse({ password: "x" }).success, false);
});

test("more than three leave approvers is not a draft of this page", () => {
  assert.equal(credentialDraftSchema.safeParse({ leaveApproverIds: ["1", "2", "3", "4"] }).success, false);
});

test("the draft never travels on an ordinary employee row", () => {
  const row = { id: 5, employeeName: "dhanush M M", loginCredentialsDraft: { username: "x", temporaryPassword: "secret" } };
  const answered = withoutCredentialsDraft(row);
  assert.equal("loginCredentialsDraft" in answered, false);
  // And nothing else is lost on the way.
  assert.deepEqual(answered, { id: 5, employeeName: "dhanush M M" });
});

test("a row without one is handed back unchanged", () => {
  assert.deepEqual(withoutCredentialsDraft({ id: 5 }), { id: 5 });
  assert.equal(withoutCredentialsDraft(null), null);
});
