/**
 * **What a save actually changed**, in words, for an activity line.
 *
 * `fieldChanges(before, after)` compares what was stored against what was sent and answers with one
 * line per field that moved - `"Main Event Date: 20 Nov 2026 → 22 Nov 2026"` - which is what turns
 * "he saved the project" into something anybody can check. `services/activityLog.js`
 * (`describeChanges`) is where those lines are handed over.
 *
 * ── The three things that decide whether this is useful or noise ──
 *
 * **A field nobody sent is not a change.** `after[key] === undefined` means the form did not carry
 * that field at all, which is not the same as carrying it empty. A diff that read absence as "set to
 * nothing" would report half the record on every partial save.
 *
 * **Empty is empty.** `null`, `undefined` and `""` are one state here. The database keeps the
 * difference and nothing else does - Rule 5 is that `""` never *means* none, not that a reader cares
 * which flavour of blank a field held - and a line reading `Remarks: — → —` is worse than no line.
 *
 * **A day is a day.** Prisma hands back a `Date` and a form sends `"2026-11-22"`; compared as they
 * come, every save of an unchanged date reports a change. Both sides are reduced to the day, in the
 * studio's own zone, before they are compared.
 *
 * ── And one thing that decides whether it is safe ──
 *
 * `SECRET_KEYS` is **not** how a password stays out of the log - being opt-in is, since a handler that
 * never calls `describeChanges` says nothing. This is the second lock: a module that opts in and then
 * passes its whole validated body gets the obvious fields dropped rather than written down. It is
 * matched on the key, so `password`, `passwordHash` and `confirmPassword` all go.
 */

const { studioDateKey } = require("./studioTime");

/** Key fragments whose value is never written into an activity line, whatever a caller passes. */
const SECRET_KEYS = ["password", "token", "secret", "otp", "hash", "apikey", "cvv", "pin"];

const MAX_VALUE_CHARS = 80;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const isSecret = (key) => {
  const flat = String(key || "").toLowerCase().replace(/[^a-z]/g, "");
  return SECRET_KEYS.some((word) => flat.includes(word));
};

/** Whether a value is one of the blanks. `0` and `false` are answers, not blanks. */
const blank = (value) => value === null || value === undefined || (typeof value === "string" && !value.trim());

/** A `Date`, or a string that is only a date or a date and time - never a number or a word. */
function asDay(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : studioDateKey(value);
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}([T ]|$)/.test(value.trim())) return null;
  const at = new Date(value.trim().length === 10 ? `${value.trim()}T00:00:00.000Z` : value.trim());
  return Number.isNaN(at.getTime()) ? null : studioDateKey(at);
}

/** `"mainEventDate"` → `"Main Event Date"`, with the words the studio spells its own way. */
const SPELLINGS = { id: "ID", url: "URL", qr: "QR", whatsapp: "WhatsApp", upi: "UPI", crm: "CRM", crd: "CRD", pf: "PF", gst: "GST" };

function humanLabel(key) {
  return String(key || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((word) => SPELLINGS[word.toLowerCase()] || `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

/** One value as a reader should see it: a day as a day, a blank as a dash, a long one cut short. */
function showValue(value) {
  if (blank(value)) return "—";
  const day = asDay(value);
  if (day) return `${day.slice(8, 10)} ${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value) || typeof value === "object") {
    const text = JSON.stringify(value);
    return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}…` : text;
  }
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}…` : text;
}

/** Whether two values are the same answer - blanks together, days by their day. */
function same(before, after) {
  if (blank(before) && blank(after)) return true;
  const beforeDay = asDay(before);
  const afterDay = asDay(after);
  if (beforeDay && afterDay) return beforeDay === afterDay;
  if (typeof before === "object" || typeof after === "object") return JSON.stringify(before ?? null) === JSON.stringify(after ?? null);
  return String(before ?? "") === String(after ?? "");
}

/**
 * The lines describing what moved between `before` and `after`.
 *
 * `labels` renames a field whose derived name reads badly; `only` narrows the comparison to the keys
 * worth reporting, and `skip` drops ones that are not. Keys nobody sent, and keys whose value did not
 * move, produce nothing.
 */
function fieldChanges(before, after, { labels = {}, only = null, skip = [] } = {}) {
  const keys = only || Object.keys(after || {});
  const dropped = new Set(skip);
  return keys
    .filter((key) => !dropped.has(key) && !isSecret(key) && after?.[key] !== undefined)
    .filter((key) => !same(before?.[key], after[key]))
    .map((key) => `${labels[key] || humanLabel(key)}: ${showValue(before?.[key])} → ${showValue(after[key])}`);
}

/** The names alone, for a trail that records what changed without what it became. */
const changedFieldNames = (before, after, options) => fieldChanges(before, after, options)
  .map((line) => line.slice(0, line.indexOf(":")));

module.exports = { SECRET_KEYS, fieldChanges, changedFieldNames, humanLabel, showValue, same, isSecret };
