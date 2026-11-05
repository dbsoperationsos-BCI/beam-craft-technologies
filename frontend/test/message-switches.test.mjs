import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { MESSAGE_SWITCHES, WISH_SWITCH_FOR_TAB, hasMessageSwitch, switchNote } from "../src/lib/messageSwitches.mjs";

/*
 * Settings → Templates' ON / OFF for each message sent over WhatsApp, on screen: the switch above the
 * wording, and every Send WhatsApp absent while its message is OFF or this person's WhatsApp is not
 * linked.
 */

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");

test("the web's switches are the server's, word for word", () => {
  // Read as text: the server's file reaches the database, which a web test has no business opening.
  const server = fs.readFileSync(path.join(import.meta.dirname, "..", "..", "backend", "src", "services", "messageTemplateSwitches.js"), "utf8");
  const switches = server.slice(server.indexOf("const SWITCHES = Object.freeze({"), server.indexOf("});", server.indexOf("const SWITCHES")));
  const pairs = [...switches.matchAll(/^\s+([A-Z_]+): "([^"]+)",$/gm)].map(([, key, label]) => [key, label]);
  assert.deepEqual(Object.fromEntries(pairs), { ...MESSAGE_SWITCHES });
  const wishLine = server.split("\n").find((line) => line.startsWith("const WISH_SWITCHES = new Set("));
  for (const key of Object.values(WISH_SWITCH_FOR_TAB)) assert.ok(wishLine.includes(`"${key}"`), key);
  // The messages that already had a switch keep theirs and have none here.
  for (const key of ["ATTENDANCE_DAILY_REPORT", "PHOTO_SELECTION_SUBMITTED", "INTERVIEW_WELCOME"]) assert.equal(hasMessageSwitch(key), false, key);
  // The offboarding and feedback messages are sent now, so each has its switch.
  for (const key of ["EMPLOYEE_OFFBOARDING_FORM", "EMPLOYEE_OFFBOARDING_REMINDER", "EMPLOYEE_OFFBOARDING_APPROVED", "EMPLOYEE_OFFBOARDING_NOT_ACCEPTED", "FEEDBACK_THANK_YOU", "FEEDBACK_ISSUES"]) assert.equal(hasMessageSwitch(key), true, key);
});

test("the line under a switch says what OFF stops", () => {
  assert.equal(switchNote("LOGIN_CREDENTIALS", false), "Off: not sent, and its Send WhatsApp button is hidden.");
  assert.equal(switchNote("CASH_RECEIVED", false), "Off: not sent, and its Send WhatsApp button is hidden.");
  assert.equal(switchNote("PAYMENT_DUE_REMINDER", false), "Off: not sent.");
  assert.match(switchNote("CASH_RECEIVED", true), /automatically to the project's group, and from the receipt's Send WhatsApp/);
});

test("the switch sits above the wording, saved on its own, and only a writer can move it", () => {
  const panel = read("components", "settings", "MessageTemplatePanel.js");
  /*
   * The Templates panel carries **this branch's** switch - the `enabled` the wording itself holds,
   * written by `PUT /:key/enabled` - rather than develop's `MessageSwitch`, which reads the switch
   * table. Both were built for the same job and this is the one the merge kept; `MessageSwitch`
   * stays for the Wishes panel below, which is still drawn from it.
   */
  assert.match(panel, /\{switchable && <div className="flex flex-wrap items-center justify-between/);
  assert.match(panel, /<ToggleSwitch/);
  const control = read("components", "settings", "MessageSwitch.js");
  assert.match(control, /\{canWrite\s*\? <ToggleSwitch/);
  assert.match(control, /await setMessageTemplateSwitch\(switchKey, next\)/);
  const wishes = read("components", "settings", "WishesSchedulerPanel.js");
  assert.match(wishes, /<MessageSwitch key=\{`switch-\$\{kind\}`\} switchKey=\{WISH_SWITCH_FOR_TAB\[kind\]\} canWrite=\{canWrite\}/);
  // Interview Application Invite has a place under Templates now, with its switch.
  const overlay = read("components", "settings", "SettingsOverlay.js");
  assert.match(overlay, /id: "message-interview-application-invite",\s*title: "Interview Application Invite",\s*render: \(\) => <MessageTemplatePanel\s*templateKey="INTERVIEW_APPLICATION_INVITE"/);
});

test("every Send WhatsApp names its message, so it is absent while that message is OFF", () => {
  for (const [file, key] of [
    [["accounts", "ReceiptMessageDialog.js"], "CASH_RECEIVED"],
    [["employees", "CredentialsCreatedDialog.js"], "LOGIN_CREDENTIALS"],
    [["employees", "OnboardingInviteDialog.js"], "EMPLOYEE_ONBOARDING_INVITE"],
    [["hrm", "InterviewApplicationInviteDialog.js"], "INTERVIEW_APPLICATION_INVITE"],
    [["sales", "ClientLoginReadyDialog.js"], "CLIENT_LOGIN_CREDENTIALS"],
    [["sales", "CrdLinkReadyDialog.js"], "CRD_DOCUMENT_LINK"],
  ]) assert.match(read("components", ...file), new RegExp(`const \\{ canSend \\} = useWhatsappSender\\("${key}"\\);`), key);
});

test("the gallery's and the album's Send to Group are absent until this person's WhatsApp is linked", () => {
  const gallery = read("components", "image-selection", "WhatsAppTemplatePanel.js");
  assert.match(gallery, /\{canWrite && canSend && <button type="button" onClick=\{sendToGroup\}/);
  // Linking from the same panel brings the button back without reopening it.
  assert.match(gallery, /onLinked=\{\(updated\) => \{ onProjectUpdated\?\.\(updated\); setMessage\(""\); refreshSender\(\); \}\}/);
  // Send to Client opens WhatsApp in the browser and needs no link: it stays.
  assert.match(gallery, />Send to Client<\/button>/);
  assert.match(read("components", "image-selection", "signature-album", "SharePanel.js"), /\{canWrite && canSend && share\.whatsappGroupSubject && <Button/);
});

test("the offboarding messages are sent on WhatsApp: the form when raised, and the reminder, confirmation and refusal from the row", () => {
  const dialog = read("components", "employees", "OffboardingInviteDialog.js");
  assert.match(dialog, /\{screen === "sent" && raised && canSendMessage\("EMPLOYEE_OFFBOARDING_FORM"\) && <SendWhatsAppButton/);
  assert.match(dialog, /invite\.status === "Approved" && canSendMessage\("EMPLOYEE_OFFBOARDING_APPROVED"\)\) items\.push\(\{ label: "Send confirmation on WhatsApp"/);
  assert.match(dialog, /invite\.status === "Rejected" && canSendMessage\("EMPLOYEE_OFFBOARDING_NOT_ACCEPTED"\)\) items\.push\(\{ label: "Send the refusal on WhatsApp"/);
  // A reminder only while the link still opens.
  assert.match(dialog, /new Date\(invite\.expiresAt\) > new Date\(\) && canSendMessage\("EMPLOYEE_OFFBOARDING_REMINDER"\)\) items\.push\(\{ label: "Send reminder on WhatsApp"/);
  // The menu is built again once the session and the switches are read.
  assert.match(dialog, /\}, \[busyId, canWrite, copyMessage, onNotice, canSendMessage, messageFor, reminderFor\]\);/);
  assert.match(read("services", "hrm", "offboarding-invites.service.js"), /`\/api\/hrm\/offboarding-invites\/\$\{encodeURIComponent\(id\)\}\/send-whatsapp`, \{ method: "POST", body: JSON\.stringify\(\{ kind, message \}\) \}/);
});

test("the feedback reply is sent on WhatsApp to the client, absent while it is OFF or WhatsApp is not linked", () => {
  const dialog = read("components", "project-management", "FeedbackMessageDialog.js");
  assert.match(dialog, /const \{ canSend \} = useWhatsappSender\(templateKey\);/);
  assert.match(dialog, /\{feedback\.id && canSend && <SendWhatsAppButton className="max-sm:flex-1" message=\{text\} onSend=\{sendOnWhatsApp\} \/>\}/);
  assert.match(dialog, /await sendFeedbackWhatsApp\(feedback\.id, body\)/);
  // The row-menu messages open in the shared dialog, with Copy and Send WhatsApp beside Close.
  const shared = read("components", "shared", "SendMessageDialog.js");
  assert.match(shared, /\{canSend && <SendWhatsAppButton className="max-sm:flex-1" message=\{text\} onSend=\{send\} \/>\}/);
});
