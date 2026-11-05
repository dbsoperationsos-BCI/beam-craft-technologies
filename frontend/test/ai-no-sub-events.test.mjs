import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { shownVisibility, VISIBILITY_OPTIONS } from "../src/lib/aiEventDefaults.mjs";

const aiFeature = path.join(process.cwd(), "src", "components", "ai-feature");
const read = (...parts) => fs.readFileSync(path.join(aiFeature, ...parts), "utf8");
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));

// The AI Feature has no sub events: no tab, no wizard step, no picker, no card, no guest schedule.
test("no AI Feature screen offers or shows a sub event", () => {
  for (const file of files(aiFeature)) assert.doesNotMatch(fs.readFileSync(file, "utf8"), /sub[ -]?events?/i, path.relative(aiFeature, file));
  for (const gone of ["event/tabs/SubEventsTab.js", "event/SubEventDialog.js", "events/wizard/SubEventsStep.js", "guest/GuestSchedule.js"]) assert.equal(fs.existsSync(path.join(aiFeature, gone)), false, gone);
  assert.doesNotMatch(read("event", "AiEventWorkspacePage.js"), /subEvents/);
});

test("a visibility still saved as SUB_EVENT shows as only the photos they are in, and is no longer offered", () => {
  assert.deepEqual(VISIBILITY_OPTIONS.map((option) => option.value), ["ALL", "MATCHED_ONLY"]);
  assert.equal(shownVisibility("SUB_EVENT"), "MATCHED_ONLY");
  assert.equal(shownVisibility("MATCHED_ONLY"), "MATCHED_ONLY");
  assert.equal(shownVisibility(undefined), "");
});
