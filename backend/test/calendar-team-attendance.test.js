const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { SOURCES, listSchedule } = require("../src/modules/schedule/calendar/service");

/*
 * Team Attendance: everybody's Absent and On leave days on the calendar, for an administrator only -
 * named per day, and Absent never in the future.
 */

const team = SOURCES.find((source) => source.key === "teamAttendance");

test("Team Attendance names its permission and is an administrator's", async () => {
  assert.ok(team, "the source exists");
  assert.equal(team.administrator, true);
  assert.deepEqual([team.module, team.feature], ["HRM", "Employee Attendance"]);
  const asked = (isAdministrator) => listSchedule({ can: async () => true, isAdministrator, from: new Date("2099-01-01"), to: new Date("2099-01-01") })
    .catch(() => ({ kinds: [] }));
  // Without the administrator flag the source is never even loaded, whatever permission is held.
  const original = team.load;
  let loaded = 0;
  team.load = async () => { loaded += 1; return []; };
  try {
    const others = SOURCES.filter((source) => source !== team);
    const saved = others.map((source) => source.load);
    others.forEach((source) => { source.load = async () => []; });
    try {
      assert.ok(!(await asked(false)).kinds.includes("teamAttendance"));
      assert.equal(loaded, 0);
      assert.ok((await asked(true)).kinds.includes("teamAttendance"));
      assert.equal(loaded, 1);
    } finally { others.forEach((source, index) => { source.load = saved[index]; }); }
  } finally { team.load = original; }
});

test("the names come from the register's own range reader, Absent only up to today", () => {
  const service = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "schedule", "calendar", "service.js"), "utf8");
  assert.match(service, /hrmAttendance\.tallyRange\(start, end, \{ withTimeOff: false, withPeople: true \}\)/);
  assert.match(service, /\["Absent", day\.date <= todayIso \? day\.absentPeople : \[\]\]/);
  const attendance = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "attendance", "service.js"), "utf8");
  assert.match(attendance, /if \(withPeople && \(verdict\.status === "Absent" \|\| verdict\.status === "On leave"\)\)/);
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "schedule", "calendar", "controller.js"), "utf8");
  assert.match(controller, /isAdministrator: await isAdministrator\(req\.user\.id\)/);
});
