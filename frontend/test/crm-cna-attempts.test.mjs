import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * When an unanswered call is counted.
 *
 * CNA is not an ordinary status: each one is an *attempt*, the lead carries the tally, and the
 * sixth unanswered call rejects it outright. So the moment the number goes up is a decision about
 * somebody's lead, not a detail of the form.
 *
 * In the popup it used to go up on the press of the pill, which posted immediately. A run of six
 * presses - easily done, since nothing on screen said the press had already been written - walked a
 * lead to Rejected without anybody saving anything, and there was no way to un-choose it. The pill
 * selects now, and the attempt is recorded when the lead is saved: **CNA and Proceed Next**, or
 * picking CNA and pressing Update.
 *
 * Read off the source like the other CRM tests: no DOM, no renderer.
 */

const PAGE = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "CRMPage.js"), "utf8");

/** The two hosts that render the popup and answer its Update: the board's, and Contacts'. */
function saveBodies() {
  const bodies = [
    ["the board's popup", "async function savePopupLead("],
    ["the Contacts popup", "async function save(closeAfter = false, advanceAfter = false, forcedStatus = \"\", committedEntries = null) {"],
  ].map(([what, opening]) => {
    const start = PAGE.indexOf(opening);
    assert.notEqual(start, -1, `${what} was not found`);
    return [what, PAGE.slice(start, PAGE.indexOf("\n  }\n", start))];
  });
  assert.equal(bodies.length, 2);
  return bodies;
}

test("the CNA pill chooses a status; it no longer posts as it is pressed", () => {
  const pill = PAGE.slice(PAGE.indexOf("<LeadStatusPills\n                      value={displayLead.leadStatus}"), PAGE.indexOf("options={leadStatusOptionsForVertical(vertical)}"));
  assert.ok(pill, "the popup's status pills were not found");
  /*
   * The converted statuses are the ones this form cannot write itself - they hand the lead to Sales
   * Manager in a second tab - so they keep their own handler, and the status pressed goes with them
   * because Qua Qua has two of them. Everything else, CNA included, drafts.
   */
  assert.match(pill, /opensProjectFor\(value\)\s*\?\s*attemptConvert\(value\)\s*:\s*onUpdateDetails\?\.\("leadStatus", value\)/);
  assert.ok(!pill.includes("onCna"), "the pill posts an attempt again instead of choosing the status");
  // And the popup no longer takes a handler for it at all, so there is no second way in.
  assert.ok(!/^\s*onCna,$/m.test(PAGE), "the popup still accepts an onCna handler");
});

test("the count goes up when CNA is chosen and saved, and not otherwise", () => {
  for (const [what, body] of saveBodies()) {
    // The decision: the button that says CNA, or the pill pressed in this popup.
    assert.match(body, /const cnaChosenNow = forcedStatus === "CNA"\s*\|\|/, what);
    assert.match(body, /const isCnaSave = requestedStatus === "CNA" && cnaChosenNow;/, what);
    assert.match(body, /const nextSequence = isCnaSave \? currentSequence \+ 1 : currentSequence;/, what);
  }
});

/*
 * The case that makes `cnaChosenNow` more than tidiness.
 *
 * `requestedStatus` is CNA for a lead that *already* is CNA and is being saved for some unrelated
 * reason - a number corrected, a remark added. Counting there would raise a lead's attempts every
 * time anybody opened and updated it, walking it to Rejected with no call ever made. The draft is
 * what tells the two apart: it holds only what somebody edited in this popup.
 */
test("saving an unrelated edit on a lead that is already CNA counts nothing", () => {
  const [[, board], [, contacts]] = saveBodies();
  assert.match(board, /popupEdits\.details\?\.leadStatus === "CNA"\s*\|\|\s*popupEdits\.lead\?\.leadStatus === "CNA"/);
  assert.match(contacts, /draft\.details\?\.leadStatus === "CNA"\s*\|\|\s*draft\.lead\?\.leadStatus === "CNA"/);
});

test("the lead still gives up after the sixth unanswered call, and says so", () => {
  for (const [what, body] of saveBodies()) {
    // Strictly greater: the sixth attempt is recorded and shown as "CNA (6)", and the seventh is
    // what rejects the lead.
    assert.match(body, /const autoRejected = isCnaSave && nextSequence > MAX_CNA_ATTEMPTS;/, what);
    assert.match(body, /autoRejected \? "Rejected" : requestedStatus/, what);
    assert.match(body, /CNA attempts reached - this lead is now Rejected\./, what);
    // The attempt is reported from what happened rather than from which button was pressed, or
    // choosing CNA and pressing Update would raise the number with nothing said about it.
    assert.match(body, /: isCnaSave\s*\n?\s*\?\s*`Lead marked CNA \(attempt \$\{nextSequence\} of \$\{MAX_CNA_ATTEMPTS\}\)\.`/, what);
  }
});

/*
 * The info panel beside the table is deliberately untouched: its CNA pill still records an attempt
 * on the press. That pane is the quick pass down a list of leads nobody answered - there is no form
 * being filled in and no Update to reach for - and it is the popup, where a press could be mistaken
 * for a selection, that needed the change.
 */
test("the board's info panel still records an attempt on the press", () => {
  assert.match(PAGE, /if \(value === "CNA"\) \{\s*\n\s*clearInfoStatusDraft\(\);\s*\n\s*void markLeadCna\(selectedLead\);/);
});
