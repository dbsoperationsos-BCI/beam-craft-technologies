const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { waitingNotice, whenOf } = require("../src/modules/hrm/attendance/requestNotifications");

/*
 * A request waiting on somebody's answer is on that person's bell - and nobody else's. It replaced
 * the Request badge in the sidebar, so it has to reach exactly the people the badge counted for,
 * and go when they have answered.
 */

const MODULE = path.join(__dirname, "..", "src", "modules", "hrm", "attendance");
const HELPER = fs.readFileSync(path.join(MODULE, "requestNotifications.js"), "utf8");
const CONTROLLER = fs.readFileSync(path.join(MODULE, "controller.js"), "utf8");
const ROUTES = fs.readFileSync(path.join(MODULE, "routes.js"), "utf8");

test("only the approvers still to answer that request are told, and never the requester", () => {
  // Read off the request's own approval rows, the list `canDecide` lets answer it.
  assert.match(HELPER, /\(request\.approvals \|\| \[\]\)\.filter\(\(row\) => \(row\.decision \?\? "PENDING"\) === "PENDING"\)/);
  assert.match(HELPER, /id !== Number\(request\.employeeId\)/);
  assert.match(HELPER, /linkedEmployeeId: \{ in: ids \}, status: "ACTIVE"/);
});

test("the notice says whose request, what kind, and when", () => {
  const notice = waitingNotice({
    id: 12, type: "LEAVE", employee: { employeeName: "Arun Kumar" },
    fromDate: "2026-09-28", toDate: "2026-09-30",
  });
  assert.equal(notice.type, "REQUEST_WAITING");
  assert.equal(notice.title, "Leave request from Arun Kumar");
  assert.equal(notice.body, "28 Sep 2026 – 30 Sep 2026 · Waiting for your approval");
  assert.equal(notice.entityType, "HRM_ATTENDANCE_REQUEST");
  assert.equal(notice.entityId, "12");
  // A permission is one day with its hours.
  assert.equal(whenOf({ fromDate: "2026-09-26", toDate: "2026-09-26", fromTime: "18:00", toTime: "19:00" }), "26 Sep 2026 · 18:00–19:00");
});

test("raising tells the approvers; answering, settling and the raiser's own verbs take it away", () => {
  assert.match(CONTROLLER, /await notifyApprovers\(created\);/);
  // Off the deciding approver's bell while others still have to answer, off everybody's once settled.
  assert.match(CONTROLLER, /await clearApproverNotices\(request\.id, updated\.status === "PENDING" \? \[decidedById\] : null\);/);
  /*
   * Send back, revert, delete and edit each take the row out of every queue, so each clears it for
   * everybody - `null`, not the actor's own id. A notice for a row nobody can answer is one that
   * sits on a bell until somebody opens it to find there is nothing there.
   */
  assert.equal(
    (CONTROLLER.match(/await clearApproverNotices\(request\.id, null\);/g) || []).length,
    4,
    "send back, revert, delete and edit all clear it for everybody",
  );
  // And an edit puts it back on, because it is in front of them again.
  assert.match(CONTROLLER, /await clearApproverNotices\(request\.id, null\);\s*\n\s*await notifyApprovers\(updated\);/);
});

test("the badge's count endpoint is gone with the badge", () => {
  assert.doesNotMatch(ROUTES, /waiting-count/);
  assert.doesNotMatch(CONTROLLER, /countMyWaitingRequests/);
});
