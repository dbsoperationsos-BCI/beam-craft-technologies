/**
 * What counts as a day, everywhere a CRM lead carries one.
 *
 * A lead's dates arrive as **text**, from whatever wrote them: a CSV exported from Excel, a Google
 * Sheet, a person typing into Add Lead. The board then has to read them back - which tab a lead
 * belongs to, which day its cell shows, whether its follow-up is owed - and until now "a day" meant
 * exactly two shapes: `YYYY-MM-DD` and `DD/MM/YYYY`. Anything else was not a date as far as the
 * application was concerned.
 *
 * Excel's default for a short date is `09-Sep-26`. A studio exporting its own leads and importing
 * them back therefore stored every date in a shape nothing here could read, and the consequences ran
 * the length of the module rather than stopping at the cell:
 *
 *   * `created_day`, `follow_up_day` and `dob_edod_day` are **stored generated columns** computed
 *     from that same two-shape rule, so all three came out NULL. A NULL `follow_up_day` is in no
 *     Today or Yesterday Pending tab, and a NULL `dob_edod_day` is in neither Newborns nor Birthdays
 *     - on Qua Qua, whose whole board is those two occasions.
 *   * `enquiryDaySql()` came out NULL, so the lead was in no Today New Leads and no date range.
 *   * The board fell back to the row's own insert timestamp and printed **today** in the Enquiry
 *     Date column, on every row of the import.
 *
 * So this is one module and one list of shapes, and everything that reads or writes a lead's date
 * goes through it: `toIsoDay` for JavaScript, `isoDaySqlFor` for the SQL the board is queried with,
 * and `flattenLeadColumns` folding what is *written* to `YYYY-MM-DD` so the generated columns and
 * every future reader agree without having to guess at all.
 *
 * Two rules hold the list together:
 *
 *   1. **ISO is tried first and nothing may reinterpret a value that already parsed.** Every shape
 *      below ISO is a widening: a value that used to resolve resolves to the same day, and a value
 *      that used to resolve to nothing may now resolve to something.
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

/*
 * ── A cell that carries the time as well as the day ───────────────────────────────────────────
 *
 * A sheet may state an enquiry as one stamp - `10-Sep-26 10:57 am`, `2026-09-10T10:57:00` - rather
 * than as a date column and a time column beside it. The day and the clock time are stored apart
 * here (`created_date` and `added_time`), so a stamp like that has to be read as both.
 *
 * It is also what the two halves of this module already disagreed about. MySQL's `STR_TO_DATE`
 * ignores whatever trails the format it was given, so `isoDaySqlFor` read `10-Sep-26 10:57 am` as
 * the 10th all along, while `toIsoDay` refused it outright - the SQL and the JavaScript answering
 * differently for the same cell, which is the one thing this module exists to prevent. Reading the
 * time off the end brings the JavaScript up to what the SQL already did.
 */

/**
 * A clock time at the end of a cell, or the whole of one.
 *
 * The leading group is what separates it from the date in front of it - a space, a `T`, a comma -
 * and is empty when the cell is nothing but a time. Anchored at the end so a date alone, and a note
 * that merely mentions an hour, both fall through to "not a time".
 */
const TRAILING_CLOCK = /(^|[\sT,])(\d{1,2}):(\d{2})(?::\d{2})?\s*(?:([AaPp])\.?[Mm]\.?)?$/;

/**
 * `17`, `49` -> `05:49 pm`. The shape the CRM stores and shows a time in everywhere - two digits
 * for the hour, so a column of them lines up - and the same arithmetic `toTwelveHourClock` does on
 * the front end. Deliberately not `Date` and `Intl`: a clock time carries no day and no zone, and
 * putting one through a zone-aware formatter would shift it by the offset.
 */
function clockLabel(hours, minutes) {
  return `${pad(hours % 12 || 12)}:${pad(minutes)} ${hours < 12 ? "am" : "pm"}`;
}

/**
 * One cell split into the day it states and the clock time it states, either of which may be "".
 *
 * A value that is not a time is returned whole as the day, so nothing that used to parse as a date
 * can stop parsing: this only ever takes a time off the end.
 */
function splitDayAndTime(value) {
  const text = String(value ?? "").trim();
  const match = TRAILING_CLOCK.exec(text);
  if (!match) return { day: text, clock: "" };

  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  const meridiem = (match[4] || "").toLowerCase();
  const day = text.slice(0, match.index + match[1].length).trim();

  // "13:00 pm" and "10:75" are not times somebody meant, so the cell is left whole rather than
  // half-read into a time that was never there.
  if (minutes > 59) return { day: text, clock: "" };
  if (meridiem) {
    if (hours < 1 || hours > 12) return { day: text, clock: "" };
    return { day, clock: clockLabel(meridiem === "p" ? (hours % 12) + 12 : hours % 12, minutes) };
  }
  if (hours > 23) return { day: text, clock: "" };
  return { day, clock: clockLabel(hours, minutes) };
}

/** The clock time a cell states, on the 12-hour clock, or "" where it states none. */
function toClockTime(value) {
  return splitDayAndTime(value).clock;
}

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
function toIsoDay(value) {
  // The time, where the cell carries one, is not part of the day - and taking it off first is what
  // lets every shape below read a stamp as well as a bare date.
  const text = splitDayAndTime(value).day;
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
function normalizeDateText(value) {
  const text = String(value ?? "").trim();
  return toIsoDay(text) || text;
}

/*
 * The SQL half, written over an arbitrary column expression.
 *
 * `STR_TO_DATE` answers NULL for anything that does not match its format, so this is a COALESCE of
 * attempts in the same order `toIsoDay` tries them - ISO first, then day-first numeric, then the
 * month-name shapes. MySQL's `%y` pivots two-digit years at 69 exactly as `fullYear` above does, and
 * `%b`/`%M` cover the abbreviated and full month names.
 *
 * The expression is repeated per attempt, which is the price of reading a date out of a text column.
 * COALESCE stops at the first non-NULL, so an ISO value - which is what everything written from now
 * on is, see `flattenLeadColumns` - costs one branch.
 */
function isoDaySqlFor(expression) {
  /*
   * A day MySQL parsed is only a day if it is a real one, and `STR_TO_DATE` does not check.
   *
   * `STR_TO_DATE('31-Feb-26', '%d-%M-%Y')` answers `2026-02-31` - a date that does not exist - and
   * `LEFT('2026-02-31', 10)` hands the ISO branch the same thing straight out of the column. Either
   * way the board filed the lead under a day nobody can reach while `toIsoDay` above, which does
   * check, called it no date at all: the two halves disagreeing about one lead, which is the whole
   * fault this module exists to stop.
   *
   * The check is a round trip, the same one `assemble` makes in JavaScript. Adding nothing to a date
   * re-reads it, and a day that is not real comes back *moved* - `DATE_ADD('2026-02-31', INTERVAL 0
   * DAY)` is `2026-03-03` - so a date that comes back unchanged is a date that exists. Note what this
   * is not: `DATE_ADD` alone would answer 3 March and file the lead there, which is the rolling into
   * March that `assemble` refuses. Only the comparison refuses it.
   *
   * February carries itself: 29 February 2024 is real and survives, 29 February 2026 is not and does
   * not, without a leap year ever being written down here.
   */
  const real = (date) => `IF(DATE_ADD(${date}, INTERVAL 0 DAY) = ${date}, ${date}, NULL)`;
  const parsed = (format) => `DATE_FORMAT(${real(`STR_TO_DATE(${expression}, '${format}')`)}, '%Y-%m-%d')`;
  /*
   * `%Y` and never `%y`, and this is not a detail.
   *
   * `%y` reads exactly two digits, so `STR_TO_DATE('09-Sep-2026', '%d-%b-%y')` takes `20` as the
   * year and answers **2020-09-09** - a silently wrong date, which is worse than the NULL this whole
   * module exists to stop. `%Y` reads both widths and applies the same 69/70 pivot to a two-digit
   * one that `fullYear` above does, so one format covers `09-Sep-26` and `09-Sep-2026` and cannot
   * mistake either.
   *
   * `%M` and never `%b` for the same reason of coverage: MySQL's `%M` matches the full month name
   * *and* its abbreviations, "Sept" included, while `%b` matches only the three-letter form. One
   * format, more shapes, and `toIsoDay` above accepts exactly the same set.
   */
  return `COALESCE(
    CASE WHEN ${expression} REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN LEFT(${expression}, 10) END,
    ${parsed("%d/%m/%Y")},
    ${parsed("%d-%m-%Y")},
    ${parsed("%d.%m.%Y")},
    ${parsed("%d-%M-%Y")},
    ${parsed("%d %M %Y")},
    ${parsed("%d/%M/%Y")},
    ${parsed("%M %d, %Y")}
  )`;
}

/** Every lead column that holds a day, and is therefore folded to ISO on the way in. */
const LEAD_DATE_COLUMNS = [
  "createdDate",
  "date",
  "eventPlannedDate",
  "lastFollowUpDate",
  "nextFollowUpDate",
  "lastConvertedDate",
  "dateOfBirthOrEdod",
];

module.exports = { toIsoDay, toClockTime, splitDayAndTime, normalizeDateText, isoDaySqlFor, LEAD_DATE_COLUMNS };
