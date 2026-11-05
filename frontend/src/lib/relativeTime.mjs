/**
 * How long ago something happened, in the short form a comment thread wants — "just now",
 * "5 min. ago", "3 h ago", "2 d ago", "1 mo. ago", "1 y ago".
 *
 * Written out rather than taken from `Intl.RelativeTimeFormat` because the unit has to be chosen
 * first either way, and this keeps the abbreviations the same on every browser and locale — a
 * correction pin that reads "1 mo. ago" for one reviewer and "last month" for another is the same
 * comment looking like two.
 */
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * The project workspace's "Updated:" wording - "just now", "5 mins ago", "3 hours ago", "2 days ago" -
 * for whichever tab is open: the project's own timestamp on Photo Selection, the album's on
 * Signature Album. "recently" until there is a timestamp and a clock to measure it against, which
 * is what the label read before the browser's clock was read.
 */
export function updatedAgo(value, now) {
  if (!value || !now) return "recently";
  const at = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(at)) return "recently";
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function timeAgo(value, now = Date.now()) {
  const at = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(at)) return "";
  // A clock that is a little behind the server reads as the future; that is still "just now".
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return "just now";
  if (seconds < HOUR) return `${Math.round(seconds / MINUTE)} min. ago`;
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)} h ago`;
  if (seconds < MONTH) return `${Math.floor(seconds / DAY)} d ago`;
  if (seconds < YEAR) return `${Math.floor(seconds / MONTH)} mo. ago`;
  return `${Math.floor(seconds / YEAR)} y ago`;
}
