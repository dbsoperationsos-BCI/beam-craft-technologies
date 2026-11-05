const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { leftBefore } = require("../src/modules/hrm/attendance/service");

/*
 * Somebody who has left is counted by attendance up to and including their last day
 * (`dateOfRelieving`), and never after: not Absent on the calendar's Team Attendance, the Dashboard,
 * the register or the report. A day they did log in still counts, whatever the dates say.
 */
const SERVICE = fs.readFileSync(path.join(__dirname, "../src/modules/hrm/attendance/service.js"), "utf8");

test("a day after the last day is not counted; the last day itself is", () => {
  const relieved = { dateOfRelieving: new Date("2026-10-28T00:00:00.000Z") };
  assert.equal(leftBefore(relieved, "2026-10-27"), false);
  assert.equal(leftBefore(relieved, "2026-10-28"), false, "the last day is still a working day");
  assert.equal(leftBefore(relieved, "2026-10-29"), true);
  assert.equal(leftBefore({ dateOfRelieving: null }, "2030-01-01"), false, "nobody relieved is never cut off");
});

test("the register, the range tally and the time-off totals all stop at the last day, a login aside", () => {
  assert.match(SERVICE, /\|\| \(\(!employee\.dateOfJoining \|\| localIsoDate\(employee\.dateOfJoining\) <= iso\) && !leftBefore\(employee, iso\)\)\)/);
  assert.match(SERVICE, /if \(!session && leftBefore\(employee, iso\)\) continue;/);
  assert.match(SERVICE, /\(joined && iso < joined\) \|\| leftBefore\(employee, iso\)\) continue;/);
  assert.match(SERVICE, /dateOfJoining: true, dateOfRelieving: true, allowFlexibleShift: true/);
});
