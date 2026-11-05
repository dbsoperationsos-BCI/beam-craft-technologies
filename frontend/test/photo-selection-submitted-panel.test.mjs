import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");

test("Photo Selection Submitted is one Templates entry: its notification above its wording, each half on its own permission", () => {
  const overlay = read("components/settings/SettingsOverlay.js");
  assert.match(overlay, /useModuleAccess\("SETTINGS", "Automatic WhatsApp Message"\)/);
  // Offered to whoever can open either half.
  assert.match(overlay, /\.\.\.\(canReadAutomaticWhatsApp \|\| canReadMessageTemplates \? \[\{\s+id: "message-photo-selection-submitted",\s+title: "Photo Selection Submitted",\s+render: \(\) => <NotificationTemplatePanel/);
  assert.match(overlay, /notification=\{canReadAutomaticWhatsApp \? <PhotoSelectionSubmittedPanel onNotice=\{setSectionNotice\} canWrite=\{canWriteAutomaticWhatsApp\} \/> : null\}/, "the switch, group and sender answer to their own row, and nothing about the wording is passed down");
  assert.match(overlay, /message=\{canReadMessageTemplates \? <MessageTemplatePanel\s+templateKey="PHOTO_SELECTION_SUBMITTED"\s+canWrite=\{canWriteMessageTemplates\}/, "the wording is one of the app's templates, on Message Template");
  assert.match(overlay, /"message-photo-selection-submitted": messageTemplateUnsavedRef/, "an unsaved wording warns before the section is left");
  // The Automatic WhatsApp Message group is gone, and a link to its old screen still lands here.
  assert.doesNotMatch(overlay, /id: "automatic-whatsapp-message"|id: "photo-selection-submitted"/);
  assert.match(overlay, /"photo-selection-submitted": "message-photo-selection-submitted",/);
});

test("the panel is the attendance report's own panel with this notification's api and words - its switch included - and nothing about the wording", () => {
  const panel = read("components/settings/PhotoSelectionSubmittedPanel.js");
  assert.match(panel, /<AttendanceWhatsAppReportPanel onNotice=\{onNotice\} api=\{API\} wording=\{WORDING\} canWrite=\{canWrite\} \/>/);
  assert.doesNotMatch(panel, /setSendAt/, "no daily time: it goes when a client submits");
  assert.match(panel, /setEnabled: setPhotoSelectionNotificationEnabled,/, "the switch is the shared panel's, on this notification's own endpoint");
  for (const key of ["switchNote", "switchAria", "switchedOn", "switchedOff"]) assert.ok(panel.includes(`${key}:`), `${key} is said in this notification's words`);
  assert.doesNotMatch(panel, /DashboardCard|ToggleSwitch|useState|getPhotoSelectionNotification\(\)/, "no card, switch or status read of its own: one panel, one request");
  assert.doesNotMatch(panel, /MessageTemplatePanel|renderTemplate|title="Wording"|onOpenWording/, "no wording section of any kind: the template is edited under Templates");
  assert.doesNotMatch(panel, /<(button|input|select|table|textarea)\b/, "raw markup where a component exists");
  const shared = read("components/settings/AttendanceWhatsAppReportPanel.js");
  assert.match(shared, /const scheduled = typeof api\.setSendAt === "function";/, "the shared panel drops Sends daily at for an api without a time");
  // One Notification card for a message with a switch: the switch in its header for whoever may move it, On / Off as text for a reader, the sections inside.
  assert.match(shared, /const switchable = typeof api\.setEnabled === "function";/);
  assert.match(shared, /const canSwitch = typeof canWrite === "boolean" \? canWrite : Boolean\(status\.canChooseSenders\);/);
  assert.match(shared, /switchable\s+\? <DashboardCard\s+title="Notification"\s+noteAsTip\s+note=\{wording\.switchNote\}\s+action=\{canSwitch\s+\? <ToggleSwitch[\s\S]*\{sections\}\s+<\/DashboardCard>\s+: sections;/);
  assert.match(shared, /const response = await api\.setEnabled\(next\);\s+if \(response\?\.data\) setStatus\(response\.data\);/, "the switch is saved on the server, whose answer is the status - no second read that would overwrite a name or time still being typed");
  assert.match(shared, /\{children\}/);
  const editor = read("components/settings/MessageTemplatePanel.js");
  const help = editor.slice(editor.indexOf("PHOTO_SELECTION_SUBMITTED: {"), editor.indexOf("CASH_RECEIVED: {"));
  const sample = editor.slice(editor.indexOf("SAMPLE_BY_KEY = {"), editor.indexOf("export default function MessageTemplatePanel"));
  for (const name of ["client name", "project name", "event name", "category breakdown", "total selected count", "deliverables", "selected count", "submitted at"]) {
    assert.equal((help.match(new RegExp(`"${name}":`, "g")) || []).length, 1, `${name} is explained once in the editor`);
    assert.ok(sample.includes(`"${name}":`), `${name} has a sample value for the preview`);
  }
  assert.match(editor, /const filled = sample && body\.trim\(\) \? renderTemplate\(body, sample\) : "";/, "the preview fills the draft as typed, not the saved copy");
  assert.match(read("constants/settingsHelp.js"), /"message-photo-selection-submitted": `Tells a WhatsApp group when a client submits/, "a group message is not described as sent to the client");
  const service = read("services/settings/automatic-whatsapp.service.js");
  for (const path of ["/photo-selection", "/photo-selection/senders/candidates", "/photo-selection/enabled", "/photo-selection/group", "/photo-selection/senders"]) assert.ok(service.includes(path), path);
});

test("the Activity Log names the trigger", () => {
  assert.match(read("lib/whatsappActivity.mjs"), /PHOTO_SELECTION_SUBMITTED: "Photo selection submitted"/);
});
