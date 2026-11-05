import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Send WhatsApp, beside Copy, on the two screens that hand somebody something private.
 *
 * The onboarding invite and the new joiner's login already showed the finished wording in a box
 * with a Copy button; the studio then left the app, opened WhatsApp and pasted it. The button
 * sends it from the sender's own paired account instead.
 *
 * What is pinned here is the part that is easy to get wrong and impossible to see in a screenshot:
 * that the button is opt-in so the four screens that only copy are untouched, that what is sent is
 * what is on screen, that a second press cannot send twice, and that somebody without a linked
 * WhatsApp is told what to do rather than shown nothing.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");
const CONTROL = read("components", "shared", "ShareableMessage.js");
const BUTTON = read("components", "shared", "SendWhatsAppButton.js");
const HOOK = read("components", "shared", "useWhatsappSender.js");
const INVITE = read("components", "employees", "OnboardingInviteDialog.js");
const CREDENTIALS = read("components", "employees", "CredentialsCreatedDialog.js");
const SCREENING = read("components", "hrm", "InterviewApplicationInviteDialog.js");
const PAGE = read("components", "employees", "EmployeeVerificationPage.js");

test("the box publishes its wording; the button lives in the dialog's footer", () => {
  /*
   * A dialog's actions belong beside Close and Send Invite, where the reader already looks for what
   * to do next - and a footer is a sibling of the message box, not something it can render into. So
   * the box owns the wording and hands it over, and each dialog draws the button.
   */
  assert.match(CONTROL, /onTextChange \}\) \{/);
  assert.doesNotMatch(CONTROL, /SendWhatsAppButton|onSendWhatsApp/, "the box draws the send button again");
  assert.match(INVITE, /\{canSend && <SendWhatsAppButton className="max-sm:flex-1" message=\{messageText\} onSend=\{sendInviteOnWhatsApp\} \/>\}/);
  assert.match(CREDENTIALS, /\{employeeId && canSend && <SendWhatsAppButton className="max-sm:flex-1" message=\{messageText\} onSend=\{sendOnWhatsApp\} \/>\}/);
  // The screening form is the interview flow's own, sent the same way from the same footer. Its
  // "Send Onboarding Invite" needs nothing here: it opens the employee dialog above.
  assert.match(SCREENING, /\{canSend && <SendWhatsAppButton className="max-sm:flex-1" message=\{messageText\} onSend=\{sendInviteOnWhatsApp\} \/>\}/);
  assert.match(read("components", "hrm", "InterviewPage.js"), /import OnboardingInviteDialog from "@\/components\/employees\/OnboardingInviteDialog";/);
});

test("a WhatsApp send does not claim the email has gone", () => {
  /*
   * `sendMessage` is what disables Send Form / Send Invite and relabels it "Sent". Writing a
   * WhatsApp result into it would shut the button that sends the email and say it had already
   * gone - so the two results are held apart, and both are shown.
   */
  for (const [name, source] of [["the screening form", SCREENING], ["the onboarding invite", INVITE]]) {
    assert.match(source, /const \[whatsappNotice, setWhatsappNotice\] = useState\(""\);/, name);
    assert.match(source, /setWhatsappNotice\(result\?\.message/, name);
    assert.match(source, /setWhatsappError\(requestError\.data\?\.message/, name);
    const handler = source.slice(source.indexOf("async function sendInviteOnWhatsApp"));
    const body = handler.slice(0, handler.indexOf("\n  }"));
    assert.doesNotMatch(body, /setSendMessage|setSendError/, `${name} writes its WhatsApp result into the email's`);
  }
});

test("the screens that only copy are untouched", () => {
  /*
   * `ShareableMessage` is on six screens. Four of them - the interview form invite, a resent
   * application form, a send-back, the album and event shares - only copy, and a button under them
   * would be one nobody had decided the recipient or the permission for.
   */
  for (const [folder, file] of [["hrm", "ResendApplicationFormDialog.js"], ["employees", "SendBackDialog.js"]]) {
    const source = read("components", folder, file);
    assert.doesNotMatch(source, /SendWhatsAppButton|onTextChange/, `${file} grew a send without a decision about who it writes to`);
  }
});

test("it is WhatsApp's own green, and the mark the share rail already uses", () => {
  // Rather than a second WhatsApp look invented for these two dialogs.
  assert.match(BUTTON, /import WhatsApp from "@mui\/icons-material\/WhatsApp";/);
  assert.match(BUTTON, /!border-green-200 !text-green-700/);
  assert.match(BUTTON, /<WhatsApp style=\{\{ fontSize: 15 \}\} aria-hidden="true" \/>/);
  assert.match(read("components", "image-selection", "signature-album", "SharePanel.js"), /!border-green-200 !text-green-700/);
});

test("the footer sends the text on screen, not the template it started as", () => {
  /*
   * The box is editable on purpose - somebody adds a line about when to start, or writes it in the
   * candidate's own language - so a send that posted the original would discard that silently.
   * Published on every edit *and* when the message arrives, or the footer would hold the empty
   * string it was mounted with.
   */
  assert.match(CONTROL, /onTextChange\?\.\(event\.target\.value\)/);
  assert.match(CONTROL, /onTextChange\?\.\(message \|\| ""\); \}, \[message, onTextChange\]\)/);
  assert.match(BUTTON, /await onSend\(message\)/);
  assert.match(INVITE, /onTextChange=\{setMessageText\}/);
  assert.match(CREDENTIALS, /onTextChange=\{setMessageText\}/);
  assert.match(INVITE, /sendOnboardingInviteWhatsApp\(createdInvite\.id, text\)/);
  assert.match(CREDENTIALS, /sendCredentialsWhatsApp\(employeeId, text\)/);
});

test("a second press cannot send the message twice", () => {
  /*
   * On WhatsApp a duplicate is not a row somebody deletes - it is the studio's number writing to a
   * person twice, which is both embarrassing and exactly the behaviour the account is watched for.
   */
  assert.match(BUTTON, /if \(sending\) return;/);
  assert.match(BUTTON, /busy=\{sending\}/);
  // And an empty box is not a message.
  assert.match(BUTTON, /disabled=\{Boolean\(disabledReason\) \|\| !String\(message \|\| ""\)\.trim\(\)\}/);
});

test("Send WhatsApp is shown only to somebody whose WhatsApp is linked and switched on", () => {
  /*
   * Pressing it otherwise would only be refused, so the button is not drawn: WhatsApp on for the
   * studio and for them, and their own WhatsApp linked to the app. Until the session answers, and if
   * it cannot be read, it stays hidden - it never shows and then disappears. The message it sends
   * must be switched on under Settings → Templates too; a switch that cannot be read counts as ON.
   */
  assert.match(HOOK, /const \[canSend, setCanSend\] = useState\(false\);/);
  assert.match(HOOK, /setCanSend\(on && session\.chatEnabled !== false && session\.userChatEnabled !== false && session\.status === "connected"\);/);
  assert.match(HOOK, /getMessageTemplateSwitches\(\)\.then\(\(response\) => response\?\.data\?\.\[templateKey\] !== false\)\.catch\(\(\) => true\)/);
  assert.match(HOOK, /\.catch\(\(\) => \{ if \(!cancelled\) setCanSend\(false\); \}\);/);
});

test("the credentials dialog is given the record, and offers nothing without one", () => {
  // The number is read off the employee server-side, so the dialog needs the id and nothing else -
  // and with no id there is no recipient, so there is no button rather than one that always fails.
  assert.match(PAGE, /employeeId: selectedEmployee\?\.id \?\? savedForCredentials\?\.id \?\? null,/);
  assert.match(CREDENTIALS, /\{employeeId && canSend && <SendWhatsAppButton/);
});

test("the invite card reports what actually happened, not always the email", () => {
  // The same card now reports two different sends, so it says what came back rather than the one
  // sentence it used to hard-code.
  assert.match(INVITE, /\{sendMessage && <p role="status"[^>]*>\{sendMessage\}<\/p>\}/);
});

test("neither dialog sends the recipient's number", () => {
  // It is read off the record server-side. A number travelling from the browser would make these
  // a way to send WhatsApp to anybody from the studio's paired phone.
  for (const [name, source] of [["the invite", INVITE], ["the credentials", CREDENTIALS]]) {
    assert.doesNotMatch(source, /send(OnboardingInvite|Credentials)WhatsApp\([^)]*phone/, `${name} dialog sends a phone number`);
  }
});
