const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * How a selection is deleted, and how many times the rows are written.
 *
 * Deleting a whole board is the one action on this screen whose cost grows with the studio, and it
 * was paying that cost twice. `deleteCrmLeads` called `sheets.deleteCrmLeads(ids)` first and used
 * its result as the list to delete - but that function had long since stopped talking to Google
 * Sheets and was the *same* `UPDATE`, so every bulk delete wrote `deleted_at` over the same rows
 * twice. Measured on 17,573 leads: ~4.5s for the pair against ~2.2s for one.
 *
 * It is no longer an `UPDATE` at all. A delete now removes the row, because stamping `deleted_at`
 * and leaving it there is not what the studio reads "delete" as: a dev database that had had its
 * imports cleared out was holding 92,452 hidden rows against 20,094 live ones. What that removal
 * may take with it, and what it must refuse, is the second half of this file.
 */

const SERVICE = fs.readFileSync(
  path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", "crmLeadService.js"),
  "utf8",
);
const SHEETS = fs.readFileSync(
  path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", "googleSheetsService.js"),
  "utf8",
);

/** The body of `deleteCrmLeads`, which is the bulk path. */
function bulkDelete() {
  const start = SERVICE.indexOf("async function deleteCrmLeads(ids) {");
  assert.notEqual(start, -1, "deleteCrmLeads is gone");
  return SERVICE.slice(start, SERVICE.indexOf("\n}\n", start));
}

/** The body of `purgeLeads`, which is where the rows and their children actually go. */
function purge() {
  const start = SERVICE.indexOf("async function purgeLeads(ids) {");
  assert.notEqual(start, -1, "purgeLeads is gone - the delete is soft again");
  return SERVICE.slice(start, SERVICE.indexOf("\n}\n", start));
}

/*
 * The same source with the column quoting taken out.
 *
 * These statements are template literals, so every backtick around a column name is escaped in the
 * file - `\`sales_crm_lead\``. A pattern written the way the SQL reads matches nothing at all, and
 * an assertion that silently matches nothing is worse than no assertion.
 */
const plain = (source) => source.replace(/[\\`]/g, "");

test("a selection's rows are removed, not hidden, and the removal happens once", () => {
  const body = bulkDelete();
  // The fault this file was opened for: the same rows written twice. Now there is one call, and it
  // is the one that removes them.
  const calls = body.match(/purgeLeads\(/g) || [];
  assert.equal(calls.length, 1, `the bulk delete calls purgeLeads ${calls.length} times`);
  assert.doesNotMatch(plain(body), /UPDATE sales_crm_lead SET deleted_at/, "the bulk delete only hides the rows again");
  assert.doesNotMatch(body, /sheets\.deleteCrmLeads/, "the bulk delete is routed through the sheets twin again");
  // And the single path does the same: one lead deleted is the same removal as ten thousand.
  const single = SERVICE.slice(SERVICE.indexOf("async function deleteCrmLead(id) {"));
  assert.match(single.slice(0, single.indexOf("\n}\n")), /purgeLeads\(\[id\]\)/, "the single delete is still a soft delete");
});

test("the row is gone from the table, not left carrying a deleted_at", () => {
  /*
   * The whole point. `purgeLeads` ends on a `DELETE`, and nothing in it writes the column the board
   * queries hide rows by - a delete that set it would be the old behaviour wearing a new name.
   */
  const body = plain(purge());
  assert.match(body, /DELETE FROM sales_crm_lead WHERE enquiry_id IN/, "purgeLeads does not delete the lead");
  assert.doesNotMatch(body, /deleted_at/, "purgeLeads is stamping deleted_at again");
});

test("what belongs to the lead goes with it", () => {
  /*
   * Nothing in this schema is joined by a foreign key, so nothing cascades and nothing is removed
   * for us. These four are *about* the lead and are unreadable without it - left behind, they are
   * rows pointing at an enquiry nobody can open, which is the same untidiness in a different table.
   */
  const owned = SERVICE.match(/const LEAD_OWNED_TABLES = \[([^\]]*)\]/);
  assert.ok(owned, "LEAD_OWNED_TABLES is gone");
  for (const table of ["sales_crm_lead_activity", "sales_crm_lead_occasion", "sales_crm_lead_watch", "sales_crm_meeting"]) {
    assert.match(owned[1], new RegExp(`"${table}"`), `${table} is left behind when its lead is deleted`);
  }
  const body = purge();
  assert.match(body, /for \(const table of LEAD_OWNED_TABLES\)/, "the owned tables are named but never cleared");
  assert.match(plain(body), /DELETE FROM \$\{table\} WHERE enquiry_id IN/, "the lead's own rows are no longer deleted with it");
});

test("a call is unlinked, never deleted - it happened", () => {
  /*
   * A call is a fact about the studio's phone rather than a detail of the lead, so removing the
   * caller must not remove the record of them ringing. Unlinked, it returns to the Calls board as a
   * caller nobody has added - the same move `retireCallyzerCallLeads.js` makes for the same reason.
   */
  const unlinked = SERVICE.match(/const LEAD_UNLINKED_TABLES = \[([^\]]*)\]/);
  assert.ok(unlinked, "LEAD_UNLINKED_TABLES is gone");
  for (const table of ["sales_crm_call_log", "sales_call_transcript"]) {
    assert.match(unlinked[1], new RegExp(`"${table}"`), `${table} is no longer unlinked when its lead is deleted`);
  }
  const body = purge();
  assert.match(body, /for \(const table of LEAD_UNLINKED_TABLES\)/, "the calls are named but never unlinked");
  assert.match(plain(body), /UPDATE \$\{table\} SET enquiry_id = '' WHERE enquiry_id IN/);
  // And emphatically not deleted - a call is not the lead's to take with it.
  const owned = SERVICE.match(/const LEAD_OWNED_TABLES = \[([^\]]*)\]/)[1];
  assert.doesNotMatch(owned, /call_log|transcript/, "a call is being deleted with its lead");
});

test("a lead carrying real work refuses to be deleted", () => {
  /*
   * A project is a booking with money against it; a quotation and a CRD are documents sent to a
   * client. Deleting the lead under them would leave each one naming an enquiry that no longer
   * exists - the project would still open, and its CRM link would answer with nothing. That is a
   * worse fault than the hidden rows this change fixes, so the lead stays and the caller is told.
   */
  assert.match(SERVICE, /const LEAD_COMMERCIAL_TABLES = \{[^}]*sales_project:[^}]*sales_quotation:[^}]*sales_project_crd_document:/s,
    "the commercial records no longer block a delete");
  const body = purge();
  assert.match(body, /leadsWithCommercialRecords\(wanted\)/, "purgeLeads no longer checks for work against the lead");
  assert.match(body, /wanted\.filter\(\(id\) => !blocked\.has\(id\)\)/, "a blocked lead is deleted anyway");
  // Reported by name rather than as a smaller number, so nobody has to work out which stayed.
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", "controller.js"), "utf8");
  assert.match(controller, /blockedIds: refused/, "the reply does not say which leads were kept");
});

test("the sheets twin is gone rather than left to be called again", () => {
  /*
   * It was one `UPDATE` with a misleading name - nothing about it touched a spreadsheet - and while
   * it existed the two were one call away from being run in sequence again. Two answers to one job
   * is how they end up both being used.
   */
  assert.doesNotMatch(SHEETS, /async function deleteCrmLeads\(/, "googleSheetsService exports a lead delete again");
});

test("the legacy mirror is given real placeholders, and abandoned on the first refusal", () => {
  /*
   * It was `IN (?)` with every id joined into one string, so it matched nothing whatever it was
   * pointed at. And the table is absent on most installations, so retrying per slice is thousands of
   * failed statements to discover the same thing - the first refusal answers for the selection.
   */
  const body = bulkDelete();
  assert.doesNotMatch(body, /IN \(\?\)", *\w+\.join/, "the legacy mirror is back to one joined string");
  assert.match(plain(body), /DELETE FROM leads WHERE external_id IN \(\$\{slice\.map\(\(\) => "\?"\)\.join\(", "\)\}\)/);
  assert.match(body, /console\.warn\("Legacy leads bulk delete skipped:[\s\S]*?break;/, "a missing legacy table is retried per slice again");
});

test("the reply is not held behind the webhook", () => {
  /*
   * Notifying a listener is not the edit - `sendCrmWebhook` has always said so in its own comment -
   * and it is a POST carrying every deleted id, with a five-second timeout, in front of the reply to
   * somebody already watching a spinner.
   */
  assert.match(bulkDelete(), /void sendCrmWebhook\("crm\.leads\.bulk_deleted"/);
});

test("the delete is one statement wherever it fits, and capped so it always fits", () => {
  /*
   * The cost of removing a lead is the row rather than the statement, so slicing a big selection
   * makes it slower rather than faster (~5.4s in one against ~7.5s in slices of 1,000, for 17,573
   * leads, measured on the soft delete this replaced). It matters more now that `purgeLeads` runs
   * seven statements per slice: a small slice multiplies round trips as well as re-planning. The cap
   * is only so a selection near the schema's 200,000 cannot build a statement MySQL refuses.
   */
  const cap = SERVICE.match(/const BULK_DELETE_SLICE = (\d+);/);
  assert.ok(cap, "the bulk delete no longer states a ceiling");
  assert.ok(Number(cap[1]) >= 10000, `the ceiling is ${cap[1]}, which slices a normal selection again`);
  assert.ok(Number(cap[1]) <= 50000, `the ceiling is ${cap[1]}, which builds statements MySQL may refuse`);

  // Applied where the slicing happens, which is `purgeLeads` - the bulk path hands it the whole
  // selection. Read from the function body rather than the file, or a passing mention in a comment
  // would satisfy this while the constant sat unused.
  assert.match(purge(), /offset \+= BULK_DELETE_SLICE/, "purgeLeads does not use the ceiling the file defines");
});
