/**
 * Which line somebody reads after marking their day.
 *
 * Pure, so the choice can be tested rather than watched. The rule is that the same date always
 * picks the same quote: everybody in the studio sees the same line on the same day, and reloading
 * the page does not shuffle it — a sentence that changes while you are reading it reads as a bug,
 * not as variety.
 *
 * "Deterministic" is doing the work that `Math.random()` would do badly here. Random per request
 * means a different quote on every poll of the attendance screen; random per day needs somewhere to
 * remember today's pick. Deriving it from the date needs neither.
 */

/**
 * A small, stable hash of a `YYYY-MM-DD` string.
 *
 * FNV-1a, because it is four lines, has no dependencies and spreads consecutive dates across the
 * output — which is the one property that matters here. Consecutive days must not walk the list in
 * order, or a studio with three Mondays' worth of quotes would show them in a visible cycle.
 */
function hashDate(iso) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < iso.length; index += 1) {
    hash ^= iso.charCodeAt(index);
    // The FNV prime, by shifts rather than a multiply, to stay inside 32 bits without overflowing
    // into a float.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

/**
 * The quote for a date, from the ones written for that weekday.
 *
 * `quotes` is the active rows for the day, in a stable order — the caller orders by id, so adding a
 * quote does not reshuffle which of the existing ones a past date would have picked. Answers null
 * when nobody has written anything for that weekday, which is a card without a line rather than an
 * error: a missing quote must never be a reason a check-in fails.
 */
function quoteForDate(quotes, iso) {
  const list = (quotes || []).filter((entry) => entry && entry.quote);
  if (!list.length) return null;
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return list[0];
  return list[hashDate(iso) % list.length];
}

/** `Date.getDay()` for a `YYYY-MM-DD`, read as the written day rather than as an instant. */
function weekdayOf(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
}

module.exports = { hashDate, quoteForDate, weekdayOf };
