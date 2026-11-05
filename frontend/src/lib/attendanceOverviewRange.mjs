/**
 * The dates and filters of the administrator's attendance Dashboard: the range it opens on, and
 * whether Apply and Reset have anything to do.
 *
 * A decision about dates and nothing else - no component, no request - so it is here rather than in
 * the screen, and can be read on its own by `test/attendance-overview-range.test.mjs`.
 *
 * Everything is the `YYYY-MM-DD` key the date inputs hold and the endpoint takes, built from the
 * **local** day rather than from `toISOString()`, which is UTC and puts the studio a day behind
 * itself every evening.
 */

/** A `Date` as the local `YYYY-MM-DD` key, not the UTC one. */
export function isoDay(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * The range the Dashboard opens on, and goes back to on Reset: today alone - who is in, out and
 * on leave right now, the question an administrator opens it with. Any other range is the From and
 * To fields.
 *
 * `today` is injectable so the rule can be tested on a fixed day instead of on whenever the suite
 * happens to run.
 */
export function defaultRange(today = new Date()) {
  return { from: isoDay(today), to: isoDay(today) };
}

/**
 * Whether two sets of filters ask the same question, so Apply can say whether there is anything to
 * apply. The people are compared as a set: picking the same three in a different order is not a
 * new question.
 */
export function sameRange(a, b) {
  const people = (filters) => [...(filters.employeeIds || [])].map(String).sort().join(",");
  return a.from === b.from && a.to === b.to
    && String(a.branchId || "") === String(b.branchId || "")
    && people(a) === people(b);
}

/** Whether anything narrows the Dashboard beyond the default range, for Reset to say it can act. */
export function hasOverviewFilters(filters) {
  return Boolean(filters.branchId) || Boolean(filters.employeeIds?.length);
}

/** A `YYYY-MM-DD` key as "12 Sep 2026", for a caption somebody reads rather than parses. */
export function readableDay(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key || ""))) return String(key || "");
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
