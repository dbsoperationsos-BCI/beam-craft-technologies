const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  resolveColumnMapping,
  mapRowToCrmCandidate,
  createLeadIdAllocator,
} = require("../src/modules/sales/crm-leads/googleSheetsService");

/*
 * What numbers a row when a Google Sheet is linked.
 *
 * `mapRowToCrmCandidate` takes an *allocator* - the object `createLeadIdAllocator` builds, which
 * hands out `DBS-EID-QQ-ERD-000001` and counts on in memory so a sheet of a thousand rows costs no
 * round trips. Its fifth parameter used to be a plain `Set` of the ids already taken, and when it
 * became the allocator one caller was left behind: `prepareGoogleSheetCrmImport` still passed the
 * Set. It backs both the dry-run preview and the sync that runs the moment a sheet is linked, so
 * every import through the Settings dialog died on `leadIds.next is not a function` and the studio
 * saw "Sheet linked, but the import failed" - the link saved, importing nothing, forever.
 */

const SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", "googleSheetsService.js"),
  "utf8",
);

const HEADERS = ["Enquiry Name", "Phone Number", "Enquiry Date", "Assigned Branch"];
const LINK = { vertical: "Qua Qua", spreadsheetId: "sheet-1", targetedTab: "Leads" };

const mapRow = (values, rowNumber, leadIds) =>
  mapRowToCrmCandidate(
    values,
    { ...resolveColumnMapping(HEADERS, "Qua Qua"), headers: HEADERS },
    LINK,
    rowNumber,
    leadIds,
    new Map(),
    new Map(),
  );

test("a sheet row is numbered by the allocator, and each row gets its own id", () => {
  const leadIds = createLeadIdAllocator();
  const first = mapRow(["Anitha", "9876543210", "2026-08-24", "Erode"], 2, leadIds);
  const second = mapRow(["Bala", "9876500000", "2026-08-25", "Erode"], 3, leadIds);

  assert.match(first.record.lead.id, /^DBS-EID-QQ-ERD-\d{6}$/);
  assert.notEqual(
    first.record.lead.id,
    second.record.lead.id,
    "two new rows were handed the same enquiry id, so a batch collapses onto one lead",
  );
});

test("the import preview and sync hand the row mapper an allocator, not a set of taken ids", () => {
  /*
   * `prepareGoogleSheetCrmImport` is not worth standing a spreadsheet up for, so its call is pinned
   * here instead. A `Set` satisfies no part of the allocator's contract - it has no `next` - and
   * this is the exact substitution that shipped.
   */
  const prepare = SOURCE.slice(
    SOURCE.indexOf("async function prepareGoogleSheetCrmImport("),
    SOURCE.indexOf("async function runGoogleSheetLinkSync("),
  );
  assert.ok(prepare, "prepareGoogleSheetCrmImport has been renamed; this pin no longer reads it");
  assert.match(
    prepare,
    /const leadIds = await loadLeadIdAllocator\(/,
    "the sheet import no longer builds an id allocator of its own",
  );
  assert.match(
    prepare,
    /sheetRow\.rowNumber,\s*\n\s*leadIds,/,
    "the row mapper is being handed something other than the allocator again",
  );
  assert.doesNotMatch(
    prepare,
    /allocatedIds/,
    "the Set of taken ids is back, and the row mapper cannot call `.next()` on it",
  );
});

test("the counter is lifted only after rows are written, so a preview burns no ids", () => {
  /*
   * `commit` raises the shared sequence to wherever the run reached, which is what stops the next
   * Add Lead save being handed an id a sheet row has just taken. It belongs to the run that writes:
   * the preview route calls the same prepare, and committing there would spend a block of ids on a
   * sheet nobody went on to import.
   */
  const run = SOURCE.slice(
    SOURCE.indexOf("async function runGoogleSheetLinkSync("),
    SOURCE.indexOf("async function syncGoogleSheetLinkToCrm("),
  );
  assert.match(run, /preview\.leadIds\?\.commit\(\)/, "a sync run no longer commits the id counter");

  const prepare = SOURCE.slice(
    SOURCE.indexOf("async function prepareGoogleSheetCrmImport("),
    SOURCE.indexOf("async function runGoogleSheetLinkSync("),
  );
  assert.doesNotMatch(
    prepare,
    /leadIds\.commit\(\)/,
    "the preview commits the counter, spending ids on an import that may never run",
  );
});

/*
 * What a sheet's **Added Time** column is.
 *
 * It is a clock time - "10:57 am" - and not a date. `added_time` is free text, Add Lead writes it
 * with `toLocaleTimeString`, and the CRM board filters it as a time (`TIME_FILTER_COLUMNS`) and
 * renders it through `formatAddedTime`. The sheet importer's validator nevertheless listed it among
 * its date fields, so `new Date("10:57 am")` came back NaN and marked the row invalid. Every row of
 * a Dum Dum Instagram sheet carries that column, so the sync that finally ran reported
 * "0 created, 0 updated, 32 skipped" - a whole sheet rejected over the one column that was right.
 */

test("a row is not rejected for an Added Time that is a clock time, which is all it ever is", () => {
  const headers = ["Enquiry Name", "Phone Number", "Enquiry Date", "Added Time", "Nearest Branch"];
  const mapping = { ...resolveColumnMapping(headers, "Dum Dum"), headers };
  const { record } = mapRowToCrmCandidate(
    ["Sreekanth", "9642901785", "2026-09-10", "10:57 am", "Erode"],
    mapping,
    LINK,
    2,
    createLeadIdAllocator(),
    new Map(),
    new Map(),
  );

  assert.equal(record.lead.addedTime, "10:57 am", "the row's Added Time no longer reaches the lead");

  // `validateCandidateRecord` is not exported, so its list is pinned instead.
  const dateFields = SOURCE.match(/const dateFields = \[([^\]]*)\]/);
  assert.ok(dateFields, "validateCandidateRecord no longer has a dateFields list to check");
  assert.doesNotMatch(
    dateFields[1],
    /"addedTime"/,
    'Added Time is being validated as a date again, so every row carrying one is skipped as invalid',
  );
  assert.match(dateFields[1], /"createdDate"/, "the real date columns stopped being validated");
});

test("a sheet's dates are folded to ISO on the way in, as every other writer folds them", () => {
  /*
   * `created_day`, `follow_up_day` and `dob_edod_day` are stored generated columns whose expression
   * understands ISO and `DD/MM/YYYY` and nothing else. `flattenLeadColumns` exists so nothing ever
   * writes a shape they cannot read - and its own note lists "the Google Sheet sync" among the
   * writers that go through it. It did not: `upsertCrmLeadRow` here builds its own payload and
   * writes raw SQL, so a sheet carrying Excel's `10-Sep-26` stored it verbatim, leaving
   * `follow_up_day` and `dob_edod_day` NULL and `created_day` falling through its COALESCE to the
   * row's insert timestamp - every row of the import filed under the day the sync ran.
   */
  const { normalizeDateText, LEAD_DATE_COLUMNS } = require("../src/modules/sales/crm-leads/leadDates");
  assert.equal(normalizeDateText("10-Sep-26"), "2026-09-10", "the shared date reader stopped reading Excel's shape");
  assert.ok(LEAD_DATE_COLUMNS.includes("createdDate"));

  const upsert = SOURCE.slice(
    SOURCE.indexOf("async function upsertCrmLeadRow("),
    SOURCE.indexOf("async function ensureSyncHistoryTable("),
  );
  assert.match(
    upsert,
    /for \(const column of LEAD_DATE_COLUMNS\)[\s\S]*normalizeDateText\(data\[column\]\)/,
    "the sheet upsert writes its dates through again without folding them to ISO",
  );
});

test("an Added Time is left exactly as the sheet wrote it, being no kind of date", () => {
  const { normalizeDateText, LEAD_DATE_COLUMNS } = require("../src/modules/sales/crm-leads/leadDates");
  assert.equal(normalizeDateText("10:57 am"), "10:57 am", "a clock time was rewritten as though it were a date");
  assert.ok(
    !LEAD_DATE_COLUMNS.includes("addedTime"),
    "addedTime is listed as a date column, so the fold would run over a clock time",
  );
});

/*
 * A sheet that states the enquiry as one stamp.
 *
 * `created_date` and `added_time` are stored apart, so `10-Sep-26 10:57 am` in a single Enquiry
 * Date column has to be read as both. The two halves of `leadDates` also disagreed about such a
 * cell: MySQL's `STR_TO_DATE` ignores whatever trails its format, so `isoDaySqlFor` read it as the
 * 10th all along while `toIsoDay` refused it outright - the SQL and the JavaScript answering
 * differently for the same value, which is what that module exists to prevent.
 */

test("an Enquiry Date that carries a time is read as both the day and the time", () => {
  const { toIsoDay, toClockTime } = require("../src/modules/sales/crm-leads/leadDates");
  for (const stamp of ["10-Sep-26 10:57 am", "2026-09-10 10:57:00", "2026-09-10T10:57:00", "Sep 10, 2026 10:57 am"]) {
    assert.equal(toIsoDay(stamp), "2026-09-10", `${stamp} was not read as the 10th`);
    assert.equal(toClockTime(stamp), "10:57 am", `${stamp} gave up no time`);
  }
  // A 24-hour stamp lands on the 12-hour clock the rest of the CRM reads.
  assert.equal(toClockTime("10/09/2026 17:49"), "05:49 pm");
  // A bare date still states no time, and a date alone still parses exactly as it did.
  assert.equal(toClockTime("10-Sep-26"), "");
  assert.equal(toIsoDay("10-Sep-26"), "2026-09-10");
});

test("a time is taken off a date cell only where the cell really is a date", () => {
  const { toIsoDay, normalizeDateText } = require("../src/modules/sales/crm-leads/leadDates");
  // A note somebody left in the wrong column is not a date and must not become one.
  assert.equal(toIsoDay("call back at 10:57"), "");
  assert.equal(normalizeDateText("call back at 10:57"), "call back at 10:57", "a note was rewritten");
  // Nor is a time nobody meant.
  assert.equal(toIsoDay("10-Sep-26 13:00 pm"), "");
  assert.equal(toIsoDay("10-Sep-26 10:75"), "");
});

test("a stamped Enquiry Date fills Added Time, and a real Added Time column still wins", () => {
  const run = (headers, values) => {
    const mapping = { ...resolveColumnMapping(headers, "Dum Dum"), headers };
    return mapRowToCrmCandidate(values, mapping, LINK, 2, createLeadIdAllocator(), new Map(), new Map()).record.lead;
  };

  const stamped = run(["Enquiry Date", "Enquiry Name", "Phone Number"], ["10-Sep-26 10:57 am", "Sreekanth", "9642901785"]);
  assert.equal(stamped.addedTime, "10:57 am", "a sheet with one stamp column left the lead with no Added Time");

  const both = run(["Enquiry Date", "Added Time", "Enquiry Name", "Phone Number"], ["10-Sep-26 10:57 am", "11:30 am", "Sreekanth", "9642901785"]);
  assert.equal(both.addedTime, "11:30 am", "the row's own Added Time column stopped winning");

  const note = run(["Enquiry Date", "Enquiry Name", "Phone Number"], ["call back at 10:57", "Sreekanth", "9642901785"]);
  assert.equal(note.addedTime, "", "a note in the date cell was read as an Added Time");
});

test("one sheet may mix both shapes, row by row", () => {
  /*
   * The two ways of stating an enquiry are not a setting on the link and not a property of the
   * sheet - they are read per row, so a studio that keeps **Enquiry Date** and **Added Time** side
   * by side and one that puts the whole stamp in the date cell are both right, and a sheet halfway
   * through changing from one to the other imports correctly the whole way.
   */
  const headers = ["Enquiry Date", "Added Time", "Enquiry Name", "Phone Number"];
  const mapping = { ...resolveColumnMapping(headers, "Dum Dum"), headers };
  const leadIds = createLeadIdAllocator();
  const run = (values) =>
    mapRowToCrmCandidate(values, mapping, LINK, 2, leadIds, new Map(), new Map()).record.lead;

  const separate = run(["10-Sep-26", "10:57 am", "Two columns", "9000000001"]);
  assert.equal(separate.createdDate, "10-Sep-26");
  assert.equal(separate.addedTime, "10:57 am", "a row stating the two separately lost its time");

  const stamped = run(["10-Sep-26 11:06 am", "", "Stamped, time cell empty", "9000000002"]);
  assert.equal(stamped.addedTime, "11:06 am", "an empty Added Time cell did not fall back to the stamp");

  const both = run(["10-Sep-26 11:06 am", "11:30 am", "Both stated", "9000000003"]);
  assert.equal(both.addedTime, "11:30 am", "the row's own Added Time column stopped winning");

  const neither = run(["10-Sep-26", "", "Date only", "9000000004"]);
  assert.equal(neither.addedTime, "", "a row stating no time was given one from somewhere");
});
