/**
 * The Attendance Register's Send message: one day's attendance as it stands, as text to paste into
 * WhatsApp.
 *
 * The wording is the studio's, under `ATTENDANCE_DAILY_REPORT` in Settings → Templates, and this
 * fills its `{placeholders}` from the register the server just answered - so the figures are the
 * register's own, decided by the same rules, never recounted here. `DEFAULT_ATTENDANCE_REPORT` is
 * what the migration seeds and what the dialog falls back to where the studio has no wording.
 *
 * Pure, so it can be tested without a browser.
 */

export const ATTENDANCE_REPORT_TEMPLATE_KEY = "ATTENDANCE_DAILY_REPORT";

/*
 * The day as Present (a count - no names), **Leave** (away with an approved request, a comp-off
 * included and tagged) and **Uninformed Leave** (expected, and not in, without one), then Permission.
 * No Late or Absent line or list: the studio does not want them in the message. Every other
 * placeholder stays, for a studio that wants it back.
 */
export const DEFAULT_ATTENDANCE_REPORT = `Attendance Report - {date}
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

/** The statuses that mean somebody came in - the server's `isAttendedStatus`, the same list. */
const ATTENDED = new Set(["On time", "Present", "Late", "Permitted", "Half day", "Early exit", "Not logged out"]);

const timeFormat = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
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

/** Somebody's approved permissions for the day, as `10:00 am to 12:00 pm`, several joined. */
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

const minuteFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** The minute of the day the report is read at, on the studio's clock. */
const minutesAt = (value) => clockMinutes(minuteFormat.format(new Date(value)));

/** A comp-off, with the weekly off or holiday it was earned on where one is recorded. */
const compOffLine = (row) => `${who(row)}${row.compOffFor ? ` - for ${shortDayFormat.format(new Date(`${row.compOffFor}T00:00:00Z`))} worked` : ""}`;

/**
 * Somebody not in who has asked for the day off, with the request still waiting on its approvers:
 * on the Leave list rather than Uninformed Leave, and said to be pending. A comp-off says so.
 */
const pendingLeaveLine = (row) => `${who(row)}${row.leavePending === "COMP_OFF" ? " - Comp-off" : ""} (approval pending)`;

/**
 * Somebody on the absent list: their name, and - for somebody away with approval - why, so the list
 * does not read as unexplained absences. "On leave", or "Comp-off for Sun, 20 Sep worked".
 */
function absentLine(row) {
  if (row.status !== "On leave") return row.leavePending ? pendingLeaveLine(row) : who(row);
  if (row.compOffFor == null) return `${who(row)} - On leave`;
  return `${who(row)} - Comp-off${row.compOffFor ? ` for ${shortDayFormat.format(new Date(`${row.compOffFor}T00:00:00Z`))} worked` : ""}`;
}

/** Numbered lines, or "None" - an empty heading reads as if the list failed to load. */
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

/**
 * The values for every placeholder the report offers, from a register response
 * (`{ date, summary, rows }`), the branch it was read for, and the moment it was read.
 */
export function attendanceReportValues(register, { branchName = "", asOf = new Date() } = {}) {
  const rows = register?.rows || [];
  const summary = register?.summary || {};
  const present = rows.filter((row) => ATTENDED.has(row.status));
  const late = rows.filter((row) => row.status === "Late");
  // Absent includes whoever is on leave or taking a comp-off, as the Attendance Register counts them.
  /*
   * Not in, with a leave or comp-off asked for and not yet approved (`leavePending` on the register's
   * row). Absent once the shift has started, or - for a Flexible Shift - still Yet to log in, which no
   * other list holds. Either way they are on the Leave list, said to be pending, not Uninformed Leave.
   */
  const pendingLeave = rows.filter((row) => row.leavePending && (row.status === "Absent" || row.status === "Yet to log in"));
  const pendingNotYetIn = pendingLeave.filter((row) => row.status !== "Absent").length;
  const absent = rows.filter((row) => row.status === "Absent" || row.status === "On leave" || pendingLeave.includes(row));
  // The two parts of Absent that are approved time away, for a template that lists them as well.
  // A comp-off reads as On leave on the register; it has its own list, so it is not said twice.
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
    // Leave only: the register's On leave tile includes comp-offs, which are counted on their own below.
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

/** What each placeholder means, for the Settings editor's list under the box. */
export const ATTENDANCE_REPORT_PLACEHOLDERS = {
  date: "The register's day, as Saturday, 26 Sep 2026",
  time: "When the report was taken, as 10:42 am - the figures are as of then",
  branch: "The branch the register was filtered to, or All branches",
  "total employees": "Everybody on the register that day",
  "present count": "How many came in - on time, late, permitted, half day, early exit, or still in",
  "late count": "How many checked in after the grace period",
  "absent count": "How many are absent - people on leave or taking a comp-off included",
  "on leave count": "Of the absent, how many are on approved leave - comp-offs are counted on their own",
  "permission count": "How many are in the permission list - approved, or still waiting on approval",
  "comp-off count": "Of the absent, how many are taking an approved comp-off",
  "not checked out count": "How many checked in and have not checked out yet",
  "present list": "Everybody who came in, numbered - names only, no login or logout time",
  "late list": "Everybody late, numbered, with their check-in time",
  "absent list": "Everybody absent, numbered - on leave or comp-off said beside the name",
  "leave count": "How many are on leave - a comp-off, and a leave not yet approved, included",
  "leave list": "Everybody on leave, numbered - a comp-off says so, and a leave not yet approved says (approval pending)",
  "uninformed leave count": "How many are away without asking for the day off - not counting anybody on a permission at the time of the report",
  "uninformed leave list": "Everybody away without asking for the day off, numbered - somebody on a permission at the time of the report is under Permission instead",
  "on leave list": "Everybody on leave, numbered (they are in the absent list as well)",
  "permission list": "Everybody with a permission, numbered, with its times - 10:00 am to 12:00 pm; one not yet approved says (approval pending). Somebody on leave, or not in outside their permission's time, is under Leave or Uninformed Leave instead",
  "comp-off list": "Everybody taking a comp-off, numbered, with the weekly off or holiday it was earned on (in the absent list as well)",
  "not checked out list": "Everybody still checked in, numbered, with their check-in time",
};
