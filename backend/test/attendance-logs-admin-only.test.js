const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * The Self Dashboard's Login Summary and Break Summary are for holders of `HRM / Attendance Logs`;
 * everybody else gets the KPI cards. Decided on the server in one place, and enforced there, not only
 * hidden.
 */

const MODULE = path.join(__dirname, "..", "src", "modules", "hrm", "attendance");
const SERVICE = fs.readFileSync(path.join(MODULE, "service.js"), "utf8");
const CONTROLLER = fs.readFileSync(path.join(MODULE, "controller.js"), "utf8");
const PAGE = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "components", "hrm", "EmployeeAttendancePage.js"), "utf8");

test("who sees the logs is decided once, on the server", () => {
  // Administrators only - not a permission granted role by role.
  assert.match(SERVICE, /const seesAttendanceLogs = \(user\) => isAdministrator\(user\?\.id\);/);
  assert.match(CONTROLLER, /canSeeLogs: await service\.seesAttendanceLogs\(req\.user\)/);
});

test("the break list refuses anybody not shown it, before reading a row", () => {
  const body = CONTROLLER.slice(CONTROLLER.indexOf("async function getBreaks("));
  const guard = body.indexOf("service.seesAttendanceLogs(req.user)");
  assert.ok(guard > -1, "the break list is no longer guarded");
  assert.ok(guard < body.indexOf("prisma.attendanceBreak.findMany"), "the guard runs after the breaks are read");
});

test("the dashboard draws the two summaries only on the server's say-so, hidden by default", () => {
  assert.match(PAGE, /showLogs=\{SHOW_ATTENDANCE_LOGS && Boolean\(settings\?\.canSeeLogs\)\}/);
  // And off for everybody for now, administrators included.
  assert.match(PAGE, /const SHOW_ATTENDANCE_LOGS = false;/);
  // Hidden unless the server says otherwise - `showLogs` defaults to false.
  assert.match(PAGE, /function SelfDashboardPanel\(\{[^}]*\bshowLogs = false \}\) \{/);
  assert.match(PAGE, /\{showLogs && <>[\s\S]*<AttendanceSummarySection[\s\S]*<BreakSummarySection[\s\S]*<\/>\}/);
});

/*
 * An administrator no longer has a Self Dashboard at all: the tab reads **Dashboard** and shows the
 * studio's attendance over a range (`AdminAttendanceDashboard`). So the range picker that used to
 * be taken off their own dashboard is simply always drawn on it - the panel is the employee's own,
 * and nobody else's, which is what these two assert.
 */
test("an administrator gets the studio's Dashboard where everybody else gets their own", () => {
  assert.match(PAGE, /const showAdminDashboard = !permissionsLoading && isAdministrator;/);
  // The switch says Dashboard for them and Self Dashboard for everybody else.
  assert.match(PAGE, /entry\.value === SECTION_SELF && showAdminDashboard \? \{ \.\.\.entry, label: "Dashboard" \}/);
  // And the two panels are the two branches of one choice, held back while the permissions load so
  // neither is drawn and then replaced.
  assert.match(PAGE, /\{permissionsLoading[\s\S]*?: showAdminDashboard[\s\S]*?<AdminAttendanceDashboard[\s\S]*?: <SelfDashboardPanel/);
});

test("the employee's own dashboard keeps its range picker, with no administrator test left on it", () => {
  const panel = PAGE.slice(PAGE.indexOf("function SelfDashboardPanel("), PAGE.indexOf("export default function EmployeeAttendancePage"));
  // Nothing in the panel asks whether the reader is an administrator: one never reaches it.
  assert.doesNotMatch(panel, /isAdministrator/);
  assert.doesNotMatch(panel, /showRange/);
  assert.match(panel, /<p[^>]*>\{caption\}<\/p>[\s\S]*?ariaLabel="Date range"/);
});
