/**
 * The comparisons and the arithmetic of Sale Extras, apart from the database so each has one definition.
 *
 * A line's *scope* is what a price depends on - a service's quantity and timing, a deliverable's
 * quantity and variant. A shoot has none: rescheduling it is not an extra. Every amount is the
 * studio's own figure before GST, exactly as the original quotation's is; the kind only decides its sign.
 */

const KINDS = ["ADDED", "REMOVED", "MODIFIED"];
const CATEGORIES = ["SHOOT", "SERVICE", "DELIVERABLE"];
const STATUSES = ["DRAFT", "PUBLISHED", "CANCELLED"];
const MAX_AMOUNT = 999_999_999;

const SCOPE_FIELDS = {
  SHOOT: [],
  SERVICE: ["quantity", "quantitySessionTiming", "sessionOptionId", "durationHours", "durationMinutes", "workDays", "timingMinutes", "sizeOptionValueId"],
  DELIVERABLE: ["quantity", "numberOfPhotos", "brandName", "size", "frameInches", "videoLength", "sizeOptionValueId"],
};

/** The scope fields of a row, every one present (null when unset), nothing else. */
function scopeOf(category, row) {
  return Object.fromEntries((SCOPE_FIELDS[category] || []).map((field) => [field, row?.[field] ?? null]));
}

// Compared as values: a number stored as 1 and read back as "1" is the same quantity.
const comparable = (value) => (value === null || value === undefined || value === "" ? null : String(value));

function sameScope(category, a, b) {
  return (SCOPE_FIELDS[category] || []).every((field) => comparable(a?.[field]) === comparable(b?.[field]));
}

// Through the decimal exponent rather than `* 100`, so 2500.555 rounds to 2500.56 and not 2500.55.
function round2(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return number;
  const sign = number < 0 ? -1 : 1;
  return sign * Number(`${Math.round(Number(`${Math.abs(number)}e2`))}e-2`);
}

/** The stored amount for what was typed: an addition is always positive, a removal always negative. */
function signedAmount(kind, entered) {
  const value = round2(entered);
  if (kind === "ADDED") return Math.abs(value);
  if (kind === "REMOVED") return value === 0 ? 0 : -Math.abs(value);
  return value;
}

/** Why a figure cannot be stored, or "" when it can. */
function amountProblem(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "Enter the amount as a number.";
  if (Math.abs(value) > MAX_AMOUNT) return "That amount is too large.";
  return "";
}

/** The three figures a revision carries. Included lines carry no amount; nothing is floored. */
function revisionTotals(originalAmount, lines) {
  const original = round2(originalAmount);
  const net = round2(lines.reduce((sum, line) => sum + (line.included === true ? 0 : Number(line.amount || 0)), 0));
  return { originalAmount: original, netAdjustment: net, updatedTotal: round2(original + net) };
}

const lineOf = (row) => ({
  extraId: row.id,
  code: row.code,
  kind: row.kind,
  category: row.category,
  itemName: row.itemName,
  shootName: row.shootName || null,
});

/**
 * Published lines as a revision freezes them: each priced line with the lines included in its price
 * under it. What the client reads, never the internal remarks.
 */
function snapshotLines(rows) {
  const parents = rows.filter((row) => !row.parentExtraId);
  return parents.map((row) => ({
    ...lineOf(row),
    amount: round2(row.amount ?? 0),
    publishedIn: row.publishedIn ?? null,
    included: rows.filter((child) => child.parentExtraId === row.id).map((child) => ({ ...lineOf(child), publishedIn: child.publishedIn ?? null })),
  }));
}

module.exports = { KINDS, CATEGORIES, STATUSES, SCOPE_FIELDS, MAX_AMOUNT, scopeOf, sameScope, signedAmount, amountProblem, revisionTotals, snapshotLines, round2 };
