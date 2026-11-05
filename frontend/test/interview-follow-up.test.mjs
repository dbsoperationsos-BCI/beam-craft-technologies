import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  CANDIDATE_STATUSES,
  DEFAULT_CANDIDATE_STATUS,
  FOLLOW_UP_STATUS,
  candidateInfoSections,
  candidateStatusStyles,
} from "../src/constants/interviewConfig.js";

/*
 * **Follow Up**: the other half of what an untouched row is for.
 *
 * A candidate nobody has spoken to gets one of two things done to them - the screening form, or a
 * call - and only the first of those was a stage. The second was a remark, or nothing. So a register
 * worked every morning could not tell "nobody has tried this person" from "we have called three
 * times and they have not answered", which are the two rows that need completely different work.
 *
 * What has to stay true:
 *
 *   * it sits **straight after** the stage it answers, or the tab row stops reading as a sequence;
 *   * it is the one stage that asks for a **date** as well as a reason, because it is a decision
 *     about the work rather than about the person - this is worth another try, on this day;
 *   * every attempt **appends**, so three unanswered calls read as three rather than as the last one;
 *   * the whole log is on the record, which is the only place a history of chasing can be read.
 */

const HERE = import.meta.dirname;
const src = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");
const backend = (...parts) => fs.readFileSync(path.join(HERE, "..", "..", "backend", "src", ...parts), "utf8");
const PAGE = src("components", "hrm", "InterviewPage.js");
const DIALOG = src("components", "hrm", "InterviewDecisionDialog.js");
const SERVICE = src("services", "hrm", "interview.service.js");
const FORMATTERS = src("components", "hrm", "interviewInfoFormatters.js");
const CONTROLLER = backend("modules", "hrm", "interview", "controller.js");
const CANDIDATES = backend("modules", "hrm", "interview", "candidates.js");

test("Follow Up sits straight after the stage it answers", () => {
  assert.equal(CANDIDATE_STATUSES[0], DEFAULT_CANDIDATE_STATUS);
  assert.equal(CANDIDATE_STATUSES[1], FOLLOW_UP_STATUS);
  // And the two sides agree on the word. A stage spelled differently on the server filters to an
  // empty tab with nothing on screen to say why.
  assert.match(CANDIDATES, /const FOLLOW_UP_STATUS = "Follow Up";/);
  assert.match(CANDIDATES, /DEFAULT_CANDIDATE_STATUS,\s*\n\s*FOLLOW_UP_STATUS,/);
});

test("it has a colour of its own, read as the stage before it being worked", () => {
  // A stage with no colour draws the shared slate, which is how an *unrecognised* word from a sheet
  // reads - so a real stage without one says "the studio has not named this".
  assert.ok(candidateStatusStyles[FOLLOW_UP_STATUS], "Follow Up has no dot colour");
  assert.notEqual(candidateStatusStyles[FOLLOW_UP_STATUS], candidateStatusStyles[DEFAULT_CANDIDATE_STATUS]);
});

test("a sheet's own words for chasing fold onto it", () => {
  // The words a spreadsheet actually uses. Without these a synced row lands as an unrecognised stage
  // under All, which is the honest reading of a word nobody has named - but these are named now.
  for (const word of ["followup", "callback", "noresponse", "notreachable"]) {
    assert.match(CANDIDATES, new RegExp(`\\["${word}", FOLLOW_UP_STATUS\\]`), `${word} should fold onto Follow Up`);
  }
});

test("it is offered where chasing is the work, and nowhere else", () => {
  /*
   * Yet to Connect and Follow Up itself. Everywhere further on, something has already happened that
   * the move would undo - a form out, a conversation in the diary, an answer given - and a register
   * that let a scheduled candidate be dropped back into the chase would lose the appointment.
   */
  assert.match(PAGE, /const followable = \[DEFAULT_CANDIDATE_STATUS, FOLLOW_UP_STATUS\]\.includes\(candidate\.status\);/);
  /*
   * On a row **already** at Follow Up the entry is named for what it does there. Everywhere else in
   * this menu an entry naming a stage moves the candidate to it, and the two that cannot are
   * withheld - Reject from a rejected row, Put On Hold from one already held - so "Follow Up" on a
   * Follow Up row reads like that same no-op. It is not one: chasing is the one thing here that
   * genuinely happens more than once, and only the word was wrong.
   */
  assert.match(PAGE, /const chasing = candidate\.status === FOLLOW_UP_STATUS;/);
  assert.match(PAGE, /label: chasing \? "Log Another Follow-up" : "Follow Up",/);
  // Beside the screening form, because those two are the whole of what an untouched row offers.
  assert.match(PAGE, /\{ label: "Send Screening Form"[\s\S]{0,400}?\.\.\.\(followable \? \[followUpItem\] : \[\]\),/);
});

test("it is the one stage that asks for a date, and the only one that sends it", () => {
  assert.match(DIALOG, /asksDate: true,/);
  assert.match(DIALOG, /<DateField\s+label="Next Follow-up"/);
  /*
   * `undefined` for the other three, so a rejection cannot blank a follow-up date nobody meant to
   * touch; `null` where Follow Up is saved with the box cleared, which means "there is no next one"
   * and has to stay tellable from "this move says nothing about it".
   */
  assert.match(DIALOG, /decision\.asksDate \? \(nextFollowUpDate \|\| null\) : undefined,/);
  assert.match(SERVICE, /\.\.\.\(nextFollowUpDate === undefined \? \{\} : \{ nextFollowUpDate \}\),/);
  assert.match(CONTROLLER, /if \(nextFollowUpDate !== undefined\) values\.nextFollowUpDate = nextFollowUpDate \|\| null;/);
});

test("every attempt appends, and carries the day it promised", () => {
  /*
   * The record holds one `next_follow_up_date` - the next one - so a candidate chased three times
   * would show the latest day and nothing about what was agreed the other two times. "Called on the
   * 8th, said to try the 15th" is the line worth reading afterwards.
   */
  assert.match(CONTROLLER, /values\.statusNotes = \[\.\.\.held, \{/);
  assert.match(CONTROLLER, /\.\.\.\(nextFollowUpDate \? \{ nextFollowUpDate \} : \{\}\),/);
  assert.match(FORMATTERS, /entry\.nextFollowUpDate && <span[^>]*>· next \{formatDay\(entry\.nextFollowUpDate\)\}<\/span>/);
});

test("the whole log is on the record, under a heading that says what it holds", () => {
  /*
   * The same list the info panel and the panel a double-click opens both draw from. Apart from
   * Remarks, which is HR's single running note and is written over each time it is edited - these
   * are appended and never rewritten.
   */
  const section = candidateInfoSections.find((entry) => entry.fields.some(([key]) => key === "statusNotes"));
  assert.ok(section, "the record no longer shows the log at all");
  assert.equal(section.title, "Follow-ups & Decisions");
  const remarks = candidateInfoSections.find((entry) => entry.title === "Remarks");
  assert.ok(remarks, "HR's own running note should still have its own section");
  assert.notEqual(remarks, section, "the appended log and the single note are two different things");
});
