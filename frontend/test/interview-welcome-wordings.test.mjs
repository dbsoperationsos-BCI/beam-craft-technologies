import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
 * Settings → Templates → Interview Welcome has two wordings, as New Lead Welcome does: Office time
 * (Interview Welcome itself) and After hours, switched on tabs above the one editor.
 */
const PANEL = readFileSync(new URL("../src/components/settings/InterviewWelcomePanel.js", import.meta.url), "utf8");

test("Office time and After hours are two templates, edited one at a time on tabs", () => {
  assert.match(PANEL, /\{ id: "office", label: "Office time", key: "INTERVIEW_WELCOME", name: "Interview Welcome" \}/);
  assert.match(PANEL, /\{ id: "afterHours", label: "After hours", key: "INTERVIEW_WELCOME_AFTER_HOURS", name: "Interview Welcome - After hours" \}/);
  assert.match(PANEL, /<Tabs tabs=\{WORDINGS\.map/);
  assert.match(PANEL, /templateKey=\{openWording\.key\}\s+helpKey="INTERVIEW_WELCOME"/);
  // Switching with unsaved wording asks first.
  assert.match(PANEL, /if \(unsaved\.current\) setPendingWording\(next\); else setWording\(next\);/);
});
