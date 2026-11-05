/**
 * When an employee's next salary review falls due.
 *
 * One rule, applied in three places so they cannot disagree: a review is six months after the thing
 * that starts the clock. At onboarding that is the joining date; afterwards it is the last review
 * that happened. The date is always a suggestion — every field it fills in stays editable, and an
 * edited one is never overwritten.
 *
 * Dates here are the `YYYY-MM-DD` strings the form and the date inputs hold, not `Date` objects.
 * Parsing them as local calendar parts rather than through `new Date(string)` is deliberate: that
 * constructor reads a bare `YYYY-MM-DD` as UTC midnight, so east of Greenwich every date it hands
 * back is the previous day, and a review scheduled for the 1st reads as the 31st.
 */

/** How long a review cycle is. Six months, stated once. */
export const REVIEW_INTERVAL_MONTHS = 6;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` to `{ year, month, day }`, or null for anything that is not one. */
function parts(value) {
  const match = ISO_DATE.exec(String(value ?? "").trim());
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Rejects the 31st of a 30-day month and the 30th of February, which the regex cannot.
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return { year, month, day };
}

const iso = (year, month, day) => `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

/**
 * A date `months` later, with the day clamped to the target month's length.
 *
 * The clamp is what stops 31 August + 6 becoming 3 March: there is no 31st of February, and rolling
 * into the next month would put a review a few days after the month it belongs to. The last day of
 * the month is the honest answer to "six months after the 31st".
 */
export function addMonths(value, months) {
  const start = parts(value);
  if (!start) return "";
  const zeroBased = start.year * 12 + (start.month - 1) + months;
  const year = Math.floor(zeroBased / 12);
  const month = (zeroBased % 12) + 1;
  const daysInMonth = new Date(year, month, 0).getDate();
  return iso(year, month, Math.min(start.day, daysInMonth));
}

/** Six months after whatever starts the clock — a joining date, or a review that just happened. */
export function defaultNextReviewDate(from) {
  return addMonths(from, REVIEW_INTERVAL_MONTHS);
}

/**
 * The next review date after the date it is counted from has changed.
 *
 * The point of this function is knowing when *not* to write. A date the user has typed themselves is
 * theirs to keep, so it is only replaced while it still reads as the one this rule last produced —
 * empty, or exactly six months after the previous source. Anything else has been decided by a person
 * and is left alone.
 *
 * That is what makes the two directions safe to wire up at once: moving the joining date moves a
 * review nobody has touched, and moving it again after HR has picked their own date changes nothing.
 */
export function syncedNextReviewDate({ previousSource, nextSource, currentNext } = {}) {
  const current = String(currentNext ?? "").trim();
  const wasDerived = current === "" || current === defaultNextReviewDate(previousSource);
  return wasDerived ? defaultNextReviewDate(nextSource) : current;
}

/** Today as `YYYY-MM-DD` in the reader's own timezone, which is the calendar a review is read against. */
export function today(now = new Date()) {
  return iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/**
 * The review that has not happened yet, as one entry rather than a list.
 *
 * There is never more than one, and it is never a review row: a row records an appraisal that has
 * been held, with the increment it awarded, and the dialog that creates one refuses a future date.
 * What is outstanding is a *date* — the latest review's Next Review Date, or six months from joining
 * for somebody who has not had one yet — which is exactly what the employee's `nextReviewDate`
 * holds.
 *
 * Splitting the review rows by date instead, which is what this used to do, put everything under
 * Past and left Upcoming permanently empty. The two tabs are not two halves of one list; they are a
 * schedule and a history.
 *
 * `overdue` is the due date having gone by, which is the one thing about it worth colouring.
 */
export function scheduledReview(nextReviewDate, now = today()) {
  const dueOn = String(nextReviewDate ?? "").slice(0, 10);
  if (!dueOn || !parts(dueOn)) return null;
  return { dueOn, overdue: dueOn < now };
}

/** The reviews already held, newest first — the one being looked for is usually the last one. */
export function heldReviews(reviews) {
  const rows = Array.isArray(reviews) ? reviews : [];
  return [...rows].sort((first, second) => String(second?.reviewDate ?? "").localeCompare(String(first?.reviewDate ?? "")));
}
