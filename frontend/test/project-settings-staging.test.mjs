import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * What Settings → Project stages, and what its one Save does with it.
 *
 * Reads the source, the way the other settings tests here do: there is no DOM in this suite.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", "components", "project-management", ...parts), "utf8");
const PANEL = read("ProjectSettingsPanel.js");
const SERVICE_DIALOG = read("ServiceDefinitionDialog.js");
const DELIVERABLE_DIALOG = read("DeliverableDefinitionDialog.js");

test("a service is mapped to saved deliverables only, because only those have ids to name", () => {
  // A staged deliverable has no brand or variant ids until Save writes them, and a mapping is
  // three ids or nothing - offering it was a choice that was dropped on the way to the server.
  assert.match(PANEL, /deliverableDefinitions=\{mappableDeliverables\}/);
  assert.doesNotMatch(PANEL, /deliverableDefinitions=\{stagedDeliverables\}/);
  assert.match(PANEL, /const mappableDeliverables = useMemo\(\s*\(\) => deliverables\.filter\(\(row\) => !pending\.deliverables\.deletes\.includes\(row\.id\)\)/);
});

test("a name another row already has is refused in the dialog, not at Save", () => {
  assert.match(PANEL, /takenNames=\{takenDefinitionNameKeys\(stagedServices, serviceDraft\.id \|\| null\)\}/);
  assert.match(PANEL, /takenNames=\{takenDefinitionNameKeys\(stagedDeliverables, deliverableDraft\.id \|\| null\)\}/);
  for (const [dialog, noun] of [[SERVICE_DIALOG, "service"], [DELIVERABLE_DIALOG, "deliverable"]]) {
    assert.match(dialog, /const nameTaken = definitionNameTaken\(named, takenNames\);/);
    assert.match(dialog, new RegExp(`error=\\{nameTaken \\? "A ${noun} with this name already exists\\." : ""\\}`));
    assert.match(dialog, /disabled=\{saving \|\| !named \|\| nameTaken/);
  }
});

test("a row the dialog adds is never called what a row it opened on is called", () => {
  assert.match(DELIVERABLE_DIALOG, /const id = `new-\$\{nextRowId\}`;/);
});

test("a row created whose settings could not be written becomes an edit, not a second create", () => {
  // Otherwise the next Save tries to make it again and is refused as a duplicate, forever.
  assert.match(PANEL, /carried\[section\]\[id\] = settings;/);
  assert.match(PANEL, /const updates = \{ \.\.\.carried\[section\] \};/);
  // And the staging area is read again after the save, so a row staged meanwhile is kept.
  assert.match(PANEL, /setPending\(\(current\) =>/);
  assert.doesNotMatch(PANEL, /setPending\(remaining\)/);
  // A row created by this save and edited again while it ran is patched, never added twice; a
  // patch staged meanwhile is told apart from the one sent by being a different object.
  assert.match(PANEL, /if \(created && created\.entry !== entry && created\.id\) updates\[created\.id\] = entry\.values;/);
  assert.match(PANEL, /if \(done\[section\]\.updates\.get\(id\) !== values\)/);
});

test("deliverables are written before the services that may name their variants", () => {
  const writers = PANEL.slice(PANEL.indexOf("const writers = {"), PANEL.indexOf("for (const [section, writer] of Object.entries(writers))"));
  assert.ok(writers.indexOf("deliverables: {") < writers.indexOf("services: {"));
});
