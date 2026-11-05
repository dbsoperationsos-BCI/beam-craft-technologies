import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ATTENDANCE_REPORT_PLACEHOLDERS } from "../src/lib/attendanceReport.mjs";

const read = (file) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
const OVERLAY = read("components/settings/SettingsOverlay.js");
const TEMPLATES = OVERLAY.slice(OVERLAY.indexOf("const templates = ["), OVERLAY.indexOf('return templates.length ? [{ id: "templates", title: "Templates", children: templates }] : [];'));

/*
 * Every automatic WhatsApp message is one Templates entry, laid out as Interview Welcome: its
 * notification (switch, time, senders, group) above its wording. The Automatic WhatsApp Message
 * group is gone; each half keeps its own permission and endpoint, so nothing about sending moved.
 */
test("the Automatic WhatsApp Message group is gone, and links to its old screens land on the Templates entries", () => {
  assert.doesNotMatch(OVERLAY, /id: "automatic-whatsapp-message"|title: "Automatic WhatsApp Message"/);
  for (const [from, to] of [["attendance-whatsapp-report", "message-attendance-report"], ["photo-selection-submitted", "message-photo-selection-submitted"], ["new-lead-welcome", "message-crm-lead-welcome-verticals"]]) {
    assert.ok(OVERLAY.includes(`"${from}": "${to}",`), `${from} → ${to}`);
    assert.doesNotMatch(OVERLAY, new RegExp(`id: "${from}"`), `${from} is not a screen of its own any more`);
  }
  assert.match(OVERLAY, /const initialSection = MOVED_SECTIONS\[requestedSection\] \|\| requestedSection;/);
});

test("each automatic message is one entry: notification on its own permission, wording on Message Template", () => {
  const entries = [
    ["message-attendance-report", "Attendance WhatsApp Report", "admittedToAttendanceReport || isAttendanceReportSender", "<AttendanceWhatsAppReportPanel onNotice={setSectionNotice} />", '<MessageTemplatePanel\n            templateKey="ATTENDANCE_DAILY_REPORT"'],
    ["message-photo-selection-submitted", "Photo Selection Submitted", "canReadAutomaticWhatsApp", "<PhotoSelectionSubmittedPanel onNotice={setSectionNotice} canWrite={canWriteAutomaticWhatsApp} />", '<MessageTemplatePanel\n            templateKey="PHOTO_SELECTION_SUBMITTED"'],
    ["message-crm-lead-welcome-verticals", "New Lead Welcome", "canReadAutomaticWhatsApp", "<NewLeadWelcomePanel onNotice={setSectionNotice} canWrite={canWriteAutomaticWhatsApp} />", "<LeadWelcomeVerticalTemplates"],
  ];
  for (const [id, title, gate, notification, message] of entries) {
    const at = TEMPLATES.indexOf(`id: "${id}"`);
    assert.ok(at > -1, `${id} is under Templates`);
    const entry = TEMPLATES.slice(at, TEMPLATES.indexOf("}] : []),", at));
    assert.ok(entry.includes(`title: "${title}"`), title);
    assert.ok(entry.includes("<NotificationTemplatePanel"), `${title} is laid out as Interview Welcome`);
    assert.ok(entry.includes(`notification={${gate} ? ${notification} : null}`), `${title}'s notification answers to its own permission`);
    assert.ok(entry.includes(`message={canReadMessageTemplates ? ${message}`), `${title}'s wording answers to Message Template`);
    assert.ok(TEMPLATES.includes(`...(${gate} || canReadMessageTemplates ? [{\n        id: "${id}"`), `${title} is offered to whoever can open either half`);
    assert.equal((OVERLAY.match(new RegExp(`id: "${id}"`, "g")) || []).length, 1, `${title} appears once`);
  }
  // Interview Welcome is as it was.
  assert.match(TEMPLATES, /id: "message-interview-welcome",\s+title: "Interview Welcome",\s+render: \(\) => <InterviewWelcomePanel/);
});

test("the shared layout is the notification above the wording, nothing else", () => {
  const panel = read("components/settings/NotificationTemplatePanel.js");
  assert.match(panel, /<div className="max-w-5xl space-y-4">\s+\{notification\}\s+\{message\}\s+<\/div>/);
  assert.doesNotMatch(panel, /apiRequest|fetch\(|useState/);
});

test("the attendance report's wording is previewed: every placeholder it fills has a sample", () => {
  const editor = read("components/settings/MessageTemplatePanel.js");
  assert.match(editor, /ATTENDANCE_DAILY_REPORT: ATTENDANCE_REPORT_PLACEHOLDERS,/);
  const sampleAt = editor.indexOf("  ATTENDANCE_DAILY_REPORT: { date:");
  assert.ok(sampleAt > -1);
  const sample = editor.slice(sampleAt, editor.indexOf("\n", sampleAt));
  for (const name of Object.keys(ATTENDANCE_REPORT_PLACEHOLDERS)) {
    assert.ok(sample.includes(name.includes(" ") || name.includes("-") ? `"${name}":` : `${name}:`), `${name} has a sample value`);
  }
});

/*
 * Every Templates entry previews its wording with sample details: every key the Settings rail opens a
 * MessageTemplatePanel on has a sample, and that sample fills every placeholder the editor lists for
 * it - so nothing in a preview is left as a bare {placeholder} the sender would have filled.
 */
test("every template the Settings rail offers has a preview sample that fills each of its placeholders", async () => {
  const editor = read("components/settings/MessageTemplatePanel.js");
  const keys = new Set([...OVERLAY.matchAll(/templateKey[=:]\s*"([A-Z_]+)"/g)].map((match) => match[1]));
  for (const [key] of OVERLAY.matchAll(/\["(SHOOT_CREW_[A-Z]+)",/g)) keys.add(key.replace(/[[\]",]/g, ""));
  keys.add("SHOOT_CREW_ASSIGNED"); keys.add("SHOOT_CREW_REMOVED");
  // Interview Welcome's two wordings and New Lead Welcome's per-vertical ones read their help key's sample.
  keys.add("INTERVIEW_WELCOME"); keys.add("CRM_LEAD_WELCOME");
  const samples = editor.slice(editor.indexOf("const SAMPLE_BY_KEY = {"), editor.indexOf("const AFTER_FILL_BY_KEY"));
  const help = editor.slice(editor.indexOf("const PLACEHOLDER_HELP_BY_KEY = {"), editor.indexOf("const NO_PLACEHOLDERS"));
  for (const key of keys) {
    const line = samples.split("\n").find((row) => row.startsWith(`  ${key}: {`));
    assert.ok(line, `${key} has a preview sample`);
    // The editor's placeholder list for the key: its own block, or a shared list imported for it.
    const start = help.indexOf(`  ${key}: `);
    if (start < 0) continue;
    const rest = help.slice(start + key.length + 4);
    if (!rest.startsWith("{")) continue; // a shared list (attendance, production) - checked by its own test
    const block = rest.slice(0, rest.indexOf("\n  },"));
    const names = [...block.matchAll(/^\s+(?:"([^"]+)"|([a-z]+)):/gm)].map((match) => match[1] || match[2]);
    for (const name of names) assert.ok(line.includes(`"${name}":`) || line.includes(` ${name}:`), `${key}: {${name}} has a sample value`);
  }
});

test("the production messages' samples fill every production placeholder", async () => {
  const { PRODUCTION_MESSAGE_PLACEHOLDERS } = await import("../src/lib/productionSteps.mjs");
  const editor = read("components/settings/MessageTemplatePanel.js");
  for (const key of ["PRODUCTION_STARTED_FROM_STUDIO", "PRODUCTION_REACHED_SHOOT_PLACE", "PRODUCTION_SHOOT_COMPLETED"]) {
    const at = editor.indexOf(`  ${key}: { "project name"`);
    assert.ok(at > -1, `${key} has a sample`);
    const line = editor.slice(at, editor.indexOf("\n", at));
    for (const name of Object.keys(PRODUCTION_MESSAGE_PLACEHOLDERS)) assert.ok(line.includes(`"${name}":`) || line.includes(` ${name}:`), `${key}: {${name}}`);
  }
});

test("the receipt's preview carries its invoice link as the sender does, even where the wording leaves it out", () => {
  const editor = read("components/settings/MessageTemplatePanel.js");
  assert.ok(editor.includes("CASH_RECEIVED: (text, sample) => (text.includes(sample[\"invoice link\"]) ? text : `${text.trimEnd()}\\n\\nInvoice: ${sample[\"invoice link\"]}`),"), "the receipt preview appends the invoice link as the sender does");
  assert.match(editor, /const preview = filled && AFTER_FILL_BY_KEY\[helpKey\] \? AFTER_FILL_BY_KEY\[helpKey\]\(filled, sample\) : filled;/);
});
