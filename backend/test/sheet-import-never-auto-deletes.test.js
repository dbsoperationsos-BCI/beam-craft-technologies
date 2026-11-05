const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * ── Once a row is in, only a person takes it out ──────────────────────────────────────────────
 *
 * The studio's rule for every Google Sheet integration, and it is absolute: nothing on the sheet side
 * ever deletes what was imported. Not unlinking the sheet, not deleting the link, not a row vanishing
 * from the spreadsheet, not a sync that fails halfway. A lead or a candidate that has arrived is the
 * studio's record from that moment, and the only thing that removes it is somebody pressing Delete.
 *
 * Deleting a link used to delete everything it had imported - soft for leads, hard for candidates -
 * on the argument that "deleting a source deletes what it produced". That is defensible right up
 * until the records have been worked: a lead carrying a quotation, a candidate with three rounds and
 * a remark history, gone because somebody tidied up an integration. The link is a **sync**, and
 * stopping a sync is not a reason to destroy what it brought in.
 */

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
const INTERVIEW_LINKS = read("src", "modules", "hrm", "interview", "sheetLinksController.js");
const INTERVIEW_SYNC = read("src", "modules", "hrm", "interview", "sheetSyncService.js");
const LEAD_LINKS = read("src", "modules", "sales", "google-sheet-links", "controller.js");
const LEAD_SERVICE = read("src", "modules", "sales", "crm-leads", "crmLeadService.js");
const LEAD_SERVICE_SHEETS = read("src", "modules", "sales", "crm-leads", "googleSheetsService.js");

test("deleting a link deletes no candidate", () => {
  assert.equal(INTERVIEW_LINKS.includes("deleteCandidatesFromSheet"), false, "unlinking must not reach the register");
  // And the function itself is gone rather than left for the next caller to find.
  assert.equal(INTERVIEW_SYNC.includes("deleteCandidatesFromSheet"), false, "the helper should not exist at all");
  assert.equal(/hrmInterviewCandidate\.deleteMany/.test(INTERVIEW_SYNC), false, "nothing in the sync path deletes a candidate");
  assert.equal(/hrmInterviewApplicationInvite\.deleteMany/.test(INTERVIEW_SYNC), false, "nor their screening forms");
});

test("deleting a link deletes no lead", () => {
  assert.equal(LEAD_LINKS.includes("removeLeadsForLink"), false, "unlinking must not reach the board");
  assert.equal(LEAD_LINKS.includes("deleteCrmLeadsFromSheet"), false);
  assert.equal(LEAD_SERVICE.includes("deleteCrmLeadsFromSheet"), false, "the helper should not exist at all");
});

test("the link itself still goes, because stopping the sync is the whole point", () => {
  /*
   * Unlinking still means unlinking: the link is soft-deleted, the poller stops reading that sheet, and
   * `restore` can bring it back. What changed is only what it takes with it, which is nothing.
   */
  assert.match(INTERVIEW_LINKS, /prisma\.hrmInterviewGoogleSheetLink\.update\(\{ where: \{ id \}, data: \{ deletedAt: new Date\(\) \} \}\)/);
  assert.match(LEAD_LINKS, /UPDATE \\`sales_google_sheet_link\\`\s*\n\s*SET deleted_at = CURRENT_TIMESTAMP\(3\)/);
});

test("a sync only ever adds", () => {
  /*
   * The other half of the rule, and the half that was already true: a row taken out of the spreadsheet
   * leaves the record standing, and a cell corrected there never overwrites what the studio has since
   * put on the record. Pinned so it stays that way.
   */
  assert.match(INTERVIEW_SYNC, /A sync only ever \*adds\*/);
  for (const source of [INTERVIEW_SYNC, LEAD_SERVICE]) {
    assert.equal(/rowsRemovedFromSheet|deleteMissingRows|pruneRows/.test(source), false, "a missing row is not a deletion");
  }
});

test("the only delete there is, is hard", () => {
  /*
   * A soft delete hides a row and leaves it answering to a phone number, which is how a register the
   * studio believed it had cleared went on recognising people nobody could see. So manual deletion -
   * the only deletion left - really deletes, on both the single and the bulk path.
   */
  const INTERVIEW_SERVICE = read("src", "modules", "hrm", "interview", "service.js");
  assert.match(INTERVIEW_SERVICE, /prisma\.hrmInterviewCandidate\.delete\(\{ where: \{ id: existing\.id \} \}\)/, "the single delete is soft again");
  assert.match(INTERVIEW_SERVICE, /prisma\.hrmInterviewCandidate\.deleteMany\(\{ where: \{ id: \{ in: liveIds \} \} \}\)/, "the bulk delete is soft again");
  // Their screening forms go with them either way, or the invite outlives the person it was for.
  assert.match(INTERVIEW_SERVICE, /hrmInterviewApplicationInvite\.deleteMany\(\{ where: \{ candidateId: existing\.id \} \}\)/);

  // On the leads side `purgeLeads` is now the only path, and it is a real DELETE.
  assert.match(LEAD_SERVICE, /async function purgeLeads\(ids\)/);
  assert.equal(/SET \`deleted_at\` = CURRENT_TIMESTAMP\(3\)/.test(LEAD_SERVICE), false, "a soft delete is back on the lead path");
});

test("a lead carrying commercial records is still refused", () => {
  /*
   * The one exception to "delete really deletes", and it is the database's rule rather than a
   * preference: since migration 20260924150000 the tables *about* a lead cascade and the commercial
   * ones refuse. Deleting a lead that became a booking would take a project, a quotation or a signed
   * CRD document with it, so it is refused and named back to whoever asked.
   */
  assert.match(LEAD_SERVICE, /CRD document is refused and left standing, and the caller reports it by name/);
  // The database holds the same rule as keys, so it cannot be forgotten in code.
  assert.match(LEAD_SERVICE, /the owned tables\n \* cascade, the commercial ones refuse/);
});

test("a row the studio deleted stays deleted on the next sync", () => {
  /*
   * The other half of "only manual deletion deletes": having deleted somebody, the sheet must not put
   * them back an hour later when the poller next runs. The ledger is what remembers - it records that
   * this link imported that row and it outlives the record, which is exactly why it is a table of its
   * own rather than a flag on the candidate.
   */
  assert.match(INTERVIEW_SYNC, /importedRowKeys/);
  assert.match(LEAD_SERVICE_SHEETS, /`sales_google_sheet_row` is the memory that survives the lead/);
});
