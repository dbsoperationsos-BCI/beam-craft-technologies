const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * One number, one enquiry within a vertical - on every path, not just the form.
 *
 * The rule already existed and was already the right rule: a second lead on a number the vertical
 * already holds is the same client written down twice, their calls and follow-ups split across two
 * records that neither knows about. It was enforced in exactly two places, `create` and `update`,
 * so three of the five doors into the CRM never asked the question at all - Bulk Entry, the CSV
 * import and the linked Google Sheet. A number refused on the Add Lead form went in without a word
 * through any of them, which is how a sheet lead and a hand-typed lead ended up on one number.
 *
 * Read from source, the way the other CRM sheet tests here are: these paths are a database and a
 * Google connection apart from a unit test, and what is pinned is which questions the code asks.
 */

const src = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", ...parts), "utf8");
const CONTROLLER = src("controller.js");
const CSV = src("csvImportService.js");
const SHEET = src("googleSheetsService.js");

test("Bulk Entry asks the same question the Add Lead form does", () => {
  const fn = CONTROLLER.slice(CONTROLLER.indexOf("async function createBulk("));
  const body = fn.slice(0, fn.indexOf("\nasync function update("));
  assert.match(body, /batchVerticalClashes\(parsed\.data\.records\)/, "Bulk Entry no longer checks for a number the vertical already holds");
  assert.match(body, /DUPLICATE_PHONE_IN_VERTICAL/, "a refused batch is not answered with the code the browser tells this apart by");
  // Before the ids, or a refused batch burns enquiry numbers that read as deletions later.
  const check = body.indexOf("batchVerticalClashes");
  const mint = body.indexOf("nextLeadId(");
  assert.ok(check !== -1 && mint !== -1 && check < mint, "ids are minted before the batch is checked");
});

test("a batch is checked against itself, not only against the database", () => {
  /*
   * Two rows of one paste carrying the same number are both new, so neither is found by a lookup -
   * a per-row check passes both and writes the duplicate it exists to prevent.
   */
  const fn = CONTROLLER.slice(CONTROLLER.indexOf("async function batchVerticalClashes("));
  const body = fn.slice(0, fn.indexOf("\nasync function create("));
  assert.match(body, /seenInBatch/, "rows of the same batch are no longer compared with each other");
  assert.match(body, /findVerticalDuplicate\(/, "rows are no longer compared against the leads already here");
  // Every clash, not the first: a grid is corrected in one pass.
  assert.match(body, /clashes\.push/, "the clashing rows are no longer collected");
  assert.doesNotMatch(body, /return clashes\[0\]/, "only the first clashing row is reported");
});

test("editing a lead is refused only when the write actually changes the number", () => {
  /*
   * `excludeId` stops a lead clashing with itself but not with a second lead already sharing its
   * number - and those exist, written by the three paths that never asked. Guarding an unchanged
   * number would make every such pair uneditable, so the studio could not even open one and
   * correct it, which is the one action that resolves the duplicate.
   */
  const fn = CONTROLLER.slice(CONTROLLER.indexOf("async function update("));
  const body = fn.slice(0, fn.indexOf("\nasync function remove("));
  assert.match(body, /const changingPhone = phoneMatchKey\(phone\) !== phoneMatchKey\(storedPhone\)/, "an edit no longer compares the number against the one already stored");
  assert.match(body, /if \(phone && changingPhone\)/, "an edit that keeps its own number is still being checked, so existing duplicates cannot be corrected");
});

test("the CSV import skips a number the vertical already holds, and says so", () => {
  // Skipped rather than refusing the file: a few rows already being here is ordinary, and throwing
  // away a hundreds-row import over them would mean editing the file by hand to import anything.
  assert.match(CSV, /loadVerticalPhoneKeys\(\)/, "the CSV import no longer reads the numbers already held");
  assert.match(CSV, /duplicates \+= 1/, "duplicate rows are not counted");
  assert.match(CSV, /duplicates,/, "the result no longer reports the duplicates on their own");
  // Both number columns, or a lead whose number lives in Contact Number is missed.
  assert.match(CSV, /`contact_number` AS `contactNumber`/, "only one of the two number columns is read");
});

test("the sheet sync names the rows held back for a number already held", () => {
  for (const [label, source] of [["CRM leads", SHEET], ["HRM interview", fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "interview", "sheetSyncService.js"), "utf8")]]) {
    assert.match(source, /skippedSameContact/, `${label}: rows matched on phone or email are no longer counted apart`);
    assert.match(source, /matchedBy === "phone" \|\| row\.matchedBy === "email"/, `${label}: the count no longer follows how the row was matched`);
  }
});

test("a refused batch names the number, not only the row", () => {
  /*
   * "Row 7 is a duplicate" sends somebody counting down a grid of twenty lines. The number is the
   * thing they have to go and look at, and it is the same piece of news whether the other copy is
   * elsewhere in the batch or already in the CRM - so both clashes carry it.
   */
  const fn = CONTROLLER.slice(CONTROLLER.indexOf("async function batchVerticalClashes("));
  const body = fn.slice(0, fn.indexOf("\nasync function create("));
  const pushes = [...body.matchAll(/clashes\.push\(\{[\s\S]*?\}\);/g)].map((match) => match[0]);
  assert.equal(pushes.length, 2, "the batch no longer reports both kinds of clash");
  for (const push of pushes) {
    assert.match(push, /\brow:/, "a clash no longer says which row it is on");
    assert.match(push, /\bphone,/, "a clash no longer carries the number that caused it");
    assert.match(push, /\$\{phone\}/, "the reason no longer names the number");
  }

  // And the message itself, since that is what the toast prints straight through.
  const bulk = CONTROLLER.slice(CONTROLLER.indexOf("async function createBulk("));
  assert.match(bulk.slice(0, bulk.indexOf("\nasync function update(")), /numbers\.join\(", "\)/, "the refusal no longer names the numbers");
});

test("the sheet recognises a lead typed in by hand whichever number column it went into", () => {
  /*
   * "It was added manually already" has to be one answer whatever column the number sits in. The
   * Add Lead rule reads `phone` and `contact_number` together; this index read only `phone`, so a
   * lead whose number lives in Contact Number was invisible to the sheet and a second copy of that
   * person was imported on the next pass.
   */
  const fn = SHEET.slice(SHEET.indexOf("function buildExistingIndexes("));
  const body = fn.slice(0, fn.indexOf("\nfunction classifyAgainstExisting("));
  assert.match(body, /item\.lead\?\.phone, item\.lead\?\.contactNumber/, "the phone index no longer reads both number columns");

  const classify = SHEET.slice(SHEET.indexOf("function classifyAgainstExisting("));
  const cbody = classify.slice(0, classify.indexOf("\nasync function prepareGoogleSheetCrmImport("));
  assert.match(cbody, /const contactNumber = normalizePhone\(lead\.contactNumber\)/, "an arriving row's second number is no longer read");
  assert.match(cbody, /indexes\.byPhone\.get\(contactNumber\)/, "an arriving row's second number is never looked up");
  // And it counts as having been seen, or two rows of one sheet carrying it are both imported.
  assert.match(cbody, /const duplicateKey = sourceId \|\| phone \|\| contactNumber/, "the in-sheet duplicate key ignores the second number");
});
