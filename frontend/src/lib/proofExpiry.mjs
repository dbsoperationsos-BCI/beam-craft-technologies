/**
 * The expiry date of a client proof link, between the calendar and the server.
 *
 * The server stores an instant; the studio picks a day. These two turn one into the other, and the
 * whole point of them living here rather than inside the card is the second rule below, which is
 * easy to get wrong and impossible to notice: a link that expires at the first second of the day
 * shown is a link the studio believes is live all day and the client cannot open at all.
 */

/** A stored instant as the day a calendar shows, in the reader's own timezone. */
export function expiryDateKey(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * The chosen day expires at the end of it, not at its first second. "Expires 19/03/2027" has to
 * mean the client can still open it on the 19th.
 */
export function expiryInstant(dateKey) {
  if (!dateKey) return null;
  const date = new Date(`${dateKey}T23:59:59`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** The earliest day the calendar may offer: an expiry already past is a revoke by the back door. */
export function earliestExpiryKey(now = new Date()) {
  return expiryDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000));
}
