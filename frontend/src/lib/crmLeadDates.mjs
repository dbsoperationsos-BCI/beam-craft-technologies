/**
 * What counts as a day, for a CRM lead's dates on the client.
 *
 * The exact twin of `toIsoDay` in
 * [backend/src/modules/sales/crm-leads/leadDates.js](../../../backend/src/modules/sales/crm-leads/leadDates.js),
 * which the board's SQL is built from as well. The two are held to the same answers by
 * `crm-lead-dates.test.mjs` here and `crm-lead-dates.test.js` there, over one shared list of samples
 * - because the client decides what the Enquiry Date cell *shows* and the server decides which tab
 * the lead is *in*, and a lead shown one date and filed under another is the fault this exists to
 * stop.
 *
 * A lead's dates are text, written by whatever produced them. The rule used to be ISO or
 * `DD/MM/YYYY` and nothing else, so `09-Sep-26` - which is what Excel writes for a short date, and
 * therefore what a studio's own exported CSV carries - was not a date to this application at all.
 * The cell fell through to the row's insert timestamp and printed **today** on every row of an
 * import.
 *
 * Two rules hold the list together:
 *
 *   1. **ISO is tried first and nothing may reinterpret a value that already parsed.** Every shape
 *      below it is a widening.
 *   2. **Day comes before month**, as `DD/MM/YYYY` already decided for this application. The
 *      month-name shapes are unambiguous and carry no such choice.
 */

// Abbreviated and full month names, which is what makes `09-Sep-26` and `9 September 2026`
// readable without guessing at day-versus-month order.
const MONTHS = new Map();
[
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
].forEach((name, index) => {
  MONTHS.set(name, index + 1);
  MONTHS.set(name.slice(0, 3), index + 1);
});
// Excel and some locales write these; they are the only irregular abbreviations worth carrying.
MONTHS.set("sept", 9);

const pad = (number) => String(number).padStart(2, "0");

/**
 * A two-digit year on the same pivot MySQL's `%y` uses, so JavaScript and the database never
 * disagree about which century `26` is. 00-69 is this century, 70-99 the last.
 */
function fullYear(text) {
  const year = Number(text);
  if (text.length === 4) return year;
  return year <= 69 ? 2000 + year : 1900 + year;
}

/** A real calendar day, or "" - so 31 February is refused rather than rolled into March. */
function assemble(year, month, day) {
  if (!(year >= 1900 && year <= 2999) || !(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return "";
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * One stored date as `YYYY-MM-DD`, or "" for anything that is not a day.
 *
 * "" rather than a guess: a cell holding a note, a dash or a half-typed date is not a date, and the
 * board is honest about a lead it cannot place rather than filing it under a day nobody chose.
 */
export function toIsoDay(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";

  // ISO, with or without a time after it. First, and unchanged, so nothing that parsed before can
  // resolve to a different day now.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return assemble(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // Day-first, numeric, separated by / . or - : 09/09/2026, 9.9.26, 09-09-2026.
  const numeric = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(text);
  if (numeric) return assemble(fullYear(numeric[3]), Number(numeric[2]), Number(numeric[1]));

  // Day-first with the month named: 09-Sep-26, 9 September 2026, 09/Sep/2026.
  const named = /^(\d{1,2})[\s/.-]([A-Za-z]{3,9})[\s/.-](\d{2}|\d{4})$/.exec(text);
  if (named) {
    const month = MONTHS.get(named[2].toLowerCase());
    if (month) return assemble(fullYear(named[3]), month, Number(named[1]));
  }

  // Month named first, which is how a US-formatted export reads: Sep 9, 2026.
  const monthFirst = /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{2}|\d{4})$/.exec(text);
  if (monthFirst) {
    const month = MONTHS.get(monthFirst[1].toLowerCase());
    if (month) return assemble(fullYear(monthFirst[3]), month, Number(monthFirst[2]));
  }

  return "";
}

/** The same value, folded to a day where it is one and left exactly as it is where it is not. */
export function normalizeDateText(value) {
  const text = String(value ?? "").trim();
  return toIsoDay(text) || text;
}
