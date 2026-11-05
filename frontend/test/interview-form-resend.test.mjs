import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { reopenedExpiry, resendFormMessage } from "../src/lib/interviewFormResend.mjs";

/*
 * Resend Form: the candidate has already answered, and HR needs them to look again.
 *
 * The record panel used to offer **Send Screening Form** whatever the candidate had done - so the
 * one row that had already answered was offered the one thing nobody wants: a fresh link, raised
 * from nothing, which reads to a candidate as a form that swallowed what they typed. A submitted
 * form now offers **Resend Form** in its place, which returns their own submission on their own
 * link with every answer still in it.
 *
 * Two halves are worth pinning: the button that appears, and the message HR hands over - because
 * the message is copied *before* anything is sent, and a message that says something the link then
 * contradicts is worse than no message at all.
 */

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");
const PANEL = read("components", "hrm", "InterviewCandidateFormPanel.js");
const PAGE = read("components", "hrm", "InterviewPage.js");
const DIALOG = read("components", "hrm", "ResendApplicationFormDialog.js");

/* --------------------------------------------------------------- which button the record offers */

test("a candidate who has answered is offered Resend Form in place of Send Screening Form", () => {
  /*
   * Never both. They answer opposite questions about the same person - one asks for an application,
   * the other hands back the one already given - so the second **replaces** the first rather than
   * joining it, and the footer draws whichever `formAction` names.
   */
  assert.match(PANEL, /const canResendForm = canWrite && formSubmitted && Boolean\(onResendApplicationForm\);/);
  assert.match(PANEL, /const canSendForm = canWrite && !canResendForm && Boolean\(onSendApplicationForm\);/);
  /*
   * Called **Resend** rather than Resend Form while the panel is reviewing a submission: four
   * buttons share one row there, and inside a review the word "form" is the only thing on screen, so
   * the shorter name says the same thing. The act and the handler are the one act either way.
   */
  assert.match(PANEL, /const formAction = canResendForm\s*\n\s*\? \{ label: review \? "Resend" : "Resend Form", onClick: saveThenResend \}\s*\n\s*: canSendForm \? \{ label: "Send Screening Form", onClick: saveThenSend \} : null;/);
  // One button in the footer, drawn from that one answer - not two conditionals that could both fire.
  assert.match(PANEL, /\{formAction && <Button [^>]*onClick=\{formAction\.onClick\}[^>]*>\{formAction\.label\}<\/Button>\}/);
  assert.equal(PANEL.split('label: "Send Screening Form"').length - 1, 1, "Send Screening Form is drawn from more than one place");
  assert.equal(PANEL.split('onClick: saveThenResend').length - 1, 1, "the resend is drawn from more than one place");
});

test("the record is saved before the form goes back, so HR's own corrections survive it", () => {
  /*
   * The same thing `saveThenSend` does and for the same reason: HR reads a submission, corrects what
   * they can see is wrong here, and *then* asks the candidate for the rest. Without the save, the
   * next thing that happens - the panel closing behind the confirmation - loses them.
   */
  assert.match(PANEL, /async function saveThenResend\(event\) \{[\s\S]*?const found = validate\(\);[\s\S]*?onResendApplicationForm\?\.\(await save\(\)\);/);
  /*
   * And no email check, unlike sending a fresh form. This one goes to the address the **invite**
   * carries - the address the candidate proved to open the form in the first place - so a record
   * whose email column is empty is not a reason to refuse it.
   */
  const body = /async function saveThenResend\(event\) \{([\s\S]*?)\n  \}/.exec(PANEL)?.[1] || "";
  assert.ok(body, "saveThenResend could not be read");
  assert.doesNotMatch(body, /An email address is needed/);
});

test("whether they have answered is read off the form, not off the stage", () => {
  /*
   * A stage is not a form. Somebody moved on to Interview Scheduled has still submitted, and a stage
   * typed straight onto a row by a linked sheet has not - so the page answers from the candidate's
   * latest invite, which is the same reading its row menu already uses.
   */
  assert.match(PAGE, /formSubmitted=\{Boolean\(candidateFormState\.get\(editCandidate\.id\)\?\.submitted\)\}/);
  assert.match(PAGE, /onResendApplicationForm=\{\(saved\) => setResendTarget\(\{/);
});

test("resending is confirmed first, and re-reads both the register and the forms", () => {
  /*
   * Confirmed, unlike Reject beside it: a stage moves back with one press, where this emails a
   * person and a mail that has gone cannot be un-sent. The confirmation is also where the message is
   * offered to copy, so it is worth stopping at.
   *
   * Both lists are re-read because both change - the candidate's stage, and the form that decides
   * which button their record offers next time it is opened.
   */
  assert.match(PAGE, /<ResendApplicationFormDialog/);
  assert.match(PAGE, /await Promise\.all\(\[load\(\{ quiet: true \}\), loadInvites\(\)\]\);/);
  // The panel closes with it: what was on screen was a submission to read, and it is the
  // candidate's again.
  assert.match(PAGE, /setResendTarget\(null\);\s*\n\s*setEditCandidate\(null\);/);
});

test("a refused email finishes like a success rather than reading as a failure", () => {
  /*
   * A 502 means the form **was** reopened and only the email was refused. The reopening happened, so
   * holding the dialog open over it would ask somebody to dismiss a question that has already been
   * answered - and whoever is sending the message by hand already holds it, because the dialog
   * offered it to copy before Resend Form was pressed.
   */
  assert.match(PAGE, /if \(requestError\.status === 502\) \{\s*\n\s*await finish\(\);/);
  assert.match(PAGE, /Send the message to them yourself/);
});

/* ------------------------------------------------------------------- the message HR hands over */

test("the message says the link, and promises the one thing that makes reopening bearable", () => {
  const message = resendFormMessage({
    candidateName: "Asha R",
    applicationUrl: "https://example.test/interview/apply/A7K9C2M4",
    expiresAt: "2026-12-01T00:00:00Z",
  });
  assert.match(message, /^Hi Asha R,/);
  // On its own line: it is pasted into WhatsApp, where a URL sharing a line with a full stop is a
  // URL that will not open.
  assert.ok(message.split("\n").includes("https://example.test/interview/apply/A7K9C2M4"));
  assert.match(message, /still there/);
  assert.match(message, /1 Dec 2026/);
});

test("a nameless candidate and a linkless form both read as sentences rather than as holes", () => {
  const message = resendFormMessage({});
  assert.match(message, /^Hi there,/);
  // The line is left out rather than printing "null" or a blank into something about to be sent to
  // a person - a form raised before short codes has no link, and the endpoint refuses it too.
  assert.doesNotMatch(message, /null|undefined/);
  assert.equal(message.includes("\n\n\n"), false, "a missing link left an empty line behind it");
  // And the dialog says so out loud rather than offering a message with nothing to click.
  assert.match(DIALOG, /!invite\?\.applicationUrl && <p/);
  assert.match(DIALOG, /predates resendable links/);
});

test("the message quotes the deadline the link will have, not the one it had", () => {
  /*
   * The server never shortens a deadline: a reopened form gets its own expiry or a week from now,
   * whichever is later. The message is copied *before* the send, so quoting the stored expiry would
   * tell a candidate they have until a date that may already be past.
   */
  const past = reopenedExpiry("2020-01-01T00:00:00Z");
  assert.ok(past.getTime() > Date.now(), "an expired form's message would promise a date already gone");
  // A deadline still far off is left exactly as it is.
  const far = "2030-01-01T00:00:00Z";
  assert.equal(reopenedExpiry(far).toISOString(), new Date(far).toISOString());
  // And a form with no stored expiry at all still reads as a real date.
  assert.ok(reopenedExpiry(null).getTime() > Date.now());
  assert.doesNotMatch(resendFormMessage({ expiresAt: "2020-01-01T00:00:00Z" }), /2020/);
});
