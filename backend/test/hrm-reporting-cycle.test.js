const test = require("node:test");
const assert = require("node:assert/strict");
const { reportingProblem } = require("../src/modules/hrm/employees/controller");

/*
 * A reporting line has to stay a tree.
 *
 * The chart is walked upward until somebody reports to nobody. A ring has no such person, so it has
 * no top to arrive at — the reader survives one and says the chain is broken, but the honest place
 * to stop a ring is where it would be written. These hold that guard.
 *
 * `reportsToEmployeeId` reaches the database through exactly two paths, createEmployee and
 * updateEmployee, and both call this before writing. Every other writer of an employee row —
 * onboarding submission, separations — sets named columns and never this one.
 */

/** A stand-in for Prisma holding `id -> reportsToEmployeeId`. Anyone absent is archived or gone. */
function fakeClient(people) {
  const byId = new Map(people.map(([id, reportsToEmployeeId]) => [id, { id, reportsToEmployeeId }]));
  return { employee: { findFirst: async ({ where }) => byId.get(where.id) || null } };
}

test("nobody may report to themselves", async () => {
  const problem = await reportingProblem(1, 1, fakeClient([[1, null]]));
  assert.match(problem, /cannot report to themselves/i);
});

test("clearing the reporting person is always allowed", async () => {
  assert.equal(await reportingProblem(1, null, fakeClient([[1, null]])), null);
});

test("refuses the two-person ring", async () => {
  // Priya (2) already reports to Arun (1). Pointing Arun at Priya would close the loop.
  const problem = await reportingProblem(1, 2, fakeClient([[1, null], [2, 1]]));
  assert.match(problem, /loop/i);
});

test("refuses a longer ring, however many levels up it closes", async () => {
  // 4 -> 3 -> 2 -> 1. Pointing 1 at 4 puts the top of the chain under its own descendant.
  const problem = await reportingProblem(1, 4, fakeClient([[1, null], [2, 1], [3, 2], [4, 3]]));
  assert.match(problem, /loop/i);
});

test("allows a deep chain that does not close", async () => {
  // 1 is a root; 4 sits under an unrelated line, so 1 may report to 4 without forming a ring.
  assert.equal(await reportingProblem(1, 4, fakeClient([[1, null], [2, null], [3, 2], [4, 3]])), null);
});

test("allows the ordinary case of reporting to a root", async () => {
  assert.equal(await reportingProblem(2, 1, fakeClient([[1, null], [2, null]])), null);
});

test("refuses a reporting person who is archived or no longer employed", async () => {
  const problem = await reportingProblem(1, 99, fakeClient([[1, null]]));
  assert.match(problem, /no longer an employee/i);
});

test("a ring already in the data does not hang the walk", async () => {
  // 2 and 3 point at each other — written before this guard existed, or by a direct database edit.
  // Checking an unrelated employee against that line has to terminate rather than spin forever.
  const problem = await reportingProblem(1, 2, fakeClient([[1, null], [2, 3], [3, 2]]));
  // Not a loop for employee 1, and the walk still ends.
  assert.equal(problem, null);
});

test("the walk stops where the chain runs into somebody archived", async () => {
  // 2 reports to 99, who is gone. The chain ends there rather than reporting a false loop.
  assert.equal(await reportingProblem(1, 2, fakeClient([[1, null], [2, 99]])), null);
});
