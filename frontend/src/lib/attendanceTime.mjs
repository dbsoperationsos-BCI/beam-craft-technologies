/**
 * The pay cycle, as the Self Dashboard counts by it.
 *
 * Payroll counts from the cycle day to the day before the next one - the 25th to the 24th by
 * default (`hrm_settings.pay_cycle_day`) - so a dashboard counting the calendar month answered a
 * different question from the payslip beside it: the same working days, absences and hours over two
 * windows that never agree.
 *
 * The rule is the server's `attendancePeriods` in
 * `backend/src/modules/hrm/attendance/service.js`, kept here because the range is worked out in the
 * browser; a cycle day past a short month's end means that month's last day in both, which is what
 * stops the two disagreeing about where a cycle begins.
 */
export const DEFAULT_PAY_CYCLE_DAY = 25;

/** The name the dashboard's toggle and its range label use. */
export const PAY_CYCLE_OPTION = "Pay cycle";

/** The cycle day the studio set, or the default where the value is missing or not a day. */
const cycleDayOf = (value) => {
  const day = Number(value);
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : DEFAULT_PAY_CYCLE_DAY;
};

/** `day` of `year`-`month`, or the month's last day where it has no such date. */
const dayIn = (year, month, day) => new Date(year, month, Math.min(day, new Date(year, month + 1, 0).getDate()));

/**
 * The pay cycle holding `today`: `{ start, end }`, the whole of the opening day to the whole of the
 * closing one. The cycle day itself opens a cycle rather than closing the one before it.
 */
export function payCycleRange(cycleDay, today = new Date()) {
  const day = cycleDayOf(cycleDay);
  const now = new Date(today);
  const thisMonth = dayIn(now.getFullYear(), now.getMonth(), day);
  const start = now < thisMonth ? dayIn(now.getFullYear(), now.getMonth() - 1, day) : thisMonth;
  const next = dayIn(start.getFullYear(), start.getMonth() + 1, day);
  const end = new Date(next.getFullYear(), next.getMonth(), next.getDate() - 1, 23, 59, 59, 999);
  return { start: new Date(start.getFullYear(), start.getMonth(), start.getDate()), end };
}

/**
 * How long a login stays a login: 18 hours from the latest login of the day, after which an owed day
 * reads Absent until an approved Attendance Regularization says what it was.
 *
 * The rule itself is the server's (`SESSION_VALID_HOURS` in
 * `backend/src/modules/hrm/attendance/attendanceRules.js`) and this is the browser's copy of the
 * number, for the sentences a screen has to write. The two are held together by
 * `backend/test/attendance-session-hours.test.js`, which fails if they disagree - a notice saying
 * 24 while the rule says 18 is worse than no notice, because somebody plans their evening around it.
 */
export const SESSION_VALID_HOURS = 18;

/**
 * The two time helpers Employee Attendance and the Schedule both need.
 *
 * In `lib` rather than on either screen because the request dialog moved out to be shared, and a
 * formatter living on one of its callers would have meant the other importing a helper out of a
 * page. Pure, so both `.js` screens and the `.mjs` tests can read them.
 */

/** Minutes as `7h 30m`. Anything that is not a number reads as `0h 0m` rather than as NaN. */
export function formatTotalMinutes(minutes) {
  const safe = Number.isFinite(minutes) ? minutes : 0;
  return `${Math.floor(safe / 60)}h ${safe % 60}m`;
}

/** `"09:30"` as minutes since midnight, for measuring a permission against its limit. */
export function clockMinutes(value) {
  const [hours, minutes] = String(value || "0:0").split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * Minutes since midnight as a clock time, `9:32 AM` - `clockMinutes` the other way round. For a time
 * that is not one instant but an average of several, which is why it takes minutes and not a
 * `Date`. Anything that is not a number reads as a dash rather than as midnight.
 */
export function clockLabel(minutes) {
  if (!Number.isFinite(minutes)) return "—";
  const whole = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(whole / 60);
  const period = hours < 12 ? "AM" : "PM";
  return `${hours % 12 || 12}:${String(whole % 60).padStart(2, "0")} ${period}`;
}

/** A `Date` as `YYYY-MM-DD` in the reader's own zone, never through UTC. */
export function isoDate(date) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

const DAY_FORMAT = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** A calendar day's `YYYY-MM-DD` as "5 Oct 2026", read as the day itself - no zone shifts it. */
export function dayLabel(iso) {
  return iso ? DAY_FORMAT.format(new Date(`${iso}T00:00:00Z`)) : "";
}

/**
 * The **last** of the days a comp-off claim is paid for by, `YYYY-MM-DD` or "". A day off has to fall
 * after every day it was earned by, so it is this - not the first - that the day off is measured
 * from. The expiry is measured from the first, which is the credit that runs out soonest.
 */
export function lastWorkedDay({ workedDate = "", workedPairDate = "" } = {}) {
  return [workedDate, workedPairDate].filter(Boolean).sort().at(-1) || "";
}

/**
 * The worked day or days one comp-off day off is paid for by, as a sentence: "1 Nov 2026", or
 * "1 Nov 2026 and 2 Nov 2026" where two half days buy it between them.
 *
 * One phrase in one place because three screens say it - the balance tile, the picker and the
 * request's own details - and a day off that cost two days must never read on any of them as though
 * it cost one.
 */
export function workedDaysLabel(dates) {
  const days = (Array.isArray(dates) ? dates : [dates]).filter(Boolean).map(dayLabel);
  if (!days.length) return "";
  return days.length === 1 ? days[0] : `${days.slice(0, -1).join(", ")} and ${days.at(-1)}`;
}
