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
const PANEL = src("components", "hrm", "InterviewCandidatePopup.js");

test("a candidate whose form has come back is Reviewed, and everyone else is Edited", () => {
  assert.match(PAGE, /const reviewing = candidate\.status === FORM_SUBMITTED_STATUS;/);
  assert.match(PAGE, /const editItem = \{ label: reviewing \? "Review" : "Edit", onSelect: \(\) => openCandidatePopup\(candidate\) \}/);
  /*
   * The same reading decides the footer, and it is made **once**, on the page. The menu and the
   * panel it opens must not disagree about which errand this is: a row that said Review opening a
   * panel that ended in Save Changes would be the old behaviour wearing the new word.
   */
  assert.match(PAGE, /review=\{editCandidate\.status === FORM_SUBMITTED_STATUS\}/);
});

test("the review ends in two answers, and Update is the one that finishes it", () => {
  /*
   * Discard, Update. **Update is the primary**, and in a review it says *Save Review* - which is a
   * change from the panel this replaced, where Schedule Meeting was primary on the argument that the
   * answer a review reaches is the meeting.
   *
   * That argument moved rather than failing. The answer a review reaches is now *in* the popup: the
   * stage pills in the Follow-up Details card, with the remark that explains the decision in the tab
   * beside them. Choosing a pill that is a consequence of an act - Interview Scheduled among them -
   * opens that act's own form directly through `forward`, so scheduling is one of the things a
   * reviewer might do on the way to Update rather than a footer button of its own beside it.
   */
  assert.match(PANEL, /variant="primary" busy=\{saving\} busyLabel="Updating\.\.\." onClick=\{\(\) => void save\(\)\}/);
  assert.match(PANEL, /\{review \? "Save Review" : "Update and Close"\}/);
  // Two, and no decisions among them: those are pills in the card above, so the footer cannot be a
  // second way to set the same field with the reason left out.
  for (const word of ["Selected", "On Hold", "Rejected"]) {
    assert.equal(PANEL.includes(`>{"${word}"}<`), false, `${word} should not be a footer button`);
  }
  assert.equal(PANEL.includes("BULK_STAGE_STATUSES"), false, "the decisions belong to the pills now");
});

test("Discard is named for what it does to the edits, not to the application", () => {
  /*
   * "Cancel" in front of an application somebody is reading reads as cancelling the application, which
   * is the one thing it does not do. The panel said Discard only while reviewing; the popup says it
   * always, because it is always true of the popup - and what makes it honest is the unsaved guard
   * behind it, which asks before anything typed is actually thrown away.
   */
  // No `mr-auto`: it sits with the other buttons at the right, as every footer's do
  // (`form-footer-buttons.test.mjs`). The word is what this test is about, not where it is.
  assert.match(PANEL, /<Button type="button" onClick=\{requestClose\} disabled=\{saving\}>Discard<\/Button>/);
  assert.equal(PANEL.includes('"Cancel"'), false, "Cancel is the wrong word in front of an application");
  assert.match(PANEL, /useUnsavedGuard\(dirty, \{/);
});

test("scheduling is a pill away, not a footer button of its own", () => {
  /*
   * The footer used to draw a fourth button, gated on whether a page was listening for it - a popup
   * opened with no schedule handler drew three buttons rather than a fourth that saved the record and
   * then visibly did nothing. That whole question is gone with the button: choosing **Interview
   * Scheduled** above already refuses through `refusedStatuses` wherever the handler was not passed
   * (see `interview-candidate-popup.test.mjs`), which is the one place this now needs answering.
   */
  assert.equal(PANEL.includes("canSchedule"), false, "the footer no longer gates a button on this");
  const footer = PANEL.slice(PANEL.indexOf('justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3'));
  assert.equal(footer.includes("Schedule"), false, "Schedule is a pill now, not a footer button");
});

test("the act's form is booked against what was just saved", () => {
  /*
   * `forward` saves first and only then hands the saved record to the act's handler - a form opened
   * against an unsaved edit would book the round, or raise the invite, against the details last
   * written rather than the corrections on screen, and lose them as the popup closed behind it.
   */
  assert.match(PANEL, /function forward\(handler\) \{[\s\S]*?const saved = await persist\(\);[\s\S]*?if \(saved\) handler\?\.\(saved\);/);
  /*
   * And which errand the schedule dialog opens on is read from the **saved** candidate's own round
   * count, not from the row the popup was opened from: a review left open while somebody else
   * scheduled a round would otherwise book a second Round 1 over the first.
   */
  assert.match(PAGE, /const alreadySeen = Number\(target\?\.interviewRound\) > 0;/);
  assert.match(PAGE, /setScheduleCandidate\(\{ candidate: target, mode: alreadySeen \? SCHEDULE_MODES\.next : SCHEDULE_MODES\.first \}\)/);
});

test("two buttons still fit a phone", () => {
  // The footer wraps at 360px rather than scrolling sideways.
  assert.match(PANEL, /flex shrink-0 flex-wrap items-center justify-end gap-2 border-t/);
});

// Marking a candidate Onboarded from inside their popup opens the onboarding invite over that
// full-screen form, not underneath it - the layer rule the resend dialog on the same screen follows.
test("the onboarding invite opened from the candidate's form stacks over the form", () => {
  const source = (file) => fs.readFileSync(new URL(`../src/components/${file}`, import.meta.url), "utf8");
  const page = source("hrm/InterviewPage.js");
  assert.match(page, /<OnboardingInviteDialog[\s\S]*?layer=\{editCandidate \? "dialogOverPanel" : "dialog"\}/, "over the form when the form is open, from the page otherwise");
  const dialog = source("employees/OnboardingInviteDialog.js");
  assert.match(dialog, /layer = "dialog" \}\) \{/, "a page that opens it without saying gets a plain dialog");
  assert.match(dialog, /<Dialog\n\s+title=\{title\}\n\s+description=\{description\}\n\s+layer=\{layer\}/, "and the layer reaches the Dialog itself");
});
