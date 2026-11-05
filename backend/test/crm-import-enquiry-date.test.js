const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { resolveColumnMapping, mapRowToCrmCandidate } = require("../src/modules/sales/crm-leads/googleSheetsService");

/*
 * What dates an imported lead.
 *
 * Every tab on the CRM board - Today New Leads, Yet to connect, the Status pill's Inactive, and the
 * header's date range - is read from the lead's own Enquiry Date (`leadQueryService.js`, and
 * `crm-date-range.test.js` holds the whole board to that one expression). So what a file or a sheet
 * says a lead's date is decides which day it is filed under, and stamping today over it puts a whole
 * import into today's tabs however old the enquiries are. That is the fault these pin.
 */

const SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", "googleSheetsService.js"),
  "utf8",
);

const HEADERS = ["Enquiry Name", "Phone Number", "Enquiry Date", "Assigned Branch"];
const row = (name, phone, date, branch) => [name, phone, date, branch];

test("an imported row keeps the date its file states, rather than the day it was imported", () => {
  const mapping = resolveColumnMapping(HEADERS);
  const { record } = mapRowToCrmCandidate(row("Anitha", "9876543210", "2026-08-24", "Erode"), mapping, {}, 2);
  assert.equal(
    record.lead.createdDate,
    "2026-08-24",
    "the row's own Enquiry Date was replaced with the day the import ran",
  );
});

test("a row that states no date falls back to the day it was imported, which is all that is left", () => {
  const mapping = resolveColumnMapping(HEADERS);
  const { record } = mapRowToCrmCandidate(row("Anitha", "9876543210", "", "Erode"), mapping, {}, 2);
  assert.match(
    record.lead.createdDate,
    /^\d{4}-\d{2}-\d{2}$/,
    "a row nothing dates is left with no date at all, so no tab can file it",
  );
});

test("the sheet sync dates a row exactly as the CSV import does", () => {
  /*
   * There are two mappers over the same columns: `mapRowToCrmCandidate`, which the CSV path uses and
   * which the two tests above exercise, and `buildRecordFromRow`, which the Google Sheet import and
   * the recurring sync use. `buildRecordFromRow` is not exported, so its line is pinned here.
   *
   * They disagreed. The sync's mapper read `existing?.lead?.createdDate || importDateKey()` and left
   * `lead.createdDate` - the sheet's own Created Date / Enquiry Date column - out of the chain, so
   * the same spreadsheet kept its dates when imported as a file and had every row stamped with the
   * day the sync ran when linked. Whichever way a studio brings a year of old enquiries in, they are
   * that year's enquiries.
   */
  const sync = SOURCE.slice(SOURCE.indexOf("function buildRecordFromRow("));
  assert.match(
    sync,
    /createdDate: existing\?\.lead\?\.createdDate \|\| lead\.createdDate \|\| importDateKey\(\),/,
    "the sheet sync no longer reads the row's own date",
  );
});

test('a column headed "Enquiry Date" reaches a column the database actually has', () => {
  /*
   * `mapHeaderToLeadKey` resolved it to `enquiryDate`, which is what the *board* calls the cell and
   * not a column any table stores - `crmLeadColumns.js` has `date` and `created_date` and nothing
   * between them. So the heading was matched, read, and thrown away: a sheet whose only date column
   * was "Enquiry Date" imported with no date on any row.
   */
  const columns = fs.readFileSync(
    path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", "crmLeadColumns.js"),
    "utf8",
  );
  const target = SOURCE.match(/enquirydate: "([A-Za-z]+)",/);
  assert.ok(target, "mapHeaderToLeadKey no longer resolves an Enquiry Date heading at all");
  assert.match(
    columns,
    new RegExp(`\\["${target[1]}", "[a-z_]+"\\]`),
    `an Enquiry Date heading is read into "${target[1]}", which no column stores`,
  );
});

test('"When is the Event Planned" may be words, because that is how a client answers it', () => {
  /*
   * It is a question the client answers in their own words on a Meta lead form, and a wedding is
   * two days as often as one: "feb 10 th and 11 th 2027", "March 10,11 2027". The column is `TEXT`
   * and has always held exactly that.
   *
   * Validating it as a single day refused the **whole row** - name, number and all - over a cell
   * that had been answered correctly, so a sheet of new leads imported the ones who left it blank
   * and dropped the rest. The same mistake `addedTime` was taken out of the list for.
   */
  const SERVICE = fs.readFileSync(
    path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", "googleSheetsService.js"),
    "utf8",
  );
  const list = /const dateFields = \[([^\]]*)\]/.exec(SERVICE);
  assert.ok(list, "the validated date fields are gone");
  assert.doesNotMatch(list[1], /eventPlannedDate/, "a row is refused again over a free-text event date");
  // The rest stay refused: "next week" in a follow-up column is a note in the wrong place.
  for (const field of ["createdDate", "lastFollowUpDate", "nextFollowUpDate", "lastConvertedDate", "dateOfBirthOrEdod"]) {
    assert.match(list[1], new RegExp(`"${field}"`), `${field} is no longer validated`);
  }

  /*
   * And it is still folded to a day where the cell is one - through `LEAD_DATE_COLUMNS` on the way
   * to the database, which leaves anything else exactly as written. So a real date still sorts and
   * filters as one, and a client's own answer is kept rather than costing the studio the lead.
   */
  const { normalizeDateText, LEAD_DATE_COLUMNS } = require("../src/modules/sales/crm-leads/leadDates");
  assert.ok(LEAD_DATE_COLUMNS.includes("eventPlannedDate"), "the column is no longer normalised at all");
  assert.equal(normalizeDateText("10-Feb-2027"), "2027-02-10");
  assert.equal(normalizeDateText("feb 10 th and 11 th 2027"), "feb 10 th and 11 th 2027");
});
