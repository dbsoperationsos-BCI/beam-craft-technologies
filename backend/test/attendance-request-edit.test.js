const test = require("node:test");
const assert = require("node:assert/strict");

const service = require("../src/modules/hrm/attendance/service");
const { edit } = service;

/**
 * The raiser correcting their own request.
 *
 * It was "Apply again", which raised a second request and left the first one sitting beside it, so
 * two rows described one ask. The row is edited instead - and **every answer is cleared**, whatever
 * it was: an approval of 20-22 October is not an approval of 2-3 November, and an approver who has
 * already said yes is asked again about what is actually being asked now.
 */

/** A client holding one request, enough for the writes `edit` makes. */
function fakeClient(request) {
  const state = { request: { ...request, approvals: (request.approvals || []).map((row) => ({ ...row })) }, events: [] };
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
    },
    attendanceRequestEvent: { create: async ({ data }) => { state.events.push(data); return data; } },
  };
  return client;
}

const raiser = { raiserEmployeeId: 9, user: { id: 9, name: "Raiser" } };

test("an edit puts the request back in front of everybody", async () => {
  const client = fakeClient({
    id: "r1", status: "APPROVED", employeeId: 9, type: "LEAVE",
    approvals: [
      { id: "a1", approverEmployeeId: 1, decision: "APPROVED" },
      { id: "a2", approverEmployeeId: 2, decision: "APPROVED" },
    ],
  });
  await edit(client, { request: client.state.request, ...raiser, patch: { fromDate: "2026-11-02", toDate: "2026-11-03", reason: "Moved" } });

  assert.equal(client.state.request.status, "PENDING", "an approved leave edited is pending again");
  assert.deepEqual(client.state.request.approvals.map((row) => row.decision), ["PENDING", "PENDING"]);
  assert.equal(client.state.request.fromDate, "2026-11-02");
  assert.equal(client.state.events.at(-1).action, "EDITED");
  // The old decision is gone with the answers: nobody has settled this, and the remark that refused
  // or returned the previous version does not describe the one now being asked about.
  assert.equal(client.state.request.decidedById, null);
  assert.equal(client.state.request.decisionRemarks, null);
});

test("a request with no approval rows at all does not break the edit", async () => {
  /*
   * Older rows, and types whose approvers have since been removed: `outcomeOf([])` is PENDING and
   * nothing here may divide by an empty list. Whether such an edit is *allowed* is the controller's
   * question - it resolves the approvers of today and refuses an empty list in the same words
   * raising one does (`assertApproversExist`).
   */
  const client = fakeClient({ id: "r1", status: "PENDING", employeeId: 9, type: "LEAVE", approvals: [] });
  await edit(client, { request: client.state.request, ...raiser, patch: { reason: "Fixed" } });
  assert.equal(client.state.request.status, "PENDING");
});

test("every status but deleted and the legacy cancelled is editable", async () => {
  for (const status of ["PENDING", "SENT_BACK", "APPROVED", "REJECTED", "REVERTED"]) {
    const client = fakeClient({ id: "r1", status, employeeId: 9, type: "LEAVE", approvals: [] });
    await edit(client, { request: client.state.request, ...raiser, patch: { reason: "Fixed" } });
    assert.equal(client.state.request.status, "PENDING", status);
  }
  for (const status of ["DELETED", "CANCELLED"]) {
    const client = fakeClient({ id: "r1", status, employeeId: 9, type: "LEAVE", approvals: [] });
    await assert.rejects(
      () => edit(client, { request: client.state.request, ...raiser, patch: { reason: "x" } }),
      new RegExp(status.toLowerCase(), "i"),
      status,
    );
  }
});

test("an edit cannot move the request to somebody else, or change what kind of request it is", async () => {
  const client = fakeClient({ id: "r1", status: "PENDING", employeeId: 9, type: "LEAVE", approvals: [] });
  await edit(client, {
    request: client.state.request,
    ...raiser,
    // What a crafted body would carry. The patch is the raiser's own fields and nothing else: a
    // LEAVE edited into a CORRECTION would skip the checks a Correction is raised through.
    patch: { reason: "Fixed", employeeId: 4, type: "CORRECTION", status: "APPROVED" },
  });
  assert.equal(client.state.request.employeeId, 9);
  assert.equal(client.state.request.type, "LEAVE");
  assert.equal(client.state.request.status, "PENDING");
});

test("an edit is somebody's own request only", async () => {
  const client = fakeClient({ id: "r1", status: "PENDING", employeeId: 4, type: "LEAVE", approvals: [] });
  await assert.rejects(() => edit(client, { request: client.state.request, ...raiser, patch: { reason: "x" } }), /your own/i);
});

test("an edit can carry a check that has to run inside the write", async () => {
  /*
   * A comp-off's worked day may be claimed once, and the claim is read under a row lock so two
   * submits a moment apart cannot both pass it (`compOffClaimProblem`, as `createRequest` does).
   * That has to happen inside the same transaction as the write, which is the service's, so the
   * controller hands the check in rather than running it a moment earlier and hoping.
   */
  const client = fakeClient({ id: "r1", status: "PENDING", employeeId: 9, type: "COMP_OFF", approvals: [] });
  const ran = [];
  await edit(client, {
    request: client.state.request, ...raiser, patch: { reason: "Fixed" },
    beforeWrite: async (tx) => { ran.push(tx === client); },
  });
  assert.deepEqual(ran, [true], "it runs once, with the transaction");
  assert.equal(client.state.request.status, "PENDING");

  // A check that refuses stops the edit.
  const blocked = fakeClient({ id: "r2", status: "PENDING", employeeId: 9, type: "COMP_OFF", approvals: [] });
  await assert.rejects(
    () => edit(blocked, {
      request: blocked.state.request, ...raiser, patch: { reason: "Fixed" },
      beforeWrite: async () => { throw Object.assign(new Error("already claimed"), { status: 400 }); },
    }),
    /already claimed/,
  );
  assert.equal(blocked.state.request.status, "PENDING");
});
