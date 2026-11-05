const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Somebody ticked **Exclude From Attendance** is not in the attendance module at all.
 *
 * `createRequest` refuses them in so many words, and a request of theirs is off every queue
 * (`visibilityFilter`'s `employee: NOT_EXCLUDED`) and cannot be decided by id either. The rule
 * arrived on `develop` while the request lifecycle - edit, revert, delete, send back - was being
 * written here, so the four verbs it added were never held to it: a textual merge keeps both
 * changes and cannot see that one of them left a hole in the other.
 *
 * Each verb asks the same question the path beside it asks: an approver's gets `Request not found`,
 * because a request they may not see is one that is not there for them; the raiser's own gets the
 * sentence `createRequest` gives, which says what to do about it.
 */

const CONTROLLER = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "attendance", "controller.js"), "utf8");
const bodyOf = (name) => {
  // `decide` takes the status and the remark as well, so match the opening and not the whole list.
  const start = CONTROLLER.indexOf(`async function ${name}(req, res`);
  assert.notEqual(start, -1, `${name} is not in the controller`);
  return CONTROLLER.slice(start, CONTROLLER.indexOf("\n}\n", start));
};

test("every request verb is held to Exclude From Attendance", () => {
  // The approver's two: a request they may not see is not there for them.
  for (const verb of ["decide", "sendBackRequest"]) {
    assert.match(bodyOf(verb), /isExcludedFromAttendance\(request\.employeeId\)/, verb);
    assert.match(bodyOf(verb), /notFound\("Request not found"\)/, verb);
  }
  // The raiser's four, which are their own request: told what to do, as raising one tells them.
  for (const verb of ["createRequest", "updateRequest", "revertRequest", "deleteRequest"]) {
    const body = bodyOf(verb);
    assert.match(body, /isExcludedFromAttendance\(/, verb);
    assert.match(body, /throw forbidden\(NOT_IN_ATTENDANCE\)/, verb);
  }
});

test("the sentence is written once", () => {
  // Four verbs say it; one `const` holds it, or they drift apart a word at a time.
  assert.match(CONTROLLER, /const NOT_IN_ATTENDANCE = "Your attendance is not tracked in the studio's Attendance module/);
  assert.equal(
    (CONTROLLER.match(/not tracked in the studio's Attendance module/g) || []).length,
    1,
    "the words live in the constant and nowhere else",
  );
  // Extra time throws it too: a logout past 18 hours is attendance like any other.
  assert.equal((CONTROLLER.match(/NOT_IN_ATTENDANCE/g) || []).length, 6, "declared once, thrown by five verbs");
});
