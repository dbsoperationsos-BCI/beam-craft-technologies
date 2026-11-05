const test = require("node:test");
const assert = require("node:assert/strict");

const service = require("../src/modules/hrm/attendance/service");
const { revert, remove } = service;

/**
 * The raiser's own two verbs.
 *
 * Withdraw, Cancel and Apply again were three ways out of a request, two of which read as the same
 * thing and one of which deleted the row. They are one way out and one ending now:
 *
 *   **Revert back** pulls the request out of every queue and leaves it with the raiser, every answer
 *   cleared, editable back into the queues.
 *   **Delete** marks it `DELETED` and keeps the row - the raiser goes on seeing what they did, and
 *   it counts for nothing, because only `APPROVED` ever counted.
 */

/** A client holding one request, enough for the writes the two verbs make. */
function fakeClient(request) {
  const state = {
    request: { ...request, approvals: (request.approvals || []).map((row) => ({ ...row })) },
    events: [], deleted: false, noticesCleared: null,
  };
  const client = {
    state,
    $transaction: async (run) => run(client),
    // Every verb locks the request row before it writes, so the stand-in has to answer the lock.
    $queryRaw: async () => [],
    attendanceRequestApproval: {
      updateMany: async ({ data }) => {
        for (const row of state.request.approvals) Object.assign(row, data);
        return { count: state.request.approvals.length };
      },
    },
    attendanceRequest: {
      update: async ({ data }) => { Object.assign(state.request, data); return state.request; },
      findUnique: async () => state.request,
      delete: async () => { state.deleted = true; return state.request; },
    },
    attendanceRequestEvent: {
      create: async ({ data }) => { state.events.push(data); return data; },
    },
  };
  return client;
}

test("revert back takes it out of the queues and leaves it with the raiser", async () => {
  const client = fakeClient({ id: "r1", status: "PENDING", employeeId: 9, approvals: [{ id: "a1", approverEmployeeId: 1, decision: "APPROVED" }] });
  await revert(client, { request: client.state.request, raiserEmployeeId: 9, user: { id: 9, name: "Raiser" } });
  assert.equal(client.state.request.status, "REVERTED");
  assert.deepEqual(client.state.request.approvals.map((row) => row.decision), ["PENDING"]);
  assert.equal(client.state.events.at(-1).action, "REVERTED");
  // Nobody settled it, so nobody is named as having done so.
  assert.equal(client.state.request.decidedById, null);
});

test("delete marks it deleted and keeps the row", async () => {
  const client = fakeClient({ id: "r1", status: "APPROVED", employeeId: 9, type: "LEAVE", approvals: [] });
  await remove(client, { request: client.state.request, raiserEmployeeId: 9, user: { id: 9, name: "Raiser" } });
  assert.equal(client.state.request.status, "DELETED");
  assert.equal(client.state.deleted, false, "the row must still be there");
  // Terminal: there is no way back, and a second press says so rather than doing it twice.
  await assert.rejects(() => remove(client, { request: client.state.request, raiserEmployeeId: 9, user: { id: 9 } }), /deleted/i);
});

test("a reverted request is the raiser's to delete, but there is nothing left to revert it out of", async () => {
  const client = fakeClient({ id: "r1", status: "REVERTED", employeeId: 9, approvals: [] });
  await assert.rejects(() => revert(client, { request: client.state.request, raiserEmployeeId: 9, user: { id: 9 } }), /reverted/i);
  await remove(client, { request: client.state.request, raiserEmployeeId: 9, user: { id: 9 } });
  assert.equal(client.state.request.status, "DELETED");
});

test("neither verb touches somebody else's request, or a cancelled one", async () => {
  const other = fakeClient({ id: "r1", status: "PENDING", employeeId: 4, approvals: [] });
  await assert.rejects(() => revert(other, { request: other.state.request, raiserEmployeeId: 9, user: { id: 9 } }), /your own/i);
  await assert.rejects(() => remove(other, { request: other.state.request, raiserEmployeeId: 9, user: { id: 9 } }), /your own/i);
  // A login with no employee behind it is nobody's raiser, and must not match a request's null.
  await assert.rejects(() => revert(other, { request: other.state.request, raiserEmployeeId: null, user: { id: 9 } }), /your own/i);
  const old = fakeClient({ id: "r2", status: "CANCELLED", employeeId: 9, approvals: [] });
  await assert.rejects(() => revert(old, { request: old.state.request, raiserEmployeeId: 9, user: { id: 9 } }), /cancelled/i);
  await assert.rejects(() => remove(old, { request: old.state.request, raiserEmployeeId: 9, user: { id: 9 } }), /cancelled/i);
});
