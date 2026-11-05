import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * A date column holding something that is not a date, and the calendar opened on it.
 *
 * The studio's date columns are free text, filled for years from spreadsheets, so a lead's
 * `next_follow_up_date` can read `#N/A` or `20sept2026`. `parseDateKey` used to hand those to
 * `new Date("#N/AT00:00:00")`, which is an **Invalid Date**: an object, so truthy, so it became
 * the panel's opening month and every `getFullYear()`/`getMonth()` in the header read `NaN`. The
 * calendar showed "NaN, NaN" over an empty grid, with no day to pick - the field dead for exactly
 * the lead somebody had opened it to fix.
 *
 * The data is deliberately left alone: nothing here is repaired by a migration, because the next
 * import would put it straight back and because `DD/MM/YYYY` - a value the database parses and the
 * follow-up board counts - was showing `NaN, NaN` for the same reason and must not be deleted to
 * fix it. The component is what learned to read them.
 *
 * `parseDateKey` is lifted out of the source and run for real, rather than asserted as text: it is
 * a pure function, and what is worth pinning is what it answers.
 */

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");
const PANEL = read("components", "shared", "CalendarPanel.js");
const FIELD = read("components", "shared", "DateField.js");

const CLOSE = "  return null;\n};";
const start = PANEL.indexOf("const DATE_KEY");
const end = PANEL.indexOf(CLOSE, start) + CLOSE.length;
assert.ok(start > 0 && end > start, "parseDateKey and its helpers must be liftable from the source");
const source = PANEL.slice(start, end).replace(/^export /gm, "");
const { parseDateKey } = new Function(`${source}\nreturn { parseDateKey };`)();

/** What the panel actually does with the answer: `selectedDate || opensOn()`. */
const opensOnToday = (value) => parseDateKey(value) === null;

test("the values that put NaN in the header answer null", () => {
  // Real values off the leads table. None is a date, and none may reach `new Date` as one.
  for (const junk of ["#N/A", "20sept2026", "N/A", "-", "TBD", "not a date", "2026", "sept 2026"]) {
    assert.equal(parseDateKey(junk), null, `${junk} must not open a calendar`);
    assert.ok(opensOnToday(junk), `${junk} must leave the grid on today`);
  }
});

test("it never answers an Invalid Date, whatever it is given", () => {
  /*
   * The whole defect in one assertion. An Invalid Date is truthy, so every caller that guards with
   * `selectedDate || ...` is fooled by one; `null` is the only refusal that survives that idiom.
   */
  for (const value of ["#N/A", "20sept2026", "", "   ", null, undefined, "2026-02-31", "31/04/2026", {}, []]) {
    const parsed = parseDateKey(value);
    assert.ok(parsed === null || !Number.isNaN(parsed.getTime()), `${String(value)} answered an Invalid Date`);
  }
});

test("a date key still opens on its own day, at local midnight", () => {
  const parsed = parseDateKey("2026-09-20");
  assert.equal(parsed.getFullYear(), 2026);
  assert.equal(parsed.getMonth(), 8);
  assert.equal(parsed.getDate(), 20);
  // Local, not UTC: a UTC midnight is the previous day for anybody behind Greenwich, which would
  // show the calendar sitting on the 19th for a lead scheduled on the 20th.
  assert.equal(parsed.getHours(), 0);
});

test("a key with a time after it is still that day", () => {
  // `DateField` passes the date half alone, but `minDate`/`maxDate` and the CRD document's stored
  // values carry a `T`, and the generated column matches on the same prefix.
  assert.equal(parseDateKey("2026-09-20T22:30").getDate(), 20);
});

test("DD/MM/YYYY is read day-first, not month-first", () => {
  /*
   * Not junk: it is the second shape `sales_crm_lead.follow_up_day` parses, so the board and the
   * follow-up tabs already treat these leads as scheduled. Refusing it would have been the
   * calendar disagreeing with the database about a date they both hold - and nulling it in the
   * database to "fix" the NaN would have deleted live follow-ups.
   */
  const parsed = parseDateKey("09/10/2026");
  assert.equal(parsed.getDate(), 9, "the leading pair is the day");
  assert.equal(parsed.getMonth(), 9, "October, not September");
  assert.equal(parsed.getFullYear(), 2026);
});

test("a date of the right shape that is no real day is refused", () => {
  /*
   * `new Date(2026, 1, 31)` rolls forward into March rather than refusing, so shape-matching alone
   * would have opened the calendar on a day the value does not name. February is counted properly,
   * leap year and all.
   */
  for (const impossible of ["2026-02-31", "2026-13-01", "31/04/2026", "29/02/2025", "00/01/2026"]) {
    assert.equal(parseDateKey(impossible), null, `${impossible} is not a day`);
  }
  assert.equal(parseDateKey("29/02/2024").getDate(), 29, "a real leap day is kept");
});

test("an empty value is still an empty value", () => {
  // Unchanged behaviour, and the reason the refusal is spelled `null`: this is what "no date yet"
  // has always answered, and an unreadable value now joins it rather than becoming a third state.
  for (const empty of ["", "   ", null, undefined]) assert.equal(parseDateKey(empty), null);
});

test("the field goes on showing the value it cannot read", () => {
  /*
   * The text is the record's own data. Blanking it on screen would be the field deciding what the
   * row says, and would hide the very value somebody needs to see to know what to replace.
   */
  assert.match(FIELD, /const unrecognisedFormat = Boolean\(String\(value \?\? ""\)\.trim\(\)\) && parseDateKey\(datePart\) === null;/);
  assert.match(FIELD, /displayValue\(value, withTime\) \|\| placeholder/);
  assert.doesNotMatch(FIELD, /unrecognisedFormat \?\s*""/, "the value is never swapped for an empty string");
});

test("it is flagged as an unrecognised format, and the caller's own error still wins", () => {
  // An error passed in is about the answer being given now, which matters more than the shape of
  // the one already sitting there - so it takes the line, and the amber note stands down.
  assert.match(FIELD, /Unrecognised date format/);
  assert.match(FIELD, /\{error\s*\n\s*\? <p role="alert"[\s\S]*?\n\s*: unrecognisedFormat && <p/);
  assert.match(FIELD, /error \? "border-red-400[^"]*" : unrecognisedFormat \? "border-amber-400/);
});

test("a read-only field is not told to pick a day", () => {
  // There is no calendar to open on one, so the half of the sentence offering a fix is dropped.
  assert.match(FIELD, /readOnly \? "\." : " — pick a date to replace it\."/);
});

test("a value that merely starts with a T is still flagged", () => {
  /*
   * `splitDateTime` cuts on the `T` that separates a date from a time, so `"TBD".split("T")` gives
   * an **empty** date half - and a check written against `datePart` read those as a field nobody
   * had answered yet, showing no notice at all. The calendar was right either way, opening on
   * today; it was the warning that went missing, on exactly the placeholder text somebody is most
   * likely to have left in a date column. Measured against the whole value instead.
   */
  assert.match(FIELD, /Boolean\(String\(value \?\? ""\)\.trim\(\)\)/);
  assert.doesNotMatch(FIELD, /const unrecognisedFormat = Boolean\(datePart\)/);
  // And an empty value is still not flagged - it is unanswered, not wrong.
  assert.match(FIELD, /Boolean\(String\(value \?\? ""\)\.trim\(\)\) &&/);
});
