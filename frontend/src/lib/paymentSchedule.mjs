/**
 * The arithmetic behind Schedule Payment, which is a decision about two numbers and nothing else - so it
 * is here and unit-tested on its own rather than pinned through the form that draws it.
 */

/**
 * The share of the signed quotation that an amount is, to six decimal places.
 *
 * The schedule stores **percentages**, which is what lets every amount follow when the quotation is
 * corrected. A studio does not always think in percentages, though - a client agrees to ₹50,000 at slot
 * booking - so the amount box works out the share rather than asking somebody to do the division.
 *
 * Six places, because that is what makes the round trip exact: ₹50,000 of ₹4,20,000 is 11.904762%, and a
 * whole number would be ₹210 out. Six keeps the amount right to the rupee on quotations up to a crore;
 * past that it can come back a rupee or two different, which is the honest reading of a row that holds a
 * share rather than a figure typed twice. `Number` drops the trailing zeros, so 5% stays "5".
 *
 * A quotation of nothing has no shares: `50000 / 0` is Infinity and `0 / 0` is NaN, and either written into
 * the row would be stored and drawn. "" instead, which is what an unanswered percentage already is.
 */
export function percentageForAmount(amount, signedQuotation) {
  const total = Number(signedQuotation || 0);
  const value = Number(String(amount ?? "").trim());
  if (!total || !Number.isFinite(value) || String(amount ?? "").trim() === "") return "";
  return Number(((value / total) * 100).toFixed(6));
}

/** The rupees a share comes to, to the nearest rupee - what the Amount box shows when nobody is typing in it. */
export function amountForPercentage(percentage, signedQuotation) {
  return Math.round(Number(signedQuotation || 0) * (Number(percentage || 0) / 100));
}

/**
 * A saved schedule as the Schedule Payment rows hold it. A payment a part payment split carries a
 * fixed amount rather than a share, so its share is worked out from that amount to draw it.
 * `locked` - money received, a hold or a split in Accounts - is still edited and removed like any other
 * row; the form shows its status beside it, and it needs no date to be saved.
 */
export function scheduleFormRows(saved, signedQuotation) {
  return (saved || []).map((row) => ({
    id: row.id,
    category: row.category || "",
    date: row.dueRule === "SHOOT" ? "" : row.dueDate || "",
    ...shootLinkFields(row),
    remarks: row.remarks || "",
    percentage: row.percentage ?? percentageForAmount(row.amount, signedQuotation),
    locked: Boolean(row.locked),
    status: row.status || "",
  }));
}

/*
 * ── Date not known: the payment follows a shoot ──
 *
 * A row holds it as `dateKnown: false`, the shoot (`shootKey`, "" for the main event), `timing`
 * (BEFORE / ON / AFTER) and `days`; the server stores one signed number of days (`dueOffsetDays`),
 * negative before the shoot. The due date itself is worked out on the server from the shoot's date.
 */
export const SHOOT_TIMINGS = [
  { value: "BEFORE", label: "Before shoot" },
  { value: "ON", label: "On shoot day" },
  { value: "AFTER", label: "After shoot" },
];

/** A saved payment's shoot link as the form row holds it. */
export function shootLinkFields(row) {
  if (row?.dueRule !== "SHOOT") return { dateKnown: true, shootKey: "", timing: "ON", days: "" };
  const offset = Number(row.dueOffsetDays || 0);
  return {
    dateKnown: false,
    shootKey: row.dueShootRemoved ? "" : row.dueShootId || "",
    timing: offset < 0 ? "BEFORE" : offset > 0 ? "AFTER" : "ON",
    days: offset ? String(Math.abs(offset)) : "",
  };
}

/** The signed days from the shoot a row's timing comes to: −3 for three days before, 0 on the day. */
export function shootOffsetDays(row) {
  if (row.timing === "ON") return 0;
  const days = Math.min(365, Math.max(0, Math.round(Number(row.days) || 0)));
  return row.timing === "BEFORE" ? -days : days;
}

/** "3 days before Reception", "On the Wedding day", or with the main event where no shoot is picked. */
export function shootLinkLabel(row, shoots = []) {
  const shoot = row.shootKey ? (shoots || []).find((entry) => String(entry.id) === String(row.shootKey)) : null;
  if (row.shootKey && (shoots || []).length && !shoot) return "Its shoot was removed - pick again";
  const name = shoot?.shoot || (row.shootKey ? "the shoot" : "the main event");
  if (row.timing === "ON") return `On ${name} day`;
  const days = Math.abs(shootOffsetDays(row));
  return `${days} day${days === 1 ? "" : "s"} ${row.timing === "BEFORE" ? "before" : "after"} ${name}`;
}

/**
 * Where a payment falls due, for the screens that list it: its date, "Waiting for shoot date" for one
 * that follows a shoot with none yet, or what a payment with no date otherwise is (`undatedText`).
 */
export function dueDateText(payment, formatDay, undatedText = "Final settlement") {
  if (payment?.dueDate) return formatDay(payment.dueDate);
  if (payment?.dueRule === "SHOOT") return payment.dueShootRemoved ? "Waiting for shoot (removed)" : "Waiting for shoot date";
  return undatedText;
}

/** A row the save keeps: one with a category and a percentage. The blank row the form keeps at the bottom is not one. */
const isAnswered = (row) => String(row.category || "").trim() && String(row.percentage ?? "").trim() !== "";

/** The rows as the server saves them: answered rows only, each as typed. */
export function scheduleSavePayload(rows) {
  return (rows || [])
    .filter(isAnswered)
    .map((row) => ({
      id: row.id,
      category: String(row.category).trim(),
      date: row.dateKnown === false ? null : row.date || null,
      remarks: row.remarks || "",
      percentage: row.percentage,
      ...(row.dateKnown === false
        ? { dueRule: "SHOOT", dueShootId: row.shootKey || null, dueOffsetDays: shootOffsetDays(row) }
        : { dueRule: "DATE", dueShootId: null, dueOffsetDays: null }),
    }));
}

/**
 * The rows the save would keep that have no date - which it refuses, as the server does.
 *
 * Every payment falls due on a day, except the row that settles the balance (`settlingNames`, the
 * categories flagged so in Settings): it takes no date, and the form draws none for it. A row
 * Accounts has already worked (`locked`) is not asked for one either - the server saves it without. The empty row the form adds below the last is not answered, so it never counts.
 */
export function undatedPayments(rows, settlingNames = []) {
  return (rows || []).filter((row) => isAnswered(row)
    && !row.locked
    && row.dateKnown !== false
    && !settlingNames.includes(String(row.category).trim())
    && !String(row.date || "").trim());
}
