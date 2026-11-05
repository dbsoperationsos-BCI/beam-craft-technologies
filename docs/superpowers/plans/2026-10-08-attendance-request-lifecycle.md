# Attendance request lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the raiser View / Edit / Revert back / Delete and the approver Accept / Reject / Send
back, with a rejection reversible to an approval but never the other way round.

**Architecture:** The request's status is already computed from its approval rows by
`approvals.outcomeOf` — the work is to let a row change, to re-run that, and to add three statuses the
raiser's own verbs set (`SENT_BACK`, `REVERTED`, `DELETED`). No schema change: `status` is
`VarChar(20)`. Nothing in the attendance register changes, because it filters on `APPROVED` — with
one exception the spec missed, handled in Task 6.

**Tech Stack:** Express + Prisma (MySQL) on the backend; Next.js 16 App Router, React 19 on the
frontend. Tests are `node:test` on both sides.

**Spec:** `docs/superpowers/specs/2026-10-08-attendance-request-lifecycle-design.md`

## Global Constraints

- Statuses are exactly `PENDING`, `SENT_BACK`, `APPROVED`, `REJECTED`, `REVERTED`, `DELETED`, plus
  legacy `CANCELLED` rows which are never migrated and must keep reading as "Cancelled".
- A rejection may become an approval. **An approval may never become a rejection.**
- An approver may change only their own answer, never another's.
- The request's status is computed by `outcomeOf(approvals, type)` after every change to a row —
  never assigned directly, except by the raiser's verbs (`SENT_BACK`, `REVERTED`, `DELETED`).
- Every new verb records an event through `service.recordEvent`, so none of them is silent.
- Every new verb refuses a request that is not the caller's to act on, by the rules already in
  `service.canDecide` (approver) and the owner check in `cancelRequest` (raiser).
- Send back requires a remark. Approve takes none. Reject already requires one.
- No new permission: the existing `readRequests` / `requestGuard` guards are reused unchanged.
- `npm test` must pass in **both** `backend` and `frontend`; twelve backend tests read frontend
  source, so a frontend change can break the backend suite.

## Review Focus

1. **Two approvers at once, one of them reversing a rejection.** The row lock in `decide()` settles
   simultaneous answers today; a reversal path that reads the rows before the lock would reintroduce
   the race it was written to fix. Pinned in Task 2.
2. **A request with no approval rows at all** (older data, or a type whose approvers were removed).
   `outcomeOf([])` answers `PENDING`; edit, send back, revert and delete must not divide by it or
   crash. Pinned in Task 5.
3. **A legacy `CANCELLED` request.** It is not `PENDING`, so every new verb must refuse it with a
   sentence rather than treat it as open or crash on an unknown status. Pinned in Task 1 and Task 4.
4. **An approved Checkout correction or Attendance Regularization.** Approving one writes a stored
   `AttendanceStatusOverride` (and, for `CORRECTION`, the session's `logoutAt`) that nothing deletes,
   so editing, reverting or deleting it would leave the day changed by an approval that no longer
   exists. Pinned in Task 6.
5. **A deleted request still on an approver's bell.** `clearApproverNotices` is what takes a request
   off the bell; delete, revert and send back must each call it or an approver is left with a
   notification for a row they can no longer open. Pinned in Task 3 and Task 4.

---

### Task 1: The six statuses and their labels

**Files:**
- Modify: `backend/src/modules/hrm/attendance/attendanceRules.js:55` and `:644-650`
- Test: `backend/test/hrm-attendance-rules.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `REQUEST_STATUSES` including `"SENT_BACK"`, `"REVERTED"`, `"DELETED"`;
  `requestDisplayStatus(request, now)` returning `"Send Back"`, `"Reverted"`, `"Deleted"` for them.

- [ ] **Step 1: Write the failing test**

```js
test("the six statuses each read as themselves, and an old cancelled row still reads", () => {
  assert.deepEqual(REQUEST_STATUSES, ["PENDING", "SENT_BACK", "APPROVED", "REJECTED", "REVERTED", "DELETED"]);
  const at = (status) => requestDisplayStatus({ status, fromDate: "2026-01-01" }, new Date("2026-06-01"));
  assert.equal(at("PENDING"), "Pending");
  assert.equal(at("SENT_BACK"), "Send Back");
  assert.equal(at("REJECTED"), "Rejected");
  assert.equal(at("REVERTED"), "Reverted");
  assert.equal(at("DELETED"), "Deleted");
  // Never migrated: it is what happened to those rows.
  assert.equal(at("CANCELLED"), "Cancelled");
  // Unchanged: an approved request whose first day is still ahead reads as Upcoming.
  assert.equal(requestDisplayStatus({ status: "APPROVED", fromDate: "2026-12-01" }, new Date("2026-06-01")), "Upcoming");
  assert.equal(requestDisplayStatus({ status: "APPROVED", fromDate: "2026-01-01" }, new Date("2026-06-01")), "Approved");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && node --test test/hrm-attendance-rules.test.js`
Expected: FAIL — `REQUEST_STATUSES` has four entries and `at("SENT_BACK")` answers `"Pending"`.

- [ ] **Step 3: Add the statuses and the labels**

```js
// attendanceRules.js:55
const REQUEST_STATUSES = ["PENDING", "SENT_BACK", "APPROVED", "REJECTED", "REVERTED", "DELETED"];
```

```js
// attendanceRules.js, inside requestDisplayStatus
if (request?.status !== "APPROVED") {
  return {
    PENDING: "Pending",
    SENT_BACK: "Send Back",
    REJECTED: "Rejected",
    REVERTED: "Reverted",
    DELETED: "Deleted",
    // Never migrated. Requests cancelled under the old flow keep saying so.
    CANCELLED: "Cancelled",
  }[request?.status] || "Pending";
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd backend && node --test test/hrm-attendance-rules.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/hrm/attendance/attendanceRules.js backend/test/hrm-attendance-rules.test.js
git commit -m "feat(attendance): the six request statuses and their labels"
```

---

### Task 2: A rejection may become an approval; an approval may not become a rejection

**Files:**
- Modify: `backend/src/modules/hrm/attendance/controller.js:1384-1394` (the two guards at the top of
  `decide`) and the approval write inside its transaction
- Modify: `backend/src/modules/hrm/attendance/service.js:1570` (`myPendingApprovalFor`, which looks
  up the caller's row by `decision: "PENDING"`)
- Test: `backend/test/attendance-request-reversal.test.js` (create)

**Interfaces:**
- Consumes: `outcomeOf(approvals, type)` from `approvals.js:86`, unchanged.
- Produces: `decide()` accepting a second answer from an approver whose own row is `REJECTED` when the
  new answer is `APPROVED`, and refusing every other second answer.

- [ ] **Step 1: Write the failing test**

```js
test("an approver turns their rejection into an approval, and the request recomputes", async () => {
  // A leave with three approvers: A approved, B rejected, C pending -> the request is REJECTED.
  const rows = [
    { approverEmployeeId: 1, decision: "APPROVED" },
    { approverEmployeeId: 2, decision: "REJECTED" },
    { approverEmployeeId: 3, decision: "PENDING" },
  ];
  assert.equal(outcomeOf(rows, "LEAVE"), "REJECTED");
  // B changes their mind: still not everybody, so the request is PENDING again - not APPROVED.
  rows[1].decision = "APPROVED";
  assert.equal(outcomeOf(rows, "LEAVE"), "PENDING");
  // And when C answers, it is approved.
  rows[2].decision = "APPROVED";
  assert.equal(outcomeOf(rows, "LEAVE"), "APPROVED");
});

test("an approval cannot be turned into a rejection", () => {
  assert.equal(mayAnswer({ status: "PENDING" }, { decision: "APPROVED" }, "REJECTED"), false);
  assert.equal(mayAnswer({ status: "APPROVED" }, { decision: "APPROVED" }, "REJECTED"), false);
  // The one reversal allowed, from either resting place.
  assert.equal(mayAnswer({ status: "REJECTED" }, { decision: "REJECTED" }, "APPROVED"), true);
  assert.equal(mayAnswer({ status: "PENDING" }, { decision: "REJECTED" }, "APPROVED"), true);
  // A first answer, as before.
  assert.equal(mayAnswer({ status: "PENDING" }, { decision: "PENDING" }, "APPROVED"), true);
  assert.equal(mayAnswer({ status: "PENDING" }, { decision: "PENDING" }, "REJECTED"), true);
  // Nothing is answerable once the raiser has taken it away.
  for (const status of ["SENT_BACK", "REVERTED", "DELETED", "CANCELLED"]) {
    assert.equal(mayAnswer({ status }, { decision: "PENDING" }, "APPROVED"), false);
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && node --test test/attendance-request-reversal.test.js`
Expected: FAIL — `mayAnswer` is not exported from `approvals.js`.

- [ ] **Step 3: Write the rule, where the other decision rules live**

```js
// approvals.js - exported beside outcomeOf
/**
 * Whether this approver may give this answer now.
 *
 * One reversal is allowed and only one: a rejection may become an approval. The other direction is
 * refused however it is reached - an approval is what the register and the sent reports have already
 * called "On leave", and taking that back retroactively is what a Correction is for.
 *
 * A request the raiser has taken away - sent back, reverted, deleted - or one cancelled under the old
 * flow is answerable by nobody.
 */
function mayAnswer(request, myRow, answer) {
  if (!["PENDING", "REJECTED"].includes(String(request?.status || ""))) return false;
  const mine = String(myRow?.decision || "PENDING");
  if (mine === "PENDING") return true;
  return mine === "REJECTED" && answer === "APPROVED";
}
```

- [ ] **Step 4: Use it in `decide`, in place of the two guards**

```js
// controller.js, replacing the canDecide/status guards at the top of decide()
const myEmployeeId = await service.linkedEmployeeIdFor(req.user);
const myRow = (request.approvals || []).find((row) => row.approverEmployeeId === myEmployeeId) || null;
if (!myRow) throw forbidden("You are not an approver for this request.");
if (!mayAnswer(request, myRow, status)) {
  if (myRow.decision === "APPROVED" && status === "REJECTED") {
    throw badRequest("You have already approved this request. An approval cannot be turned into a rejection - raise a Correction instead.");
  }
  if (!["PENDING", "REJECTED"].includes(request.status)) {
    throw badRequest(`This request has been ${request.status.toLowerCase()} and can no longer be answered.`);
  }
  throw badRequest(`You have already ${myRow.decision.toLowerCase()} this request.`);
}
```

Inside the transaction, the row is **updated by its own id** rather than found by
`decision: "PENDING"`, so a reversal lands on the row that already holds an answer:

```js
await tx.attendanceRequestApproval.update({ where: { id: mine.id }, data: { decision: status, remarks, decidedAt: new Date() } });
```

The re-read inside the lock keeps the race closed — it must re-check `mayAnswer` against the rows as
they are *after* the lock, not the ones loaded before it:

```js
const current = await tx.attendanceRequest.findUnique({ where: { id: request.id }, include: service.requestInclude });
const mine = (current.approvals || []).find((row) => row.approverEmployeeId === decidedById);
if (!mine || !mayAnswer(current, mine, status)) throw badRequest("This request has changed since you opened it. Open it again to see where it stands.");
```

- [ ] **Step 5: Run the tests and the suite**

Run: `cd backend && node --test test/attendance-request-reversal.test.js && npm test`
Expected: PASS, and the existing attendance request tests still pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/hrm/attendance/approvals.js backend/src/modules/hrm/attendance/controller.js backend/test/attendance-request-reversal.test.js
git commit -m "feat(attendance): a rejection may become an approval, never the reverse"
```

---

### Task 3: Send back

**Files:**
- Modify: `backend/src/modules/hrm/attendance/controller.js` (add `sendBackRequest`)
- Modify: `backend/src/modules/hrm/attendance/routes.js:41` (add the route beside approve/reject)
- Modify: `backend/src/modules/hrm/attendance/service.js` (queue `where` excludes the new statuses)
- Test: `backend/test/attendance-request-send-back.test.js` (create)

**Interfaces:**
- Consumes: `mayAnswer` (Task 2), `service.recordEvent`, `clearApproverNotices`.
- Produces: `POST /api/hrm/attendance/requests/:id/send-back` taking `{ remarks }`, required.

- [ ] **Step 1: Write the failing test**

```js
test("send back clears every answer and takes the request out of the queues", async () => {
  const request = { id: "r1", status: "PENDING", type: "LEAVE", employeeId: 9, approvals: [
    { id: "a1", approverEmployeeId: 1, decision: "APPROVED" },
    { id: "a2", approverEmployeeId: 2, decision: "PENDING" },
  ] };
  const client = fakeClient(request);
  await sendBack(client, { request, approverEmployeeId: 2, user: { id: 7, name: "B" }, remarks: "Wrong dates." });

  assert.equal(client.state.request.status, "SENT_BACK");
  assert.deepEqual(client.state.request.approvals.map((row) => row.decision), ["PENDING", "PENDING"]);
  assert.equal(client.state.events.at(-1).action, "SENT_BACK");
  assert.equal(client.state.events.at(-1).remarks, "Wrong dates.");
  assert.equal(client.state.noticesCleared, "r1");
});

test("send back needs a reason, and is refused once the request is approved", async () => {
  await assert.rejects(() => sendBack(fakeClient({ id: "r1", status: "PENDING", approvals: [] }), { remarks: "" }), /reason/i);
  await assert.rejects(
    () => sendBack(fakeClient({ id: "r1", status: "APPROVED", approvals: [] }), { remarks: "Late" }),
    /approved/i,
    "sending back an approved request would be a rejection by another name",
  );
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && node --test test/attendance-request-send-back.test.js`
Expected: FAIL — `sendBack` is not exported from `service.js`.

- [ ] **Step 3: Write it in the service, so the controller stays thin**

```js
/**
 * Back to the raiser to be fixed: an answer for a request that is nearly right, where a rejection
 * would say something harsher and truer of nothing.
 *
 * **Every answer is cleared**, not only the sender's. The raiser is about to change the request, and
 * an approval given for the old dates is not an approval of the new ones - the same reasoning as the
 * edit in Task 5. It leaves every queue, so nobody is holding a row they cannot act on.
 */
async function sendBack(client, { request, approverEmployeeId, user, remarks }) {
  const reason = String(remarks || "").trim();
  if (!reason) throw badRequest("Say why it is going back: it is the one answer that is useless without a reason.");
  if (!["PENDING", "REJECTED"].includes(request.status)) {
    throw badRequest(`This request has been ${request.status.toLowerCase()} and can no longer be sent back.`);
  }
  return client.$transaction(async (tx) => {
    await tx.attendanceRequestApproval.updateMany({ where: { requestId: request.id }, data: { decision: "PENDING", remarks: null, decidedAt: null } });
    await tx.attendanceRequest.update({ where: { id: request.id }, data: { status: "SENT_BACK", decidedById: null, decidedAt: null, decisionRemarks: reason } });
    await recordEvent(tx, request.id, "SENT_BACK", user, reason);
    return tx.attendanceRequest.findUnique({ where: { id: request.id }, include: requestInclude });
  });
}
```

- [ ] **Step 4: Wire the controller and the route**

```js
// controller.js
async function sendBackRequest(req, res) {
  const parsed = rejectionSchema.safeParse(req.body ?? {});   // the same shape: a required remark
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    const request = await loadRequest(req.params.id);
    const approverEmployeeId = await service.linkedEmployeeIdFor(req.user);
    if (!(request.approvals || []).some((row) => row.approverEmployeeId === approverEmployeeId)) {
      throw forbidden("You are not an approver for this request.");
    }
    const updated = await service.sendBack(prisma, { request, approverEmployeeId, user: req.user, remarks: parsed.data.remarks });
    // Off every bell: nobody is being asked about it while it sits with the raiser.
    await clearApproverNotices(request.id, null);
    return res.json({ data: service.serialiseRequest(updated, new Date(), { approverNames: await service.approverNamesFor([updated]) }) });
  } catch (error) { return handleError(res, error, "Unable to send this request back"); }
}
```

```js
// routes.js, beside approve and reject
router.post("/requests/:id/send-back", readRequests, controller.sendBackRequest);
```

- [ ] **Step 5: Exclude the raiser's own statuses from the queue**

```js
// service.js, in the approver-queue where (around line 330)
return {
  approvals: { some: { approverEmployeeId: employeeId } },
  // Only what is actually being asked. Sent back, reverted and deleted are with the raiser, and a
  // queue holding rows nobody can answer is a queue people stop reading.
  status: { in: ["PENDING", "REJECTED"] },
  NOT: { employeeId },
};
```

- [ ] **Step 6: Run the tests**

Run: `cd backend && node --test test/attendance-request-send-back.test.js && npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/hrm/attendance/ backend/test/attendance-request-send-back.test.js
git commit -m "feat(attendance): an approver may send a request back to be fixed"
```

---

### Task 4: Revert back, and a Delete that does not delete

**Files:**
- Modify: `backend/src/modules/hrm/attendance/controller.js` (`cancelRequest` becomes
  `revertRequest`; `withdrawRequest` becomes `deleteRequest`)
- Modify: `backend/src/modules/hrm/attendance/routes.js:45-46`
- Test: `backend/test/attendance-request-raiser-verbs.test.js` (create)

**Interfaces:**
- Consumes: `service.recordEvent`, `clearApproverNotices`.
- Produces: `POST /requests/:id/revert` and `DELETE /requests/:id`, both the raiser's own, setting
  `REVERTED` and `DELETED`.

- [ ] **Step 1: Write the failing test**

```js
test("revert back takes it out of the queues and leaves it with the raiser", async () => {
  const client = fakeClient({ id: "r1", status: "PENDING", employeeId: 9, approvals: [{ id: "a1", approverEmployeeId: 1, decision: "APPROVED" }] });
  await revert(client, { request: client.state.request, raiserEmployeeId: 9, user: { id: 9, name: "Raiser" } });
  assert.equal(client.state.request.status, "REVERTED");
  assert.equal(client.state.events.at(-1).action, "REVERTED");
  assert.equal(client.state.noticesCleared, "r1");
});

test("delete marks it deleted and keeps the row", async () => {
  const client = fakeClient({ id: "r1", status: "APPROVED", employeeId: 9, type: "LEAVE", approvals: [] });
  await remove(client, { request: client.state.request, raiserEmployeeId: 9, user: { id: 9, name: "Raiser" } });
  assert.equal(client.state.request.status, "DELETED");
  assert.equal(client.state.deleted, false, "the row must still be there");
  // Terminal: there is no way back, and a second press says so rather than doing it twice.
  await assert.rejects(() => remove(client, { request: client.state.request, raiserEmployeeId: 9, user: { id: 9 } }), /deleted/i);
});

test("neither verb touches somebody else's request, or a cancelled one", async () => {
  const other = fakeClient({ id: "r1", status: "PENDING", employeeId: 4, approvals: [] });
  await assert.rejects(() => revert(other, { request: other.state.request, raiserEmployeeId: 9, user: { id: 9 } }), /your own/i);
  const old = fakeClient({ id: "r2", status: "CANCELLED", employeeId: 9, approvals: [] });
  await assert.rejects(() => revert(old, { request: old.state.request, raiserEmployeeId: 9, user: { id: 9 } }), /cancelled/i);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && node --test test/attendance-request-raiser-verbs.test.js`
Expected: FAIL — `revert` and `remove` are not exported from `service.js`.

- [ ] **Step 3: Write both in the service**

```js
/*
 * What the raiser may still do, by status. Two lists, because the two verbs differ in one place: a
 * request already reverted is theirs to delete but there is nothing left to revert it out of.
 * `DELETED` is terminal and `CANCELLED` belongs to the old flow, so neither appears in either.
 */
const MAY_REVERT = ["PENDING", "SENT_BACK", "APPROVED", "REJECTED"];
const MAY_DELETE = ["PENDING", "SENT_BACK", "APPROVED", "REJECTED", "REVERTED"];

/**
 * Revert back: the raiser pulling the request out of every queue, to edit or to drop.
 *
 * It replaces Withdraw, Cancel and Apply again - one way out instead of three, two of which read as
 * the same thing. The request keeps its history and can be edited from here back into the queues.
 */
async function revert(client, { request, raiserEmployeeId, user }) {
  assertRaiserMayAct(request, raiserEmployeeId, MAY_REVERT, "reverted");
  return client.$transaction(async (tx) => {
    await tx.attendanceRequestApproval.updateMany({ where: { requestId: request.id }, data: { decision: "PENDING", remarks: null, decidedAt: null } });
    await tx.attendanceRequest.update({ where: { id: request.id }, data: { status: "REVERTED", decidedById: null, decidedAt: null } });
    await recordEvent(tx, request.id, "REVERTED", user, null);
    return tx.attendanceRequest.findUnique({ where: { id: request.id }, include: requestInclude });
  });
}

/**
 * Delete, which deletes nothing: the row stays and says Deleted.
 *
 * The raiser goes on seeing what they did, and it counts for nothing - only `APPROVED` ever counted
 * towards the register, the reports or a leave balance, so no attendance code changes. Terminal: a
 * fresh request is raised rather than this one brought back.
 */
async function remove(client, { request, raiserEmployeeId, user }) {
  assertRaiserMayAct(request, raiserEmployeeId, MAY_DELETE, "deleted");
  return client.$transaction(async (tx) => {
    await tx.attendanceRequest.update({ where: { id: request.id }, data: { status: "DELETED" } });
    await recordEvent(tx, request.id, "DELETED", user, null);
    return tx.attendanceRequest.findUnique({ where: { id: request.id }, include: requestInclude });
  });
}

function assertRaiserMayAct(request, raiserEmployeeId, allowed, verb) {
  if (!request) throw notFound("That request could not be found.");
  /*
   * Theirs, checked here rather than left to the controller: three verbs reach this and a check in
   * one place cannot be the one somebody forgets. `linkedEmployeeIdFor` is the controller's to
   * resolve - it needs the request's user - and the id is what this compares.
   */
  if (!raiserEmployeeId || request.employeeId !== raiserEmployeeId) {
    throw forbidden("You can only change your own requests.");
  }
  if (frozenByItsOwnApproval(request)) {
    throw badRequest("This request has already changed that day's attendance, so it can no longer be changed here. Raise a fresh request for the day instead.");
  }
  if (!allowed.includes(String(request.status || ""))) {
    throw badRequest(`This request has been ${String(request.status).toLowerCase()} and cannot be ${verb}.`);
  }
}
```

`frozenByItsOwnApproval` is Task 6's, and is listed there; it is named here because this is the one
function all three raiser verbs pass through.

- [ ] **Step 4: Replace the two controllers and their routes**

```js
// routes.js, replacing the cancel and withdraw pair
// The raiser's own two verbs: taking a request back out of the queues, and marking it deleted.
router.post("/requests/:id/revert", readRequests, controller.revertRequest);
router.delete("/requests/:id", readRequests, controller.deleteRequest);
```

`cancelRequest` and `withdrawRequest` are **removed**, not left beside the new pair.

- [ ] **Step 5: Run the tests**

Run: `cd backend && node --test test/attendance-request-raiser-verbs.test.js && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/hrm/attendance/ backend/test/attendance-request-raiser-verbs.test.js
git commit -m "feat(attendance): revert back and a delete that marks rather than deletes"
```

---

### Task 5: Edit, which resets every answer

**Files:**
- Modify: `backend/src/modules/hrm/attendance/controller.js` (add `updateRequest`, reusing the create
  validation)
- Modify: `backend/src/modules/hrm/attendance/routes.js` (add `PATCH /requests/:id`)
- Test: `backend/test/attendance-request-edit.test.js` (create)

**Interfaces:**
- Consumes: the schema `createRequest` already validates with; `assertRaiserMayAct` (Task 4).
- Produces: `PATCH /api/hrm/attendance/requests/:id`, the raiser's own, setting the request back to
  `PENDING` with every approval row cleared.

- [ ] **Step 1: Write the failing test**

```js
test("an edit puts the request back in front of everybody", async () => {
  const client = fakeClient({ id: "r1", status: "APPROVED", employeeId: 9, type: "LEAVE", approvals: [
    { id: "a1", approverEmployeeId: 1, decision: "APPROVED" },
    { id: "a2", approverEmployeeId: 2, decision: "APPROVED" },
  ] });
  await edit(client, { request: client.state.request, raiserEmployeeId: 9, user: { id: 9, name: "Raiser" }, patch: { fromDate: "2026-11-02", toDate: "2026-11-03", reason: "Moved" } });

  assert.equal(client.state.request.status, "PENDING", "an approved leave edited is pending again");
  assert.deepEqual(client.state.request.approvals.map((row) => row.decision), ["PENDING", "PENDING"]);
  assert.equal(client.state.request.fromDate, "2026-11-02");
  assert.equal(client.state.events.at(-1).action, "EDITED");
});

test("a request with no approvers at all can still be edited", async () => {
  // Older rows, and types whose approvers have since been removed: `outcomeOf([])` is PENDING and
  // nothing here may divide by an empty list.
  const client = fakeClient({ id: "r1", status: "PENDING", employeeId: 9, type: "LEAVE", approvals: [] });
  await edit(client, { request: client.state.request, raiserEmployeeId: 9, user: { id: 9 }, patch: { reason: "Fixed" } });
  assert.equal(client.state.request.status, "PENDING");
});

test("a deleted request is not editable", async () => {
  const client = fakeClient({ id: "r1", status: "DELETED", employeeId: 9, approvals: [] });
  await assert.rejects(() => edit(client, { request: client.state.request, raiserEmployeeId: 9, user: { id: 9 }, patch: { reason: "x" } }), /deleted/i);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && node --test test/attendance-request-edit.test.js`
Expected: FAIL — `edit` is not exported from `service.js`.

- [ ] **Step 3: Write it**

```js
/** What the raiser may edit from. Everything but `DELETED` and the old `CANCELLED`. */
const RAISER_MAY_EDIT = ["PENDING", "SENT_BACK", "APPROVED", "REJECTED", "REVERTED"];

/**
 * The raiser correcting their own request, from any status but deleted.
 *
 * **Every answer is cleared and the request goes back to `PENDING`**, whatever it was: approvers
 * answered about the dates as they were, and an approval of 20-22 October is not an approval of
 * 2-3 November. Editing an approved leave therefore stops those days reading "On leave" until it is
 * approved again - the raiser can do to attendance what an approver cannot (see `mayAnswer`), and
 * that is the studio's decision, recorded here rather than hidden.
 */
async function edit(client, { request, raiserEmployeeId, user, patch }) {
  assertRaiserMayAct(request, raiserEmployeeId, RAISER_MAY_EDIT, "edited");
  return client.$transaction(async (tx) => {
    await tx.attendanceRequestApproval.updateMany({ where: { requestId: request.id }, data: { decision: "PENDING", remarks: null, decidedAt: null } });
    await tx.attendanceRequest.update({
      where: { id: request.id },
      data: { ...patch, status: "PENDING", decidedById: null, decidedAt: null, decisionRemarks: null },
    });
    await recordEvent(tx, request.id, "EDITED", user, null);
    return tx.attendanceRequest.findUnique({ where: { id: request.id }, include: requestInclude });
  });
}
```

- [ ] **Step 4: Wire the controller and the route**

```js
// routes.js, beside POST /requests
router.patch("/requests/:id", readRequests, controller.updateRequest);
```

`updateRequest` validates the body with the same schema `createRequest` uses, checks ownership the
way Task 4 does, then calls `service.edit`. It clears the approvers' bells and re-notifies, because
the request is in front of them again: `await clearApproverNotices(request.id, null)` then the same
notification call `createRequest` makes.

- [ ] **Step 5: Run the tests**

Run: `cd backend && node --test test/attendance-request-edit.test.js && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/hrm/attendance/ backend/test/attendance-request-edit.test.js
git commit -m "feat(attendance): the raiser may edit, which asks everybody again"
```

---

### Task 6: The two types that write onto a day

**Files:**
- Modify: `backend/src/modules/hrm/attendance/service.js` (`assertRaiserMayAct`, `edit`)
- Test: `backend/test/attendance-request-correction-lock.test.js` (create)

**Interfaces:**
- Consumes: `assertRaiserMayAct(request, raiserEmployeeId, allowed, verb)`, `MAY_REVERT`, `MAY_DELETE` (Task 4) and `RAISER_MAY_EDIT` (Task 5).
- Produces: both refusing an **approved** `CORRECTION` or `INCORRECT_LOGIN`.

**Why this task exists:** the spec says only `APPROVED` counts, so the new statuses need no attendance
changes. That is true of leave, permission and comp-off. It is **false** for these two: approving a
`CORRECTION` writes the session's `logoutAt` through `applyCorrection`, and approving an
`INCORRECT_LOGIN` upserts an `AttendanceStatusOverride` through `applyCorrectionStatus` — and nothing
in the codebase ever deletes one. Editing, reverting or deleting such a request would leave the day
changed by an approval that no longer exists.

- [ ] **Step 1: Write the failing test**

```js
test("an approved correction cannot be edited, reverted or deleted", async () => {
  for (const type of ["CORRECTION", "INCORRECT_LOGIN"]) {
    const request = { id: "r1", status: "APPROVED", employeeId: 9, type, approvals: [] };
    await assert.rejects(() => edit(fakeClient(request), { request, raiserEmployeeId: 9, user: { id: 9 }, patch: { reason: "x" } }), /already changed that day/i, type);
    await assert.rejects(() => revert(fakeClient(request), { request, raiserEmployeeId: 9, user: { id: 9 } }), /already changed that day/i, type);
    await assert.rejects(() => remove(fakeClient(request), { request, raiserEmployeeId: 9, user: { id: 9 } }), /already changed that day/i, type);
  }
});

test("the same two are freely editable while nobody has approved them", async () => {
  for (const type of ["CORRECTION", "INCORRECT_LOGIN"]) {
    for (const status of ["PENDING", "SENT_BACK", "REJECTED", "REVERTED"]) {
      const request = { id: "r1", status, employeeId: 9, type, approvals: [] };
      await edit(fakeClient(request), { request, raiserEmployeeId: 9, user: { id: 9 }, patch: { reason: "fixed" } });
    }
  }
});

test("leave, permission and comp-off are untouched by this rule", async () => {
  for (const type of ["LEAVE", "PERMISSION", "COMP_OFF"]) {
    const request = { id: "r1", status: "APPROVED", employeeId: 9, type, approvals: [] };
    await edit(fakeClient(request), { request, raiserEmployeeId: 9, user: { id: 9 }, patch: { reason: "moved" } });
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && node --test test/attendance-request-correction-lock.test.js`
Expected: FAIL — an approved `CORRECTION` is edited without complaint.

- [ ] **Step 3: Write the rule where both verbs read it**

```js
/**
 * The two types whose approval **writes onto the day**, which is why they freeze once approved.
 *
 * `CORRECTION` sets the session's `logoutAt` (`applyCorrection`) and `INCORRECT_LOGIN` upserts an
 * `AttendanceStatusOverride` (`applyCorrectionStatus`). Nothing in this codebase deletes either, so
 * editing, reverting or deleting an approved one would leave the day carrying a change whose request
 * no longer says it was approved - a day nobody can explain. Undoing the day is a Correction's job,
 * raised afresh, which is what the message says.
 */
const WRITES_ONTO_THE_DAY = ["CORRECTION", "INCORRECT_LOGIN"];

const frozenByItsOwnApproval = (request) => request?.status === "APPROVED"
  && WRITES_ONTO_THE_DAY.includes(String(request?.type || "").toUpperCase());
```

Both `assertRaiserMayAct` and `edit` call it first:

```js
if (frozenByItsOwnApproval(request)) {
  throw badRequest("This request has already changed that day's attendance, so it can no longer be changed here. Raise a fresh request for the day instead.");
}
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && node --test test/attendance-request-correction-lock.test.js && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/hrm/attendance/service.js backend/test/attendance-request-correction-lock.test.js
git commit -m "fix(attendance): an approved correction freezes, because it has written onto the day"
```

---

### Task 7: The tabs

**Files:**
- Modify: `frontend/src/components/hrm/attendanceRequests.js:36` and `:42`
- Test: `frontend/test/attendance-request-tabs.test.mjs` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `statusTabs = ["All", "Pending", "Send Back", "Approved", "Rejected"]` and
  `inStatusTab(request, tab)` placing Reverted, Deleted and Cancelled under All alone.

- [ ] **Step 1: Write the failing test**

```js
test("five tabs, and the raiser's own endings live under All", () => {
  assert.deepEqual(statusTabs, ["All", "Pending", "Send Back", "Approved", "Rejected"]);
  const at = (displayStatus) => ({ displayStatus });
  assert.equal(inStatusTab(at("Send Back"), "Send Back"), true);
  assert.equal(inStatusTab(at("Send Back"), "Pending"), false, "sent back is with the raiser, not waiting on anybody");
  // Upcoming is an approved request that has not started, as before.
  assert.equal(inStatusTab(at("Upcoming"), "Approved"), true);
  // The three that are nobody's queue: found under All and nowhere else.
  for (const ending of ["Reverted", "Deleted", "Cancelled"]) {
    assert.equal(inStatusTab(at(ending), "All"), true, ending);
    for (const tab of ["Pending", "Send Back", "Approved", "Rejected"]) {
      assert.equal(inStatusTab(at(ending), tab), false, `${ending} must not sit under ${tab}`);
    }
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && node --test test/attendance-request-tabs.test.mjs`
Expected: FAIL — four tabs, and "Cancelled" sits under Rejected.

- [ ] **Step 3: Change the two lines**

```js
// attendanceRequests.js:36
export const statusTabs = ["All", "Pending", "Send Back", "Approved", "Rejected"];

/*
 * The statuses each tab holds, where that is more than its own name.
 *
 * Reverted, Deleted and Cancelled are deliberately in none of them: they are not queues anybody
 * works through, and a Rejected tab that also held them made "how many were refused" unanswerable.
 * They are found under All, each saying what it is.
 */
const TAB_STATUSES = { Rejected: ["Rejected"] };
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd frontend && node --test test/attendance-request-tabs.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/hrm/attendanceRequests.js frontend/test/attendance-request-tabs.test.mjs
git commit -m "feat(attendance): a Send Back tab, and the endings under All"
```

---

### Task 8: The row actions, on both sides

**Files:**
- Modify: `frontend/src/components/hrm/attendanceRequests.js` (`requestActionItems`; delete
  `reapplyPrefill` and `cancelLabels`)
- Modify: `frontend/src/components/hrm/AttendanceRequestsPage.js:73` (`inMyQueue`), `:79` (the
  `OWN_ACTIONS` comment), and the handlers it passes
- Test: `frontend/test/attendance-request-actions.test.mjs` (create)

**Interfaces:**
- Consumes: `statusTabs` (Task 7).
- Produces: `requestActionItems(view, request, { onView, onEdit, onRevert, onDelete, onDecide, onSendBack })`.

- [ ] **Step 1: Write the failing test**

```js
const labels = (view, request) => requestActionItems(view, request, handlers).map((item) => item.label);

test("the raiser gets View, Edit, Revert back and Delete", () => {
  assert.deepEqual(labels("own", { status: "PENDING", displayStatus: "Pending" }), ["View", "Edit", "Revert back", "Delete"]);
  // From every status they may act on, including an approved leave - editing asks everybody again.
  for (const status of ["SENT_BACK", "APPROVED", "REJECTED", "REVERTED"]) {
    assert.ok(labels("own", { status, displayStatus: status }).includes("Edit"), status);
  }
  // Nothing left to revert a reverted request out of: it is already with the raiser.
  assert.deepEqual(labels("own", { status: "REVERTED", displayStatus: "Reverted" }), ["View", "Edit", "Delete"]);
  // Deleted is terminal, and an old cancelled row is nobody's to act on: View alone.
  assert.deepEqual(labels("own", { status: "DELETED", displayStatus: "Deleted" }), ["View"]);
  assert.deepEqual(labels("own", { status: "CANCELLED", displayStatus: "Cancelled" }), ["View"]);
  // The three that went: Edit and Revert back do their work.
  for (const gone of ["Withdraw", "Cancel Leave", "Apply again"]) {
    assert.equal(labels("own", { status: "REJECTED", displayStatus: "Rejected" }).includes(gone), false, gone);
  }
});

test("the approver gets Approve, Reject and Send back - and Approve on a row they rejected", () => {
  assert.deepEqual(labels("approvals", { canDecide: true, status: "PENDING", myDecision: "PENDING" }), ["Approve", "Reject", "Send back"]);
  // Their own rejection may be changed; the request is REJECTED and still answerable.
  assert.deepEqual(labels("approvals", { canDecide: true, status: "REJECTED", myDecision: "REJECTED" }), ["Approve"]);
  // Their own approval may not become a rejection, so nothing is offered but the row they see.
  assert.deepEqual(labels("approvals", { canDecide: false, status: "PENDING", myDecision: "APPROVED" }), []);
  // Nothing is answerable once the raiser has taken it away.
  for (const status of ["SENT_BACK", "REVERTED", "DELETED"]) {
    assert.deepEqual(labels("approvals", { canDecide: true, status, myDecision: "PENDING" }), [], status);
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && node --test test/attendance-request-actions.test.mjs`
Expected: FAIL — the own view answers `["Withdraw"]`.

- [ ] **Step 3: Rewrite the function**

```js
/*
 * What the raiser may still do, by status - the same two lists the server keeps, for the same
 * reason: a reverted request is theirs to edit or delete, but there is nothing left to revert it out
 * of. `DELETED` is terminal and `CANCELLED` is the old flow's, so both offer View alone.
 */
const MAY_EDIT = ["PENDING", "SENT_BACK", "APPROVED", "REJECTED", "REVERTED"];
const MAY_REVERT = ["PENDING", "SENT_BACK", "APPROVED", "REJECTED"];

export function requestActionItems(view, request, { onView, onEdit, onRevert, onDelete, onDecide, onSendBack }) {
  const items = [];
  if (view === REQUEST_VIEW_APPROVALS) {
    // Answerable while the raiser has not taken it away. An approver who approved sees nothing to
    // press - their approval cannot become a rejection - and the row says "You approved" instead.
    if (!["PENDING", "REJECTED"].includes(request.status)) return items;
    if (request.myDecision === "REJECTED") {
      // The one reversal allowed: they may change their mind towards yes.
      items.push({ label: "Approve", onSelect: () => onDecide("approve") });
      return items;
    }
    if (request.canDecide) {
      items.push({ label: "Approve", onSelect: () => onDecide("approve") });
      items.push({ label: "Reject", tone: "danger", onSelect: () => onDecide("reject") });
      items.push({ label: "Send back", onSelect: onSendBack });
    }
    return items;
  }
  // The raiser's own four. View is always offered: a deleted request is still theirs to read.
  items.push({ label: "View", onSelect: onView });
  if (!MAY_EDIT.includes(request.status)) return items;
  items.push({ label: "Edit", onSelect: onEdit });
  if (MAY_REVERT.includes(request.status)) items.push({ label: "Revert back", onSelect: onRevert });
  items.push({ label: "Delete", tone: "danger", onSelect: onDelete });
  return items;
}
```

`inMyQueue` in `AttendanceRequestsPage.js:73` gains the same gate, so a sent-back or reverted request
leaves the Waiting for me count:

```js
const inMyQueue = (request) => ["PENDING", "REJECTED"].includes(request.status)
  && (request.canDecide || request.myDecision === "APPROVED" || request.myDecision === "REJECTED");
```

- [ ] **Step 4: Run the tests**

Run: `cd frontend && node --test test/attendance-request-actions.test.mjs && npm test`
Expected: PASS. Fix any test that still names Withdraw, Cancel or Apply again by changing what it
asserts, never by keeping the action.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/hrm/ frontend/test/attendance-request-actions.test.mjs
git commit -m "feat(attendance): the raiser's four actions and the approver's three"
```

---

### Task 9: The Edit dialog, the Send back dialog, and the services

**Files:**
- Create: `frontend/src/services/hrm/attendance-requests.service.js` additions (or modify the existing
  service file the page imports `approveAttendanceRequest` from)
- Modify: `frontend/src/components/hrm/AttendanceRequestsPage.js` (the handlers and the two dialogs)
- Test: `frontend/test/attendance-request-dialogs.test.mjs` (create)

**Interfaces:**
- Consumes: `requestActionItems` (Task 8).
- Produces: `editAttendanceRequest(id, payload)` → `PATCH /api/hrm/attendance/requests/:id`,
  `sendBackAttendanceRequest(id, remarks)` → `POST …/send-back`,
  `revertAttendanceRequest(id)` → `POST …/revert`, `deleteAttendanceRequest(id)` → `DELETE …/:id`.

- [ ] **Step 1: Write the failing test**

```js
test("each verb calls its own endpoint", () => {
  const service = read("src/services/hrm/attendance-requests.service.js");
  assert.match(service, /`\/api\/hrm\/attendance\/requests\/\$\{encodeURIComponent\(id\)\}`, \{ method: "PATCH"/);
  assert.match(service, /\/send-back`, \{ method: "POST"/);
  assert.match(service, /\/revert`, \{ method: "POST"/);
  assert.match(service, /`\/api\/hrm\/attendance\/requests\/\$\{encodeURIComponent\(id\)\}`, \{ method: "DELETE"/);
});

test("Edit opens the raise form on the request, and Send back asks for a reason", () => {
  const page = read("src/components/hrm/AttendanceRequestsPage.js");
  // The raise form, reused: one form that knows how to ask for a leave, not a second one.
  assert.match(page, /editingRequest/);
  assert.match(page, /sendBackRequest/);
  // The reason is required before the dialog will submit - the server refuses it anyway.
  assert.match(page, /Say why it is going back/);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && node --test test/attendance-request-dialogs.test.mjs`
Expected: FAIL — the service has no PATCH.

- [ ] **Step 3: Add the four service functions**

```js
/** The raiser's correction. Every answer is cleared on the server and all three are asked again. */
export function editAttendanceRequest(id, payload) {
  return apiRequest(`/api/hrm/attendance/requests/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) });
}

/** An approver sending it back to be fixed. The remark is required. */
export function sendBackAttendanceRequest(id, remarks) {
  return apiRequest(`/api/hrm/attendance/requests/${encodeURIComponent(id)}/send-back`, { method: "POST", body: JSON.stringify({ remarks }) });
}

/** The raiser pulling it out of the queues, to edit or to delete. */
export function revertAttendanceRequest(id) {
  return apiRequest(`/api/hrm/attendance/requests/${encodeURIComponent(id)}/revert`, { method: "POST" });
}

/** Marks it Deleted. The row stays and the raiser goes on seeing it. */
export function deleteAttendanceRequest(id) {
  return apiRequest(`/api/hrm/attendance/requests/${encodeURIComponent(id)}`, { method: "DELETE" });
}
```

- [ ] **Step 4: Wire the page**

`Edit` opens the existing Raise Request form with the request's own values and an `editingRequest`
id; submitting calls `editAttendanceRequest` instead of creating. `Send back` opens a
`ConfirmDialog` with a required remark, the same shape Reject already uses. `Revert back` and
`Delete` each open a `ConfirmDialog` naming what will happen — "It leaves the approvers' queues and
comes back to you" and "It will show as Deleted and cannot be brought back".

- [ ] **Step 5: Run the gate**

Run: `cd frontend && npm run lint && npm test && npm run build`
Expected: lint 0 errors, tests pass, build compiles.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/ frontend/test/attendance-request-dialogs.test.mjs
git commit -m "feat(attendance): the edit, send back, revert and delete dialogs"
```

---

### Task 10: The documentation

**Files:**
- Modify: `docs/CHANGELOG.md` (one entry at the top of `### Changed` under `Unreleased`)
- Modify: `docs/project-state/PROJECT-STATE.md` (the attendance requests passage)
- Modify: `backend/README.md` (the `/api/hrm/attendance` row: the new routes and the state machine)

**Interfaces:**
- Consumes: everything above.
- Produces: no code.

- [ ] **Step 1: Write the changelog entry**

One bold sentence first, then the six statuses, the one-way reversal, what each side sees, the two
frozen types from Task 6, and that `CANCELLED` rows are untouched. State plainly that editing an
approved leave stops those days reading "On leave" until it is approved again.

- [ ] **Step 2: Update PROJECT-STATE's request passage**

The state machine, the tabs, and the two types that freeze once approved.

- [ ] **Step 3: Update the backend README's attendance row**

The four new routes, that `cancel` and `withdraw` are gone, and that the status is computed by
`outcomeOf` after every change to an approval row.

- [ ] **Step 4: Check what the docs cost to read**

Run: `bash scripts/doc-sizes.sh`
Expected: prints the table; no file has grown enough to need splitting.

- [ ] **Step 5: Commit**

```bash
git add docs/ backend/README.md
git commit -m "docs(attendance): the request lifecycle, its six statuses and its two frozen types"
```
