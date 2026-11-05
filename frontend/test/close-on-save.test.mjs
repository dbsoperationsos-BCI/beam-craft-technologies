import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

// A popup's primary button closes the window once the save succeeds; a failed save keeps it open.
test("Pre Production's General panel closes once it is saved", () => {
  assert.match(read("components/project-management/PreProductionProjectEditor.js"),
    /onSaved=\{async \(message\) => \{ await onReload\?\.\(\); setGeneralOpen\(false\); onSuccess\?\.\(message\); \}\}/);
});

test("a shoot's plan closes its panel when saved, however the panel was opened", () => {
  assert.doesNotMatch(read("components/project-management/production/ProductionShootPanel.js"), /closeOnSave/);
});

test("booking a project from Meetings leaves the panel to show the client's login before it closes", () => {
  const page = read("components/sales/MeetingsPage.js");
  assert.match(page, /onSaved=\{\(\) => \{ showSuccess\("The project is created\."\); void loadSchedule\(\); \}\}/);
});
