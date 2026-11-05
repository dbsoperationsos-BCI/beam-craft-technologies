const test = require("node:test");
const assert = require("node:assert/strict");
const { returningStatus, ONBOARDING_STATUSES } = require("../src/modules/hrm/employees/controller");
const { closeLogin, reopenLogin, STATUS_BY_TYPE } = require("../src/modules/hrm/separations/controller");

/*
 * Coming back from the InActive tab.
 *
 * Two halves, and both used to be missing. There was no way at all to put somebody back to work
 * from the repository - the only thing that restored a status was `deleteSeparation`, which no
 * screen called - and a departure never closed the person's login, so a Fired or Absconded employee
 * could still sign in the next morning carrying every role they held. `User.status` is the only
 * thing sign-in checks, and nothing but deleting the employee outright ever set it.
 */

test("every status a separation produces is one somebody can be brought back from", () => {
  // The three the InActive tab lists as departures. If a separation type ever mapped to something
  // else, the row would land in a tab whose menu has no way back.
  for (const status of Object.values(STATUS_BY_TYPE)) {
    assert.ok(["Relieved", "Fired", "Absconded"].includes(status), `${status} is outside the InActive tab`);
  }
});

test("a departure closes the login and taking it back reopens it", async () => {
  const calls = [];
  const client = { user: { updateMany: async (args) => { calls.push(args); return { count: 1 }; } } };

  await closeLogin(client, 41);
  await reopenLogin(client, 41);

  assert.deepEqual(calls.map((call) => call.data.status), ["INACTIVE", "ACTIVE"]);
  // Keyed off the join between the two records, and never off the employee's own id as a user id:
  // a user and an employee are separate rows whose numbers have nothing to do with each other.
  assert.deepEqual(calls.map((call) => call.where), [{ linkedEmployeeId: 41 }, { linkedEmployeeId: 41 }]);
});

// The grants are what make an account worth reopening rather than recreating, and stripping them
// would mean rebuilding by hand for somebody whose offboarding was simply recorded in error.
test("neither direction touches the roles on the account", async () => {
  const calls = [];
  const client = { user: { updateMany: async (args) => { calls.push(args); return { count: 1 }; } } };
  await closeLogin(client, 41);
  await reopenLogin(client, 41);
  for (const call of calls) assert.deepEqual(Object.keys(call.data), ["status"]);
});

/*
 * Which status somebody returns *to*. Their own, where that is somebody working here - being put
 * back on Active would read as a promotion for somebody who left while `in Training`.
 */
test("an employee returns to the status they held before they left", async () => {
  assert.equal(await returningStatus("in Training"), "in Training");
  assert.equal(await returningStatus("PIP"), "PIP");
  assert.equal(await returningStatus("Active"), "Active");
});

// The case that made this a function rather than `previous || "Active"`: somebody who went on long
// leave and was then relieved would have been "restored" to Long Leave - still in the InActive tab,
// having just been told they were being moved out of it.
test("a previous status that is not working is not what they come back to", async () => {
  assert.equal(await returningStatus("Long Leave"), "Active");
  assert.equal(await returningStatus("Relieved"), "Active");
  assert.equal(await returningStatus(null), "Active");
  assert.equal(await returningStatus(undefined), "Active");
});

// Somebody still waiting to be onboarded has nothing to come back *from*, so the endpoint refuses
// to reactivate them rather than rewriting the status.
test("the onboarding statuses are named once, and are the two the flow writes", () => {
  assert.deepEqual(ONBOARDING_STATUSES, ["HR Onboarding Pending", "Employee Submission Pending"]);
});

/*
 * A hire that falls through *can* be offboarded from those two statuses - the candidate stops
 * answering, or takes another offer - so a row taken back from that has to return to the wait it
 * was in. Putting somebody who never started on Active would hand the studio an employee it never
 * took on, holding a joining date and a salary nobody agreed.
 */
test("a candidate offboarded before they started comes back to the wait they were in", async () => {
  assert.equal(await returningStatus("HR Onboarding Pending"), "HR Onboarding Pending");
  assert.equal(await returningStatus("Employee Submission Pending"), "Employee Submission Pending");
});
