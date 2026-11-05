const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * A Callyzer call, from delivery to the enquiry it may or may not become.
 *
 * The flow has four steps and each one is decided in a different file, which is why this reads them
 * all rather than testing one:
 *
 *   1. the webhook stores the call and, for a number the CRM does not hold, creates no lead at all;
 *   2. the call lands on the **Calls** board under a Call ID of its own - `DBS-CID-000001`;
 *   3. Calls is read by the call: which way it went, and whether anybody talked;
 *   4. somebody reads the caller and adds them, and *that* is when an Enquiry ID is minted, for the
 *      vertical chosen in the form.
 *
 * It used to work the other way round: every delivered call became a lead on arrival and took an
 * `EID` with it, so the run the studio counts its enquiries in counted misdials and wrong numbers
 * too, and placing a call meant re-issuing the id it should never have had. Step 4 is where that
 * damage was done and where it is now prevented, which is why most of what follows is about it.
 *
 * Read from source rather than a database, the way `crm-lead-tabs.test.js` is, so they run anywhere
 * with no MySQL.
 */

const CRM = path.join(__dirname, "..", "src", "modules", "sales", "crm-leads");
const read = (name) => fs.readFileSync(path.join(CRM, name), "utf8");
const LEAD_SERVICE = read("crmLeadService.js");
const QUERY_SERVICE = read("leadQueryService.js");
const ROUTING = read("callRouting.js");
const BOARD = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "components", "sales", "CRMPage.js"), "utf8");

const { ENQUIRY_ID_REFERENCES } = require("../src/modules/sales/crm-leads/crmLeadService");

/* ─────────────────────────────────────────────────────────── 1. the call arrives unplaced ── */

test("a call the router cannot place is left without a vertical", () => {
  /*
   * The whole flow rests on this. `verticalForCall` guessing would put a newborn enquiry in the
   * wedding board, where the people who would have called it back never see it - so it answers
   * nothing, and the Calls board is what catches those.
   */
  assert.match(ROUTING, /function verticalForCall/);
  const routing = ROUTING.slice(ROUTING.indexOf("function verticalForCall"));
  assert.match(routing, /return ""/, "verticalForCall no longer declines to guess");
});

test("a call from a number the CRM does not hold creates no lead", () => {
  /*
   * The heart of it. Every delivered call used to become a lead, which is how a two-second misdial
   * came to hold an enquiry number - so the branch that used to call `createCrmLead` now records
   * the call with no lead against it and stops there.
   */
  const CONTROLLER = read("controller.js");
  const loop = CONTROLLER.slice(CONTROLLER.indexOf("for (const [position, record] of prepared.entries())"), CONTROLLER.indexOf("await recordCallLogs(callLogsToRecord)"));
  assert.doesNotMatch(loop, /createCrmLead/, "the webhook is creating leads out of calls again");
  assert.match(loop, /callLogsToRecord\.push\(\{ callLog, employee, enquiryId: "" \}\)/, "an unmatched call no longer waits with a blank enquiry id");
  // A caller the CRM already holds is still their lead's call, and still updates it - that half was
  // never the problem, and losing it would take a known client's history off their record.
  assert.match(loop, /callLogsToRecord\.push\(\{ callLog, employee, enquiryId: existing\.lead\.id \}\)/);
  assert.match(loop, /records\.push\(await updateCrmLead\(existing\.lead\.id/);
});

/* ────────────────────────────────────────────────────── 2. it lands on Calls, under a Call ID ── */

test("a call carries an identifier of its own, with no vertical in it", () => {
  const IDENTIFIERS = fs.readFileSync(path.join(__dirname, "..", "src", "services", "identifiers.js"), "utf8");
  /*
   * `CLID`, and neither a vertical nor a branch. Which of the three businesses a call belongs to is
   * the question the Calls board exists to answer; a code that guessed one would be guessing in the
   * place the studio reads out loud. The `EID` above it keeps both, and is minted at step 4.
   *
   * The tag was `CID` and is `CLID`: read aloud beside `EID` it was one syllable from it, and a Call
   * ID heard as an Enquiry ID sends whoever heard it looking for a lead nobody created.
   */
  assert.match(IDENTIFIERS, /CALL_LOG: \{ tag: "CLID", parts: \[\], width: 6/, "a call no longer has an identifier scheme of its own");
  /*
   * And the codes minted under the old tag are rewritten to the new one, once, rather than left to
   * stand beside it. Two formats on one board is the fault the change was meant to end - adjacent
   * rows reading `DBS-CID-000012` and `DBS-CLID-000013` with nothing to say they are the same kind
   * of thing, and a search for one not finding the other.
   */
  const RENAME = read("callLogService.js");
  assert.match(RENAME, /async function renameCallIdTag/, "the codes minted as CID are never rewritten");
  assert.match(RENAME, /SET `call_id` = CONCAT\('DBS-CLID-', SUBSTRING\(`call_id`, 9\)\)/);
  assert.match(RENAME, /WHERE `call_id` LIKE 'DBS-CID-%'/, "the rename is not confined to the old tag, so it is not idempotent");
  /*
   * Order, asserted as order. This was a bounded character window, which is a proxy for "in the same
   * block" - and every repair since sequenced alongside them pushed the two further apart and failed
   * a test that was still describing something true. Positions say what is meant and stay true as
   * the sequence grows.
   */
  const renameAt = RENAME.indexOf("await renameCallIdTag();");
  const mintAt = RENAME.indexOf("await assignCallIds({ batches: BACKFILL_BATCHES })");
  assert.ok(renameAt !== -1 && mintAt !== -1, "the rename and the minting are no longer both run");
  assert.ok(renameAt < mintAt, "the rename no longer runs before the minting");
  // Minted after the rows are written, so a batch Callyzer redelivers - which lands on the rows it
  // wrote the first time - does not spend a number per call every time it arrives.
  const LOGS = read("callLogService.js");
  assert.match(LOGS, /async function assignCallIds/);
  assert.match(LOGS, /WHERE `call_id` IS NULL OR `call_id` = ''/);
  assert.match(LOGS, /await assignCallIds\(\);\s*\n\s*return written;/, "recordCallLogs no longer gives the calls it wrote their codes");
});

/* ───────────────────────────────────────────── 3. Calls is read by the call, not by the lead ── */

test("the Calls board is the call log rather than a slice of the lead table", () => {
  const CALL_BOARD = read("callBoardService.js");
  assert.match(CALL_BOARD, /FROM \\`sales_crm_call_log\\`/, "the Calls board no longer reads the call log");
  const region = BOARD.slice(BOARD.indexOf("const BOARD_TABS"), BOARD.indexOf("function getTabsForBoard"));
  assert.match(region.slice(region.indexOf("Calls:")), /Calls:\s*CALL_TABS/);
  /*
   * `CALLS_SQL` survives, and it is still the blank-branch Callyzer test - not for the board any
   * more, but because Dum Dum is defined as everything *except* it. Left as it was, a Callyzer lead
   * from before this change would be counted on two boards at once.
   */
  const callsSql = "(TRIM(COALESCE(`vertical`,'')) = '' AND LOWER(TRIM(COALESCE(`source`,''))) = 'callyzer')";
  assert.ok(QUERY_SERVICE.includes(`const CALLS_SQL = ${JSON.stringify(callsSql)}`), "CALLS_SQL is no longer the blank-branch Callyzer test");
  assert.match(QUERY_SERVICE, /"Dum Dum": `\(NOT \$\{CALLS_SQL\}/);
  // And the client's own test of what a row on that board may do, which lives in `lib/crmBoards.js`.
  const BOARDS = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "lib", "crmBoards.js"), "utf8");
  assert.match(BOARDS, /export function isUnassignedCall/);
  assert.match(BOARD, /isUnassignedCall/, "the board no longer asks whether a row is a call nobody has added");
});

/* ────────────────────────────────── 4. adding the caller is when the enquiry id is minted ── */

test("adding a call creates the lead rather than writing one that already exists", () => {
  /*
   * Confirm used to PUT: the lead existed, because the webhook had made one, so placing a call was
   * an update. It POSTs now, and the server mints the Enquiry ID at that moment - for the vertical
   * just chosen in the form, which is the first point at which anybody knows it.
   *
   * The Call ID is deliberately not sent as the lead's id. It is not a lead id, and a form seeded
   * with it would ask the server to write a lead that is not there.
   */
  /*
   * The form has a third job since - assigning an unassigned lead, opened by dragging a card out of
   * the board's Unassigned column - and **that** one updates, because the lead is already there. So
   * the call's path is the `else`: `assigning` is empty while a call is being placed, and a call
   * still has no lead until Confirm writes one.
   */
  assert.match(BOARD, /: await apiRequest\("\/api\/sales\/crm-leads", \{ method: "POST"/, "Add Lead no longer creates the lead");
  assert.match(BOARD, /const saved = assigning\s*\n\s*\? await apiRequest\(`\/api\/sales\/crm-leads\/\$\{encodeURIComponent\(assigning\)\}`, \{ method: "PUT"/, "and the assigning path no longer updates the lead it opened on");
  // To `leadFormFromLead`, which follows it: that one keeps the lead's own id, being an update, and
  // reading it as part of this function would answer the opposite of what the next line asks.
  const fromCall = BOARD.slice(BOARD.indexOf("function leadFormFromCall"), BOARD.indexOf("function leadFormFromLead"));
  assert.doesNotMatch(fromCall, /\bid: lead\.id\b/, "the Add Lead form is carrying the Call ID across as a lead id again");
  assert.match(fromCall, /\n {4}id: "",\n/, "leadFormFromCall no longer opens on a lead with no id of its own");
});

test("the calls are handed to the lead the moment it is created", () => {
  /*
   * Every call from that number, not just the one that was double-clicked: a client who rang five
   * times before anybody got to them has five calls of history, and splitting them between "the call
   * that made the lead" and "the rest" would leave the Call Logs tab showing one conversation out of
   * five. This is also what fills the Enquiry ID column on the Calls board.
   */
  const CONTROLLER = read("controller.js");
  assert.match(CONTROLLER, /await linkCallsToLead\(created\?\.lead\?\.phone \|\| record\.lead\.phone, created\?\.lead\?\.id\)/, "creating a lead no longer claims that caller's calls");
  const LOGS = read("callLogService.js");
  const link = LOGS.slice(LOGS.indexOf("async function linkCallsToLead"), LOGS.indexOf("async function relinkOrphanedCalls"));
  /*
   * Only the calls that are nobody's yet - and "nobody's" is judged by whether the lead a call
   * names is really there, not by whether the column happens to be empty.
   *
   * The column used to be the whole test, and it is plain text that three different things write:
   * a call left naming a lead deleted since, or an id in a format no lead has carried for a year,
   * looked linked to this writer and looked unlinked to the board that shows it. So the writer
   * skipped it for good - adding that caller to a vertical, however many times, left the board
   * still showing the Call ID. Both sides read `liveLeadSql` now.
   */
  assert.match(link, /WHERE NOT \$\{CALL_HAS_LEAD_SQL\}/);
  assert.doesNotMatch(link, /`enquiry_id` IS NULL OR `enquiry_id` = ''/, "an empty column is not the test; a lead that is really there is");
  assert.match(LOGS, /const CALL_HAS_LEAD_SQL = "EXISTS \(SELECT 1 FROM `sales_crm_lead` `cl` WHERE `cl`\.`enquiry_id` = `c`\.`enquiry_id`"/);
  assert.match(link, /RIGHT\(REGEXP_REPLACE\(COALESCE\(`c`\.`client_number`, ''\), '\[\^0-9\]', ''\), 10\) = \?/);
  /*
   * And a redelivery of an already-linked call must not blank the link it now carries. Callyzer
   * resends a whole batch after a sync failure, carrying whatever it knew at the time - which for a
   * caller who has since been added is nothing - so `VALUES()` is only taken when it says something.
   * The backticks are escaped in the source, which is a template literal.
   */
  assert.match(LOGS, /\\`enquiry_id\\` = IF\(VALUES\(\\`enquiry_id\\`\) = '', \\`enquiry_id\\`, VALUES\(\\`enquiry_id\\`\)\)/);
});

test("the side that writes a link and the side that keeps the row read the same rule", () => {
  /*
   * A call carried `DBS-DD-EID-35950` - an id from a format no lead has had for a year, and no lead
   * at all. The board judged that claim properly, found nothing, and left the row where it was. The
   * writer judged it by "is the column empty", found it full, and skipped the row. So the caller
   * could be added to Corp, and to Qua Qua after that, and the three calls sat on the board reading
   * `DBS-CID-000010`. Two readings of one fact is what made it unfixable from the screen; there is
   * one now, and both sides take it from there.
   */
  const LOGS = read("callLogService.js");
  const BOARD_SERVICE = read("callBoardService.js");
  assert.match(LOGS, /const liveLeadSql = \(alias\) =>/, "the one reading of 'the lead a call belongs to' has moved or gone");
  // The backticks are escaped in the source, which is a template literal.
  assert.match(LOGS, /\\`\$\{alias\}\\`\.\\`deleted_at\\` IS NULL AND TRIM\(COALESCE\(\\`\$\{alias\}\\`\.\\`vertical\\`, ''\)\) <> ''/);
  /*
   * And the board's own question - has this caller been added - is asked two ways, because a caller
   * can be in the CRM without the call knowing it. The call's own link answers one; the number, the
   * CRM's one rule for the same client, answers the other, so a call delivered after the caller was
   * written down is placed even though nothing has stamped it.
   */
  assert.match(LOGS, /const callerIsALeadSql = `\(\$\{CALL_HAS_LEAD_SQL\} OR EXISTS/);
  assert.match(LOGS, /`pl`\.`phone_key` = RIGHT\(REGEXP_REPLACE\(COALESCE\(`c`\.`client_number`, ''\), '\[\^0-9\]', ''\), 10\)/);
  assert.match(BOARD_SERVICE, /const \{ ensureCallIds, callerIsALeadSql \} = require\("\.\/callLogService"\)/);
  assert.match(BOARD_SERVICE, /const UNPLACED_SQL = `NOT \$\{callerIsALeadSql\}`/, "the board must judge this by the shared rule, not by one written out again here");
});

test("a call left naming a lead that is not there is handed back to its caller's first lead", () => {
  /*
   * The corrected rule alone does not undo the damage: nothing re-runs `linkCallsToLead` for a lead
   * that already exists, so a call stranded before this would have shown its Call ID for good and
   * the studio's only recourse was to add the caller yet again.
   *
   * *First* lead, not the newest. A number may be one enquiry in each vertical - the controller's
   * duplicate check says exactly that - so a caller can be a Corp lead and a Qua Qua lead at once,
   * and their call history stays with the enquiry they were first written down as. That is the same
   * answer `linkCallsToLead` arrives at by never unmaking a link that is already good.
   */
  const LOGS = read("callLogService.js");
  const repair = LOGS.slice(LOGS.indexOf("async function relinkOrphanedCalls"), LOGS.indexOf("function numberKey"));
  assert.match(repair, /UPDATE `sales_crm_call_log`/);
  assert.match(repair, /NOT \$\{CALL_HAS_LEAD_SQL\}/, "the repair must claim exactly the rows the board disowns");
  // Blanked where the caller was never added, which is what the board reads such a call as anyway -
  // and what lets the next person who adds them claim it.
  assert.match(repair, /COALESCE\(\(\$\{FIRST_LEAD_FOR_CALLER_SQL\}\), ''\)/);
  assert.match(LOGS, /ORDER BY `fl`\.`created_at` ASC, `fl`\.`enquiry_id` ASC LIMIT 1/, "the first lead the caller was added as, not the latest");
  assert.match(LOGS, /`fl`\.`phone_key` = RIGHT\(REGEXP_REPLACE\(COALESCE\(`c`\.`client_number`, ''\), '\[\^0-9\]', ''\), 10\)/);

  /*
   * Run beside the Call ID backfill, once per process, for the reason that one is: the same fault
   * otherwise arrives fresh on the production database the day this deploys, and an operator step
   * is a step somebody has to know about.
   */
  const ensure = LOGS.slice(LOGS.indexOf("async function ensureCallIds"), LOGS.indexOf("async function ensureCallIds") + 1300);
  assert.match(ensure, /await relinkOrphanedCalls\(\)/, "the repair never runs, so nothing fixes the calls already stranded");
});

test("a leftover untriaged call is still re-issued its enquiry id when it is placed", () => {
  /*
   * Legacy, and kept deliberately. No new call takes an `EID` on arrival any more, so nothing
   * reaches this in the ordinary course - but leads created by the old webhook may still be sitting
   * on a vertical with a `DBS-EID-DD-…` code that was minted before anybody knew the vertical, and
   * one of those being placed by hand must still be renumbered for the vertical it turned out to be.
   */
  assert.match(LEAD_SERVICE, /async function reissueEnquiryIdOnPlacement/);
  const reissue = LEAD_SERVICE.slice(
    LEAD_SERVICE.indexOf("async function reissueEnquiryIdOnPlacement"),
    LEAD_SERVICE.indexOf("async function updateCrmLead"),
  );
  // Only an untriaged call, and only when a vertical is actually being given.
  assert.match(reissue, /!isUntriagedCall\(before\) \|\| !givenVertical/);
  // The new id is minted for the vertical it is being placed into, not the one it had.
  assert.match(reissue, /nextIdentifier\("CRM_LEAD", \{\s*vertical: givenVertical/);
  // And `updateCrmLead` carries on with the new id rather than the one it was called with.
  assert.match(LEAD_SERVICE, /id = await reissueEnquiryIdOnPlacement\(id, before, record\);/);
});

test("the client's board test and the server's agree about what an untriaged call is", () => {
  // `isUntriagedCall` decides whether an id is re-issued; `CALLS_SQL` decides which rows arrive.
  // A drift between them re-issues an id for a lead that was never on Calls, or fails to for one
  // that was.
  const untriaged = LEAD_SERVICE.slice(LEAD_SERVICE.indexOf("function isUntriagedCall"), LEAD_SERVICE.indexOf("async function renameEnquiryId"));
  assert.match(untriaged, /!String\(lead\.vertical \|\| ""\)\.trim\(\)/, "the vertical must be blank");
  assert.match(untriaged, /"callyzer"/, "and the source must be Callyzer");
});

test("renaming a lead moves every column that quotes it, in one transaction", () => {
  /*
   * An enquiry id is the lead's primary key *and* plain text on ten other tables. A rename that
   * moved the key and not the rest leaves projects, quotations and the activity log pointing at a
   * lead that is not there - and half of one is worse than none, which is why it is a transaction.
   */
  const rename = LEAD_SERVICE.slice(LEAD_SERVICE.indexOf("async function renameEnquiryId"), LEAD_SERVICE.indexOf("async function reissueEnquiryIdOnPlacement"));
  assert.match(rename, /prisma\.\$transaction/);
  assert.match(rename, /for \(const \[table, column\] of ENQUIRY_ID_REFERENCES\)/);

  // The list itself has to be complete. These are the columns `information_schema` reports as
  // holding an enquiry id; one missing is a row left pointing at nothing.
  const named = new Set(ENQUIRY_ID_REFERENCES.map(([table, column]) => `${table}.${column}`));
  for (const column of [
    "sales_project.enquiry_id",
    "sales_quotation.enquiry_id",
    "sales_crm_meeting.enquiry_id",
    "sales_crm_lead_activity.enquiry_id",
    "sales_crm_call_log.enquiry_id",
    "sales_call_transcript.enquiry_id",
    "sales_crm_lead_watch.enquiry_id",
    "sales_crm_lead_occasion.enquiry_id",
    "sales_whatsapp_group_name.enquiry_id",
    "sales_project_crd_document.enquiry_id",
    "sales_crm_lead.source_enquiry_id",
  ]) {
    assert.ok(named.has(column), `${column} quotes an enquiry id and is not swept when one is renamed`);
  }
});

test("a lead moved between verticals by hand keeps its identifier", () => {
  /*
   * Deliberate, and worth stating: by then the id has been quoted on a project, a quotation, a
   * WhatsApp group name and very likely to the client, and renaming it would be a worse lie than
   * the one it tells. A call that has just arrived has none of that, which is what makes placement
   * the one safe moment.
   */
  const reissue = LEAD_SERVICE.slice(
    LEAD_SERVICE.indexOf("async function reissueEnquiryIdOnPlacement"),
    LEAD_SERVICE.indexOf("async function updateCrmLead"),
  );
  assert.match(reissue, /if \(!before \|\| !isUntriagedCall\(before\)/, "the gate must be the untriaged-call one");
});

test("the renumbering script sweeps the same columns rather than its own list", () => {
  // Two lists is one that gets a table added to it and one that does not.
  const script = fs.readFileSync(path.join(__dirname, "..", "scripts", "renumberIdentifiers.js"), "utf8");
  assert.match(script, /references: ENQUIRY_ID_REFERENCES,/);
  assert.match(script, /const \{ ENQUIRY_ID_REFERENCES \} = require\("\.\.\/src\/modules\/sales\/crm-leads\/crmLeadService"\)/);
});
