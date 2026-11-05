const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { attendanceReportValues } = require("../src/modules/hrm/attendance/reportText");

/*
 * Somebody not in yet whose permission covers the moment of the report is on a permission, not
 * missing: asked for 9:30 to 12:00 and the report sent at 9:45, they are listed under Permission alone
 * - approved, or still waiting on its approvers and said to be pending - and not as Uninformed Leave.
 * One whose permission has not begun yet, or has ended, is still Uninformed Leave when not in - and is
 * said there alone. Leave, Uninformed Leave and Permission name each person once.
 */
const row = (employeeName, employeeCode, status, extra = {}) => ({ employeeName, employeeCode, status, permissions: [], pendingPermissions: [], compOffFor: null, leavePending: null, ...extra });
const morning = [{ fromTime: "09:30", toTime: "12:00" }];
const register = {
  date: "2026-10-28",
  rows: [
    row("Asha", "E1", "On time"),
    row("Bala", "E2", "Absent", { permissions: morning }),
    row("Chitra", "E3", "Absent", { pendingPermissions: morning }),
    row("Dinesh", "E4", "Absent", { permissions: [{ fromTime: "14:00", toTime: "16:00" }] }),
    row("Esther", "E5", "Absent"),
    row("Farook", "E6", "On time", { permissions: [{ fromTime: "15:00", toTime: "16:00" }] }),
    row("Gita", "E7", "On leave", { permissions: morning }),
  ],
};
register.summary = { total: 7, present: 2, absent: 4, onLeave: 1, compOff: 0, permission: 3 };
// 9:45 am in the studio's time zone (India, UTC+5:30).
const at945 = new Date("2026-10-28T04:15:00Z");

test("on a permission at the time of the report - approved or pending - is under Permission alone", () => {
  const values = attendanceReportValues(register, { asOf: at945 });
  assert.equal(values["permission list"], [
    "1. Bala (E2) - 9:30 am to 12:00 pm",
    "2. Chitra (E3) - 9:30 am to 12:00 pm (approval pending)",
    "3. Farook (E6) - 3:00 pm to 4:00 pm",
  ].join("\n"));
  assert.equal(values["permission count"], 3, "pending ones counted, as the list says them");
  // Dinesh's permission is this afternoon: at 9:45 he is not in and not excused.
  assert.equal(values["uninformed leave list"], "1. Dinesh (E4)\n2. Esther (E5)");
  assert.equal(values["uninformed leave count"], 2);
  // On leave is said under Leave alone, whatever permission the day also holds.
  assert.equal(values["leave list"], "1. Gita (E7)");
});

test("nobody is named in two of Leave, Uninformed Leave and Permission", () => {
  for (const asOf of [at945, new Date("2026-10-28T06:45:00Z")]) {
    const values = attendanceReportValues(register, { asOf });
    const names = (list) => (list === "None" ? [] : list.split("\n").map((line) => line.replace(/^\d+\. /, "").split(" (")[0]));
    const all = [...names(values["leave list"]), ...names(values["uninformed leave list"]), ...names(values["permission list"])];
    assert.equal(new Set(all).size, all.length, all.join(", "));
  }
});

test("once the permission has ended, somebody still not in is Uninformed Leave again", () => {
  const values = attendanceReportValues(register, { asOf: new Date("2026-10-28T06:45:00Z") }); // 12:15 pm
  assert.equal(values["uninformed leave list"], "1. Bala (E2)\n2. Chitra (E3)\n3. Dinesh (E4)\n4. Esther (E5)");
  assert.equal(values["uninformed leave count"], 4);
  assert.equal(values["permission list"], "1. Farook (E6) - 3:00 pm to 4:00 pm", "and not under Permission as well");
});

test("the screen's copy of the report says the same", async () => {
  const front = await import(pathToFileURL(path.join(__dirname, "../../frontend/src/lib/attendanceReport.mjs")).href);
  // The screen reads the reader's own clock, the studio's: the same instant, as the browser would.
  const values = front.attendanceReportValues(register, { asOf: at945 });
  if (Intl.DateTimeFormat().resolvedOptions().timeZone !== "Asia/Kolkata") return;
  assert.equal(values["uninformed leave list"], "1. Dinesh (E4)\n2. Esther (E5)");
  assert.equal(values["permission count"], 3);
});
