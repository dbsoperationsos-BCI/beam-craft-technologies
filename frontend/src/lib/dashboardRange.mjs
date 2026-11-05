/**
 * The vocabulary every module dashboard shares — Image Selection, the AI Feature and Album
 * Proofing offer the same range picker over the same `?range=` keys, print the same phrases
 * under their arrows and format a count, a size and a time the same way. One copy, so a person
 * moving between the three never meets a second set of words for the same month.
 *
 * The counts a dashboard shows are *positions* (the module as it stands); a range scopes the
 * *period* figures (what happened inside it) and fixes the point each card's arrow is measured
 * from. Lifetime has no start, so it has no comparison and no arrow.
 */

/** The range picker above the cards: the keys the API accepts, in the order the menu lists them. */
export const RANGE_OPTIONS = [
  { value: "lifetime", label: "Lifetime" },
  { value: "month", label: "This Month" },
  { value: "week", label: "This Week" },
  { value: "3m", label: "3 Months" },
  { value: "6m", label: "6 Months" },
];
export const DEFAULT_RANGE = "month";

/**
 * How each range reads at the end of a sentence: "+2 created **this month**", "624 photos picked
 * **in total**". The label alone would not do it — "created Lifetime" is not a sentence — so the
 * picker's name and the words under a card are kept apart on purpose.
 */
export const PERIOD_PHRASES = {
  lifetime: "in total",
  month: "this month",
  week: "this week",
  "3m": "in the last 3 months",
  "6m": "in the last 6 months",
};
export const periodPhrase = (key) => PERIOD_PHRASES[key] || "in this range";

/**
 * What each card's arrow is measured against: where the number stood at the start of the range.
 * Lifetime has no start, so it has no phrase and the card shows no arrow.
 */
export const PREVIOUS_PHRASES = {
  month: "vs last month",
  week: "vs last week",
  "3m": "vs 3 months ago",
  "6m": "vs 6 months ago",
};
export const previousPhrase = (key) => PREVIOUS_PHRASES[key] || null;

/**
 * The same comparison as a name rather than as a phrase: what a card prints under its own "vs".
 * Title case and no "vs" of its own, because the card supplies that word on the line above it.
 */
export const PREVIOUS_LABELS = {
  month: "Last Month",
  week: "Last Week",
  "3m": "3 Months Ago",
  "6m": "6 Months Ago",
};
export const previousLabel = (key) => PREVIOUS_LABELS[key] || null;

/** The arrow for a change: which way it points, and the signed number beside it. */
// The arrow itself lives in `trend.mjs`, which the attendance Dashboard draws its arrows with too;
// re-exported here so every dashboard keeps one import.
export { trendOf } from "./trend.mjs";

/**
 * The noun that follows a headline figure, matched to it: "1 Project", "4 Projects", "1 Person",
 * "3 People". `unit` is a singular word pluralised with an "s", or a `[singular, plural]` pair for
 * a word that does not pluralise that way.
 */
export function unitLabel(value, unit) {
  if (!unit) return "";
  const one = Math.abs(Number(value) || 0) === 1;
  if (Array.isArray(unit)) return one ? unit[0] : unit[1];
  return one ? unit : `${unit}s`;
}

/** A count the way the studio reads it: Indian digit grouping. */
export const number = (value) => Number(value || 0).toLocaleString("en-IN");

/** "184", "12.5K", "248K", "1.2M" — a headline number that fits a card. */
export function formatCompact(value) {
  const count = Number(value || 0);
  if (!Number.isFinite(count)) return "0";
  const abs = Math.abs(count);
  if (abs < 1000) return count.toLocaleString("en-IN");
  if (abs < 10000) return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  if (abs < 1000000) return `${Math.round(count / 1000)}K`;
  return `${(count / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** A byte count as the unit a person reads it in. */
export function formatBytes(bytes) {
  const count = Number(bytes || 0);
  if (!Number.isFinite(count) || count <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const power = Math.min(units.length - 1, Math.floor(Math.log(count) / Math.log(1024)));
  const scaled = count / 1024 ** power;
  const text = scaled >= 100 || power === 0 ? String(Math.round(scaled)) : scaled.toFixed(1).replace(/\.0$/, "");
  return `${text} ${units[power]}`;
}

/** "just now", "12 mins ago", "3 days ago" — or a dash for a time nobody recorded. */
export function relativeTime(value, now = new Date()) {
  if (!value) return "—";
  const stamp = new Date(value);
  if (Number.isNaN(stamp.getTime())) return "—";
  const seconds = Math.max(0, Math.round((now.getTime() - stamp.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const units = [["min", 60], ["hour", 3600], ["day", 86400], ["week", 604800], ["month", 2629800], ["year", 31557600]];
  for (let index = units.length - 1; index >= 0; index -= 1) {
    const [unit, size] = units[index];
    if (seconds >= size) { const count = Math.floor(seconds / size); return `${count} ${unit}${count === 1 ? "" : "s"} ago`; }
  }
  return "just now";
}
