import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Reading a submitted application is **Review**, and a review ends in an answer.
 *
 * The register's Form Submitted tab exists because somebody has to read what a candidate sent back
 * and decide what happens next. The row offered **Edit**, which is a different question - "something
 * on this record is wrong" rather than "what do we do about this person" - and the panel it opened
 * ended in **Save Changes**, which is not an answer to anything. So a tab whose whole reason is a
 * decision was worked as a tidying job, and the deciding happened somewhere else or not at all.
 *
 * One word on the menu and one footer is the whole of the change. What has to stay true:
 *
 *   * **Review** is only for Form Submitted - every other stage still says Edit, because every other
 *     stage really is a correction;
 *   * the same panel opens either way, since a submission is read by reading it;
 *   * the review's four answers are all there, and the forward one is the primary;
 *   * Schedule Meeting **saves first** and books against what was just saved, like the two buttons
 *     beside it - a schedule opened from an unsaved form loses the corrections behind it.
 */

const HERE = import.meta.dirname;
const src = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");
const PAGE = src("components", "hrm", "InterviewPage.js");
const PANEL = src("components", "hrm", "InterviewCandidateFormPanel.js");

test("a candidate whose form has come back is Reviewed, and everyone else is Edited", () => {
  assert.match(PAGE, /const reviewing = candidate\.status === FORM_SUBMITTED_STATUS;/);
  assert.match(PAGE, /const editItem = \{ label: reviewing \? "Review" : "Edit", onSelect: \(\) => setEditCandidate\(candidate\) \}/);
  /*
   * The same reading decides the footer, and it is made **once**, on the page. The menu and the
   * panel it opens must not disagree about which errand this is: a row that said Review opening a
   * panel that ended in Save Changes would be the old behaviour wearing the new word.
   */
  assert.match(PAGE, /review=\{editCandidate\.status === FORM_SUBMITTED_STATUS\}/);
});

test("the review ends in its four answers, and the forward one is the primary", () => {
  /*
   * Discard, Resend, Save, Schedule Meeting. Save is deliberately **not** primary in a review: the
   * answer a review exists to reach is the meeting, and Save is what somebody presses when they have
   * not reached one yet.
   */
  assert.match(PANEL, /\{review \? "Discard" : "Cancel"\}/);
  assert.match(PANEL, /label: review \? "Resend" : "Resend Form"/);
  assert.match(PANEL, /variant=\{canSchedule \? "secondary" : "primary"\}/);
  assert.match(PANEL, /\{saving \? "Saving\.\.\." : review \? "Save" : "Save Changes"\}/);
  assert.match(PANEL, /\{canSchedule && <Button [^>]*variant="primary" onClick=\{saveThenSchedule\}/);
});

test("Discard is named for what it does to the edits, not to the application", () => {
  // "Cancel" in front of an application somebody is reading reads as cancelling the application,
  // which is the one thing it does not do - it closes the panel and keeps no corrections.
  assert.match(PANEL, /<Button className="max-sm:flex-1" type="button" onClick=\{onClose\}[^>]*>\{review \? "Discard" : "Cancel"\}<\/Button>/);
});

test("Schedule Meeting appears only where a page is listening for it", () => {
  // A panel opened with no handler - a read-only viewer, or a caller that does not own the schedule
  // dialog - draws three buttons rather than a fourth that leads nowhere.
  assert.match(PANEL, /const canSchedule = canWrite && review && Boolean\(onScheduleInterview\);/);
});

test("the meeting is booked against what was just saved", () => {
  /*
   * Saves first, exactly as Send Screening Form and Resend do: HR reads a submission, corrects what
   * they can see is wrong, and *then* decides. A schedule opened from an unsaved form would book the
   * round against the details last written and lose the corrections as the panel closed behind it.
   */
  assert.match(PANEL, /async function saveThenSchedule\(event\) \{[\s\S]*?const found = validate\(\);[\s\S]*?onScheduleInterview\?\.\(await save\(\)\);/);
  /*
   * And which errand the dialog opens on is read from the **saved** candidate's own round count, not
   * from the row the panel was opened from: a review left open while somebody else scheduled a round
   * would otherwise book a second Round 1 over the first.
   */
  assert.match(PAGE, /const alreadySeen = Number\(target\?\.interviewRound\) > 0;/);
  assert.match(PAGE, /setScheduleCandidate\(\{ candidate: target, mode: alreadySeen \? SCHEDULE_MODES\.next : SCHEDULE_MODES\.first \}\)/);
});

test("four buttons still fit a phone", () => {
  // Below `sm` the footer is one row that does not wrap, so four buttons share about 300px. The
  // shorter word says the same thing in the space there is, rather than wrapping to two lines
  // inside its own button.
  assert.match(PANEL, /<span className="sm:hidden">Schedule<\/span><span className="max-sm:hidden">Schedule Meeting<\/span>/);
  assert.match(PANEL, /className="max-sm:flex-1" type="button" variant="primary" onClick=\{saveThenSchedule\}/);
});
