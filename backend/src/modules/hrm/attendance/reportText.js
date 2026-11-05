/**
 * The Attendance Report's text, built on the server - for the daily message sent into the linked
 * WhatsApp group at 10:00 am, where there is no browser to build it.
 *
 * The same placeholders, filled the same way, as the screen's copy
 * (`frontend/src/lib/attendanceReport.mjs`), which the Send dialog uses. They are two files because
 * one is an ES module in the frontend package and this runs in the backend's CommonJS;
 * `test/attendance-report-text.test.js` holds the two to the same output for the same register, so
 * the message in the group and the one copied off the screen cannot drift apart.
 *
 * One difference, on purpose: every clock time here is read in the studio's time zone. The browser's
 * copy formats in the reader's own zone, which is the studio's; a server's may be UTC.
 */

const { STUDIO_TIME_ZONE } = require("../../../services/studioTime");

const ATTENDANCE_REPORT_TEMPLATE_KEY = "ATTENDANCE_DAILY_REPORT";

/** What the migrations last seeded, and what is sent where the studio has no wording of its own. */
const DEFAULT_ATTENDANCE_REPORT = `Attendance Report - {date}
{branch}, as of {time}

Total employees: {total employees}
Present: {present count}
Leave: {leave count}
Uninformed Leave: {uninformed leave count}
Permission: {permission count}

Leave:
{leave list}

Uninformed Leave:
{uninformed leave list}

Permission:
{permission list}`;

/** The statuses that mean somebody came in - `isAttendedStatus`, the same list. */
const ATTENDED = new Set(["On time", "Present", "Late", "Permitted", "Half day", "Early exit", "Not logged out"]);

const timeFormat = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: STUDIO_TIME_ZONE });
const dayFormat = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const shortDayFormat = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

const clock = (value) => (value ? timeFormat.format(new Date(value)).toLowerCase() : "");
const who = (row) => `${row.employeeName}${row.employeeCode ? ` (${row.employeeCode})` : ""}`;

/** A permission's `"14:00"` as `2:00 pm` - the wall-clock time as written, never through a timezone. */
function wallClock(value) {
  const [hours, minutes] = String(value || "").split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return String(value || "");
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "am" : "pm"}`;
}

const slotText = (slot) => `${wallClock(slot.fromTime)} to ${wallClock(slot.toTime)}`;
const permissionLine = (row) => `${who(row)} - ${[
  ...(row.permissions || []).map(slotText),
  // Asked for and still waiting on its approvers, said so - as a leave not yet approved is.
  ...(row.pendingPermissions || []).map((slot) => `${slotText(slot)} (approval pending)`),
].join(", ")}`;

/** A permission's `"09:30"` as minutes of the day, or null. */
function clockMinutes(value) {
  const [hours, minutes] = String(value || "").split(":").map(Number);
  return Number.isInteger(hours) && Number.isInteger(minutes) ? hours * 60 + minutes : null;
}

const minuteFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: STUDIO_TIME_ZONE });
/** The minute of the day the report is read at, on the studio's clock. */
const minutesAt = (value) => clockMinutes(minuteFormat.format(new Date(value)));
const compOffLine = (row) => `${who(row)}${row.compOffFor ? ` - for ${shortDayFormat.format(new Date(`${row.compOffFor}T00:00:00Z`))} worked` : ""}`;

/**
 * Somebody not in who has asked for the day off, with the request still waiting on its approvers:
 * on the Leave list rather than Uninformed Leave, and said to be pending. A comp-off says so.
 */
const pendingLeaveLine = (row) => `${who(row)}${row.leavePending === "COMP_OFF" ? " - Comp-off" : ""} (approval pending)`;

function absentLine(row) {
  if (row.status !== "On leave") return row.leavePending ? pendingLeaveLine(row) : who(row);
  if (row.compOffFor == null) return `${who(row)} - On leave`;
  return `${who(row)} - Comp-off${row.compOffFor ? ` for ${shortDayFormat.format(new Date(`${row.compOffFor}T00:00:00Z`))} worked` : ""}`;
}

/**
 * Somebody on the Leave list - away with approval: their name, and "Comp-off" with the day it was
 * earned where it is one. Plain approved leave needs no tag.
 */
function leaveLine(row) {
  if (row.compOffFor == null) return who(row);
  return `${who(row)} - Comp-off${row.compOffFor ? ` for ${shortDayFormat.format(new Date(`${row.compOffFor}T00:00:00Z`))} worked` : ""}`;
}

const numbered = (lines) => (lines.length ? lines.map((line, index) => `${index + 1}. ${line}`).join("\n") : "None");

/** Somebody on the present list: their name and ID alone - no login or logout time, no status. */
const presentLine = (row) => who(row);

/** The values for every placeholder, from a register response (`{ date, summary, rows }`). */
function attendanceReportValues(register, { branchName = "", asOf = new Date() } = {}) {
  const rows = register?.rows || [];
  const summary = register?.summary || {};
  const present = rows.filter((row) => ATTENDED.has(row.status));
  const late = rows.filter((row) => row.status === "Late");
  /*
   * Not in, with a leave or comp-off asked for and not yet approved (`leavePending` on the register's
   * row). Absent once the shift has started, or - for a Flexible Shift - still Yet to log in, which no
   * other list holds. Either way they are on the Leave list, said to be pending, not Uninformed Leave.
   */
  const pendingLeave = rows.filter((row) => row.leavePending && (row.status === "Absent" || row.status === "Yet to log in"));
  const pendingNotYetIn = pendingLeave.filter((row) => row.status !== "Absent").length;
  const absent = rows.filter((row) => row.status === "Absent" || row.status === "On leave" || pendingLeave.includes(row));
  const compOff = rows.filter((row) => row.status === "On leave" && row.compOffFor != null);
  const onLeave = rows.filter((row) => row.status === "On leave" && row.compOffFor == null);
  const approvedLeave = rows.filter((row) => row.status === "On leave");
  /*
   * Not in, but on a permission - approved or still waiting on its approvers - that covers the moment
   * of the report: somebody on 9:30 to 12:00 is not missing at 9:45. They are listed under Permission
   * alone, not under Uninformed Leave. One whose permission has not begun yet, or has ended, is.
   */
  const now = minutesAt(asOf);
  const covers = (slots) => now !== null && slots.some((slot) => {
    const from = clockMinutes(slot.fromTime);
    const to = clockMinutes(slot.toTime);
    return from !== null && to !== null && from <= now && now < to;
  });
  const onPermissionNow = rows.filter((row) => row.status === "Absent" && !row.leavePending && covers([...(row.permissions || []), ...(row.pendingPermissions || [])]));
  const uninformed = rows.filter((row) => row.status === "Absent" && !row.leavePending && !onPermissionNow.includes(row));
  /*
   * Leave, Uninformed Leave and Permission each name somebody once: whoever is on the Leave list (away,
   * or with a leave waiting) or on Uninformed Leave (not in, and no permission covering now - one that
   * starts later or has ended does not excuse them) is said there and not under Permission as well.
   */
  const onLeaveList = new Set([...approvedLeave, ...pendingLeave]);
  const permission = rows.filter((row) => (row.permissions?.length || row.pendingPermissions?.length) && !onLeaveList.has(row) && !uninformed.includes(row));
  const notCheckedOut = rows.filter((row) => ATTENDED.has(row.status) && row.checkInAt && !row.checkOutAt);

  return {
    date: register?.date ? dayFormat.format(new Date(`${register.date}T00:00:00Z`)) : "",
    time: clock(asOf),
    branch: branchName || "All branches",
    "total employees": summary.total ?? rows.length,
    "present count": summary.present ?? present.length,
    "late count": summary.late ?? late.length,
    "absent count": summary.absent != null && summary.onLeave != null ? summary.absent + summary.onLeave + pendingNotYetIn : absent.length,
    "on leave count": summary.onLeave != null ? summary.onLeave - (summary.compOff ?? compOff.length) : onLeave.length,
    // Approved and pending alike, as the list says them - the register's own count is approved only.
    "permission count": permission.length,
    "comp-off count": summary.compOff ?? compOff.length,
    "not checked out count": summary.notCheckedOut ?? notCheckedOut.length,
    "present list": numbered(present.map(presentLine)),
    "late list": numbered(late.map((row) => `${who(row)}${row.checkInAt ? ` - in ${clock(row.checkInAt)}` : ""}`)),
    "absent list": numbered(absent.map(absentLine)),
    /*
     * Leave and Uninformed Leave: the two halves of Absent, said apart. Leave is whoever is away
     * with an approved request - leave or a comp-off - and, said to be pending, whoever is not in
     * with one still waiting on its approvers; Uninformed Leave whoever was expected and is not in
     * without either (a day too short to count included).
     */
    "leave count": (summary.onLeave ?? approvedLeave.length) + pendingLeave.length,
    "leave list": numbered([...approvedLeave.map(leaveLine), ...pendingLeave.map(pendingLeaveLine)]),
    "uninformed leave count": summary.absent != null ? summary.absent - (pendingLeave.length - pendingNotYetIn) - onPermissionNow.length : uninformed.length,
    "uninformed leave list": numbered(uninformed.map(who)),
    "on leave list": numbered(onLeave.map(who)),
    "permission list": numbered(permission.map(permissionLine)),
    "comp-off list": numbered(compOff.map(compOffLine)),
    "not checked out list": numbered(notCheckedOut.map((row) => `${who(row)} - in ${clock(row.checkInAt)}`)),
  };
}

module.exports = { ATTENDANCE_REPORT_TEMPLATE_KEY, DEFAULT_ATTENDANCE_REPORT, attendanceReportValues };
