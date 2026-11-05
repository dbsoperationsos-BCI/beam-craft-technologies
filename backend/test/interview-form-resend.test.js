const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Resend: the candidate applied once, and HR needs them to look at it again.
 *
 * The Interview module's counterpart of the Employee Repository's Send Back, and the reason it
 * exists is what makes it worth pinning: before it, an application that came back with something
 * missing left the register two answers, both bad. Ask for the whole thing again on a new link,
 * which throws away everything the candidate typed - or correct it on their behalf, which puts HR's
 * words in the candidate's mouth. This returns **their own submission on their own link**, with
 * every answer still in it.
 *
 * Four things can go wrong here and none of them announce themselves:
 *
 *   * the form is reopened but the *candidate* is dragged backwards out of a stage somebody moved
 *     them to on purpose;
 *   * a form is reopened onto a link that cannot be sent, because the token is stored hashed and
 *     only a short code survives;
 *   * a reopened form arrives already expired, because its original deadline has passed;
 *   * a refused email is read as a failure, leaving somebody holding a reopened form with no way to
 *     tell the candidate.
 */

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", ...parts), "utf8");
const INVITES = read("modules", "hrm", "interview", "invites.js");
const ROUTES = read("modules", "hrm", "interview", "routes.js");
const TEMPLATES = read("services", "emailTemplates.js");

/* ------------------------------------------------------------------ the route and its guard */

test("resending is a POST on the candidate, behind the register's own permission", () => {
  /*
   * A POST rather than a GET, so `requireModule("HRM", "Interview")` on the router asks for
   * Read / Write - it moves a candidate's stage and emails a person, which is not a read by any
   * reading. Keyed by candidate rather than by invite because that is what the screen asking holds:
   * the record panel is open on a person, not on a form.
   */
  assert.match(ROUTES, /router\.post\("\/candidates\/:id\/resend-form", resendSubmittedForm\);/);
  assert.match(ROUTES, /router\.use\(requireModule\("HRM", "Interview"\)\);/);
  // Mounted after the guard, or the route would be the one way into the register without one.
  assert.ok(
    ROUTES.indexOf('requireModule("HRM", "Interview")') < ROUTES.indexOf("/candidates/:id/resend-form"),
    "the resend route is mounted above the permission guard",
  );
  const { resendSubmittedForm } = require("../src/modules/hrm/interview/invites");
  assert.equal(typeof resendSubmittedForm, "function");
});

/* ------------------------------------------------------- whose form, and what happens to it */

test("the newest submitted form is the one reopened", () => {
  // Somebody asked twice is answered by their most recent application, which is the same rule
  // `candidateFormState` reads the row's menu by.
  assert.match(INVITES, /where: \{ candidateId, status: "Submitted" \},\s*\n\s*orderBy: \{ createdAt: "desc" \},/);
  assert.match(INVITES, /has not submitted an application form, so there is nothing to resend/);
});

test("the form goes back to the state the candidate held it in", () => {
  /*
   * Verified, which is what it was while they had it - and `submittedAt: null`, without which
   * `submitPublicInvite`'s own guard (`status: "Verified", submittedAt: null`) would refuse the
   * next submission and the candidate would be handed a link that takes their edits and throws
   * them away.
   */
  assert.match(INVITES, /data: \{ status: "Verified", submittedAt: null, expiresAt \}/);
});

test("a candidate is only pulled back from the stage the form is the answer to", () => {
  /*
   * The one that matters. A candidate who has since been scheduled, put on hold or selected has
   * been moved by a decision somebody took, and reopening their form must not undo it - so the
   * write names the stage it is allowed to move from rather than setting it outright.
   */
  assert.match(
    INVITES,
    /hrmInterviewCandidate\.updateMany\(\{\s*\n\s*where: \{ id: candidateId, deletedAt: null, status: FORM_SUBMITTED_STATUS \},\s*\n\s*data: \{ status: FORM_PENDING_STATUS \},/,
  );
  // And both moves are one transaction: a form reopened against a stage that did not move is a row
  // whose menu and whose record disagree about what is waiting on whom.
  assert.match(INVITES, /const \[reopened\] = await prisma\.\$transaction\(\[/);
});

test("a reopened form is never handed back already expired", () => {
  // `Math.max`, so a deadline that has already passed is pushed out and one still far off is left
  // alone - a form reopened today that expired yesterday would otherwise be a link that refuses
  // the candidate the moment they open it.
  assert.match(INVITES, /const expiresAt = new Date\(Math\.max\(invite\.expiresAt\.getTime\(\), Date\.now\(\) \+ REOPEN_DAYS \* 24 \* 60 \* 60 \* 1000\)\);/);
  assert.match(INVITES, /const REOPEN_DAYS = 7;/);
});

test("a form with no sendable link is refused rather than quietly reopened", () => {
  /*
   * The token is stored **hashed** and never kept in the clear, so an invite raised before short
   * codes has no link left that anybody - this endpoint included - could put in an email. Reopening
   * it would move a candidate backwards and leave nobody able to tell them.
   */
  assert.match(INVITES, /const applicationUrl = applicationUrlFor\(invite\);\s*\n\s*if \(!applicationUrl\) \{/);
  assert.match(INVITES, /predates resendable links/);
  // Refused *before* anything is written, or the refusal would follow the change it was meant to
  // prevent.
  assert.ok(
    INVITES.indexOf("if (!applicationUrl) {") < INVITES.indexOf("const expiresAt = new Date(Math.max("),
    "the link is checked after the form has already been reopened",
  );
});

/* ------------------------------------------------------------- a refused email is not a failure */

test("a refused email answers 502 with the link, because the reopening already happened", () => {
  /*
   * `smtpPool` answers `{ sent: false }` for one case only - no sender configured at all - and
   * *throws* when senders exist and every one refuses, which is what a spent daily quota looks like.
   * Both are the same answer here: the form is open again either way, and what a failed send costs
   * is only that the candidate has not been told. A 500 with no link would leave somebody holding a
   * reopened form and no way to reach them.
   */
  assert.match(INVITES, /if \(!result\.sent\) emailFailure = result\.reason \|\| "the email could not be sent";/);
  assert.match(INVITES, /catch \(emailError\) \{[\s\S]*?emailFailure = describeMailFailure\(emailError\);/);
  assert.match(INVITES, /if \(emailFailure\) return res\.status\(502\)\.json\(\{ \.\.\.body,/);
  // The link travels on both answers, so the screen can hand over the message either way.
  assert.match(INVITES, /const body = \{ invite: serializeInvite\(reopened, candidates\.get\(reopened\.candidateId\)\), applicationUrl, expiresAt \};/);
  // The reason only, never the thrown text: an SMTP error can quote the message it carried.
  assert.equal(/Resend email refused for invite \$\{invite\.id\}:`, emailError\)/.test(INVITES), false);
});

/* ------------------------------------------------------------------------- what they are sent */

test("a resent form is its own email, not the application invite sent twice", () => {
  /*
   * The same reasoning that gives the onboarding send-back its own template. A candidate who has
   * already filled the form once and is told to "complete your application" a second time reads it
   * as a mistake, or as a form that swallowed what they typed. This one says their application was
   * read, that something needs another look, and that their answers are still in the form.
   */
  const { interviewApplicationResendEmail, interviewApplicationEmail } = require("../src/services/emailTemplates");
  const args = { candidateName: "Asha R", applicationUrl: "https://example.test/interview/apply/A7K9C2M4", expiresAt: new Date("2026-10-01T00:00:00Z"), position: "Photographer" };
  const resend = interviewApplicationResendEmail(args);
  const invite = interviewApplicationEmail({ ...args });

  assert.notEqual(resend.subject, invite.subject, "a resent form must not arrive wearing the invite's subject");
  assert.match(resend.subject, /Update Your Application/);
  // The one promise that makes opening a form a second time bearable, in both halves of the mail.
  assert.match(resend.text, /already filled in/);
  assert.match(resend.html, /already filled in/);
  // The link is in the plain text too - it is what a client with images off shows, and what a
  // screen reader is handed.
  assert.ok(resend.text.includes(args.applicationUrl));
  // The role is named where there is one, so the mail reads as addressed to them.
  assert.match(resend.text, /Photographer/);
  assert.doesNotMatch(interviewApplicationResendEmail({ ...args, position: "" }).text, /position at/);
  // Declared where the rest of the module's mail is, or nothing could send it.
  assert.match(TEMPLATES, /module\.exports = \{[^}]*interviewApplicationResendEmail[^}]*\}/);
  assert.match(read("services", "emailService.js"), /module\.exports = \{[^}]*sendInterviewApplicationResendEmail[^}]*\}/);
});
