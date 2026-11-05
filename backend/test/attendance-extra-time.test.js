const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { REQUEST_TYPES, RAISABLE_REQUEST_TYPES, DAY_REQUEST_TYPES, SYSTEM_REQUEST_TYPES } = require("../src/modules/hrm/attendance/attendanceRules");
const { PERMISSION_APPROVER_ONLY_TYPES, approversFor } = require("../src/modules/hrm/attendance/approvals");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

/*
 * Extra time: the logout somebody presses after their login's 18 hours. The 18 hours used to refuse
 * it, which lost the time worked past them. Now the logout is taken at the time it is pressed, the
 * day goes on reading Absent, and the Permission Approver decides - approving writes the logout onto
 * the day, which makes it Present.
 */

test("it is its own kind of request, raised by attendance rather than from the Raise Request form", () => {
  assert.ok(REQUEST_TYPES.includes("EXTRA_TIME"));
  assert.ok(SYSTEM_REQUEST_TYPES.includes("EXTRA_TIME"), "nobody raises, edits or reverts one by hand");
  assert.equal(RAISABLE_REQUEST_TYPES.includes("EXTRA_TIME"), false);
  assert.ok(DAY_REQUEST_TYPES.includes("EXTRA_TIME"), "it is about a day already recorded");
  assert.notEqual("EXTRA_TIME", "INCORRECT_LOGIN", "it is not the regularization request");
});

test("it goes to the Permission Approver, and to nobody else", () => {
  assert.ok(PERMISSION_APPROVER_ONLY_TYPES.includes("EXTRA_TIME"));
  const employee = { permissionApproverEmployeeId: 9, regularizationApproverEmployeeId: 4, reportingManagerEmployeeId: 7 };
  assert.deepEqual(approversFor(employee, "EXTRA_TIME"), [9], "not the regularization approver, and not the reporting manager");
  assert.deepEqual(approversFor({ permissionApproverEmployeeId: null }, "EXTRA_TIME"), [], "nobody named is refused where it is raised");
});

test("the day is logged out of, and held at Absent until it is approved", () => {
  const controller = read("src/modules/hrm/attendance/controller.js");
  const helper = controller.slice(controller.indexOf("async function raiseExtraTime"), controller.indexOf("const clockOf ="));
  // Written, so the day stops saying nobody logged out - and pinned to Absent, because a written
  // logout would otherwise finish the day as Present with nobody having approved the extra hours.
  assert.match(helper, /attendanceStatusOverride\.upsert\(\{[\s\S]*?status: "Absent"/);
  assert.match(helper, /currentStatus: "Absent",\n\s*requestedStatus: "Present",/);
  assert.match(helper, /toTime: clockOf\(at\)/, "the clock time the logout was pressed");
  assert.match(helper, /reason,/, "their own description, which the form asks for");
  assert.match(helper, /if \(!approverIds\.length\) return null;/, "nobody to approve it: the logout still stands");
  assert.match(controller, /const clockOf = \(when\) => \{\n\s*const \{ hour, minute \} = studioParts\(when\);/);
  // Approving it replaces the Absent override with Present, the same write a regularization makes.
  assert.match(controller, /if \(outcome === "APPROVED" && \(request\.type === "INCORRECT_LOGIN" \|\| request\.type === "EXTRA_TIME"\)\) \{/);
  assert.match(read("src/modules/hrm/attendance/service.js"), /const WRITES_ONTO_THE_DAY = \["CORRECTION", "INCORRECT_LOGIN", "EXTRA_TIME"\];/);
});

test("the logout box takes a late logout instead of refusing it, and sends the extra time with it", () => {
  const controller = read("src/modules/hrm/attendance/controller.js");
  const logout = controller.slice(controller.indexOf("async function markLogout"), controller.indexOf("async function getLogoutPreview"));
  assert.match(logout, /const late = sessionExpired\(session\);/);
  assert.match(logout, /if \(late && !reason\) throw badRequest\("Say why you are logging out late\."\);/, "the description is asked for");
  assert.doesNotMatch(logout, /throw badRequest\(EXPIRED_LOGIN\)/, "the logout is no longer refused");
  // The ordinary logout write still runs: the selfie, the position and the CHECK_OUT capture.
  assert.match(logout, /type: "CHECK_OUT", capturedAt,/);
  assert.match(logout, /const extraTime = late\n\s*\? await raiseExtraTime\(tx, \{ employee, workDate: calendarDay\(session\.workDate\)/);
  assert.match(logout, /if \(updated\.extraTime\) await notifyApprovers\(updated\.extraTime\);/);
  assert.match(logout, /No Permission Approver is set on your record, so the extra time could not be sent/);
});

test("the banner's Log out late writes the same logout, with no selfie it never took", () => {
  const controller = read("src/modules/hrm/attendance/controller.js");
  const raise = controller.slice(controller.indexOf("async function markExtraTime"), controller.indexOf("async function createRequest"));
  assert.match(raise, /attendanceSession\.updateMany\(\{ where: \{ id: day\.sessionId, logoutAt: null \}, data: \{ logoutAt: now \} \}\)/);
  assert.match(raise, /attendanceBreak\.updateMany/, "a break still running ends with the day");
  assert.match(raise, /type: "CHECK_OUT_CORRECTED"/, "no selfie and no position, and the event says so");
  assert.match(raise, /type: \{ in: \["CORRECTION", "INCORRECT_LOGIN", "EXTRA_TIME"\] \}/, "a day already asked about cannot be asked about twice");
  assert.match(raise, /FOR UPDATE/, "two taps a moment apart raise one request");
});

test("only a day that really is an expired login of theirs can be sent", () => {
  const raise = read("src/modules/hrm/attendance/controller.js");
  assert.match(raise, /const open = await service\.openPastDays\(employee\.id, now\);\n\s*const day = open\.find\(\(entry\) => entry\.date === date\);\n\s*if \(!day\) throw badRequest\(/);
  assert.match(read("src/modules/hrm/attendance/routes.js"), /router\.post\("\/extra-time", controller\.markExtraTime\);/);
});

test("the refusal now points at Log out late rather than at a regularization", () => {
  assert.match(read("src/modules/hrm/attendance/controller.js"), /so that day is marked Absent\. Log in again, and send the time you worked past them to your approver with Log out late\./);
});
