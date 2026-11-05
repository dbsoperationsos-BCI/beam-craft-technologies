/**
 * What a working day is, and whether a given day met it.
 *
 * Every function here is pure: dates and settings in, a verdict out, no Prisma and no clock of its
 * own. That is deliberate. Attendance status used to be decided in the browser against a hardcoded
 * 9:45 cutoff and fixed 42h30 / 170h targets, which meant the numbers could not be changed, could
 * not be tested, and disagreed with anything HR actually did about weekends, holidays or approved
 * time off. Putting the arithmetic in one testable place is the fix; the controller supplies the
 * settings row, the holidays and the approved requests, and reads the answer back.
 *
 * Times are local wall-clock throughout — "09:30" is half past nine wherever the studio is, and a
 * work date is the calendar day it reads as on the wall, not a UTC instant. The server and the
 * database run in the studio's zone, which is the same assumption every other date column in this
 * schema already makes.
 */

const MINUTES_PER_DAY = 24 * 60;
const MS_PER_DAY = 86400000;

/** The kinds of day a date can be, most specific first — the order `dayKindFor` decides in. */
const DAY_KINDS = {
  HOLIDAY: "Holiday",
  WEEKLY_OFF: "Weekly off",
  ON_LEAVE: "On leave",
  WORKING: "Working",
};

/**
 * The kinds of ask an approver answers.
 *
 * `CORRECTION` and `OUTSIDE_LOCATION` join the original three rather than getting tables of their
 * own, because they are the same conversation the other three are — somebody asks, an approver says
 * yes or no — and the whole pipeline already exists for it: the approver rules, the event log, the
 * Approvals queue, the overlap check. What they name differs, and that fits the columns already
 * here: both put one day in `fromDate` and `toDate`, a correction proposes a checkout in `toTime`,
 * and the session being corrected is found by the day, since one employee has one session per day.
 *
 * `approvedTimeOff` counts only LEAVE and PERMISSION, so neither of the new two can be mistaken for
 * time away from work.
 */
const REQUEST_TYPES = ["LEAVE", "PERMISSION", "ON_DUTY", "CORRECTION", "OUTSIDE_LOCATION"];
/** The two that are about a day already recorded, rather than a request to be away from one. */
const DAY_REQUEST_TYPES = ["CORRECTION", "OUTSIDE_LOCATION"];
const REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"];
/** The statuses that still hold a claim on the calendar, and so can collide with a new request. */
const BLOCKING_STATUSES = ["PENDING", "APPROVED"];
const WORK_MODES = ["office", "work-from-home", "client-site"];

/**
 * The calendar day `value` names, as midnight **UTC** on that day.
 *
 * A calendar day is not an instant, and the representation has to be the one the database round
 * trips. Every date column in this module is `@db.Date`, and Prisma writes such a column from the
 * Date's UTC fields and reads it back as midnight UTC. Anchoring a day to local midnight instead
 * meant that in any zone ahead of UTC the instant handed to Prisma fell on the previous UTC day, so
 * a leave applied for on the 10th was stored - and shown back - as the 9th. Every date in the
 * module was a day early in Asia/Kolkata, and a day late for anywhere behind UTC.
 *
 * The three kinds of value this is asked about are each read as the day a person would call it:
 *
 * - `"YYYY-MM-DD"`, which is what a browser sends: the day is written down, so it is taken
 *   literally rather than parsed into an instant and read back out of one.
 * - a value from a `@db.Date` column, which is already midnight UTC: it is that day as it stands.
 * - an instant such as `new Date()`: the day it reads as on the studio's wall clock.
 */
function calendarDay(value) {
  if (value === null || value === undefined || value === "") return null;

  const written = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof value === "string" ? value.trim() : "");
  if (written) return new Date(Date.UTC(Number(written[1]), Number(written[2]) - 1, Number(written[3])));

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  // Already anchored to a day rather than to a moment within one - which is every `@db.Date` value
  // and nothing else this module handles - so it is that day, in whatever zone the server runs.
  if (date.getTime() % MS_PER_DAY === 0) return new Date(date.getTime());

  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

/**
 * `YYYY-MM-DD` for the day `value` names. `toISOString()` alone is not this - it would be right
 * only because the day is anchored in UTC, and would go on reading as right if that ever changed.
 */
function localIsoDate(value) {
  const date = calendarDay(value);
  if (!date) return "";
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

/**
 * "HH:MM" as minutes since midnight, or null if it is not a time. Null rather than 0 because 0 is
 * itself a valid time (midnight), and a caller that cannot tell them apart writes the bug this
 * module exists to remove.
 */
function parseClockTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function formatClockTime(minutes) {
  if (!Number.isFinite(minutes)) return "";
  const normalised = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(normalised / 60)).padStart(2, "0")}:${String(normalised % 60).padStart(2, "0")}`;
}

/** Minutes since local midnight of the day the instant falls in. */
function minutesOfDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * The weekdays nobody is expected in, as a Set of `Date.getDay()` numbers. Stored as a comma list
 * because it is read whole and never queried by day; anything unparseable is dropped rather than
 * throwing, so one bad character in a settings row cannot take the attendance screen down.
 */
function weeklyOffDaySet(settings) {
  const days = String(settings?.weeklyOffDays ?? "")
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  return new Set(days);
}

/**
 * Every date from `start` to `end` inclusive, as local `YYYY-MM-DD` strings.
 *
 * Stepped by constructing each day from the previous one's calendar fields rather than by adding
 * 86_400_000 milliseconds, which drifts by an hour across a daylight-saving boundary and can repeat
 * or skip a day. India has no DST today, but a date walk that only works in one timezone is a trap
 * left for whoever opens a second studio.
 */
function eachDateInRange(start, end) {
  const first = calendarDay(start);
  const last = calendarDay(end);
  if (!first || !last || last < first) return [];
  const dates = [];
  for (let cursor = first; cursor <= last; cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() + 1))) {
    dates.push(localIsoDate(cursor));
  }
  return dates;
}

/**
 * What kind of day this is for this person.
 *
 * A holiday beats a weekly off beats approved leave beats a working day: they are checked in that
 * order because the answer is used to decide whether an absence needs explaining, and the studio
 * being shut explains it more completely than the person having asked to be away. `leaveDates` is
 * the set of dates covered by that employee's APPROVED leave, built once per range by the caller.
 */
function dayKindFor(date, { settings, holidayDates, leaveDates } = {}) {
  const iso = localIsoDate(date);
  if (!iso) return DAY_KINDS.WORKING;
  if (holidayDates?.has?.(iso)) return DAY_KINDS.HOLIDAY;
  const day = calendarDay(date).getUTCDay();
  if (weeklyOffDaySet(settings).has(day)) return DAY_KINDS.WEEKLY_OFF;
  if (leaveDates?.has?.(iso)) return DAY_KINDS.ON_LEAVE;
  return DAY_KINDS.WORKING;
}

/**
 * The days in the range somebody was actually expected to work. Approved leave is *not* removed:
 * leave is time off against a day that was owed, so the target still counts it — otherwise taking
 * leave would quietly lower the hours the month asks for and no shortfall would ever show.
 */
function workingDaysInRange(start, end, { settings, holidayDates } = {}) {
  return eachDateInRange(start, end)
    .filter((iso) => dayKindFor(iso, { settings, holidayDates }) === DAY_KINDS.WORKING)
    .length;
}

/**
 * The hours a range owes, in minutes: a full day's target for every working day in it. This is what
 * replaces the fixed 42h30 week and 170h month — a short month, a festival week and a new joiner's
 * first part-week now each ask for what they actually contain.
 */
function targetMinutesForRange(start, end, { settings, holidayDates } = {}) {
  const perDay = Number(settings?.dailyTargetMinutes);
  if (!Number.isFinite(perDay) || perDay <= 0) return 0;
  return workingDaysInRange(start, end, { settings, holidayDates }) * perDay;
}

/** The latest a login still counts as on time, in minutes since midnight. */
function onTimeCutoffMinutes(settings) {
  const shiftStart = parseClockTime(settings?.shiftStart);
  if (shiftStart === null) return null;
  const grace = Number(settings?.lateGraceMinutes);
  return shiftStart + (Number.isFinite(grace) && grace >= 0 ? grace : 0);
}

/**
 * Whether an approved permission excuses arriving at `loginMinutes`.
 *
 * A permission excuses lateness only if it covers the gap it is meant to explain: it has to start
 * at or before the shift does and still be running when the person arrives. A permission taken at
 * four in the afternoon says nothing about a ten o'clock arrival, and the old screen — which had no
 * concept of an approved permission at all — marked both alike.
 */
function permissionCoversArrival(permissions, loginMinutes, settings) {
  const shiftStart = parseClockTime(settings?.shiftStart);
  if (shiftStart === null || !Number.isFinite(loginMinutes)) return false;
  return (permissions || []).some((permission) => {
    const from = parseClockTime(permission.fromTime);
    const to = parseClockTime(permission.toTime);
    if (from === null || to === null) return false;
    return from <= shiftStart && to >= loginMinutes;
  });
}

/**
 * Whether an approved permission excuses leaving at `logoutMinutes`.
 *
 * The mirror of `permissionCoversArrival`, and held to the same standard: the permission has to
 * cover the gap it is meant to explain, which for a departure means starting at or before the
 * person left and running to at least the end of the shift. A permission taken at ten in the
 * morning says nothing about somebody leaving at four.
 */
function permissionCoversDeparture(permissions, logoutMinutes, settings) {
  const shiftEnd = parseClockTime(settings?.shiftEnd);
  if (shiftEnd === null || !Number.isFinite(logoutMinutes)) return false;
  return (permissions || []).some((permission) => {
    const from = parseClockTime(permission.fromTime);
    const to = parseClockTime(permission.toTime);
    if (from === null || to === null) return false;
    return from <= logoutMinutes && to >= shiftEnd;
  });
}

/**
 * The latest somebody may leave before it counts as an early exit, in minutes since midnight, or
 * null when the studio has not configured the rule — in which case the check is off rather than
 * impossible to pass. Its own grace rather than `lateGraceMinutes` reused: arriving late and
 * leaving early are not the same forgiveness.
 */
function earlyExitCutoffMinutes(settings) {
  const shiftEnd = parseClockTime(settings?.shiftEnd);
  if (shiftEnd === null) return null;
  const grace = Number(settings?.earlyExitGraceMinutes);
  if (!Number.isFinite(grace) || grace < 0) return null;
  return shiftEnd - grace;
}

/** Worked minutes, floored at zero. An open session has none yet, which is not the same as zero. */
function workedMinutes(session) {
  if (!session?.loginAt || !session?.logoutAt) return 0;
  const minutes = Math.round((new Date(session.logoutAt).getTime() - new Date(session.loginAt).getTime()) / 60000);
  return Number.isFinite(minutes) ? Math.max(0, minutes) : 0;
}

/**
 * The one status a day is shown as, and the tone it is shown in.
 *
 * A day with no session reads as what the calendar says it was — a holiday, a weekly off, approved
 * leave, or an absence nobody has explained. A day with one reads as how it went, and an open
 * session outranks lateness because the day is not finished being recorded yet.
 */
function attendanceDayStatus(session, { settings, dayKind = DAY_KINDS.WORKING, permissions = [], today = null } = {}) {
  if (!session) {
    if (dayKind === DAY_KINDS.HOLIDAY) return { status: "Holiday", tone: "slate" };
    if (dayKind === DAY_KINDS.WEEKLY_OFF) return { status: "Weekly off", tone: "slate" };
    if (dayKind === DAY_KINDS.ON_LEAVE) return { status: "On leave", tone: "blue" };
    return { status: "Absent", tone: "red" };
  }
  if (!session.logoutAt) {
    // Today's open session is a day still being worked; a past one is a checkout that never
    // happened. The two look identical in the database and mean opposite things, which is why the
    // caller passes the day it is reading against rather than this function asking a clock. No
    // `today` at all keeps the original reading, so a caller that has not been updated is not
    // silently told that every open day is a fault.
    const day = localIsoDate(session.workDate);
    if (today && day && day < localIsoDate(today)) return { status: "Missed checkout", tone: "red" };
    return { status: "Not logged out", tone: "red" };
  }
  /*
   * A closed day, read in the order the readings matter.
   *
   * Half a day beats everything else: somebody who worked two hours was not simply late, and that
   * is the fact payroll and leave will both ask about. Then the arrival, then the departure — a day
   * can be all three at once and the status field can only say one thing, so it says the most
   * consequential.
   *
   * Both new rules are off when the studio has not configured them, rather than defaulting to
   * something: this function is read by a register of days already recorded, and a rule that
   * switched itself on would restate months of history overnight.
   */
  const minutes = workedMinutes(session);
  const { floor, ceiling } = halfDayBand(settings);
  if (floor) {
    /*
     * Too short to credit. The person was here — the check-in, the selfie and the times are all on
     * the record and stay there — but a day under the floor earns nothing, which is what makes the
     * floor mean anything at all. Said as Absent rather than as a tenth status, because that is
     * what it costs the person and what every count downstream already knows how to read.
     */
    if (minutes < floor) return { status: "Absent", tone: "red" };
    if (ceiling && minutes <= ceiling) return { status: "Half day", tone: "amber" };
  }

  const cutoff = onTimeCutoffMinutes(settings);
  const loginMinutes = minutesOfDay(session.loginAt);
  const arrivedLate = cutoff !== null && loginMinutes !== null && loginMinutes > cutoff;
  if (arrivedLate) {
    return permissionCoversArrival(permissions, loginMinutes, settings)
      ? { status: "Permitted", tone: "blue" }
      : { status: "Late", tone: "amber" };
  }

  const leaveBy = earlyExitCutoffMinutes(settings);
  const logoutMinutes = minutesOfDay(session.logoutAt);
  if (leaveBy !== null && logoutMinutes !== null && logoutMinutes < leaveBy) {
    return permissionCoversDeparture(permissions, logoutMinutes, settings)
      ? { status: "Permitted", tone: "blue" }
      : { status: "Early exit", tone: "amber" };
  }

  return { status: "On time", tone: "green" };
}

/**
 * The named state of one day, for a caller that is not a screen.
 *
 * `attendanceDayStatus` above answers "how did this day go" in words a person reads — On time, Late,
 * Half day. This answers "where in the day's flow is this person" in a fixed vocabulary a client can
 * branch on, and the two are deliberately separate: a screen wants the first, an integration wants
 * the second, and one field trying to be both would end up bad at each.
 *
 * `MISSED_CHECKOUT` is only ever a state of a **past** day. Today's open session is somebody still
 * at work, which is `CHECKED_IN`; the same row read tomorrow is a checkout that never happened. So
 * this takes the day it is being read against, exactly as `attendanceDayStatus` does.
 */
const ATTENDANCE_STATES = ["NOT_CHECKED_IN", "CHECKED_IN", "CHECKED_OUT", "MISSED_CHECKOUT", "ON_LEAVE", "HOLIDAY", "WEEKLY_OFF"];

function attendanceState(session, { dayKind = DAY_KINDS.WORKING, today = null } = {}) {
  if (session) {
    if (session.logoutAt) return "CHECKED_OUT";
    const day = localIsoDate(session.workDate);
    if (today && day && day < localIsoDate(today)) return "MISSED_CHECKOUT";
    return "CHECKED_IN";
  }
  if (dayKind === DAY_KINDS.HOLIDAY) return "HOLIDAY";
  if (dayKind === DAY_KINDS.WEEKLY_OFF) return "WEEKLY_OFF";
  if (dayKind === DAY_KINDS.ON_LEAVE) return "ON_LEAVE";
  // Not "ABSENT": a working day nobody has marked *yet* is not an absence until it is over, and this
  // is read at nine in the morning as often as at six in the evening.
  return "NOT_CHECKED_IN";
}

/**
 * The half-day band, read off the settings: at least `floor` minutes and no more than `ceiling`.
 *
 * A band rather than a single threshold. "Under four hours is a half day" credits twenty minutes
 * with half a day and makes four hours exactly a *full* one — the boundary landing on the wrong
 * side of the one number anybody would name.
 *
 * A floor of zero switches both rules off, which is how a studio that has not decided keeps the
 * behaviour it had. A ceiling below the floor is not a band, so it is read as no band: the floor
 * still applies and everything above it is a full day.
 */
function halfDayBand(settings) {
  const floor = Number(settings?.halfDayMinMinutes);
  const ceiling = Number(settings?.halfDayMaxMinutes);
  if (!Number.isFinite(floor) || floor <= 0) return { floor: 0, ceiling: 0 };
  return { floor, ceiling: Number.isFinite(ceiling) && ceiling >= floor ? ceiling : 0 };
}

/**
 * Whether a day's status counts as having been at work.
 *
 * The one place that decides it, because three different counts used to answer it three different
 * ways — and once a day can be both "has a session" and "reads as Absent", a count of days with a
 * login stops being a count of days attended.
 */
function isAttendedStatus(status) {
  return ["On time", "Late", "Permitted", "Half day", "Early exit", "Not logged out", "Missed checkout"].includes(status);
}

/**
 * Where a day was worked, as a label.
 *
 * Deliberately *not* folded into the status. "Work from home" and "Field work" answer where somebody
 * was, and the status answers how the day went; collapsing them would mean a day marked as work
 * from home could no longer say whether it was late, short or a full day — the two facts would
 * compete for one field and the more useful one would lose. They are shown side by side instead.
 */
function workModeLabel(workMode) {
  return { "office": "Office", "work-from-home": "Work from home", "client-site": "Field work" }[workMode] || null;
}

/**
 * How many days a leave spans, inclusive — or null when the dates do not describe a span at all.
 *
 * The browser version clamped this to a minimum of 1, so a leave whose To date fell before its From
 * date was silently recorded as one day. Null is the honest answer, and `leaveDatesProblem` below
 * is what stops such a request being raised in the first place.
 */
function leaveDayCount(fromDate, toDate) {
  const start = calendarDay(fromDate);
  const end = calendarDay(toDate);
  if (!start || !end || end < start) return null;
  return Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
}

/** How long a permission runs, in minutes — or null when the times do not describe a span. */
function permissionMinutes(fromTime, toTime) {
  const from = parseClockTime(fromTime);
  const to = parseClockTime(toTime);
  if (from === null || to === null || to <= from) return null;
  return to - from;
}

const MAX_LEAVE_DAYS = 90;

/** Why these leave dates cannot be raised, or null if they can. */
function leaveDatesProblem(fromDate, toDate) {
  const start = calendarDay(fromDate);
  const end = calendarDay(toDate);
  if (!start) return "Enter a valid From date.";
  if (!end) return "Enter a valid To date.";
  if (end < start) return "The To date cannot be earlier than the From date.";
  const days = leaveDayCount(start, end);
  if (days > MAX_LEAVE_DAYS) return `A single leave request cannot cover more than ${MAX_LEAVE_DAYS} days. Raise it in shorter periods.`;
  return null;
}

/** Why these permission times cannot be raised, or null if they can. */
function permissionTimesProblem(fromTime, toTime, settings) {
  const from = parseClockTime(fromTime);
  const to = parseClockTime(toTime);
  if (from === null) return "Enter a valid From time.";
  if (to === null) return "Enter a valid To time.";
  if (to <= from) return "The To time must be later than the From time.";
  const limit = Number(settings?.maxPermissionMinutes);
  if (Number.isFinite(limit) && limit > 0 && to - from > limit) {
    return `A permission cannot be longer than ${formatDurationMinutes(limit)}. Apply for leave instead.`;
  }
  return null;
}

function formatDurationMinutes(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0m";
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (!hours) return `${rest}m`;
  if (!rest) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/**
 * How a request reads today, given what a person decided about it.
 *
 * "Upcoming" is a reading of an approved request, not a fourth decision — an approved leave starting
 * on Monday is the same row on Sunday as it is on Tuesday, and storing the difference would mean a
 * status that silently goes stale in the database. The screen's tabs ask for it, so it is derived
 * here, once, against a clock the caller passes in.
 */
function requestDisplayStatus(request, now = new Date()) {
  if (request?.status !== "APPROVED") {
    return { PENDING: "Pending", REJECTED: "Rejected", CANCELLED: "Cancelled" }[request?.status] || "Pending";
  }
  const start = calendarDay(request.fromDate);
  const today = calendarDay(now);
  return start && today && start > today ? "Upcoming" : "Approved";
}

module.exports = {
  ATTENDANCE_STATES,
  BLOCKING_STATUSES,
  DAY_KINDS,
  DAY_REQUEST_TYPES,
  MAX_LEAVE_DAYS,
  REQUEST_STATUSES,
  REQUEST_TYPES,
  WORK_MODES,
  attendanceDayStatus,
  attendanceState,
  dayKindFor,
  eachDateInRange,
  formatClockTime,
  formatDurationMinutes,
  leaveDatesProblem,
  leaveDayCount,
  localIsoDate,
  minutesOfDay,
  earlyExitCutoffMinutes,
  halfDayBand,
  isAttendedStatus,
  onTimeCutoffMinutes,
  parseClockTime,
  permissionCoversArrival,
  permissionCoversDeparture,
  workModeLabel,
  permissionMinutes,
  permissionTimesProblem,
  requestDisplayStatus,
  calendarDay,
  targetMinutesForRange,
  weeklyOffDaySet,
  workedMinutes,
  workingDaysInRange,
};
