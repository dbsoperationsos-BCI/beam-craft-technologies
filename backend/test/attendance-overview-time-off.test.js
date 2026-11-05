const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { timeOffUsed } = require("../src/modules/hrm/attendance/service");

/*
 * The administrator's Dashboard: who used Casual Leave, permissions and comp-offs over the range, from
 * the approved requests the overview already reads.
 */

const day = (iso) => new Date(`${iso}T00:00:00.000Z`);
const SETTINGS = { weeklyOffDays: "0" };
const EMPLOYEES = [
  { id: 1, employeeId: "EMP-1", employeeName: "Kavya", branchId: 1, dateOfJoining: day("2026-01-01") },
  { id: 2, employeeId: "EMP-2", employeeName: "Arun", branchId: 2, dateOfJoining: day("2026-10-08") },
];
const options = {
  branchName: new Map([[1, "Erode TN"], [2, "Coimbatore TN"]]),
  settings: SETTINGS,
  // Friday 2 Oct is a declared holiday; Sunday 4 Oct a weekly off.
  holidayDates: new Set(["2026-10-02"]),
  goLive: null,
  start: day("2026-10-01"),
  end: day("2026-10-15"),
};

test("Casual Leave is counted in working days, Loss of Pay leave is left out, and only the range counts", () => {
  const approved = [
    // Thu 1 Oct to Tue 6 Oct: 2 Oct a holiday and 4 Oct a Sunday are not days of leave - 4 days.
    { employeeId: 1, type: "LEAVE", leaveType: "CL", fromDate: day("2026-10-01"), toDate: day("2026-10-06") },
    // Raised before the leave type existed: Casual Leave. Runs past the range - only 15 Oct counts.
    { employeeId: 1, type: "LEAVE", leaveType: null, fromDate: day("2026-10-15"), toDate: day("2026-10-20") },
    { employeeId: 1, type: "LEAVE", leaveType: "LOP", fromDate: day("2026-10-07"), toDate: day("2026-10-07") },
    // Overlapping a day already counted: still one day.
    { employeeId: 1, type: "LEAVE", leaveType: "CL", fromDate: day("2026-10-06"), toDate: day("2026-10-06") },
  ];
  const { casualLeave } = timeOffUsed(approved, EMPLOYEES, options);
  assert.deepEqual(casualLeave.map((row) => [row.employeeName, row.branchName, row.days, row.dates]), [
    ["Kavya", "Erode TN", 5, ["2026-10-01", "2026-10-03", "2026-10-05", "2026-10-06", "2026-10-15"]],
  ]);
});

test("permissions are counted with their minutes, comp-offs as days off taken, the most first", () => {
  const approved = [
    { employeeId: 1, type: "PERMISSION", fromDate: day("2026-10-08"), toDate: day("2026-10-08"), fromTime: "10:00", toTime: "11:00" },
    { employeeId: 2, type: "PERMISSION", fromDate: day("2026-10-09"), toDate: day("2026-10-09"), fromTime: "15:00", toTime: "15:30" },
    { employeeId: 2, type: "PERMISSION", fromDate: day("2026-10-10"), toDate: day("2026-10-10"), fromTime: "09:00", toTime: "09:45" },
    { employeeId: 1, type: "COMP_OFF", fromDate: day("2026-10-13"), toDate: day("2026-10-13") },
    // Before Arun joined on 8 Oct: not his.
    { employeeId: 2, type: "COMP_OFF", fromDate: day("2026-10-06"), toDate: day("2026-10-06") },
    // Somebody not on the roster the filters left.
    { employeeId: 9, type: "COMP_OFF", fromDate: day("2026-10-13"), toDate: day("2026-10-13") },
  ];
  const { permissions, compOffs } = timeOffUsed(approved, EMPLOYEES, options);
  assert.deepEqual(permissions.map((row) => [row.employeeName, row.count, row.minutes]), [["Arun", 2, 75], ["Kavya", 1, 60]]);
  assert.deepEqual(compOffs.map((row) => [row.employeeName, row.days, row.dates]), [["Kavya", 1, ["2026-10-13"]]]);
});

test("the overview hands the three lists to the Dashboard", () => {
  const SERVICE = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "attendance", "service.js"), "utf8");
  // The range's per-branch calendar, so each person's leave is counted against their own holidays.
  assert.match(SERVICE, /timeOff: withTimeOff \? timeOffUsed\(approved, employees, \{ branchName, settings, holidays, goLive, start, end \}\) : null,/);
  // The period compared against shows only its totals, so its lists are not worked out.
  assert.match(SERVICE, /tallyRange\(previousStart, previousEnd, \{ branchId, employeeIds, withTimeOff: false \}\)/);
  assert.match(SERVICE, /select: \{ employeeId: true, type: true, leaveType: true, fromDate: true, toDate: true, fromTime: true, toTime: true \},/);
});
