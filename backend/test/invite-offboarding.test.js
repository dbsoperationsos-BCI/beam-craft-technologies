const test = require("node:test");
const assert = require("node:assert/strict");
const { employeeFromInvite, separationCreateSchema, STATUS_BY_TYPE } = require("../src/modules/hrm/separations/controller");

/*
 * Offboarding a hire that fell through before the candidate ever submitted their form.
 *
 * Those rows are onboarding **invites**, not employees - the repository draws them beside employee
 * rows, which is why they look alike, but there is no record behind them and no employee id for a
 * separation to point at. All the menu could do was cancel the invite, which removed the row from
 * the list and left the studio with no account of what happened.
 *
 * So the invite becomes a record at the moment it is offboarded, inside the same transaction, and
 * from there it is an ordinary departure: it lands in InActive, and Move to Active brings it back
 * to the wait it was in.
 */

const inviteRow = (overrides = {}) => ({
  id: "inv_1",
  candidateName: "Priya Sharma",
  candidateEmail: "priya@example.com",
  candidatePhone: "+91 9876543210",
  intendedDesignation: "Photographer",
  employeeId: null,
  ...overrides,
});

function clientHolding(invite) {
  const calls = { created: [], updated: [] };
  return [{
    employeeOnboardingInvite: {
      findUnique: async () => invite,
      update: async (args) => { calls.updated.push(args); return invite; },
    },
    employee: { create: async (args) => { calls.created.push(args.data); return { id: 77, ...args.data }; } },
    // The studio's own counter, which the record's `DBS-n` is minted from inside this same
    // transaction - so a separation that fails to save does not spend a number.
    appSequence: { upsert: async () => ({ currentValue: 5 }) },
  }, calls];
}

test("the record carries the four answers the invite already held", async () => {
  const [client, calls] = clientHolding(inviteRow());
  const employee = await employeeFromInvite(client, "inv_1");

  assert.equal(employee.id, 77);
  const [created] = calls.created;
  // Minted rather than invented: the same `EMPLOYEE` scheme every other record is numbered by.
  assert.match(created.employeeId, /^DBS-\d+$/);
  assert.equal(created.employeeName, "Priya Sharma");
  assert.equal(created.emailId, "priya@example.com");
  assert.equal(created.contactNumber, "+91 9876543210");
  assert.equal(created.designation, "Photographer");
});

/*
 * The status the repository was already showing the invite under. The separation stores it as
 * `previousEmploymentStatus` a moment later, which is what Move to Active reads - so the row
 * returns to the same wait rather than a candidate who never started being promoted to Active.
 */
test("the record starts on the status the invite row was shown under", async () => {
  const [client, calls] = clientHolding(inviteRow());
  await employeeFromInvite(client, "inv_1");
  assert.equal(calls.created[0].employmentStatus, "Employee Submission Pending");
});

// Cancelled because nothing is being asked of the candidate any more, and pointed at the new record
// so the repository stops drawing the invite row beside the employee row that now stands for it.
test("the invite is closed and pointed at the record that replaces it", async () => {
  const [client, calls] = clientHolding(inviteRow());
  await employeeFromInvite(client, "inv_1");
  const [{ data }] = calls.updated;
  assert.equal(data.status, "Cancelled");
  assert.equal(data.employeeId, "77");
  assert.ok(data.cancelledAt instanceof Date);
});

test("an invite that already became a record is refused rather than duplicated", async () => {
  const [client, calls] = clientHolding(inviteRow({ employeeId: "12" }));
  await assert.rejects(
    () => employeeFromInvite(client, "inv_1"),
    (error) => error.status === 409 && /already has an employee record/.test(error.message),
  );
  assert.deepEqual(calls.created, []);
});

test("an invite that is not there reads as not found", async () => {
  const [client] = clientHolding(null);
  await assert.rejects(() => employeeFromInvite(client, "nope"), (error) => error.status === 404);
});

/* ------------------------------------------------------- what the endpoint accepts as its subject */

const payload = { separationType: "Resignation", separationReason: "Took another offer", proposedLastWorkingDate: "2026-09-30" };

test("offboarding takes an employee or an invite", () => {
  assert.equal(separationCreateSchema.safeParse({ ...payload, employeeId: 12 }).success, true);
  assert.equal(separationCreateSchema.safeParse({ ...payload, inviteId: "inv_1" }).success, true);
});

// Both would leave the endpoint choosing which one the reader meant; neither has nothing to record
// against. Either way the request says something the server cannot act on, so it is refused.
test("it refuses a request naming both, or neither", () => {
  assert.equal(separationCreateSchema.safeParse({ ...payload, employeeId: 12, inviteId: "inv_1" }).success, false);
  assert.equal(separationCreateSchema.safeParse(payload).success, false);
});

test("an offboarded invite lands on a status the InActive tab holds", () => {
  assert.ok(["Relieved", "Fired", "Absconded"].includes(STATUS_BY_TYPE[payload.separationType]));
});
