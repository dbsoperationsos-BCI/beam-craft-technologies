const { studioCalendarDay, studioInstant, studioMinutesOfDay } = require("../../../services/studioTime");

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
 * `approvedTimeOff` counts only LEAVE, COMP_OFF and PERMISSION, so neither of these two can be mistaken for
 * time away from work.
 */
/*
 * `COMP_OFF` is a day off given back for a holiday or weekly off that was worked: the worked day is
 * `workedDate`, the day taken is `fromDate` = `toDate`. `approvedTimeOff` reads an approved one as
 * leave on the day taken.
 */
/*
 * `INCORRECT_LOGIN` is the **Correction** request (shown under that name; the stored value is kept so
 * no request or API changes meaning): it asks for one day's attendance status - Present, Late, an
 * Incorrect login, an absence, ... - to read as another (`requestedStatus`). It replaced `CORRECTION`,
 * which proposed a checkout time for a day never logged out of; old ones still read and decide.
 */
/*
 * `EXTRA_TIME` is the logout somebody pressed **after** their login's 18 hours. The logout is taken
 * - the day is theirs and refusing it only lost the time - but it is not written onto the session:
 * the day goes on reading Absent (an expired login) until this request is approved, and the approval
 * writes the logout they captured onto it (`applyCorrection`), which makes the day Present.
 *
 * Raised by the logout itself rather than from the Raise Request form, so it is a system type;
 * `toTime` is the clock time they pressed it and `reason` the description they were asked for.
 */
const REQUEST_TYPES = ["LEAVE", "PERMISSION", "ON_DUTY", "CORRECTION", "OUTSIDE_LOCATION", "COMP_OFF", "INCORRECT_LOGIN", "COMP_OFF_CREDIT", "EXTRA_TIME"];
/**
 * The kinds attendance raises by itself and nobody may raise, edit, revert, delete or send back: a
 * COMP_OFF_CREDIT is a weekly off or holiday worked, put to the Leave Approvers (`compOffCredits.js`).
 */
const SYSTEM_REQUEST_TYPES = ["COMP_OFF_CREDIT", "EXTRA_TIME"];
/** What a person may raise - every kind but the ones attendance raises. */
const RAISABLE_REQUEST_TYPES = REQUEST_TYPES.filter((type) => !SYSTEM_REQUEST_TYPES.includes(type));
/**
 * What a leave is, chosen when it is raised: CL (Casual Leave) takes from the Casual Leave balance, a
 * day beyond it Loss of Pay; LOP (Loss of Pay) is unpaid every day and never touches the balance. A
 * leave with none - raised before the choice existed, or by a caller that does not say - is CL.
 */
const LEAVE_TYPES = ["CL", "LOP"];
/** The `where` for leave that takes from the Casual Leave balance: CL, or none said (read as CL). */
const CASUAL_LEAVE_ONLY = { OR: [{ leaveType: null }, { leaveType: { not: "LOP" } }] };
/** The ones that are about a day already recorded, rather than a request to be away from one. */
const DAY_REQUEST_TYPES = ["CORRECTION", "OUTSIDE_LOCATION", "INCORRECT_LOGIN", "EXTRA_TIME"];
/*
 * What a request can be, in the order it travels.
 *
 * `SENT_BACK` is an approver's third answer - back to the raiser to be fixed - and `REVERTED` and
 * `DELETED` are the raiser's own: one pulls the request out of the queues, the other marks it
 * deleted while deleting nothing, so they go on seeing what they did.
 *
 * `CANCELLED` is **deliberately not here** and is never migrated. Requests cancelled under the old
 * flow keep that status and keep reading as "Cancelled": it is what happened to them. Nothing sets
 * it any more, which is why it is not something a new request may be asked for.
 */
const REQUEST_STATUSES = ["PENDING", "SENT_BACK", "APPROVED", "REJECTED", "REVERTED", "DELETED"];
/** The statuses that still hold a claim on the calendar, and so can collide with a new request. */
const BLOCKING_STATUSES = ["PENDING", "APPROVED"];
const WORK_MODES = ["office", "work-from-home", "client-site", "flexible"];
/**
 * Flexible Shift: a login at any hour, for an employee HR has allowed it (`allowFlexibleShift`). The
 * day is judged on its hours from login to logout - the Half day / Full day band - and never on the
 * shift's start or end, so it is never Late or Early exit; a full day reads Present.
 */
const FLEXIBLE_WORK_MODE = "flexible";

/**
 * How long a login stays a login. An open session is somebody at work for 18 hours from their latest
 * login - a login at 9:30 can be logged out of until 3:29 the next morning - and from then on it is
 * an expired login: a logout that never happened - an Absent day on an owed day
 * (`expiredLoginStatus`) until a Correction says otherwise. Exact instants, not calendar days, so a
 * login at 21:30 is still open at 02:00 and a login at 9:30 does not expire at midnight.
 *
 * It was 24, which let a day that ended at six in the evening stay "at work" until nine the next
 * morning - through the night and into the following shift. Eighteen covers the longest shoot day
 * and closes before the next morning's login.
 */
const SESSION_VALID_HOURS = 18;
/**
 * What a Correction may ask a day to read as, and the tone each is shown in. Only the finished
 * readings of a day - never "Not logged out", which is a day still in progress. "Present" is the
 * plain attended day.
 */
const CORRECTABLE_STATUSES = ["Present", "Absent", "Half day", "Early exit", "Late", "On leave"];
const CORRECTED_TONES = { Present: "green", Absent: "red", "Half day": "amber", "Early exit": "amber", Late: "amber", "On leave": "blue" };
/**
 * A day's status as a Correction reads it: the day's own reading, named the way the request names
 * it. An on-time day, one corrected to Present and one whose lateness a permission covered are all
 * Present; a login nobody logged out of reads Absent, and is corrected from Absent.
 *
 * ── Why a holiday and a weekly off are here ──
 *
 * Because a studio shoots on them. Somebody who worked a Sunday or a festival day and marked
 * nothing had no way to say so: the day read "Weekly off", this map answered null, and the
 * regularization form refused with "there is no attendance to correct" - which is true of the
 * *record* and false of the day. They are their own current status now, so the day can be
 * regularized to Present, Half day or whatever it actually was, and the approver sees exactly what
 * is being claimed: a day the calendar says was off, asked to read as worked.
 *
 * They remain absent from `CORRECTABLE_STATUSES`, so no day can be regularized *into* a holiday or
 * a weekly off: which days are off is the calendar's to say (Settings → Holidays, the attendance
 * rules' week-offs), not one employee's request.
 *
 * Still null for a day there is nothing to correct at all - one still being worked, and one
 * attendance is not owed for.
 */
const CORRECTION_CURRENT_LABELS = {
  "On time": "Present", Present: "Present", Permitted: "Present", Late: "Late", "Half day": "Half day",
  "Early exit": "Early exit", Absent: "Absent", "On leave": "On leave",
  Holiday: "Holiday", "Weekly off": "Weekly off",
};
function correctionStatusOf(status) {
  return CORRECTION_CURRENT_LABELS[status] || null;
}

/** When an open session stops being a login: 18 hours after its latest login. Null with no login. */
function sessionExpiresAt(session) {
  const from = session?.lastLoginAt || session?.loginAt;
  if (!from) return null;
  const at = new Date(from).getTime();
  return Number.isFinite(at) ? new Date(at + SESSION_VALID_HOURS * 3600000) : null;
}

/** Whether `session` is a login nobody logged out of within its 18 hours, as of `now`. */
function sessionExpired(session, now = new Date()) {
  if (!session || session.logoutAt || !now) return false;
  const expiresAt = sessionExpiresAt(session);
  return Boolean(expiresAt) && new Date(now).getTime() >= expiresAt.getTime();
}

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
 * - an instant such as `new Date()`: the day it reads as on the studio's wall clock - in India,
 *   whatever zone the server runs in (`studioCalendarDay`). Read off the server's own clock, "today"
 *   turned over at 5:30 am on a server left on UTC.
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

  return studioCalendarDay(date);
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

/**
 * The instant `minutes` past midnight on `day`, on the studio's wall clock - "18:00 on the 26th" as
 * the moment somebody standing in the studio would call that.
 *
 * The day is anchored to midnight UTC (see `calendarDay`), so adding the minutes to it straight
 * read the time as UTC: a correction to 18:00 in Asia/Kolkata was stored as 23:30, and "09:00" for
 * a 09:30 login passed the "after the login" check as 14:30. Built from the day's own date on the
 * studio's clock (`studioInstant`) - the same clock `minutesOfDay` reads a login back with. It was
 * the server's own clock, which is the studio's only on a machine set to India: on a server left on
 * UTC, 18:00 typed by HR was stored as 18:00 UTC, which is 23:30 in the studio.
 */
function wallClockInstant(day, minutes) {
  const date = calendarDay(day);
  if (!date || !Number.isFinite(minutes)) return null;
  return studioInstant(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), minutes);
}

/**
 * Minutes since the studio's midnight of the day the instant falls in - 9:38 am in India is 578,
 * whatever zone the server runs in. Late, Early Exit, the Check In and Check Out every screen shows
 * and "is it inside a permission now" all read a time this way. `getHours()` read the server's own
 * clock instead, so a server on UTC showed a 9:38 login as 4:08 and judged nobody late.
 */
function minutesOfDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return studioMinutesOfDay(date);
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

/**
 * A day's breaks, summed: each with its length in minutes, the running one (if any) measured up to
 * `now`, and the day's count and total. Recorded and reported only - `workedMinutes` below does not
 * take breaks off, so no status already decided changes because a break was logged.
 */
function summariseBreaks(rows, now = new Date(), { closedAt = null } = {}) {
  /*
   * `closedAt` is where a day that stopped being a login - an Incorrect login, past its 18 hours -
   * stopped. A break still open on it is measured up to there and is not running: nobody pressed
   * Break Off, and the row says so by staying open, but the break did not go on for days.
   */
  const breaks = [...(rows || [])]
    .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt))
    .map((row) => {
      const end = row.endedAt ? new Date(row.endedAt) : new Date(closedAt || now);
      const minutes = Math.max(0, Math.round((end - new Date(row.startedAt)) / 60000));
      return { id: row.id, startedAt: row.startedAt, endedAt: row.endedAt || null, minutes, running: !row.endedAt && !closedAt };
    });
  const current = breaks.find((entry) => entry.running) || null;
  const totalMinutes = breaks.reduce((sum, entry) => sum + entry.minutes, 0);
  return {
    onBreak: Boolean(current),
    current,
    breaks,
    count: breaks.length,
    totalMinutes,
    totalLabel: formatDurationMinutes(totalMinutes),
  };
}

/**
 * Worked minutes, floored at zero. An open session has none yet, which is not the same as zero.
 *
 * First login to latest logout, less the time spent logged out in between (`awayMinutes`) - a day
 * logged out and in again is not paid for the hour away.
 */
function workedMinutes(session) {
  if (!session?.loginAt || !session?.logoutAt) return 0;
  const span = Math.round((new Date(session.logoutAt).getTime() - new Date(session.loginAt).getTime()) / 60000);
  const minutes = span - (Number(session.awayMinutes) || 0);
  return Number.isFinite(minutes) ? Math.max(0, minutes) : 0;
}

/**
 * The one status a day is shown as, and the tone it is shown in.
 *
 * A day with no session reads as what the calendar says it was — a holiday, a weekly off, approved
 * leave, or an absence nobody has explained. A day with one reads as how it went, and an open
 * session outranks lateness because the day is not finished being recorded yet.
 */
function attendanceDayStatus(session, { settings, dayKind = DAY_KINDS.WORKING, permissions = [], today = null, now = null, optional = false, flexible = false, override = null, date = null } = {}) {
  // An approved Correction has said what this day is (`attendance_status_override`), and that
  // outranks the times and the calendar - with or without a login behind it.
  if (override) return { status: override, tone: CORRECTED_TONES[override] || "slate" };
  const verdict = judgedDayStatus(session, { settings, dayKind, permissions, today, now, date, flexible });
  /*
   * For somebody attendance is optional for - a Super Admin - checking in and out is not owed, so a
   * day without either is not a fault. A day they did mark is still recorded and read as it went;
   * only the three verdicts that mean "did not check in / out" are withdrawn.
   */
  if (optional && OPTIONAL_EXCUSED_STATUSES.includes(verdict.status)) return { status: NOT_REQUIRED_STATUS, tone: "slate" };
  return verdict;
}

/** What a day reads as for somebody attendance is optional for, where it would otherwise be a fault. */
const NOT_REQUIRED_STATUS = "Not required";
/** Today, before the shift has started: somebody not in yet is not absent yet. */
const YET_TO_LOG_IN_STATUS = "Yet to log in";

const OPTIONAL_EXCUSED_STATUSES = ["Absent", "Not logged out", YET_TO_LOG_IN_STATUS];

/**
 * A login nobody logged out of within its 18 hours. On a day that was owed it is an **Absent** day -
 * nothing shows it was attended - until a Correction says otherwise; the employee is told why on
 * their attendance screen (`openPastDays`) and raises the Correction from there. On a holiday, a
 * weekly off or a day of approved leave nothing was owed, so the day reads as the calendar says.
 */
function expiredLoginStatus(dayKind) {
  if (dayKind === DAY_KINDS.HOLIDAY) return { status: "Holiday", tone: "slate" };
  if (dayKind === DAY_KINDS.WEEKLY_OFF) return { status: "Weekly off", tone: "slate" };
  if (dayKind === DAY_KINDS.ON_LEAVE) return { status: "On leave", tone: "blue" };
  return { status: "Absent", tone: "red" };
}

/**
 * Whether `date` is today and the shift has not started yet, at the instant `now` - read on the
 * studio's clock like every other time here. From the shift start on, somebody still not logged in
 * is Absent; a login after that turns the day On time or Late (after the grace), both present.
 */
function beforeShiftStart(date, now, settings) {
  if (!date || !now) return false;
  const instant = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(instant.getTime()) || localIsoDate(date) !== localIsoDate(instant)) return false;
  const start = parseClockTime(settings?.shiftStart);
  const minutes = minutesOfDay(instant);
  return start !== null && minutes !== null && minutes < start;
}

/**
 * Whether today, with nothing logged yet, is still a day somebody may log in to: before the shift
 * starts for everybody, and the whole of today for somebody allowed a Flexible Shift - they have no
 * shift start to be absent from, so the day is not an absence until it is over.
 */
function notInYet(date, now, settings, flexible = false) {
  if (!flexible) return beforeShiftStart(date, now, settings);
  if (!date || !now) return false;
  const instant = now instanceof Date ? now : new Date(now);
  return !Number.isNaN(instant.getTime()) && localIsoDate(date) === localIsoDate(instant);
}

function judgedDayStatus(session, { settings, dayKind, permissions, today, now, date, flexible = false }) {
  if (!session) {
    if (dayKind === DAY_KINDS.HOLIDAY) return { status: "Holiday", tone: "slate" };
    if (dayKind === DAY_KINDS.WEEKLY_OFF) return { status: "Weekly off", tone: "slate" };
    if (dayKind === DAY_KINDS.ON_LEAVE) return { status: "On leave", tone: "blue" };
    // Today, before the shift starts, nobody is absent yet - only once it has started. All of today
    // for somebody allowed a Flexible Shift, who may start at any hour.
    if (notInYet(date, now || today, settings, flexible)) return { status: YET_TO_LOG_IN_STATUS, tone: "slate" };
    return { status: "Absent", tone: "red" };
  }
  if (!session.logoutAt) {
    /*
     * An open session inside its 18 hours is a day still being worked; past them it is a logout that
     * never happened - Absent on an owed day (`expiredLoginStatus`). The two look identical in the database and mean opposite
     * things, which is why the caller passes the instant it is reading at (`now`, or `today` where
     * that is an instant) rather than this function asking a clock. Neither keeps the original
     * reading, so a caller that has not been updated is not told that every open day is a fault.
     */
    if (sessionExpired(session, now || today)) return expiredLoginStatus(dayKind);
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
  /*
   * A Flexible Shift day has no shift to arrive late to or leave early from: only its hours are
   * judged, by the same band as every other day - under the floor Absent, under the full day a Half
   * day - and a day that reaches the full day is Present.
   */
  if (session.workMode === FLEXIBLE_WORK_MODE) {
    if (floor && minutes < floor) return { status: "Absent", tone: "red" };
    if (floor && ceiling && minutes < ceiling) return { status: "Half day", tone: "amber" };
    return { status: "Present", tone: "green" };
  }
  const loginMinutes = minutesOfDay(session.loginAt);
  const logoutMinutes = minutesOfDay(session.logoutAt);
  const cutoff = onTimeCutoffMinutes(settings);
  const leaveBy = earlyExitCutoffMinutes(settings);
  // A logout after midnight - a login held across it - left later than any cutoff on the login's day,
  // not early on the next one.
  const loggedOutNextDay = localIsoDate(calendarDay(session.logoutAt)) > localIsoDate(session.workDate);
  const arrivedLate = cutoff !== null && loginMinutes !== null && loginMinutes > cutoff;
  const leftEarly = leaveBy !== null && logoutMinutes !== null && !loggedOutNextDay && logoutMinutes < leaveBy;
  const arrivalPermitted = arrivedLate && permissionCoversArrival(permissions, loginMinutes, settings);
  const departurePermitted = leftEarly && permissionCoversDeparture(permissions, logoutMinutes, settings);
  /*
   * An approved permission explains the hours it took, so a short day whose every shortfall it covers
   * - the late arrival, the early departure, or both - is not cut to a Half day or an Absence: it goes
   * on to the ladder below and reads Permitted. Somebody allowed to leave at four is not short. Only
   * every shortfall: a permitted late arrival does not excuse an unpermitted early departure too, and
   * a day short for no reason a permission covers is judged by its hours.
   */
  const permitted = (arrivedLate || leftEarly) && (!arrivedLate || arrivalPermitted) && (!leftEarly || departurePermitted);
  if (floor && !permitted) {
    /*
     * Too short to credit. The person was here — the check-in, the selfie and the times are all on
     * the record and stay there — but a day under the floor earns nothing, which is what makes the
     * floor mean anything at all. Said as Absent rather than as a tenth status, because that is
     * what it costs the person and what every count downstream already knows how to read.
     */
    if (minutes < floor) return { status: "Absent", tone: "red" };
    if (ceiling && minutes < ceiling) return { status: "Half day", tone: "amber" };
  }

  if (arrivedLate) return arrivalPermitted ? { status: "Permitted", tone: "blue" } : { status: "Late", tone: "amber" };
  if (leftEarly) return departurePermitted ? { status: "Permitted", tone: "blue" } : { status: "Early exit", tone: "amber" };

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
 * `INCORRECT_LOGIN` is an open session past its 18 hours: somebody inside them is still at work,
 * which is `CHECKED_IN`, and the same row read a day later is a logout that never happened. So this
 * takes the instant it is being read at, exactly as `attendanceDayStatus` does. `CORRECTED` is a day
 * an approved Correction has since given a status.
 */
const ATTENDANCE_STATES = ["NOT_CHECKED_IN", "CHECKED_IN", "CHECKED_OUT", "INCORRECT_LOGIN", "CORRECTED", "ON_LEAVE", "HOLIDAY", "WEEKLY_OFF"];

function attendanceState(session, { dayKind = DAY_KINDS.WORKING, today = null, now = null, override = null } = {}) {
  if (override) return "CORRECTED";
  if (session) {
    if (session.logoutAt) return "CHECKED_OUT";
    if (sessionExpired(session, now || today)) return "INCORRECT_LOGIN";
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
 * The half-day band, read off the settings: at least `floor` minutes ("Half day from") and less than
 * `ceiling`, the full day ("Full day", `dailyTargetMinutes`). A day that reaches the full day is a
 * full day; under the floor it is too short to credit.
 *
 * A floor of zero switches both rules off, which is how a studio that has not decided keeps the
 * behaviour it had. A full day no longer than the floor leaves no room for a band, so it is read as
 * no band: the floor still applies and everything above it is a full day.
 */
function halfDayBand(settings) {
  const floor = Number(settings?.halfDayMinMinutes);
  const ceiling = Number(settings?.dailyTargetMinutes);
  if (!Number.isFinite(floor) || floor <= 0) return { floor: 0, ceiling: 0 };
  return { floor, ceiling: Number.isFinite(ceiling) && ceiling > floor ? ceiling : 0 };
}

/** `YYYY-MM` of an ISO date, and the month after one. */
const monthOf = (iso) => String(iso).slice(0, 7);
function nextMonth(month) {
  const [year, number] = month.split("-").map(Number);
  return number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, "0")}`;
}
const days2 = (value) => Math.round(value * 100) / 100;

/**
 * An employee's Casual Leave, month by month, worked out from the leave they took - nothing is stored.
 *
 * - **Credited** `casualLeavePerMonth` at the start of every month from `fromIso`'s month - the
 *   later of their joining date and the day attendance starts being counted - so a leave in a month
 *   can use that month's credit.
 * - **Taken** by each leave day in `leaveDates` (approved Leave on a working day - not a holiday, a
 *   weekly off or a comp-off), in date order. A day the balance cannot cover - or covers only part
 *   of, where the credit is half a day - is **Loss of Pay** for what is missing (`lossOfPayByDate`).
 * - **Carried**: into the next month whole when `casualLeaveMonthlyCarry` is on, and into a new year
 *   (1 January) at most `casualLeaveYearCarryMax`. With it off, every month's unused leave lapses at
 *   the month's end - December's too, so nothing reaches a new year.
 *
 * A "month" is a calendar month, or - with `periodOf` - whatever period a day belongs to, named
 * `YYYY-MM`: on the pay cycle, the payroll month whose cycle holds it, so the year turns with
 * January's payroll. `throughMonth` is the last period worked out. Answers `enabled` (false while no
 * days a month are set - every leave paid, as before), the months (`opening`, `credited`, `taken`,
 * `lossOfPay`, `closing`), `lossOfPayByDate`, `coveredByDate` (what the balance paid of each leave day)
 * and `balance`, the last period's closing.
 */
function casualLeaveLedger({ settings, fromIso, leaveDates = [], throughMonth, periodOf = monthOf } = {}) {
  const perMonth = Number(settings?.casualLeavePerMonth) || 0;
  const empty = { enabled: perMonth > 0, months: [], lossOfPayByDate: new Map(), coveredByDate: new Map(), balance: 0 };
  if (perMonth <= 0 || !fromIso || !throughMonth || throughMonth < periodOf(fromIso)) return empty;
  const monthlyCarry = settings.casualLeaveMonthlyCarry !== false;
  const yearCarryMax = Math.max(0, Number(settings.casualLeaveYearCarryMax) || 0);

  const takenIn = new Map();
  for (const iso of [...new Set(leaveDates)].sort()) {
    const period = periodOf(iso);
    if (iso < fromIso || period > throughMonth) continue;
    if (!takenIn.has(period)) takenIn.set(period, []);
    takenIn.get(period).push(iso);
  }

  const months = [];
  const lossOfPayByDate = new Map();
  // What the balance covered of each leave day - paid as Casual Leave.
  const coveredByDate = new Map();
  let carried = 0;
  for (let month = periodOf(fromIso); month <= throughMonth; month = nextMonth(month)) {
    const available = carried + perMonth;
    let taken = 0;
    let lossOfPay = 0;
    for (const iso of takenIn.get(month) || []) {
      const covered = Math.min(1, Math.max(0, available - taken));
      taken = days2(taken + covered);
      if (covered > 0) coveredByDate.set(iso, days2(covered));
      if (covered < 1) {
        lossOfPayByDate.set(iso, days2(1 - covered));
        lossOfPay = days2(lossOfPay + 1 - covered);
      }
    }
    const closing = days2(available - taken);
    months.push({ month, opening: carried, credited: perMonth, taken, lossOfPay, closing });
    const following = nextMonth(month);
    carried = !monthlyCarry ? 0 : following.endsWith("-01") ? Math.min(closing, yearCarryMax) : closing;
  }
  return { enabled: true, months, lossOfPayByDate, coveredByDate, balance: months.at(-1)?.closing ?? 0 };
}

/**
 * Whether a day's status counts as having been at work.
 *
 * The one place that decides it, because three different counts used to answer it three different
 * ways — and once a day can be both "has a session" and "reads as Absent", a count of days with a
 * login stops being a count of days attended.
 */
function isAttendedStatus(status) {
  // "Present" is a day a Correction made a plain attended day - typically a login nobody logged out
  // of, which reads Absent until then: nobody logged out, so nothing says the day was worked.
  return ["On time", "Present", "Late", "Permitted", "Half day", "Early exit", "Not logged out"].includes(status);
}

/**
 * How much of a day a status adds to the Present and the Absent counts.
 *
 * A Half day is half of each - 0.5 present and 0.5 absent - so a month of twenty owed days with two
 * half days in it reads 19 present and 1 absent, not 20 and 0. Every other attended day is a whole
 * day present, and an Absent a whole day absent. The day itself still reads "Half day" wherever a
 * day is shown (the calendar, the register, the day rows); only the counts split it.
 */
function dayShares(status) {
  if (status === "Half day") return { present: 0.5, absent: 0.5 };
  if (isAttendedStatus(status)) return { present: 1, absent: 0 };
  if (status === "Absent") return { present: 0, absent: 1 };
  return { present: 0, absent: 0 };
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
  return { "office": "Office", "work-from-home": "Work from home", "client-site": "Field work", [FLEXIBLE_WORK_MODE]: "Flexible Shift" }[workMode] || null;
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

/**
 * Whether working `date` can earn a comp-off: a weekly off (Attendance Rules → Weekly off) or a holiday
 * declared in Settings → Holidays - a day nobody was owed. Whether it did is the hours'
 * (`fullDayWorked`).
 */
function earnsCompOff(date, holidayDates, settings) {
  const day = calendarDay(date);
  if (!day) return false;
  const kind = dayKindFor(localIsoDate(day), { settings, holidayDates });
  return kind === DAY_KINDS.WEEKLY_OFF || kind === DAY_KINDS.HOLIDAY;
}

/**
 * Whether a session on a weekly off or holiday was a full day's work - Attendance Rules' **Full day**,
 * from login to logout less the time logged out in between (`workedMinutes`). A login never logged
 * out of is not: its hours are not known. Only a full day earns a comp-off.
 */
function fullDayWorked(session, settings) {
  if (!session?.loginAt || !session?.logoutAt) return false;
  const target = Number(settings?.dailyTargetMinutes);
  return workedMinutes(session) >= (Number.isFinite(target) && target > 0 ? target : 0);
}

/**
 * The last day a comp-off earned on `workedDate` can be taken (`YYYY-MM-DD`): Attendance Rules'
 * `compOffExpiryDays` after the day worked - 30 days from 4 Oct is 3 Nov - or null where it never
 * expires (0, the default).
 */
function compOffExpiresOn(workedDate, settings) {
  const days = Number(settings?.compOffExpiryDays);
  const worked = calendarDay(workedDate);
  if (!worked || !Number.isInteger(days) || days <= 0) return null;
  return localIsoDate(new Date(worked.getTime() + days * MS_PER_DAY));
}

/**
 * Why these comp-off dates cannot be raised, or null if they can - the part of the rule that is
 * about the calendar alone. Each worked day has to be a weekly off or declared holiday that is over;
 * the day off a working day after the last of them, and - where the studio sets an expiry - no later
 * than the **earliest** worked day's (`compOffExpiresOn`), which is the credit that runs out first.
 * Whether attendance shows them there, and whether the days are already claimed or add up to a whole
 * day off, are the controller's to ask of the database.
 *
 * `workedPairDate` is the second half day, where two halves buy the day off between them; the days
 * arrive in either order and need not be next to each other.
 */
function compOffDatesProblem({ workedDate, workedPairDate, fromDate, toDate }, { settings, holidayDates, today = new Date() } = {}) {
  const named = [workedDate, workedPairDate].filter(Boolean).map((value) => calendarDay(value)).filter(Boolean).sort((a, b) => a - b);
  const worked = named[0];
  // The last day worked: a day off has to come after every day it was earned by, and each of them has
  // to be over. The earliest still governs the expiry.
  const lastWorked = named.at(-1);
  const off = calendarDay(fromDate);
  if (!worked) return "Choose the weekly off or holiday you worked.";
  if (!off) return "Choose the day you want off.";
  if (localIsoDate(fromDate) !== localIsoDate(toDate)) return "A comp-off is one day off.";
  // Over, not merely started: a holiday being worked right now can be claimed once it has ended.
  if (lastWorked >= calendarDay(today)) return "The day you worked has to be over before it can be claimed.";
  if (off <= lastWorked) return "The day off has to be after the day you worked.";
  const expiresOn = compOffExpiresOn(worked, settings);
  if (expiresOn && localIsoDate(off) > expiresOn) {
    return `A comp-off for ${localIsoDate(worked)} has to be taken by ${expiresOn} - it expires ${Number(settings.compOffExpiryDays)} days after the day worked.`;
  }
  for (const day of named) {
    if (!earnsCompOff(day, holidayDates, settings)) {
      return `${localIsoDate(day)} was not a weekly off or a declared holiday. A comp-off is earned by working one.`;
    }
  }
  if (dayKindFor(off, { settings, holidayDates }) !== DAY_KINDS.WORKING) {
    return `${localIsoDate(off)} is already a holiday or weekly off. Choose a working day to take off.`;
  }
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
    return {
      PENDING: "Pending",
      SENT_BACK: "Send Back",
      REJECTED: "Rejected",
      REVERTED: "Reverted",
      DELETED: "Deleted",
      // Never migrated - see `REQUEST_STATUSES`.
      CANCELLED: "Cancelled",
    }[request?.status] || "Pending";
  }
  const start = calendarDay(request.fromDate);
  const today = calendarDay(now);
  return start && today && start > today ? "Upcoming" : "Approved";
}

/**
 * The day the studio's attendance starts being counted - "Attendance starts on", Settings → Employee →
 * Attendance Rules - as `YYYY-MM-DD`, or null where it is not set.
 *
 * Before it nothing is owed by anybody: no day reads Absent or Late, no hours are owed, and a login
 * recorded then (a rehearsal before go-live) is not counted. It works as an employee's joining date
 * does, for everybody at once; each person is counted from whichever of the two is later.
 */
function attendanceStartIso(settings) {
  const value = settings?.attendanceStartDate;
  if (!value) return null;
  if (typeof value === "string") return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
  const date = new Date(value);
  // Stored as a calendar date at UTC midnight, so read in UTC - never a day out either side.
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/** The later of two `YYYY-MM-DD` days, either of which may be missing. */
function laterIso(first, second) {
  if (!first) return second || null;
  if (!second) return first;
  return first > second ? first : second;
}

module.exports = {
  YET_TO_LOG_IN_STATUS,
  beforeShiftStart,
  notInYet,
  attendanceStartIso,
  laterIso,
  compOffDatesProblem,
  earnsCompOff,
  fullDayWorked,
  compOffExpiresOn,
  ATTENDANCE_STATES,
  BLOCKING_STATUSES,
  DAY_KINDS,
  DAY_REQUEST_TYPES,
  MAX_LEAVE_DAYS,
  NOT_REQUIRED_STATUS,
  REQUEST_STATUSES,
  REQUEST_TYPES,
  RAISABLE_REQUEST_TYPES,
  SYSTEM_REQUEST_TYPES,
  WORK_MODES,
  FLEXIBLE_WORK_MODE,
  LEAVE_TYPES,
  CASUAL_LEAVE_ONLY,
  casualLeaveLedger,
  SESSION_VALID_HOURS,
  CORRECTABLE_STATUSES,
  correctionStatusOf,
  sessionExpiresAt,
  sessionExpired,
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
  wallClockInstant,
  earlyExitCutoffMinutes,
  halfDayBand,
  isAttendedStatus,
  dayShares,
  onTimeCutoffMinutes,
  parseClockTime,
  permissionCoversArrival,
  permissionCoversDeparture,
  workModeLabel,
  permissionMinutes,
  permissionTimesProblem,
  requestDisplayStatus,
  summariseBreaks,
  calendarDay,
  targetMinutesForRange,
  weeklyOffDaySet,
  workedMinutes,
  workingDaysInRange,
};
