const test = require("node:test");
const assert = require("node:assert/strict");

const { edit, revert, remove } = require("../src/modules/hrm/attendance/service");

/**
 * The two request types whose approval **writes onto the day**.
 *
 * Only `APPROVED` ever counted towards the register, the reports or a leave balance - which is why
 * the new statuses needed no attendance code at all. That is true of leave, permission and comp-off
 * and false of these two: approving a `CORRECTION` writes the session's `logoutAt`
 * (`applyCorrection`), and approving an `INCORRECT_LOGIN` upserts an `AttendanceStatusOverride`
 * (`applyCorrectionStatus`) - and nothing in this codebase ever deletes one.
 *
 * So editing, reverting or deleting an approved one would leave the day carrying a change whose
 * request no longer says it was approved: a day nobody can explain. They freeze once approved, and
 * the way back is a fresh request, which is what the refusal says.
 */

function fakeClient(request) {
  const state = { request: { ...request, approvals: (request.approvals || []).map((row) => ({ ...row })) }, events: [] };
  const client = {
    state,
    $transaction: async (run) => run(client),
    // Every verb locks the request row before it writes, so the stand-in has to answer the lock.
    $queryRaw: async () => [],
    attendanceRequestApproval: { updateMany: async ({ data }) => {
      for (const row of state.request.approvals) Object.assign(row, data);
      return { count: state.request.approvals.length };
    } },
    attendanceRequest: {
      update: async ({ data }) => { Object.assign(state.request, data); return state.request; },
      findUnique: async () => state.request,
    },
    attendanceRequestEvent: { create: async ({ data }) => { state.events.push(data); return data; } },
  };
  return client;
}

const raiser = { raiserEmployeeId: 9, user: { id: 9 } };

test("an approved correction cannot be edited, reverted or deleted", async () => {
  for (const type of ["CORRECTION", "INCORRECT_LOGIN"]) {
    const row = () => ({ id: "r1", status: "APPROVED", employeeId: 9, type, approvals: [] });
    await assert.rejects(() => edit(fakeClient(row()), { request: row(), ...raiser, patch: { reason: "x" } }), /already changed that day/i, type);
    await assert.rejects(() => revert(fakeClient(row()), { request: row(), ...raiser }), /already changed that day/i, type);
    await assert.rejects(() => remove(fakeClient(row()), { request: row(), ...raiser }), /already changed that day/i, type);
  }
});

test("the same two are freely editable while nobody has approved them", async () => {
  for (const type of ["CORRECTION", "INCORRECT_LOGIN"]) {
    for (const status of ["PENDING", "SENT_BACK", "REJECTED", "REVERTED"]) {
      const client = fakeClient({ id: "r1", status, employeeId: 9, type, approvals: [] });
      await edit(client, { request: client.state.request, ...raiser, patch: { reason: "fixed" } });
      assert.equal(client.state.request.status, "PENDING", `${type} ${status}`);
    }
  }
});

test("leave, permission and comp-off are untouched by this rule", async () => {
  for (const type of ["LEAVE", "PERMISSION", "COMP_OFF", "ON_DUTY"]) {
    const client = fakeClient({ id: "r1", status: "APPROVED", employeeId: 9, type, approvals: [] });
    await edit(client, { request: client.state.request, ...raiser, patch: { reason: "moved" } });
    assert.equal(client.state.request.status, "PENDING", type);
  }
});

test("the type is read however it is spelt, and a missing one freezes nothing", async () => {
  // `type` comes off a row, but the rule must not turn on its casing, and a row without one is not
  // one of these two.
  const lower = fakeClient({ id: "r1", status: "APPROVED", employeeId: 9, type: "correction", approvals: [] });
  await assert.rejects(() => edit(lower, { request: lower.state.request, ...raiser, patch: { reason: "x" } }), /already changed that day/i);
  const none = fakeClient({ id: "r2", status: "APPROVED", employeeId: 9, approvals: [] });
  await edit(none, { request: none.state.request, ...raiser, patch: { reason: "x" } });
  assert.equal(none.state.request.status, "PENDING");
});
