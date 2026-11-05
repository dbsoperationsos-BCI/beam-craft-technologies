const test = require("node:test");
const assert = require("node:assert/strict");
const { withUserNames, nameKeyFor, userDisplayName } = require("../src/services/userNames");

/*
 * A created_by / updated_by column holds a USER id, so its name is read through that user - their
 * linked employee's name, else their own - never by looking the number up among employees.
 */
function fakeClient(users) {
  const calls = [];
  return {
    calls,
    user: { findMany: async (query) => { calls.push(query); return users.filter((user) => query.where.id.in.includes(user.id)); } },
    // Present so a wrong lookup would be caught: it must never be asked.
    employee: { findMany: async () => { throw new Error("user ids are not employee ids"); } },
  };
}

test("each user id field gains its name, through the user to their linked employee", async () => {
  const client = fakeClient([
    { id: 7, name: "admin", linkedEmployee: { employeeName: "Arun Prakash" } },
    { id: 9, name: "Ravi (login)", linkedEmployee: null },
  ]);
  const rows = await withUserNames([{ id: "a", createdBy: 7, updatedBy: 9 }, { id: "b", createdByUserId: 9, decidedById: null }], { client });
  assert.equal(rows[0].createdByName, "Arun Prakash", "the linked employee's name");
  assert.equal(rows[0].updatedByName, "Ravi (login)", "no employee linked: the user's own name");
  assert.equal(rows[1].createdByName, "Ravi (login)", "createdByUserId names createdBy");
  assert.equal(rows[1].decidedByName, null);
  assert.equal(rows[0].createdBy, 7, "the id itself is kept");
  // One query, of users, for every id at once.
  assert.equal(client.calls.length, 1);
  assert.deepEqual(client.calls[0].where.id.in.sort(), [7, 9]);
});

test("the name key drops UserId / Id, and a list with no user ids is left alone", async () => {
  assert.equal(nameKeyFor("createdByUserId"), "createdByName");
  assert.equal(nameKeyFor("decidedById"), "decidedByName");
  assert.equal(nameKeyFor("updatedBy"), "updatedByName");
  assert.equal(userDisplayName({ name: "x", linkedEmployee: { employeeName: "Y" } }), "Y");
  const client = fakeClient([]);
  assert.deepEqual(await withUserNames([{ id: 1 }], { client }), [{ id: 1 }]);
  assert.equal(client.calls.length, 0);
});

test("a field holding a relation rather than an id is left alone, and so is the name beside it", async () => {
  // A payment request's `requestedBy` is the employee record; reading it as a user id wrote null
  // over `requestedByName`, so the list showed "Raised by —" for every request.
  const client = fakeClient([{ id: 7, name: "admin", linkedEmployee: null }]);
  const rows = await withUserNames([
    { id: "r1", requestedBy: { employeeId: "DBS-4", employeeName: "Pradeep Reddy" }, requestedByName: "Pradeep Reddy", decidedBy: 7 },
  ], { client });
  assert.equal(rows[0].requestedByName, "Pradeep Reddy");
  assert.deepEqual(rows[0].requestedBy, { employeeId: "DBS-4", employeeName: "Pradeep Reddy" });
  assert.equal(rows[0].decidedByName, "admin", "a real id beside it is still named");
});
