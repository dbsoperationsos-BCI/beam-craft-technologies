const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * The administrator's Dashboard reads `GET /api/hrm/attendance/overview` - the studio's attendance
 * over a range, which is wider than any one permission a role can be granted. Administrators only,
 * refused on the server rather than merely hidden on the screen.
 */

const MODULE = path.join(__dirname, "..", "src", "modules", "hrm", "attendance");
const SERVICE = fs.readFileSync(path.join(MODULE, "service.js"), "utf8");
const CONTROLLER = fs.readFileSync(path.join(MODULE, "controller.js"), "utf8");
const ROUTES = fs.readFileSync(path.join(MODULE, "routes.js"), "utf8");
const DASHBOARD = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "components", "hrm", "AdminAttendanceDashboard.js"), "utf8");

test("the overview refuses anybody who is not an administrator, before it reads a row", () => {
  const body = CONTROLLER.slice(CONTROLLER.indexOf("async function getOverview("));
  const guard = body.indexOf("isAdministrator(req.user?.id)");
  assert.ok(guard > -1, "the overview is no longer guarded for administrators");
  assert.ok(guard < body.indexOf("service.attendanceOverview"), "the guard runs after the range is read");
});

test("the route sits above /:sessionId, or it would be read as a session id", () => {
  const overview = ROUTES.indexOf('router.get("/overview"');
  const detail = ROUTES.indexOf('router.get("/:sessionId"');
  assert.ok(overview > -1, "the overview route is missing");
  assert.ok(overview < detail, "/overview is declared after /:sessionId and will never be reached");
});

test("a range that is backwards or too long is refused rather than walked", () => {
  const body = CONTROLLER.slice(CONTROLLER.indexOf("async function getOverview("));
  assert.match(body, /if \(from > to\) throw badRequest/);
  assert.match(body, /OVERVIEW_MAX_DAYS/);
  assert.match(CONTROLLER, /const OVERVIEW_MAX_DAYS = 366;/);
});

test("the overview judges a day with the same rules the register and the summary use", () => {
  const body = SERVICE.slice(SERVICE.indexOf("async function tallyRange("), SERVICE.indexOf("async function attendanceOverview("));
  // The verdict is not a second copy of the rules written for this screen.
  // ...on the person's own branch's holidays, which is what the register judges on too.
  assert.match(body, /dayKindFor\(iso, \{ settings, holidayDates: holidays\.forBranch\(employee\.branchId\), leaveDates \}\)/);
  // ...and a day a Correction set reads as that, on this screen as on every other.
  assert.match(body, /attendanceDayStatus\(session, \{ settings, dayKind: kind, permissions, today: now, date: iso, flexible: employee\.allowFlexibleShift === true, override: overrides\.get\(`\$\{employee\.id\}\|\$\{iso\}`\) \|\| null \}\)/);
  assert.match(body, /dayShares\(verdict\.status\)/);
});

test("attendance-optional logins are left out of the figures, as they are on the register", () => {
  const body = SERVICE.slice(SERVICE.indexOf("async function tallyRange("), SERVICE.indexOf("async function attendanceOverview("));
  assert.match(body, /attendanceOptionalEmployeeIds\(/);
  assert.match(body, /candidates\.filter\(\(employee\) => !optionalIds\.has\(employee\.id\)\)/);
});

test("a joiner is not counted absent for the days before they started", () => {
  const body = SERVICE.slice(SERVICE.indexOf("async function tallyRange("), SERVICE.indexOf("async function attendanceOverview("));
  assert.match(body, /if \(!session && joined && iso < joined\) continue;/);
});

test("the range is walked in memory, not queried per day", () => {
  const body = SERVICE.slice(SERVICE.indexOf("async function tallyRange("), SERVICE.indexOf("async function attendanceOverview("));
  // One sessions query for the whole range, not one per date - and only the columns it counts with
  // and the login and logout coordinates the Employees table links to the map; never the selfie keys
  // or the addresses a session row also carries.
  // `lastLoginAt` because a login's 18 hours run from it; `workMode` because a Flexible Shift day is
  // judged on its hours alone.
  assert.match(body, /attendanceSession\.findMany\(\{\s*where: \{ workDate: \{ gte: start, lte: end \} \},\s*select: \{ id: true, employeeId: true, workDate: true, loginAt: true, lastLoginAt: true, logoutAt: true, awayMinutes: true, workMode: true, loginLatitude: true, loginLongitude: true, logoutLatitude: true, logoutLongitude: true \}/);
  assert.doesNotMatch(body, /selfieKey: true|selfieData: true|SelfieUrl: true|locationAddress: true/);
  assert.doesNotMatch(body, /for \(const iso of dates\) \{[\s\S]*?await /);
});

test("each card's arrow is against the period of the same length just before, through the same tally", () => {
  const body = SERVICE.slice(SERVICE.indexOf("async function attendanceOverview("), SERVICE.indexOf("async function attendanceDetail("));
  assert.match(body, /tallyRange\(start, end, \{ branchId, employeeIds \}\)/);
  // The same filters; only its totals are read, so its time-off lists are not worked out.
  assert.match(body, /tallyRange\(previousStart, previousEnd, \{ branchId, employeeIds, withTimeOff: false \}\)/);
  assert.match(body, /previousStart\.setUTCDate\(previousStart\.getUTCDate\(\) - \(span - 1\)\)/);
});

test("the Employee filter refuses anything that is not a list of ids, rather than widening to everybody", () => {
  const body = CONTROLLER.slice(CONTROLLER.indexOf("async function getOverview("));
  assert.match(body, /throw badRequest\("Choose employees from the list\."\)/);
  assert.match(body, /OVERVIEW_MAX_EMPLOYEES/);
  assert.match(body, /throw badRequest\("Choose a branch from the list\."\)/);
});

test("the dashboard draws figures and tables, and pulls in no charting library", () => {
  assert.doesNotMatch(DASHBOARD, /recharts|chart\.js|apexcharts|nivo|victory|d3|echarts/i);
  assert.match(DASHBOARD, /getAttendanceOverview/);
  // The filters are applied on a press rather than on every keystroke, as on Reports & Analytics.
  assert.match(DASHBOARD, /const apply = \(\) => \{ setView\(null\); setApplied\(\{ \.\.\.draft \}\); \};/);
  assert.match(DASHBOARD, /<MultiSelectField[\s\S]*?label="Employee"[\s\S]*?searchable/);
  // The cards are Image Selection's, from the one shared component.
  assert.match(DASHBOARD, /import SummaryCard from "@\/components\/shared\/SummaryCard";/);
});
