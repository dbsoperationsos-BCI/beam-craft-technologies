import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");
const OVERLAY = read("components", "settings", "SettingsOverlay.js");
const PANEL = read("components", "settings", "WishesPanel.js");

test("Birthday, Anniversary and Work Anniversary Wishes are tabs inside Wishes Scheduler, under Templates, on SETTINGS / Wishes", () => {
  assert.match(OVERLAY, /useModuleAccess\("SETTINGS", "Wishes"\)/);
  const templates = OVERLAY.slice(OVERLAY.indexOf("const templates = ["), OVERLAY.indexOf('return templates.length ? [{ id: "templates", title: "Templates", children: templates }] : [];'));
  assert.match(templates, /\.\.\.\(canReadMessageTemplates \? \[/);
  // One entry, the Scheduler; the three wordings are its tabs, not entries of their own.
  assert.match(templates, /id: "wishes-scheduler",\s+title: "Wishes Scheduler",\s+render: \(\) => <WishesSchedulerPanel canWrite=\{canWriteWishes\} unsavedRef=\{wishesUnsavedRef\} onNotice=\{setSectionNotice\} onError=\{setLinkError\} \/>,/);
  assert.doesNotMatch(OVERLAY, /id: "(birthday|anniversary|work-anniversary)-wishes"/);
  assert.match(OVERLAY, /"wishes-scheduler": wishesUnsavedRef,/);
  const scheduler = read("components", "settings", "WishesSchedulerPanel.js");
  assert.match(scheduler, /const WISH_TABS = \[\n\s+\{ id: "birthday", label: "Birthday Wishes" \},\n\s+\{ id: "weddingAnniversary", label: "Anniversary Wishes" \},\n\s+\{ id: "workAnniversary", label: "Work Anniversary Wishes" \},\n\];/);
  assert.match(scheduler, /<Tabs tabs=\{WISH_TABS\} value=\{kind\} onChange=\{askKind\}/);
  assert.match(scheduler, /<WishesPanel key=\{kind\} kind=\{kind\} canWrite=\{canWrite\} unsavedRef=\{unsaved\}/);
  // Unsaved wording is asked about before another tab replaces it.
  assert.match(scheduler, /const askKind = \(next\) => \{ if \(next === kind\) return; if \(unsaved\.current\) setPendingKind\(next\); else setKind\(next\); \};/);
});

test("each wish is reworded in place, saved together, and read-only without Read / Write", () => {
  assert.match(PANEL, /<div key=\{wish\.key\} className="space-y-2">\s+<TextAreaField\s+label=\{`Wish \$\{index \+ 1\}`\}/);
  // Each wish is previewed under its box, as typed, filled the way the sender fills it.
  assert.match(PANEL, /<MessagePreview text=\{\(drafts\[wish\.key\] \?\? ""\)\.trim\(\) \? renderTemplate\(drafts\[wish\.key\], KINDS\[kind\]\?\.sample\) : ""\} \/>/);
  assert.match(PANEL, /readOnly=\{!canWrite\}/);
  assert.match(PANEL, /\{canWrite && <div/);
  // Save only once something changed, and never an empty wish.
  assert.match(PANEL, /disabled=\{!changed\.length \|\| empty\} onClick=\{save\}>Save<\/Button>/);
  assert.match(PANEL, /for \(const wish of changed\) updated\.push\(\(await saveWish\(wish\.key, drafts\[wish\.key\]\.trim\(\)\)\)\?\.data\);/);
  assert.doesNotMatch(PANEL, /<textarea|<button|apiRequest|fetch\(/);
});

test("the panel says where and when the wishes are sent, and why the last try failed", () => {
  assert.match(PANEL, /setDelivery\(response\?\.delivery \|\| null\)/);
  assert.match(PANEL, /picked at random and sent at \{delivery\.sendAt\} into the WhatsApp group &quot;\{delivery\.groupName\}&quot;/);
  assert.match(PANEL, /\{delivery\?\.lastError && <p role="alert"/);
});

test("Wishes Scheduler is under Templates, first, above the wishes it sends - on Attendance WhatsApp Report's panel with the wishes' own endpoints", () => {
  assert.match(OVERLAY, /\.\.\.\(canReadWishes \? \[[\s\S]{0,400}id: "wishes-scheduler",\s+title: "Wishes Scheduler",\s+render: \(\) => <WishesSchedulerPanel /);
  const employeeGroup = OVERLAY.slice(OVERLAY.indexOf('id: "employee-certificate"'), OVERLAY.indexOf('return children.length ? [{ id: "employee", title: "Employee", children }] : [];'));
  assert.doesNotMatch(employeeGroup, /id: "wishes-scheduler"/, "no longer under Employee");
  const scheduler = read("components", "settings", "WishesSchedulerPanel.js");
  assert.match(scheduler, /<AttendanceWhatsAppReportPanel onNotice=\{onNotice\} api=\{WISHES_API\} wording=\{WISHES_WORDING\} \/>/);
  assert.match(scheduler, /getStatus: getWishesScheduler,/);
  const service = read("services", "settings", "wishes.service.js");
  assert.match(service, /apiRequest\(`\$\{ROOT\}\/scheduler\/group`, \{ method: "PUT", body: JSON\.stringify\(\{ groupName \}\) \}\)/);
  // The wish lists say where they go: the scheduler's group.
  assert.match(PANEL, /the one named in Wishes Scheduler\./);
});
