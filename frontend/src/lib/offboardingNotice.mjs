/**
 * The notice period's arithmetic, in one place the browser and the test can both read.
 *
 * The server works the last working day out again and is what stores it
 * (`hrm/offboarding-invites/controller.js` `lastWorkingDateFrom`); this is the same sum, drawn as the
 * employee types so nobody agrees to a date they cannot see. Deliberately a second copy rather than
 * a round trip per keystroke - the quotation generator's preview is the same trade - and the two are
 * held together by `test/offboarding-notice.test.mjs` and the backend's own test.
 */

/** "30 days of notice", and "1 day" where it is one. */
export function noticePeriodLabel(days) {
  const count = Number(days);
  if (!Number.isFinite(count) || count < 0) return "no notice";
  return count === 1 ? "1 day of notice" : `${count} days of notice`;
}

/**
 * The last working day: the notice period counted from the day it starts, as `YYYY-MM-DD`, or "".
 *
 * Calendar days, which is what a notice period means - 30 days from 5 Nov is 4 Dec, and the day
 * after it is their first day gone. The first day of notice is a day served, so `days - 1`: a
 * one-day notice starting today ends today, where counting from the next day would hand everybody an
 * extra day. Worked in UTC on a date-only value, so the answer does not move with a timezone.
 */
export function lastWorkingDayFrom(noticeStartDate, noticePeriodDays) {
  const key = String(noticeStartDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return "";
  // `Number("")` and `Number(null)` are both 0, and 0 is a notice period - so a field nobody has
  // filled in yet would otherwise draw today as the last working day.
  if (noticePeriodDays === "" || noticePeriodDays === null || noticePeriodDays === undefined) return "";
  const days = Number(noticePeriodDays);
  if (!Number.isInteger(days) || days < 0) return "";
  const start = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return "";
  return new Date(start.getTime() + Math.max(0, days - 1) * 86_400_000).toISOString().slice(0, 10);
}

/** A day either side of today in the browser's own calendar, "YYYY-MM-DD" - the resignation date's bounds and default. */
export function dayFromToday(days = 0) {
  const now = new Date();
  now.setDate(now.getDate() + days);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
