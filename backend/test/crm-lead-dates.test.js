const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const prisma = require("../src/config/db");
const { toIsoDay, normalizeDateText, isoDaySqlFor } = require("../src/modules/sales/crm-leads/leadDates");
const { flattenLeadColumns } = require("../src/modules/sales/crm-leads/crmLeadService");

/*
 * What counts as a day, on both sides of the wire.
 *
 * A lead's dates are text. The application understood `YYYY-MM-DD` and `DD/MM/YYYY` and nothing
 * else, and Excel's short date is `09-Sep-26` - so a studio importing its own exported CSV stored
 * dates that no reader could parse. The damage was not one cell: `follow_up_day` and `dob_edod_day`
 * are stored generated columns computed from that same narrow rule, so they came out NULL and the
 * lead was in no Today or Yesterday Pending tab and in neither Newborns nor Birthdays.
 */

const SAMPLES = JSON.parse(fs.readFileSync(path.join(__dirname, "lead-date-samples.json"), "utf8")).samples;

test("the JavaScript reading of a lead's date", () => {
  for (const [text, expected] of Object.entries(SAMPLES)) {
    assert.equal(toIsoDay(text), expected, `toIsoDay(${JSON.stringify(text)})`);
  }
});

test("the SQL reading of a lead's date answers exactly the same, in MySQL", async () => {
  /*
   * Run against the real database rather than asserted as a string, because the two disagreed in
   * ways only MySQL could reveal: `STR_TO_DATE('09-Sep-2026', '%d-%b-%y')` reads `20` as the year
   * and answers **2020**-09-09. A silently wrong date is worse than the NULL this module replaced,
   * and no amount of reading the SQL would have shown it.
   */
  for (const [text, expected] of Object.entries(SAMPLES)) {
    const literal = `'${text.replace(/'/g, "''")}'`;
    const [row] = await prisma.$queryRawUnsafe(`SELECT ${isoDaySqlFor(literal)} AS day`);
    assert.equal(row.day || "", expected, `SQL for ${JSON.stringify(text)}`);
  }
});

test("nothing that already parsed is reinterpreted", () => {
  // Every shape added below ISO is a widening. A value that resolved before resolves to the same
  // day, or the change silently moved leads between tabs.
  assert.equal(toIsoDay("2026-09-09"), "2026-09-09");
  assert.equal(toIsoDay("09/09/2026"), "2026-09-09");
  // Day before month, which is what `DD/MM/YYYY` already decided for this application.
  assert.equal(toIsoDay("01/02/2026"), "2026-02-01");
  assert.equal(toIsoDay("01-02-2026"), "2026-02-01");
});

test("a value that is not a date is kept, not discarded", () => {
  // `normalizeDateText` is what the write path folds through, and it must never destroy what it
  // cannot read - a note or a half-typed date is the author's, and losing it is worse than a blank.
  assert.equal(normalizeDateText("09-Sep-26"), "2026-09-09");
  assert.equal(normalizeDateText("ask the bride"), "ask the bride");
  assert.equal(normalizeDateText("  2026-09-09  "), "2026-09-09");
  assert.equal(normalizeDateText(""), "");
});

test("every date written to a lead is folded to ISO, whichever path wrote it", () => {
  /*
   * `flattenLeadColumns` is the one object every INSERT and UPDATE takes its values from - Add Lead,
   * Import Leads, the CSV import, the sheet sync and the API alike - so folding here is what keeps
   * the schema's own generated columns from ever seeing a shape they cannot read. Without it the fix
   * would need a migration that rebuilds the table to widen three STORED columns.
   */
  const columns = flattenLeadColumns({
    lead: {
      name: "Anitha",
      createdDate: "09-Sep-26",
      date: "9/9/26",
      eventPlannedDate: "09-Sep-2026",
      dateOfBirthOrEdod: "Sep 9, 2026",
    },
    details: {
      lastFollowUpDate: "09-Sep-26",
      nextFollowUpDate: "09-Sept-26",
      lastConvertedDate: "9 September 2026",
    },
  });

  for (const field of ["createdDate", "date", "eventPlannedDate", "dateOfBirthOrEdod", "lastFollowUpDate", "nextFollowUpDate", "lastConvertedDate"]) {
    assert.equal(columns[field], "2026-09-09", `${field} was written in a shape the generated columns cannot read`);
  }
  // A clock time is not a date and is left exactly as it is.
  assert.equal(flattenLeadColumns({ lead: { addedTime: "11:34 am" }, details: {} }).addedTime, "11:34 am");
});

test("the board's tabs and the Enquiry Date column read one expression", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", "leadQueryService.js"), "utf8");
  assert.match(source, /function isoDayOf\(expression\) \{\s*return isoDaySqlFor\(expression\);/);
});

test.after(async () => { await prisma.$disconnect(); });
