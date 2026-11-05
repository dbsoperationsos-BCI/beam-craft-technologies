const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Deleting a lead a sheet is syncing has to mean something.
 *
 * The sync decided what a row was by looking for its lead: found, an edit; not found, new. Those
 * are two answers to three questions, and the missing one is the studio's. A row whose lead had
 * been *deleted* looked exactly like a row nobody had ever imported, so it was imported again on
 * the next pass - two minutes later, under a fresh id, onto the board that had just been cleared.
 *
 * It was worse under the soft delete this replaced: the upsert ends `deleted_at = NULL`, so where
 * the sheet carried the lead's own Enquiry ID the hidden row was brought back to life under its
 * original id. Either way, deleting a synced lead was not an act a person could complete.
 *
 * `sales_google_sheet_row` is the memory that outlives the lead. Read from the source, the way the
 * other sheet tests here do: what is pinned is which of the three cases the code distinguishes.
 */

const SERVICE = fs.readFileSync(
  path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", "googleSheetsService.js"),
  "utf8",
);
const SCHEMA = fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");

test("the ledger is keyed so one row per sheet row, per link, is the most it can hold", () => {
  /*
   * Without the unique key a sync that ran twice would write the row twice and the set it is read
   * into would still answer the same - the fault would only show as a table growing by a row per
   * pass per sheet, which is the growth this whole area was cleaned up for.
   */
  assert.match(SCHEMA, /model SalesGoogleSheetRow \{/, "the sheet-row ledger is gone");
  assert.match(SCHEMA, /@@unique\(\[linkId, rowKey\]/, "the ledger allows the same row twice");
  const migration = fs.readFileSync(
    path.join(__dirname, "..", "prisma", "migrations", "20260912120000_google_sheet_row_ledger", "migration.sql"),
    "utf8",
  );
  assert.match(migration, /UNIQUE INDEX `sales_google_sheet_row_link_key` \(`link_id`, `row_key`\)/);
});

test("a row is remembered by the identity the importer already uses", () => {
  /*
   * Not a second idea of what a row is. `sourceEnquiryId` is the sheet's own Enquiry ID where it
   * has one and `<spreadsheet>:<tab>:row:<n>` where it does not - the same value stored on the
   * lead - so the ledger and the lead cannot disagree about which row made which record.
   */
  assert.match(SERVICE, /function importedRowKey\(record\) \{\s*return String\(record\?\.details\?\.sourceEnquiryId \|\| ""\)\.trim\(\);/);
});

test("a deleted row stays deleted, and only a row with no lead is ever held back", () => {
  /*
   * Held back means *this* row will not be created. It is asked only of a row with no live lead,
   * because a row that still has one is skipped by the `EXISTING` branch anyway - a sync no longer
   * writes over a lead already in the CRM at all, see `sheet-sync-add-only`. Gating an existing row
   * on the ledger as well would only confuse which of the two reasons a row was skipped for.
   */
  assert.match(SERVICE, /const alreadyImported = classification\.classification === "NEW"/,
    "the ledger is being consulted for rows that already have a lead");
  assert.match(SERVICE, /importedRowKeys === null/, "an unreadable ledger no longer withholds new rows");
  assert.match(SERVICE, /\(rowKey && importedRowKeys\.has\(rowKey\)\)/, "the ledger is no longer keyed on the row");
  assert.match(SERVICE, /if \(classification === "ALREADY_IMPORTED"\) \{[\s\S]*?skippedDeleted \+= 1;[\s\S]*?continue;/,
    "an already-imported row is written anyway");
});

test("an unreadable ledger holds the board still rather than refilling it", () => {
  /*
   * `loadImportedRowKeys` answers `null`, never an empty set, when the table cannot be read - and
   * `null` withholds every new row. The other way round, one transient database error during a
   * poll would re-import an entire sheet over a board somebody had just cleared. A sync that adds
   * nothing is recoverable on the next pass; that is not.
   */
  const fn = SERVICE.slice(SERVICE.indexOf("async function loadImportedRowKeys("));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.match(body, /return null;/, "an unreadable ledger no longer says so");
  assert.doesNotMatch(body.slice(body.indexOf("catch")), /new Set\(\)/, "an unreadable ledger falls back to 'nothing imported'");
});

test("a row is only remembered once its lead is actually written", () => {
  // Recorded before the insert, a failed write would leave the row marked imported - and therefore
  // skipped for good, which is a lead the sheet can never deliver again.
  const run = SERVICE.slice(SERVICE.indexOf("async function runGoogleSheetLinkSync("));
  const body = run.slice(0, run.indexOf("\n}\n"));
  const created = body.indexOf("created += 1;");
  const recorded = body.indexOf("recordImportedRow(");
  assert.ok(created !== -1 && recorded !== -1, "the create path no longer records the row");
  assert.ok(recorded > created, "the row is recorded before the lead is written");
});

test("held-back rows are counted in the summary, not dropped quietly", () => {
  // A pass that declines nine rows and says it touched nothing is a pass nobody can explain.
  assert.match(SERVICE, /skipped: skippedExisting \+ skippedDuplicate \+ skippedInvalid \+ skippedDeleted/);
  assert.match(SERVICE, /^\s*skippedDeleted,$/m, "the summary does not report the held-back rows on their own");
  assert.match(SERVICE, /alreadyImportedRows: deletedCount/, "the preview does not report them either");
});
