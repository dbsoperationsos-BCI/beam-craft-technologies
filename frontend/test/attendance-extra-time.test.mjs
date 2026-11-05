import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/*
 * Log out late: the logout for a day whose login passed its 18 hours. Pressing it raises and sends
 * the Extra Time request by itself - the person is not sent to a request form about their own day -
 * and says before it goes that the day stays Absent until the approver answers.
 */

test("the banner offers the logout first, and raising a regularization second", () => {
  const page = read("src/components/hrm/EmployeeAttendancePage.js");
  // Today's day only: a day that has rolled over is not one anybody is still working.
  assert.match(page, /onLogOutLate && day\.date === todayIso\(\) && <><button type="button" onClick=\{\(\) => onLogOutLate\(day\)\}[^>]*>Log out late<\/button>\{" or "\}<\/>/);
  assert.match(page, /day\.date === todayIso\(\) \? "Today's attendance" : day\.date === yesterdayIso\(\) \? "Yesterday's attendance"/);
  assert.match(page, />raise attendance regularization<\/button>/, "the correction stays, for a day whose answer is not \"I worked on\"");
  assert.match(page, /<ExtraTimeDialog\n\s*day=\{lateLogout\}/);
});

test("it sends the day and the typed reason, and says who it goes to", () => {
  const dialog = read("src/components/hrm/ExtraTimeDialog.js");
  assert.match(dialog, /sendExtraTime\(\{ date: day\.date, reason: words \}\)/);
  assert.match(dialog, /if \(!words\) \{ setProblem\("Say why you are logging out late\."\); return; \}/, "the description is asked for, not optional");
  // The popup's promise, in the order it happens.
  assert.match(dialog, /Logging out now sends the extra time you worked to \{approver\.name \? <span className="font-semibold">\{approver\.name\}<\/span> : "your Permission Approver"\} for approval\./);
  assert.match(dialog, /stays <span className="font-semibold">Absent<\/span> until it is approved, and then reads <span className="font-semibold">Present<\/span>/);
  assert.match(dialog, /getMyAttendanceApprovers\(\)/, "the approver is named from the server, not guessed");
  assert.match(dialog, /No Permission Approver is set on your employee record/, "and says so where there is none");
  const service = read("src/services/hrm/attendance.service.js");
  assert.match(service, /\$\{base\}\/extra-time`, \{ method: "POST", body: JSON\.stringify\(\{ date, reason \}\) \}/);
});

test("a day already sent stops being nudged about", () => {
  const read2 = fs.readFileSync(new URL("../../backend/src/modules/hrm/attendance/service.js", import.meta.url), "utf8");
  assert.match(read2, /type: \{ in: \["CORRECTION", "INCORRECT_LOGIN", "EXTRA_TIME"\] \}/);
});
