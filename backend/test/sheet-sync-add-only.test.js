const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildDeletedKeySet,
  matchesDeletedRecord,
} = require("../src/modules/hrm/interview/sheetImport");

/*
 * A linked sheet only ever *adds*.
 *
 * The sheet is where a lead or a candidate arrives; it is not where they live afterwards. Once a
 * row is in the register it is worked on there - a status is set, an interviewer is put on it, a
 * remark is written, a number is corrected - and the sync used to overwrite all of that from the
 * spreadsheet every two minutes, because a matched row was refreshed rather than skipped. Whatever
 * the studio did to a record was undone by the next pass, silently, and the record read as though
 * nobody had touched it.
 *
 * So a matched row is now skipped and counted, and the only rows a sync writes are ones it has
 * never successfully written before: genuinely new rows, and rows that were rejected or failed,
 * which are never recorded as imported and are therefore retried on their own.
 *
 * The delete half of the same promise has two locks, and this pins both: the row ledger, which
 * remembers that a link imported a row, and the deleted records themselves, which recognise the
 * person after the spreadsheet has shifted their row onto a number the ledger never saw.
 *
 * The run functions are read from source, the way the other sheet tests here do - they are a
 * database apart from a unit test, and what is pinned is which cases the code distinguishes.
 */

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", "modules", ...parts), "utf8");
const CRM = read("sales", "crm-leads", "googleSheetsService.js");
const INTERVIEW = read("hrm", "interview", "sheetSyncService.js");

const slice = (source, from, to) => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + 1);
  assert.ok(start >= 0 && end > start, `could not find the run function between ${from} and ${to}`);
  return source.slice(start, end);
};

const RUNS = [
  ["CRM leads", slice(CRM, "async function runGoogleSheetLinkSync(", "// Wraps the run so a failure is recorded too")],
  ["HRM interview", slice(INTERVIEW, "async function runInterviewSheetSync(", "/** The run, with a failure recorded on the link")],
];

for (const [label, run] of RUNS) {
  test(`${label}: a row already in the register is skipped, never rewritten`, () => {
    assert.match(run, /classification === "EXISTING"/, "the sync no longer recognises a matched row as its own case");
    assert.match(run, /skippedExisting \+= 1/, "a matched row is not being counted as skipped");
    assert.match(run, /action: "SKIPPED_EXISTING"/, "a matched row is not being named as skipped in the actions");
  });

  test(`${label}: a sync writes no updates at all`, () => {
    // The two ways the old behaviour could come back: an UPDATED action, or a summary still
    // claiming a count of updates for a pass that can no longer make one.
    assert.doesNotMatch(run, /action: "UPDATED"/, "a sync is writing updates again");
    assert.doesNotMatch(run, /\bupdated\b\s*[,:+]/, "the summary is reporting updates a sync can no longer make");
  });

  test(`${label}: every row a pass declined to write is accounted for`, () => {
    // Otherwise a sheet whose rows are all already here reports a sync that touched nothing and
    // explains none of it - indistinguishable from a sync that is quietly broken.
    assert.match(run, /skipped: skippedExisting \+|skipped: totals\.skippedExisting \+/, "skipped rows no longer add up to the reported total");
  });
}

test("a deleted record is recognised by any identity it held, not only by its row", () => {
  /*
   * The ledger keys a row by its source row id, which for a sheet carrying no id column of its own
   * is `…:row:<n>` - its row number. Insert a row near the top of the spreadsheet and every row
   * below shifts down one, arrives under a key the ledger has never seen, and somebody the studio
   * deleted is created again. Phone and email do not shift, so they are asked too.
   */
  const deleted = buildDeletedKeySet([
    { phone: "+91 98765 43210", email: "Asha@Example.com ", sourceRowId: "sheet1:row:7" },
  ]);

  const movedRow = {
    candidate: { phone: "098765 43210", email: "" },
    details: { sourceRowId: "sheet1:row:8" },
  };
  assert.equal(matchesDeletedRecord(movedRow, deleted), true, "a deleted candidate came back when their row shifted");

  const byEmailAlone = { candidate: { phone: "", email: "asha@example.com" }, details: { sourceRowId: "sheet1:row:99" } };
  assert.equal(matchesDeletedRecord(byEmailAlone, deleted), true, "a deleted candidate came back under a new number");

  const byLedgerKeyAlone = { candidate: {}, details: { sourceRowId: "sheet1:row:7" } };
  assert.equal(matchesDeletedRecord(byLedgerKeyAlone, deleted), true, "the source row id is no longer an identity of its own");

  const genuinelyNew = {
    candidate: { phone: "+91 90000 00001", email: "new@example.com" },
    details: { sourceRowId: "sheet1:row:7000" },
  };
  assert.equal(matchesDeletedRecord(genuinelyNew, deleted), false, "a new arrival is being mistaken for a deleted one");
});

test("an empty or unreadable set of deleted records never matches a row", () => {
  // `null` is the unreadable case. It must not read as "this row is deleted" here - the callers
  // withhold every new row on `null` explicitly, which is a decision that belongs with them.
  assert.equal(matchesDeletedRecord({ candidate: { phone: "9876543210" } }, null), false);
  assert.equal(matchesDeletedRecord({ candidate: { phone: "9876543210" } }, new Set()), false);
  // A row carrying no identity at all cannot match somebody who carried none either.
  assert.equal(matchesDeletedRecord({ candidate: {}, details: {} }, buildDeletedKeySet([{ phone: "", email: "" }])), false);
});

test("both syncs ask the deleted records, not only the ledger", () => {
  for (const [label, source] of [["CRM leads", CRM], ["HRM interview", INTERVIEW]]) {
    assert.match(source, /matchesDeletedRecord\(/, `${label}: the deleted records are no longer consulted`);
    // The unreadable case withholds new rows rather than refilling a cleared board.
    assert.match(source, /deletedKeys === null/, `${label}: an unreadable tombstone set no longer withholds new rows`);
  }
});

test("the older whole-sheet refresh is add-only too, and cannot resurrect a deleted lead", () => {
  /*
   * `refreshCrmLeadsFromSheets` predates the link sync and does none of its work - no
   * classification, no ledger, no summary - so it upserted every row of every active sheet
   * unconditionally. It is reached by `POST /api/sales/crm-leads/refresh` and, worse, by
   * `listCrmLeads()` when the lead table comes back **empty**: delete every lead, open CRM Leads,
   * and the whole spreadsheet was written back with `deleted_at` cleared. The add-only rule has to
   * be stated again here because there is nothing for it to inherit.
   */
  const fn = CRM.slice(CRM.indexOf("async function refreshCrmLeadsFromSheets("));
  const body = fn.slice(0, fn.indexOf("\nasync function syncCrmLeadLink("));
  assert.match(body, /const alreadyHere = existingById\.has/, "a lead already here is being refreshed again");
  assert.match(body, /matchesDeletedRecord\(record, deletedKeys\)/, "a deleted lead can be resurrected by this path");
  assert.match(body, /deletedKeys === null/, "an unreadable tombstone set no longer withholds rows here");
  // The guard has to come *before* the write, or it guards nothing.
  const guard = body.indexOf("if (alreadyHere ||");
  const write = body.indexOf("await upsertRecord(record);");
  assert.ok(guard !== -1 && write !== -1 && guard < write, "the row is written before the add-only guard runs");
});
