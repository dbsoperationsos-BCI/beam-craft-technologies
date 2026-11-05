const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { attendanceReportValues } = require("../src/modules/hrm/attendance/reportText");

/*
 * Somebody not in who has asked for the day off, with the leave still waiting on its approvers, is
 * on the daily report's Leave list said to be pending - not Uninformed Leave, and not missing from
 * every list because a Flexible Shift still reads "Yet to log in". The screen's copy of the report
 * (`frontend/src/lib/attendanceReport.mjs`) says the same.
 */
const row = (employeeName, employeeCode, status, extra = {}) => ({ employeeName, employeeCode, status, permissions: [], compOffFor: null, leavePending: null, ...extra });
const register = {
  date: "2026-10-28",
  rows: [
    row("Asha", "E1", "On time"),
    row("Bala", "E2", "On leave"),
    row("Chitra", "E3", "Absent", { leavePending: "LEAVE" }),
    row("Dinesh", "E4", "Yet to log in", { leavePending: "LEAVE" }),
    row("Esther", "E5", "Absent", { leavePending: "COMP_OFF" }),
    row("Farook", "E6", "Absent"),
    row("Gita", "E7", "Yet to log in"),
  ],
};
register.summary = { total: 7, present: 1, absent: 3, onLeave: 1, compOff: 0, permission: 0 };

test("a leave not yet approved puts somebody not in on the Leave list, said to be pending", () => {
  const values = attendanceReportValues(register);
  assert.equal(values["leave list"], "1. Bala (E2)\n2. Chitra (E3) (approval pending)\n3. Dinesh (E4) (approval pending)\n4. Esther (E5) - Comp-off (approval pending)");
  assert.equal(values["leave count"], 4);
});

test("they are not Uninformed Leave, which keeps only whoever is away without asking", () => {
  const values = attendanceReportValues(register);
  assert.equal(values["uninformed leave list"], "1. Farook (E6)");
  assert.equal(values["uninformed leave count"], 1);
  assert.equal(values["absent count"], 5, "the four away and Farook; Gita on a Flexible Shift is not in yet");
});

test("the same counts and lists without the register's summary", () => {
  const values = attendanceReportValues({ ...register, summary: undefined });
  assert.equal(values["leave count"], 4);
  assert.equal(values["uninformed leave count"], 1);
  assert.equal(values["absent count"], 5);
});

test("the screen's copy of the report says exactly the same", async () => {
  const screen = await import(pathToFileURL(path.join(__dirname, "../../frontend/src/lib/attendanceReport.mjs")).href);
  const asOf = new Date("2026-10-28T04:30:00Z");
  const server = attendanceReportValues(register, { asOf });
  const client = screen.attendanceReportValues(register, { asOf });
  for (const key of ["leave list", "leave count", "uninformed leave list", "uninformed leave count", "absent list", "absent count"]) {
    assert.deepEqual(client[key], server[key], key);
  }
});
