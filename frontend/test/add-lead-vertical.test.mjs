import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { normalizeVertical } from "../src/lib/crmOptions.js";
import { CALLS_BOARD } from "../src/lib/crmBoards.js";

/*
 * Which vertical Add Lead opens on.
 *
 * It opened on Dum Dum whatever board was being read, so somebody working Qua Qua had to move the
 * radio before every lead they added - and one nobody moved was filed in the wrong vertical, under
 * the wrong enquiry id, on a board its owner never looks at. It opens on the board being read.
 *
 * The Call Box is the exception and has to stay one: it is the queue of callers nobody has placed,
 * and which of the three verticals they belong to is the single question that board exists to ask.
 */

const PAGE = fs.readFileSync(
  path.join(import.meta.dirname, "..", "src", "components", "sales", "CRMPage.js"),
  "utf8",
);

test("a board lends its vertical, and the Call Box lends none", () => {
  /*
   * `normalizeVertical` is what decides, and it already answers "" for anything that is not one of
   * the three - which is exactly the Call Box. Pinned here because the button leans on that: the
   * fallback `|| current.vertical` is what keeps the Dum Dum the form opens with.
   */
  for (const board of ["Dum Dum", "Qua Qua", "Corp"]) {
    assert.equal(normalizeVertical(board), board, `${board} no longer lends its own vertical`);
  }
  assert.equal(normalizeVertical(CALLS_BOARD), "", "the Call Box now lends a vertical it does not have");
});

test("the Add Lead button opens the form on the board being read", () => {
  const button = PAGE.slice(PAGE.indexOf('setAssigningCallId("");'));
  assert.match(
    button,
    /const next = leadFormForVertical\(current, normalizeVertical\(board\) \|\| current\.vertical, customFieldsByVertical\);/,
    "Add Lead opens on a fixed vertical again",
  );
  /*
   * And it no longer reads `current.board`. `current` is the *form*, which has a `vertical` and has
   * never had a `board`, so the line it replaced was seeding the custom-field defaults of a vertical
   * named `undefined` - which is to say seeding nothing, silently, for as long as it stood.
   */
  const code = PAGE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /customFieldsByVertical\[current\.board\]/, "the button reads a `board` off the form again");
});

test("Next Follow-up Date opens on today, on all three verticals", () => {
  /*
   * A lead being written down is one somebody is about to work - that is what the Interested it
   * opens on means - and the next call is almost always the same day it was taken. Left blank it was
   * a required-in-practice field answered by hand on every lead, and the ones nobody filled in are
   * the leads that appear on no Pending Followups tab and are chased by nobody.
   *
   * On the form itself rather than per vertical, so all three get it and a vertical added later
   * would too.
   */
  assert.match(PAGE, /nextFollowUpDate: getLocalDateKey\(\),/, "Add Lead opens with no follow-up date again");

  /*
   * And re-stamped when the dialog is opened, because `emptyLeadForm` is read when the *page* is
   * built - a board left open overnight would otherwise offer yesterday.
   *
   * Filled only when blank, never overwritten: closing Add Lead deliberately keeps an unsaved draft,
   * so a date somebody typed, or one cleared by marking the lead Rejected, is their answer and not
   * this button's to replace.
   */
  assert.match(PAGE, /const dated = next\.nextFollowUpDate \? next : \{ \.\.\.next, nextFollowUpDate: getLocalDateKey\(\) \};/);

  /*
   * The Enquiry Date is the opposite case, and deliberately so: it is *always* overwritten when the
   * dialog opens.
   *
   * It is not a field on the form - the studio asked for it to go, because a lead typed in as it
   * comes in is today's enquiry and being asked is noise - so nothing on screen can correct a stale
   * one. Both ways it goes stale are ordinary: `emptyLeadForm` stamps it when the page is built, so
   * a board left open overnight would file this morning's lead under yesterday, and a kept draft
   * carries whatever day it was started on. Today New Leads reads exactly this value.
   */
  assert.match(PAGE, /return \{ \.\.\.dated, createdDate: getLocalDateKey\(\) \};/, "Add Lead can file a lead under a stale day again");
  assert.doesNotMatch(PAGE, /<DateField label="Enquiry Date"/, "Add Lead is asking for the Enquiry Date again");

  // It is still cleared by the two statuses that end a conversation - a lead nobody is chasing
  // carries no date for the next call.
  assert.match(PAGE, /const STATUSES_WITHOUT_FOLLOW_UP = \["Invalid", "Rejected"\];/);
  assert.match(PAGE, /if \(key === "leadStatus" && STATUSES_WITHOUT_FOLLOW_UP\.includes\(value\)\) \{/);
});

test("the radio and the button move the form by one rule, not two", () => {
  /*
   * They had drifted into two: the radio reset a status the new vertical does not offer and seeded
   * that vertical's Table Settings fields, and the button did neither. Two callers of one idea is
   * how the button came to open a form that was only half moved.
   */
  assert.match(PAGE, /function leadFormForVertical\(form, vertical, customFieldsByVertical = \{\}\) \{/);
  assert.match(PAGE, /if \(key === "vertical"\) return leadFormForVertical\(next, value, customFieldsByVertical\);/, "the Vertical radio moves the form its own way again");

  const rule = PAGE.slice(PAGE.indexOf("function leadFormForVertical("), PAGE.indexOf("function emptyLeadForm()"));
  // Qua Qua alone offers "Converted & Followup"; left standing on Corp it is a status with no pill
  // lit to say so and no way to change it back.
  assert.match(rule, /leadStatusOptionsForVertical\(vertical\)\.some\(\(option\) => option\.value === next\.leadStatus\)/);
  assert.match(rule, /next\.leadStatus = "Interested";/);
  // Answers already typed win over the new vertical's defaults, since a field can exist on both.
  assert.match(rule, /next\.customFields = \{ \.\.\.customFieldDefaults\(customFieldsByVertical\[vertical\]\), \.\.\.\(next\.customFields \|\| \{\}\) \};/);
});
