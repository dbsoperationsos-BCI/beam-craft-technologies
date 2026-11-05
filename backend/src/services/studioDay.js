const { STUDIO_OFFSET_MS } = require("./dashboardRange");

/**
 * The studio's day, for queries over measured time.
 *
 * Every timestamp the application stores is UTC - Prisma writes `DateTime` that way - and the
 * studio reads its clock in Asia/Kolkata, five and a half hours ahead. So "23 September", bounded
 * as `'2026-09-23 00:00:00'` against a stored column, ran from 05:30 on the 23rd to 05:29 on the
 * 24th in the studio's own day, and `DATE(started_at)` filed anything before 05:30 under the day
 * before. A report that says "23 Sept to 22 Oct" above its table was reading a different range from
 * the one it named, and Inactive Time Track was summing days that began at half past five.
 *
 * One place says what a day is. Asia/Kolkata keeps one offset all year, so a fixed shift is the
 * whole rule - `STUDIO_OFFSET_MS` in `dashboardRange.js`, which this reads rather than restates.
 *
 * Named for what it bounds - a day given as "YYYY-MM-DD" - where `dashboardRange.js` keeps a private
 * `studioDayStart(y, m, d)` of its own for a range key; the two are the same idea on different input.
 */

// "+05:30", spelled from the one constant so the two cannot disagree.
const STUDIO_OFFSET = (() => {
  const minutes = STUDIO_OFFSET_MS / 60000;
  const pad = (n) => String(Math.abs(n)).padStart(2, "0");
  return `${minutes < 0 ? "-" : "+"}${pad(Math.trunc(minutes / 60))}:${pad(minutes % 60)}`;
})();

const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));

/**
 * A moment of a studio day as the `YYYY-MM-DD HH:MM:SS.mmm` UTC stamp MySQL compares a `DATETIME(3)`
 * column against. "" for no day, and "" for a day the calendar does not have - "2026-02-31" has the
 * right shape and no date behind it, and a bound that throws would fail the report rather than
 * leave it unbounded, which is what a filter nobody could have meant deserves.
 */
function sqlStamp(day, time) {
  if (!isDay(day)) return "";
  const date = new Date(`${day}T${time}${STUDIO_OFFSET}`);
  if (Number.isNaN(date.getTime())) return "";
  // Read back in the studio's own clock: "2026-02-31" parses, as the 3rd of March, and only the
  // round trip says so.
  if (new Date(date.getTime() + STUDIO_OFFSET_MS).toISOString().slice(0, 10) !== day) return "";
  return date.toISOString().replace("T", " ").replace("Z", "");
}

/** The first moment of a studio day, as the UTC stamp the database compares against. */
function studioDayStart(day) {
  return sqlStamp(day, "00:00:00.000");
}

/** The last moment of a studio day, as the UTC stamp the database compares against. */
function studioDayEnd(day) {
  return sqlStamp(day, "23:59:59.999");
}

/**
 * The studio day a stored UTC column falls on, as SQL to group by.
 *
 * Numeric offsets need none of MySQL's time-zone tables, so this runs on any install. Used only to
 * group and never to bound: a function around a column is a predicate no index can answer, so a
 * range is still narrowed on the raw column with `studioDayStart` / `studioDayEnd`.
 */
function studioDaySql(column) {
  return `DATE(CONVERT_TZ(${column}, '+00:00', '${STUDIO_OFFSET}'))`;
}

/** The studio day an instant falls on, `YYYY-MM-DD`; "" for something that is not a moment. */
function studioDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() + STUDIO_OFFSET_MS).toISOString().slice(0, 10);
}

module.exports = { STUDIO_OFFSET, studioDayStart, studioDayEnd, studioDaySql, studioDayKey };
