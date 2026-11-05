const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { mayAnswer, answerableBy, settlementFields } = require("../src/modules/hrm/attendance/approvals");
const service = require("../src/modules/hrm/attendance/service");

/*
 * The holes the review of the request lifecycle found, each pinned here.
 *
 * Five of them, all in the new verbs: a raiser's edit racing the last approval, a foreign request's
 * kind disclosed before ownership was checked, somebody listed as their own approver able to answer
 * their own request, a refuser's reason overwritten when a second approver answered a rejected
 * request, and an edit going back to Pending with approvers who are no longer anybody's.
 */

const MODULE = path.join(__dirname, "..", "src", "modules", "hrm", "attendance");
const CONTROLLER = fs.readFileSync(path.join(MODULE, "controller.js"), "utf8");

test("nobody answers their own request, however they came to be on its list", () => {
  /*
   * `approversFor` reads the approvers off the employee record and does not filter the employee out,
   * so a data-entry slip can list somebody as their own approver. `canDecide` always refused that;
   * the new answer paths read the approval rows instead, and the rule has to live with them.
   */
  const mine = { employeeId: 9, status: "PENDING", approvals: [{ approverEmployeeId: 9, decision: "PENDING" }] };
  assert.equal(answerableBy(mine, 9), false, "their own request");
  assert.equal(answerableBy({ ...mine, employeeId: 4 }, 9), true, "somebody else's, and they are on its list");
  assert.equal(answerableBy({ employeeId: 4, approvals: [] }, 9), false, "not on its list");
  assert.equal(answerableBy({ employeeId: 4, approvals: [{ approverEmployeeId: 9 }] }, null), false, "no employee behind the login");
  // Both answer paths ask it, so neither can be the one that forgets.
  assert.equal((CONTROLLER.match(/answerableBy\(/g) || []).length, 2, "decide and sendBackRequest both ask");
});

test("a second approver answering a rejected request does not overwrite the refusal's reason", () => {
  /*
   * A rejection is a veto, so the request stays REJECTED however the others answer. The reason
   * belongs to whoever refused it - it is the sentence the raiser is shown - and the decider is
   * whoever settled it. An approval arriving afterwards used to stamp both: the reason became null
   * and the approver was named as having decided a refusal.
   */
  const was = { status: "REJECTED", decidedById: 1, decisionRemarks: "The 20th is the shoot." };
  assert.deepEqual(settlementFields("REJECTED", was, { decidedById: 2, remarks: "" }), {}, "nothing restamped");
  // The answer that settles it does stamp, and so does a rejection landing on a pending request.
  const settling = settlementFields("REJECTED", { status: "PENDING" }, { decidedById: 2, remarks: "No." });
  assert.equal(settling.decidedById, 2);
  assert.equal(settling.decisionRemarks, "No.");
  assert.ok(settling.decidedAt instanceof Date);
  // Still collecting approvals: no decider and no decision remark, as before.
  assert.deepEqual(settlementFields("PENDING", { status: "PENDING" }, { decidedById: 2, remarks: "" }), {});
  // And a rejection an approver reverses to an approval settles it in their name.
  const reversed = settlementFields("APPROVED", was, { decidedById: 2, remarks: "" });
  assert.equal(reversed.decidedById, 2);
  assert.equal(reversed.decisionRemarks, null);
});

test("the raiser's verbs are decided again under the row lock", () => {
  /*
   * `decide` locks the request row and asks `mayAnswer` again after it. The raiser's verbs checked a
   * row loaded before any lock, so an edit sent while the last approval was in flight passed on the
   * stale PENDING row and wrote after the approval committed - which, for a Correction, left the day
   * changed by a request that no longer said it was approved: exactly what the freeze prevents.
   */
  let status = "PENDING";
  const row = () => ({ id: 7, status, employeeId: 9, type: "CORRECTION", approvals: [] });
  const client = {
    $transaction: async (run) => run(client),
    // The approval lands while this verb waits for the lock.
    $queryRaw: async () => { status = "APPROVED"; return []; },
    attendanceRequestApproval: { updateMany: async () => ({ count: 0 }) },
    attendanceRequest: {
      update: async () => { throw new Error("it wrote anyway"); },
      findUnique: async () => row(),
    },
    attendanceRequestEvent: { create: async (args) => args.data },
  };
  const verbs = [
    ["edit", { patch: { reason: "x" } }],
    ["revert", {}],
    ["remove", {}],
  ];
  return Promise.all(verbs.map(([verb, extra]) => assert.rejects(
    () => service[verb](client, { request: row(), raiserEmployeeId: 9, user: { id: 9 }, ...extra }),
    /already changed that day/i,
    verb,
  ))).then(() => {
    // The lock is taken, not merely the row re-read: two edits a moment apart must serialise too.
    assert.match(
      fs.readFileSync(path.join(MODULE, "service.js"), "utf8"),
      /SELECT id FROM attendance_request WHERE id = \$\{request\.id\} FOR UPDATE/,
    );
  });
});

test("an edit asks whoever the approvers are now, and refuses when there are none", () => {
  /*
   * An edit clears every answer and asks again - and "again" means the people who would be asked if
   * it were raised today. Reusing the rows written when it was raised sent it back to approvers HR
   * has since changed, or, where they were cleared, to nobody at all: a request sitting at Pending
   * that no one on earth can answer, which is the state `createRequest` refuses outright.
   */
  const rows = [];
  const client = {
    $transaction: async (run) => run(client),
    $queryRaw: async () => [],
    attendanceRequestApproval: {
      updateMany: async () => ({ count: 0 }),
      deleteMany: async () => { rows.length = 0; return { count: 0 }; },
      createMany: async ({ data }) => { rows.push(...data); return { count: data.length }; },
    },
    attendanceRequest: { update: async () => ({}), findUnique: async () => ({ id: 7, status: "PENDING", employeeId: 9, type: "LEAVE", approvals: [] }) },
    attendanceRequestEvent: { create: async (args) => args.data },
  };
  const request = { id: 7, status: "PENDING", employeeId: 9, type: "LEAVE", approvals: [{ id: 1, approverEmployeeId: 1, decision: "APPROVED" }] };
  return service.edit(client, { request, raiserEmployeeId: 9, user: { id: 9 }, patch: { reason: "Moved" }, approverIds: [3, 4] })
    .then(() => {
      assert.deepEqual(rows.map((row) => row.approverEmployeeId), [3, 4], "the approvers of today");
      // The controller is what resolves them, and refuses with the same words raising one does.
      assert.match(CONTROLLER, /const approverIds = service\.approversFor\(employee, input\.type\);[\s\S]*assertApproversExist\(/);
      assert.match(CONTROLLER, /approverIds,/);
    });
});

test("a request id that is not a number is a 400, not a 500", () => {
  // `Number("abc")` is NaN, which Prisma throws on - handled as an unexplained failure. Five more
  // routes read an id from the URL now, so the refusal belongs where the id is read.
  for (const id of ["abc", "", "1; DROP", "-4", "0", "1.5", undefined]) {
    assert.rejects(() => service.loadRequestId(id), /which request/i, String(id));
  }
  return service.loadRequestId("12").then((value) => assert.equal(value, 12));
});

test("the approver's queue keeps what they have answered, and loses only what left for the raiser", () => {
  /*
   * Narrowing the queue to PENDING and REJECTED also hid every APPROVED request from the people who
   * approved it - no history of their own answers, and Nebula answering "none" to "what have I
   * approved". Only the three statuses that are *with the raiser* leave an approver's list.
   */
  const prisma = require("../src/config/db");
  const iam = require("../src/services/iam.service");
  const real = { user: prisma.user.findUnique, perm: iam.hasPermission };
  prisma.user.findUnique = async () => ({ linkedEmployeeId: 11 });
  iam.hasPermission = async () => false;
  return service.visibilityFilter({ id: 7 }, "team").then((where) => {
    assert.deepEqual(where.status, { notIn: ["SENT_BACK", "REVERTED", "DELETED"] });
    assert.deepEqual(where.approvals, { some: { approverEmployeeId: 11 } });
  }).finally(() => {
    prisma.user.findUnique = real.user;
    iam.hasPermission = real.perm;
  });
});

test("ownership is settled before a foreign request tells the caller anything about itself", () => {
  /*
   * `updateRequest` ran the "cannot change kind" refusal and the whole raise-time gate before
   * `service.edit` checked whose request it was, so a PATCH at somebody else's id answered with that
   * request's kind. The write was never reachable - `assertRaiserMayAct` is inside the service - but
   * a 400 that discloses is still a disclosure.
   */
  const update = CONTROLLER.slice(CONTROLLER.indexOf("async function updateRequest"));
  const body = update.slice(0, update.indexOf("const updated = await service.edit"));
  const at = (text) => {
    const index = body.indexOf(text);
    assert.notEqual(index, -1, `\`${text}\` is not in updateRequest`);
    return index;
  };
  assert.ok(at("assertRaiserMayAct") < at("A request cannot change kind"), "ownership is checked before the kind is named");
  assert.ok(at("assertRaiserMayAct") < at("assertRequestAllowed"), "and before the gate that reads the caller's own attendance");
});
