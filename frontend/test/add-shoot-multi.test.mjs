import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");
const DIALOG = read("components", "project-management", "AddShootDialog.js");
const PANEL = read("components", "sales", "QuotationGeneratorPanel.js");

const LIST = read("components", "project-management", "ProjectShootList.js");
const SECTION = read("components", "project-management", "ProjectServiceCreationSection.js");

test("every screen takes several shoots, adding one or editing one", () => {
  assert.doesNotMatch(DIALOG, /multipleShoots/);
  assert.doesNotMatch(PANEL, /multipleShoots/);
  // One tick-list either way. Editing used to be a single picker, which left a shoot named for two
  // impossible to re-name without typing "Haldi + Mehandi" by hand.
  assert.match(DIALOG, /<MultiSelectField\n\s*label="Shoot"\n\s*required\n\s*searchable/);
  assert.doesNotMatch(DIALOG, /<Dropdown mode="input" searchable label="Shoot"/);
  assert.doesNotMatch(DIALOG, /\bconst multi\b/, "there is no single-shoot mode left to branch on");
  // Editing opens on the names the shoot already carries.
  assert.match(DIALOG, /useState\(\(\) => \(initialShoot \? shootNamesOf\(initialShoot\.shoot\) : \[\]\)\)/);
});

test("a shoot is edited in the Add Shoot dialog, never inline in the shoot list", () => {
  assert.doesNotMatch(LIST, /InlineInput|EditingActions|onSaveEdit/);
  // Duplicate, where a screen offers one, sits between them; editing is still never inline.
  assert.match(LIST, /onRequestEdit, (onRequestDuplicate, )?onRequestDelete/);
  assert.match(SECTION, /readOnly=\{!onRequestEditShoot \|\| !onDeleteShoot\}\n\s*onRequestEdit=\{onRequestEditShoot\}/);
  assert.doesNotMatch(SECTION, /onSaveShootEdit/);
});

test("several ticked shoots become one shoot named for all of them", () => {
  /*
   * A Haldi that runs into a Mehandi is one sitting - one crew, one day - so it is one shoot called
   * "Haldi + Mehandi", the way the studio already writes it by hand ("Wedding + Reception" is in
   * the register). It used to be a row each, which gave one afternoon three shoot ids, three pre
   * production records and three production plans to keep in step.
   */
  assert.match(DIALOG, /const names = selectedShoots;/);
  assert.match(DIALOG, /const shoot = names\.join\(SHOOT_NAME_SEPARATOR\);/);
  assert.match(DIALOG, /import \{[^}]*SHOOT_NAME_SEPARATOR[^}]*\} from "@\/lib\/shootLocations\.mjs";/);
  assert.match(DIALOG, /return \{ rows: \[\{ \.\.\.base, \.\.\.\(allowCustomText \? \{ customText \} : \{\}\), shoot, isMainEvent: Boolean\(currentShoot\.isMainEvent\) \}\] \};/);
  // The Additional Text of each ticked shoot comes with it, rather than being lost in the join.
  assert.match(DIALOG, /names\.map\(customTextFor\)\.filter\(Boolean\)\.join\("; "\)/);
  // All or nothing: the checks run once, before the row is made.
  const rows = DIALOG.slice(DIALOG.indexOf("function formRows()"), DIALOG.indexOf("function withoutDuplicates"));
  assert.ok(rows.indexOf("formError()") < rows.indexOf("names.join"));
  // Save takes the unadded row the same way Add Shoot List does.
  const save = DIALOG.slice(DIALOG.indexOf("async function save()"), DIALOG.indexOf("setSaving(true)"));
  assert.match(save, /const built = formRows\(\);/);
});

test("a name too long for the column is refused in words, not by the server", () => {
  assert.match(DIALOG, /const SHOOT_NAME_MAX_LENGTH = 191;/);
  assert.match(DIALOG, /if \(shoot\.length > SHOOT_NAME_MAX_LENGTH\) \{\n\s*fields\.check\(\{ shoot: `That is a long name for one shoot/);
});

test("one Main Event: the combined shoot carries the toggle, and a shoot already listed is not added again", () => {
  // One row now, so there is no question about which of the ticked names is the Main Event.
  assert.doesNotMatch(DIALOG, /Which shoot is the Main Event\?|mainEventShoot/);
  assert.match(DIALOG, /rows\.some\(\(row\) => row\.isMainEvent\) \? \{ \.\.\.shoot, isMainEvent: false \}/);
  // Already listed means the same shoot with the same Additional Text: Rituals for the bride and for
  // the groom are two shoots.
  assert.match(DIALOG, /const listed = new Set\(pending\.map\(keyOf\)\);/);

  // After a successful add the chosen shoots clear, with the rest of the form, as before.
  assert.match(DIALOG, /setCurrentShoot\(emptyShoot\(\)\);\n    setSelectedShoots\(\[\]\);/);
});

test("a duplicate is never dropped quietly: Save stops and names it, and a partial add is a notice, not an error", () => {
  const save = DIALOG.slice(DIALOG.indexOf("async function save()"), DIALOG.indexOf("setSaving(true)"));
  assert.match(save, /if \(skipped\.length\) \{\n\s*setError\(`\$\{alreadyListed\(skipped\)\}/);
  assert.match(DIALOG, /setNotice\(skipped\.length \?/);
  assert.match(DIALOG, /role="status"/);
  assert.match(DIALOG, /"The details below apply to every shoot selected here\."/);
});

test("editing a shoot saved with an old Shoot Type opens on a type the radio offers", () => {
  assert.match(DIALOG, /const knownTypes = shootTypesOf\(values\)\.filter\(\(type\) => shootTypeOptions\.includes\(type\)\);/);
  assert.match(DIALOG, /shootTypes: knownTypes\.length \? knownTypes : \["Studio \/ In-House"\],/);
});

test("a combined shoot can be held at one place or at a place per name, and stays one shoot either way", () => {
  // Asked only once the shoot is two or more names, on Add and on Edit alike.
  assert.match(DIALOG, /const locationShoots = selectedShoots;/);
  assert.match(DIALOG, /const asksLocationMode = locationShoots\.length > 1;/);
  assert.match(DIALOG, /\{asksLocationMode && <RadioGroupField label="Location" required(?: helperText="[^"]*")? name="locationMode"/);
  // Multiple: a Shoot Place, District and State under each name.
  assert.match(DIALOG, /locationShoots\.map\(\(name, index\) => \{/);
  assert.match(DIALOG, /role="group" aria-labelledby=\{nameId\}/);
  assert.match(DIALOG, /updateLocation\(name, "shootPlace", event\.target\.value\)/);
  // Saved as the one row, carrying each name's place and the columns joined from them.
  assert.match(DIALOG, /shootLocations: locations,/);
  assert.match(DIALOG, /const locations = multipleLocations \? currentLocations\(\) : null;/);
  // Each name must have its place before the row is made; the edit save is checked the same way.
  assert.match(DIALOG, /const locationError = shootLocationsError\(currentLocations\(\)\);/);
  // The edit save goes through `formRows`, which checks the places before it builds the row - so
  // the check is there once, not once per save path.
  const save = DIALOG.slice(DIALOG.indexOf("async function save()"), DIALOG.indexOf("setSaving(true)"));
  assert.match(save, /const built = formRows\(\);\n\s*if \(built\.invalid\) return;/);
  assert.match(DIALOG, /function formRows\(\) \{\n\s*if \(!fields\.check\(formProblems\(\)\)\) return \{ invalid: true \};/);
  // Fewer than two names, or Single chosen, lets the places per name go - Multiple again starts clean.
  assert.match(DIALOG, /if \(values\.length < 2\) leaveMultipleLocations\(values\[0\]\);/);
  assert.match(DIALOG, /setLocationMode\("Single"\);\n\s*setLocationsByShoot\(\{\}\);/);
  // The name still missing its place is marked on its own field, not only in the dialog's error.
  assert.match(DIALOG, /error=\{locationErrorsShown && !String\(location\.shootPlace \|\| ""\)\.trim\(\) \? `Enter the Shoot Place for \$\{name\}\.` : ""\}/);
  // A saved shoot at several places reopens on Multiple, its shared fields on the first place.
  assert.match(DIALOG, /useState\(sourceLocations\.length \? "Multiple" : "Single"\)/);
  assert.match(DIALOG, /const firstPlace = savedShootLocations\(values\)\[0\];/);
});
