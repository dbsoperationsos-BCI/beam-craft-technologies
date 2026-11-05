import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * A save or sync that worked is said in the green notice, as the number of records it added -
 * never on the error line, where "N skipped" (rows simply already here) read as a failure.
 */
const SECTION = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "settings", "GoogleSheetsIntegrationSection.js"), "utf8");

const { addedNotice } = new Function(`${SECTION.slice(SECTION.indexOf("function addedNotice("), SECTION.indexOf("\nfunction describeSyncSummary("))}\nreturn { addedNotice };`)();
const LEADS = { noun: "lead", nounPlural: "leads" };

test("the notice is the added count alone, 0 included, in the integration's own noun", () => {
  assert.equal(addedNotice({ created: 12, skipped: 340, skippedExisting: 340 }, LEADS), "12 leads were added.");
  assert.equal(addedNotice({ created: 1, skipped: 5 }, LEADS), "1 lead was added.");
  assert.equal(addedNotice({ created: 0, skipped: 800 }, LEADS), "0 leads were added.");
  assert.equal(addedNotice(null, LEADS), "0 leads were added.");
  assert.equal(addedNotice({ created: 2 }, { noun: "candidate", nounPlural: "candidates" }), "2 candidates were added.");
});

test("saving and syncing report success through onNotice, clearing the error line", () => {
  assert.match(SECTION, /setLinkError\(""\);\n\s*onNotice\?\.\(`\$\{verb\}\. \$\{addedNotice\(summary, config\)\}`\);/);
  assert.match(SECTION, /setLinkError\(""\);\n\s*onNotice\?\.\(`Sync complete\. \$\{addedNotice\(summary, config\)\}`\);/);
  assert.doesNotMatch(SECTION, /setLinkError\(`Sync complete:/, "a finished sync is on the error line again");
  assert.doesNotMatch(SECTION, /setLinkError\(`\$\{verb\}: \$\{describeSyncSummary/, "a finished save is on the error line again");
});

test("a save or sync clears the notice as it starts, so the same answer twice still shows", () => {
  // The panel remembers a dismissed notice by its text; only an empty notice lets it go.
  const sync = SECTION.slice(SECTION.indexOf("const handleSyncSheetLink"));
  assert.match(sync.slice(0, sync.indexOf("await api.sync(")), /onNotice\?\.\(""\);/);
  const save = SECTION.slice(SECTION.indexOf("const handleSaveSheetLink"));
  assert.match(save.slice(0, save.indexOf("try {")), /onNotice\?\.\(""\);/);
});
