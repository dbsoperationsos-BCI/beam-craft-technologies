/**
 * Sale Extras on screen: labels, and how an amount reads.
 *
 * Every amount is the studio's own figure before GST, signed: an addition positive, a removal
 * negative, a modification whatever was typed - the rule the server stores it by
 * (`backend/src/modules/sales/sale-extras/rules.js`).
 */

export const KIND_LABELS = { ADDED: "Added", REMOVED: "Removed", MODIFIED: "Modified", CORRECTION: "Correction" };
export const CATEGORY_LABELS = { SHOOT: "Shoot", SERVICE: "Service", DELIVERABLE: "Deliverable" };
// Saved but not yet on the client's quotation reads "Not published"; "Draft" is the server's word only.
export const STATUS_LABELS = { DRAFT: "Not published", PUBLISHED: "Published" };

const AMOUNT_LABELS = { ADDED: "Additional amount (₹)", REMOVED: "Reduction (₹)", MODIFIED: "Price change (₹)", CORRECTION: "Correction (₹)" };
export const amountLabel = (kind) => AMOUNT_LABELS[kind] || "Amount (₹)";

const RUPEES = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** "₹2,48,000": an amount with no sign, as the original and the updated total read. */
export function formatRupees(amount) {
  const value = Math.round(Number(amount) || 0);
  return `${value < 0 ? "−" : ""}₹${RUPEES.format(Math.abs(value))}`;
}

/** A day the way the section's Created column reads it: "01 Nov 2026". */
export function formatDay(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date) : "—";
}

/** Unpublished first - they are what needs doing - then the published, each group in the order it happened. */
export const draftsFirst = (lines) => [...(lines || [])].sort((a, b) => (a.status === b.status ? 0 : a.status === "DRAFT" ? -1 : 1));

/** "+₹15,000", "−₹10,000" (a true minus sign), or "₹0" - never "+₹0". */
export function formatSignedRupees(amount) {
  const value = Math.round(Number(amount) || 0);
  if (value === 0) return "₹0";
  return `${value > 0 ? "+" : "−"}₹${RUPEES.format(Math.abs(value))}`;
}

const FIELD_LABELS = {
  quantity: "Quantity",
  quantitySessionTiming: "Session timing",
  sessionOptionId: "Session",
  durationHours: "Duration (hours)",
  durationMinutes: "Duration (minutes)",
  workDays: "Work days",
  timingMinutes: "Timing (minutes)",
  sizeOptionValueId: "Size option",
  numberOfPhotos: "No. of photos",
  brandName: "Brand",
  size: "Size",
  frameInches: "Frame",
  videoLength: "Video length",
};

/** What a modified line changed, in the studio's words: "Quantity 1 → 3". */
export function modifiedSummary(details) {
  const before = details?.before || {};
  const after = details?.after || {};
  return Object.keys(FIELD_LABELS)
    .filter((field) => String(before[field] ?? "") !== String(after[field] ?? ""))
    .map((field) => `${FIELD_LABELS[field]} ${before[field] ?? "—"} → ${after[field] ?? "—"}`)
    .join(" · ");
}

/**
 * Each item once, where it stands now. An item - the same shoot, service or deliverable on the same
 * shoot - taken off and put back leaves a line for every change; the section shows only its latest,
 * so it reads under Added while it is on and under Removed while it is off, rather than in both. The
 * earlier lines stay recorded and counted in the totals; only the lists show less. Every unpublished
 * line is kept - each needs its amount before publishing.
 */
export function currentLines(lines = []) {
  const keyOf = (line) => `${line.category}|${line.shootRef || ""}|${line.itemName}`;
  const rank = (line) => [line.status === "DRAFT" ? 2 : line.status === "PUBLISHED" ? 1 : 0, Number(line.publishedRevisionNumber || 0), new Date(line.changedAt || 0).getTime()];
  const later = (a, b) => { const x = rank(a); const y = rank(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
  const groups = new Map();
  for (const line of lines) groups.set(keyOf(line), [...(groups.get(keyOf(line)) || []), line]);
  const kept = new Set();
  for (const group of groups.values()) {
    const drafts = group.filter((line) => line.status === "DRAFT");
    if (drafts.length) drafts.forEach((line) => kept.add(line));
    else kept.add(group.reduce((latest, line) => (later(line, latest) > 0 ? line : latest)));
  }
  return lines.filter((line) => kept.has(line));
}

/**
 * The lines in the section's two tables: what was added - an addition, or a changed scope - and what
 * was removed. A correction sits with the line it corrects. Unpublished first in each.
 */
export function splitAddedRemoved(lines = []) {
  const byId = new Map(lines.map((line) => [line.id, line]));
  const removed = (line) => (line.kind === "CORRECTION" ? byId.get(line.correctsExtraId)?.kind === "REMOVED" : line.kind === "REMOVED");
  return { added: draftsFirst(lines.filter((line) => !removed(line))), removed: draftsFirst(lines.filter(removed)) };
}

/** What the Amount box shows for a saved line: a removal's reduction as the positive figure typed. */
export function typedAmount(line) {
  if (line?.amount === null || line?.amount === undefined) return "";
  return String(line.kind === "REMOVED" ? Math.abs(line.amount) : line.amount);
}

/**
 * Why what was typed in an Amount box cannot be saved, or "". Empty is allowed - the line stays
 * unpriced and blocks publishing - and ₹0 is an amount. An addition or a reduction is typed positive.
 */
export function amountEntryProblem(kind, text) {
  const value = String(text ?? "").trim();
  if (value === "") return kind === "CORRECTION" ? "Enter the correction." : "";
  const number = Number(value);
  if (!Number.isFinite(number)) return "Enter a number.";
  if ((kind === "ADDED" || kind === "REMOVED") && number < 0) return "Enter it as a positive figure.";
  if (kind === "CORRECTION" && number === 0) return "Enter the difference to add or take off.";
  if (Math.abs(number) > 999999999) return "That amount is too large.";
  return "";
}

/** Rounded to paise, as the server rounds what it stores. */
export const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/** The stored, signed amount a typed figure becomes - the server's rule, for the review before publishing. */
export function signedFromTyped(kind, text) {
  const number = Number(text);
  if (String(text ?? "").trim() === "" || !Number.isFinite(number)) return null;
  if (kind === "ADDED") return Math.abs(number);
  if (kind === "REMOVED") return -Math.abs(number);
  return number;
}
