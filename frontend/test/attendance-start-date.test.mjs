import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * "Attendance starts on" in Settings → Employee → Attendance Rules: the day the studio's attendance
 * starts being counted. The shared date field, read-only without the Attendance Rules permission,
 * and sent with the rest of the rules - blank as null, which clears it.
 */
const PANEL = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "hrm", "AttendanceRulesPanel.js"), "utf8");

test("the date is the shared DateField, read-only where the rules are", () => {
  assert.match(PANEL, /import DateField from "@\/components\/shared\/DateField";/);
  assert.match(PANEL, /<DateField label="Attendance starts on"[^>]*value=\{form\.attendanceStartDate \|\| ""\}[^>]*readOnly=\{readOnly\}/);
  assert.match(PANEL, /onChange=\{\(next\) => update\("attendanceStartDate", next \|\| ""\)\}/);
  // It says what it does, in the studio's words, beside the field.
  assert.match(PANEL, /Nothing before this date counts for anyone: no Absent, no Late, no hours short, and no regularization./);
  assert.match(PANEL, /Leave it blank to count every day./);
});

test("the save sends it, and a cleared field sends null", () => {
  // Sent by the Working day section's own save, with the rest of that section.
  const workingDay = PANEL.slice(PANEL.indexOf("workingDay: () => ({"), PANEL.indexOf("casualLeave: () => ({"));
  assert.match(workingDay, /attendanceStartDate: form\.attendanceStartDate \|\| null,/);
});

test("changing the start date is confirmed first, since it re-counts everybody's past days", () => {
  assert.match(PANEL, /const startChanged = \(form\.attendanceStartDate \|\| ""\) !== \(settings\?\.attendanceStartDate \|\| ""\);/);
  // The Working day section's Save asks first when the start date moved; Casual Leave's when its policy did.
  assert.match(PANEL, /const needsConfirming = \{ workingDay: startChanged, casualLeave: casualChanged \};/);
  assert.match(PANEL, /onClick=\{\(\) => requestSave\(section\)\}/);
  assert.match(PANEL, /\{confirming && <ConfirmDialog[\s\S]*?confirmLabel=\{confirming === "workingDay" \? "Change start date" : "Save Casual Leave rules"\}[\s\S]*?onConfirm=\{\(\) => save\(confirming\)\}/);
  assert.match(PANEL, /Nothing is deleted - moving the date earlier counts those days again\./);
});
