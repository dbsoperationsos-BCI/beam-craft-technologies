import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { toIsoDay, normalizeDateText } from "../src/lib/crmLeadDates.mjs";

/*
 * The client's reading of a lead's date, held to the server's.
 *
 * The samples are the server's own list, read from its test folder rather than copied here - the
 * two files being one list is the entire point. The client decides what the Enquiry Date column
 * *shows* and the server decides which tab the lead is *in*, so a shape they read differently is a
 * lead shown one date and filed under another. `backend/test/crm-lead-dates.test.js` runs the same
 * list through the SQL, against MySQL.
 *
 * The fault this closes: `09-Sep-26` - Excel's short date, and so what a studio's own exported CSV
 * carries - was not a date to either side. The cell fell through to the row's insert timestamp and
 * printed today on every row of an import.
 */

const SAMPLES = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "..", "..", "backend", "test", "lead-date-samples.json"), "utf8"),
).samples;

test("the client reads every date shape the server does, to the same day", () => {
  for (const [text, expected] of Object.entries(SAMPLES)) {
    assert.equal(toIsoDay(text), expected, `toIsoDay(${JSON.stringify(text)})`);
  }
});

test("day comes before month, as DD/MM/YYYY already decided here", () => {
  assert.equal(toIsoDay("01/02/2026"), "2026-02-01");
  assert.equal(toIsoDay("01-02-2026"), "2026-02-01");
});

test("a value that is not a date is kept rather than blanked", () => {
  assert.equal(normalizeDateText("09-Sep-26"), "2026-09-09");
  assert.equal(normalizeDateText("ask the bride"), "ask the bride");
});

test("the Enquiry Date column and the Status pill both read it", () => {
  /*
   * `leadArrivalDay` is what the cell prints and what the Yet to connect / Inactive pill is derived
   * from. It tested its candidates against `^\d{4}-\d{2}-\d{2}$` and fell through everything an
   * import had written, all the way to the insert timestamp - which is how a whole file came to read
   * today's date in a column that had the real one one field away.
   */
  const page = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "CRMPage.js"), "utf8");
  const arrival = page.slice(page.indexOf("function leadArrivalDay("), page.indexOf("\n}\n", page.indexOf("function leadArrivalDay(")));
  assert.match(arrival, /const stated = toIsoDay\(candidate\);/, "the arrival day is back on a bare ISO test");
  assert.doesNotMatch(arrival, /\.test\(stated\)/, "the arrival day still decides for itself what a date looks like");
  assert.match(page, /import \{ toIsoDay \} from "@\/lib\/crmLeadDates";/);
});
