const { z } = require("zod");

/**
 * The one range vocabulary every module dashboard shares — Image Selection, the AI Feature and
 * Album Proofing all offer the same picker and read `?range=` the same way, so a person moving
 * between them never meets a second set of words for the same month.
 *
 * A range scopes the *period* figures (what happened inside it) and fixes the comparison point
 * (`from`) each card's arrow is measured against; the counts themselves are always positions, the
 * module as it stands now. Lifetime has no start and so no comparison.
 */

// The studio's day. Asia/Kolkata keeps one offset all year, so a fixed shift is the whole rule.
const STUDIO_OFFSET_MS = 330 * 60 * 1000;
const RANGE_KEYS = ["lifetime", "month", "week", "3m", "6m"];
// The labels the picker itself shows, so a page never has two names for one range.
const RANGE_LABELS = { lifetime: "Lifetime", month: "This Month", week: "This Week", "3m": "3 Months", "6m": "6 Months" };
// Lifetime has no floor. The epoch stands in for one so every range is a pair of instants and the
// queries stay identical — nothing in this application predates 1970.
const LIFETIME_START = new Date(0);
// Monday, the way a working week is read here (the meetings calendar starts its columns there).
const mondayOffset = (weekday) => (weekday + 6) % 7;
const DEFAULT_RANGE = "month";

function studioParts(now) {
  const shifted = new Date(now.getTime() + STUDIO_OFFSET_MS);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth(), d: shifted.getUTCDate(), weekday: shifted.getUTCDay() };
}
/** Midnight of one studio day, as the instant the database compares against. */
const studioDayStart = (y, m, d) => new Date(Date.UTC(y, m, d) - STUDIO_OFFSET_MS);

/**
 * The instants one range key means, ending after today. `to` is exclusive — the first moment of
 * tomorrow — so a row created at any time today is inside "today". An unknown key reads as this
 * month rather than as everything.
 */
function rangeBounds(key = DEFAULT_RANGE, now = new Date()) {
  const resolved = RANGE_KEYS.includes(key) ? key : DEFAULT_RANGE;
  const { y, m, d, weekday } = studioParts(now);
  const starts = {
    // Two calendar ranges — the week and the month so far, which is what somebody means by
    // "this week" — and two rolling ones, which is what "3 months" means.
    lifetime: LIFETIME_START,
    month: studioDayStart(y, m, 1),
    week: studioDayStart(y, m, d - mondayOffset(weekday)),
    "3m": studioDayStart(y, m - 3, d + 1),
    "6m": studioDayStart(y, m - 6, d + 1),
  };
  return { key: resolved, label: RANGE_LABELS[resolved], from: starts[resolved], to: studioDayStart(y, m, d + 1) };
}

// `range` is a key rather than a pair of dates, so a URL cannot ask for a range the picker has no
// option for.
const dashboardQuerySchema = z.object({
  range: z.enum(RANGE_KEYS).optional().default(DEFAULT_RANGE),
});

module.exports = { STUDIO_OFFSET_MS, RANGE_KEYS, RANGE_LABELS, DEFAULT_RANGE, rangeBounds, dashboardQuerySchema };
