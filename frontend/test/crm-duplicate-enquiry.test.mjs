import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * One number, one enquiry - within a vertical.
 *
 * The CRM's idea of "the same client" is the last ten digits of their phone number - it is what the
 * Callyzer webhook matches a delivered call on, what the Call Logs tab gathers a history by, and
 * what "Enquired : 2 times" counts. Two leads on one number inside one vertical are the same person
 * entered twice, with their calls, remarks and follow-ups split across two records that neither
 * knows about.
 *
 * Across verticals it is not that at all: a wedding client who later books a corporate shoot is one
 * number and two enquiries on purpose, with different work, a different pipeline and a different
 * team. So the rule is scoped to the vertical, and the two cases get different answers - refused
 * inside one, named and allowed across them.
 *
 * The check that stands in the way has three parts and every one can be broken without anything
 * failing: a check nobody asks, a check nobody acts on, or a check that fires on the wrong thing.
 * So this reads the source of all three.
 *
 * Read from source rather than rendered, the way the board's own tests are, so it runs with no
 * browser and no database.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOARD = fs.readFileSync(path.join(HERE, "..", "src", "components", "sales", "CRMPage.js"), "utf8");
const DIALOG = fs.readFileSync(path.join(HERE, "..", "src", "components", "sales", "DuplicateEnquiryDialog.js"), "utf8");
const SERVICE = fs.readFileSync(path.join(HERE, "..", "src", "services", "sales", "crm-lead-duplicates.service.js"), "utf8");

test("the check is asked of the server, through the module's own service", () => {
  /*
   * The other enquiries on a number are separate leads that the board has almost certainly never
   * loaded - it holds a page at a time, of one vertical - so this can only be a question for the
   * server. And it goes through a service, which is where this application keeps its API calls;
   * the board used to call the endpoint inline in two places, which is two places to change.
   */
  assert.match(SERVICE, /export function getDuplicateEnquiries/);
  assert.match(SERVICE, /\/api\/sales\/crm-leads\/duplicates\?/);
  assert.doesNotMatch(BOARD, /crm-leads\/duplicates/, "the board is calling the duplicates endpoint directly again");
  assert.match(BOARD, /import \{ getDuplicateEnquiries \} from "@\/services\/sales\/crm-lead-duplicates\.service"/);
});

test("Add Lead asks as the number is typed, and again before it writes", () => {
  /*
   * Two moments, catching two different mistakes. Typing is the nudge; Confirm is the guarantee - a
   * number pasted in and confirmed in the same second never gave the first one time to answer.
   */
  const asTyped = BOARD.slice(BOARD.indexOf("const [addLeadDuplicates,"), BOARD.indexOf("const addLeadDuplicateWarning"));
  assert.match(asTyped, /getDuplicateEnquiries\(\{ phone \}\)/, "Add Lead no longer checks the number as it is typed");
  // Only a whole number, so nothing is asked on the way to typing one.
  assert.match(asTyped, /isCompletePhoneNumber\(phone\)/);
  // And Confirm refuses to write while a warning is outstanding.
  assert.match(BOARD, /if \(addLeadDuplicateWarning\) \{[\s\S]{0,900}?setDuplicateAlert\(\{ \.\.\.addLeadDuplicateWarning, intent: "add", confirming: true, vertical: addLeadForm\.vertical \}\);/);
});

test("the answer is held against the number it was asked about", () => {
  /*
   * The number keeps changing while somebody types, and a reply is slower than a keystroke. An
   * answer about a number the field has since moved off is an answer about somebody else, and
   * warning on it would name an enquiry that has nothing to do with what is on screen.
   */
  assert.match(BOARD, /addLeadDuplicates\.phone === String\(addLeadForm\.phone \|\| ""\)\.trim\(\)/);
  assert.match(BOARD, /phoneClash\.phone === editedPhone/);
});

test("editing warns only when the number was actually changed", () => {
  /*
   * A lead that has always shared a number with another - a groom and a bride on one phone, a
   * family, an office line - is a fact of the studio's data, and it is already stated in the popup
   * header as "Enquired : 2 times". Raising a dialog over it on every Update would be an alarm
   * about something nobody just did.
   */
  assert.match(BOARD, /const phoneChanged = Boolean\(phoneBaseline\.id && editedPhone && editedPhone !== phoneBaseline\.phone\);/);
  assert.match(BOARD, /if \(!phoneChanged \|\| !isCompletePhoneNumber\(editedPhone\)\) return undefined;/);
  // And the save is what it is checked at, so a number pasted in and saved at once is still caught.
  assert.match(BOARD, /if \(phoneClashWarning\) \{[\s\S]{0,300}?setClashAlert\([\s\S]{0,120}?saving: true/);
});

test("the baseline survives the popup being mounted before its lead arrives", () => {
  /*
   * `LeadPopupHost` - the popup as the Contacts directory opens it - renders this form before the
   * record has been read, so the first render sees no lead at all. Taking that as the number the
   * lead started with would make every lead opened from Contacts look as though its number had just
   * been edited, and warn on the first Update.
   */
  assert.match(BOARD, /if \(lead\?\.id && phoneBaseline\.id !== lead\.id\) \{/);
});

test("the way forward is the enquiry that already exists, named", () => {
  /*
   * A button reading "Open" says nothing about where it goes, and this one goes to a record the
   * reader has not seen. The id is the whole point of the warning.
   */
  assert.match(DIALOG, /Open \{first\.enquiryId\}/);
  assert.match(DIALOG, /onOpenEnquiry\?\.\(first\.enquiryId\)/);
  // It clears the dialog above the form it was raised from - both are full-screen surfaces, and
  // `dialog` alone would put the warning behind the form it is warning about.
  assert.match(DIALOG, /layer="dialogOverPanel"/);
});

test("going ahead is offered across verticals and withheld inside one", () => {
  /*
   * The whole shape of the rule, in one button.
   *
   * Inside the vertical being written to there is no reading of a repeated number that is not a
   * mistake, and the server refuses that save outright - so the button is *absent* rather than
   * present and failing. A control whose only outcome is an error reads as a choice the person has,
   * which it is not.
   *
   * Across verticals it is offered, because the second enquiry is deliberate and correct.
   */
  assert.match(DIALOG, /const \{ blocking, elsewhere \} = splitByVertical\(leads, vertical\);/);
  assert.match(DIALOG, /const blocked = blocking\.length > 0;/);
  assert.match(DIALOG, /\{!blocked && onContinue && \(/);
  assert.match(DIALOG, /\{intent === "edit" \? "Save anyway" : "Add anyway"\}/);
  // The blocking rows are the ones shown when there are any: naming another vertical's enquiry
  // underneath a refusal about this one would explain the wrong record.
  assert.match(DIALOG, /const enquiries = blocking\.length \? blocking : elsewhere;/);
});

test("both forms tell the dialog which vertical they are writing into", () => {
  /*
   * Without it the dialog cannot tell the two cases apart and every clash reads as a warning - which
   * is the behaviour this replaced. Sent explicitly rather than read from the board's own state, so
   * the dialog is never deciding on a board that changed under it.
   */
  assert.match(BOARD, /vertical=\{duplicateAlert\.vertical \|\| addLeadForm\.vertical\}/);
  assert.match(BOARD, /vertical=\{clashAlert\.vertical \|\| vertical\}/);
  // And every place that raises one carries the vertical onto it.
  assert.match(BOARD, /setClashAlert\(\{ \.\.\.duplicate, intent: "edit", vertical \}\)/);
  assert.match(BOARD, /setClashAlert\(\{ \.\.\.phoneClashWarning, intent: "edit", saving: true, closeAfter, advanceAfter, forcedStatus, vertical \}\)/);
});

test("the vertical is compared normalised, not as it was typed", () => {
  /*
   * `vertical` is written by hand in places - a sheet import, a CSV, the older spellings - so "corp",
   * "Corporate" and the "Crop" typo are all Corp. Comparing raw text would let a second Corp lead
   * through on a spelling, which is the one case the refusal exists for.
   */
  assert.match(DIALOG, /import \{ normalizeVertical \} from "@\/lib\/crmOptions";/);
  assert.match(DIALOG, /normalizeVertical\(entry\.vertical\) === here/);
  // With no vertical to compare against nothing can be said to clash, and the dialog warns rather
  // than refuses. The server holds the same rule and is the authority either way.
  assert.match(DIALOG, /if \(!here\) return \{ blocking: \[\], elsewhere: rows \};/);
});

test("a choice to go ahead is remembered against that number", () => {
  /*
   * So the warning does not reappear on the press of Confirm that follows - and does reappear the
   * moment the number is edited to a different one that is also already held.
   */
  assert.match(BOARD, /setDuplicateAckPhone\(duplicateAlert\.phone\);/);
  assert.match(BOARD, /setClashAckPhone\(pending\.phone\);/);
  assert.match(BOARD, /addLeadDuplicates\.phone !== duplicateAckPhone/);
  assert.match(BOARD, /phoneClash\.phone !== clashAckPhone/);
});

test("the heading names the vertical that holds the number, not the one being written into", () => {
  /*
   * These are different questions with different answers, and the heading had the wrong one: editing
   * a Dum Dum lead onto a number a Corp enquiry holds, it read "already an enquiry in Dum Dum" over a
   * row plainly labelled Corp. Dum Dum is where the reader is; where the number already is is the
   * answer to why they are being stopped, or not.
   */
  assert.match(DIALOG, /const verticals = \[\.\.\.new Set\(enquiries\.map\(\(entry\) => normalizeVertical\(entry\.vertical\)\)\.filter\(Boolean\)\)\];/);
  assert.match(DIALOG, /const holder = verticals\.length === 1 \? verticals\[0\] : "";/);
  /*
   * Named only when the enquiries agree. Two in different verticals have no single answer, and a
   * heading that picked the first would be making the same mistake again - quietly, this time. The
   * rows below say it per enquiry, which is where it belongs when they differ.
   */
  assert.doesNotMatch(DIALOG, /in \$\{here\}/, "the heading is naming the form's vertical again");
  // `vertical` still decides refuse-or-warn, which is the only thing it is for.
  assert.match(DIALOG, /splitByVertical\(leads, vertical\)/);
});

test("the dialog says which vertical, and says it in one line", () => {
  /*
   * The vertical is the fact that decides which of the two situations this is - somebody reading
   * "already an enquiry" without it cannot tell whether they are being told something or stopped.
   *
   * And one line under it. The description used to run to three, explaining what "one number, one
   * enquiry" means and why the CRM gathers a history by number: all true, none of it what somebody
   * halted mid-save is reading for. They want the enquiry id and whether they may go on.
   */
  assert.match(DIALOG, /title=\{`This number is already an enquiry\$\{holder \? ` in \$\{holder\}` : ""\}`\}/);
  assert.doesNotMatch(DIALOG, /One number is one enquiry in the CRM/, "the three-line explanation is back in the dialog");
  assert.doesNotMatch(DIALOG, /calls, remarks and follow-ups all gather/);
  // And the vertical is not repeated in the line under a heading that already carries it.
  assert.match(DIALOG, /\? `\$\{phone \|\| "That number"\} is on \$\{first\.enquiryId\}\.`/);
});

test("the warning is shown under the Contact box in both forms, not only at the save", () => {
  /*
   * The lead popup caught an edited number, but only on Update and only as a dialog - so the number
   * read as perfectly fine right up to the moment somebody tried to save it, which is the latest
   * possible time to be told and the one point at which they have stopped looking at the field.
   * Both forms now say it in the same place, under the box it is about.
   */
  const line = /Already an enquiry: \{duplicate\.leads\.map\(\(entry\) => entry\.enquiryId\)\.join\(", "\)\}/g;
  assert.equal((BOARD.match(line) || []).length, 2, "the Contact box warning is missing from one of the two forms");
  // Add Lead reads it off the form's own check; the popup off the edited-number one.
  assert.match(BOARD, /const duplicate = key === "phone" \? addLeadDuplicateWarning : null;/);
  assert.match(BOARD, /const duplicate = key === "phone" \? phoneClashWarning : null;/);
});

test("going on with the save is offered only when a save was interrupted", () => {
  /*
   * Pressed from the line under the field, the dialog is telling somebody something while they are
   * still typing: there is no save to go on with, and a button reading "Save anyway" that saved a
   * half-finished edit would be a trap.
   */
  assert.match(BOARD, /onContinue=\{duplicateAlert\.confirming \? \(\) => \{/);
  assert.match(BOARD, /onContinue=\{clashAlert\.saving \? \(\) => \{/);
  // And when Confirm did raise it, going ahead finishes that Confirm rather than making somebody
  // press it a second time.
  assert.match(BOARD, /const committed = addLeadRemarkCommitRef\.current\?\.\(\);[\s\S]{0,140}?void runAddLead\(\(\) => saveLead\(committed\)\);\s*\n\s*\} : undefined\}/);
});

test("a decision made in one form does not carry into the next", () => {
  /*
   * Closing Add Lead forgets that somebody chose to go ahead with a number the CRM already holds.
   * Carried across, the next lead added on that number would be written with no warning at all -
   * which is the one case the whole check exists for.
   */
  const close = BOARD.slice(BOARD.indexOf("function closeAddLead"), BOARD.indexOf("function closeAddLead") + 900);
  assert.match(close, /setDuplicateAckPhone\(""\);/);
  assert.match(close, /setAddLeadDuplicates\(null\);/);
});
