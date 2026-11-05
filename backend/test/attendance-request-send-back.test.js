const test = require("node:test");
const assert = require("node:assert/strict");

const service = require("../src/modules/hrm/attendance/service");

/**
 * Send back: an approver's third answer.
 *
 * A request that is nearly right - the wrong dates, a reason nobody can act on - used to have to be
 * rejected, which says something harsher and truer of nothing. It goes back to the raiser instead,
 * with a reason, and waits in their Send Back tab until they fix it.
 *
 * **Every answer is cleared**, not only the sender's: the raiser is about to change the request, and
 * an approval given for the old dates is not an approval of the new ones.
 */

/** A client holding one request, enough for the writes `sendBack` makes. */
function fakeClient(request) {
  const state = { request: { ...request, approvals: (request.approvals || []).map((row) => ({ ...row })) }, events: [] };
  const client = {
    state,
    $transaction: async (run) => run(client),
    // Every verb locks the request row before it writes, so the stand-in has to answer the lock.
    $queryRaw: async () => [],
    attendanceRequestApproval: {
      updateMany: async ({ where, data }) => {
        const rows = state.request.approvals.filter((row) => row.requestId === undefined || row.requestId === where.requestId);
        for (const row of rows) Object.assign(row, data);
        return { count: rows.length };
      },
    },
    attendanceRequest: {
      update: async ({ data }) => { Object.assign(state.request, data); return state.request; },
      findUnique: async () => state.request,
    },
    attendanceRequestEvent: {
      create: async ({ data }) => { state.events.push(data); return data; },
    },
  };
  return client;
}

test("send back clears every answer and takes the request out of the queues", async () => {
  const client = fakeClient({
    id: "r1", status: "PENDING", type: "LEAVE", employeeId: 9,
    approvals: [
      { id: "a1", approverEmployeeId: 1, decision: "APPROVED" },
      { id: "a2", approverEmployeeId: 2, decision: "PENDING" },
    ],
  });
  await service.sendBack(client, { request: client.state.request, user: { id: 7, name: "B" }, remarks: "Wrong dates." });

  assert.equal(client.state.request.status, "SENT_BACK");
  assert.deepEqual(client.state.request.approvals.map((row) => row.decision), ["PENDING", "PENDING"]);
  // The reason the raiser is shown, and the history saying who sent it back.
  assert.equal(client.state.request.decisionRemarks, "Wrong dates.");
  assert.equal(client.state.events.at(-1).action, "SENT_BACK");
  assert.equal(client.state.events.at(-1).remarks, "Wrong dates.");
  // Nobody is named as having settled it: it is not settled, it is back with the raiser.
  assert.equal(client.state.request.decidedById, null);
});

test("send back needs a reason", async () => {
  const client = fakeClient({ id: "r1", status: "PENDING", type: "LEAVE", approvals: [] });
  for (const remarks of ["", "   ", undefined]) {
    await assert.rejects(
      () => service.sendBack(client, { request: client.state.request, user: { id: 7 }, remarks }),
      /why it is going back/i,
      String(remarks),
    );
  }
});

test("an approved request cannot be sent back - that would be a rejection by another name", async () => {
  for (const status of ["APPROVED", "SENT_BACK", "REVERTED", "DELETED", "CANCELLED"]) {
    const client = fakeClient({ id: "r1", status, type: "LEAVE", approvals: [] });
    await assert.rejects(
      () => service.sendBack(client, { request: client.state.request, user: { id: 7 }, remarks: "Late" }),
      new RegExp(status.toLowerCase().replace("_", " "), "i"),
      status,
    );
  }
});

test("a rejected request may still be sent back, so a refusal can become a question", async () => {
  const client = fakeClient({ id: "r1", status: "REJECTED", type: "LEAVE", approvals: [{ id: "a1", approverEmployeeId: 1, decision: "REJECTED" }] });
  await service.sendBack(client, { request: client.state.request, user: { id: 7 }, remarks: "Try the 4th instead." });
  assert.equal(client.state.request.status, "SENT_BACK");
  assert.deepEqual(client.state.request.approvals.map((row) => row.decision), ["PENDING"]);
});

/*
 * And the other half of send back: the approver's list stops holding it.
 *
 * `visibilityFilter(user, "team")` is what both the Requests screen and Nebula's lookup read, so the
 * clause is the one place that decides whether a sent-back request still sits in somebody's list.
 * It must not: it is with the raiser. What else leaves, and what stays as an approver's own history,
 * is pinned in `attendance-request-review-fixes.test.js`.
 */
test("a request the raiser has taken away leaves the approvers' list", async () => {
  const prisma = require("../src/config/db");
  const iam = require("../src/services/iam.service");
  const real = { user: prisma.user.findUnique, perm: iam.hasPermission };
  prisma.user.findUnique = async () => ({ linkedEmployeeId: 11 });
  iam.hasPermission = async () => false; // not an administrator: a named approver
  try {
    const where = await service.visibilityFilter({ id: 7 }, "team");
    assert.deepEqual(where.status, { notIn: ["SENT_BACK", "REVERTED", "DELETED"] });
    assert.deepEqual(where.approvals, { some: { approverEmployeeId: 11 } });
  } finally {
    prisma.user.findUnique = real.user;
    iam.hasPermission = real.perm;
  }
});
