import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { duplicateShootValues } from "../src/lib/shootDuplicate.mjs";

const read = (file) => fs.readFileSync(new URL(`../src/components/${file}`, import.meta.url), "utf8");
const DIALOG = read("project-management/AddShootDialog.js");
const PANEL = read("sales/QuotationGeneratorPanel.js");

/*
 * The Shoot List's ⋮ offers Duplicate on Projects (Start / Edit Project), on Bookings & Converted
 * (Create / Edit Project) and on the Quotation Generator: the shoot dialog opens to add a shoot,
 * filled with every detail of the one copied except Shoot, which is left for the person to choose,
 * and Save adds it as a new shoot - never as the Main Event.
 */

const source = () => ({
  id: 41, shootId: "SID-0041", projectId: 7, clientKey: "k1",
  shoot: "Bride Haldi", shootTypes: ["Outdoor / On-Location"], shootType: "Outdoor / On-Location",
  shootPlace: "qwerty", district: "Agra", state: "Uttar Pradesh", dateCreated: "2026-10-01",
  sessionTimings: ["Half Session"], sessionTiming: "Half Session", sessionDurationHours: 0, sessionDurationMinutes: 0,
  foodTakenCareBy: "Studio", accommodation: "Client", travel: "Studio", preference: "Both",
  customText: "Bride Varatham", isMainEvent: true,
});

test("a duplicate's draft is the source with Shoot cleared and nothing else changed", () => {
  const original = source();
  const draft = duplicateShootValues(original);
  assert.equal(draft.shoot, "", "Shoot is left for the person to choose");
  const { shoot: _s, isMainEvent: _m, ...rest } = draft;
  const { shoot: _os, isMainEvent: _om, ...expected } = original;
  assert.deepEqual(rest, expected, "every other value is as the source holds it");
  // The source is untouched, and nothing is shared between the two.
  assert.deepEqual(original, source());
  assert.notEqual(draft.shootTypes, original.shootTypes);
  assert.notEqual(draft.sessionTimings, original.sessionTimings);
});

test("a copy is never the Main Event: the mark stays on the shoot it was copied from", () => {
  assert.equal(duplicateShootValues(source()).isMainEvent, false);
  assert.equal(duplicateShootValues({ ...source(), isMainEvent: false }).isMainEvent, false);
});

test("false, 0, empty and optional values are kept as they are, not replaced by defaults", () => {
  const draft = duplicateShootValues({ shoot: "Reception", shootPlace: "", district: "", state: "", dateCreated: null, sessionDurationHours: 0, sessionDurationMinutes: 0, customText: null, isMainEvent: false, foodTakenCareBy: "Client" });
  assert.deepEqual(draft, { shoot: "", shootPlace: "", district: "", state: "", dateCreated: null, sessionDurationHours: 0, sessionDurationMinutes: 0, customText: null, isMainEvent: false, foodTakenCareBy: "Client" });
  assert.equal(duplicateShootValues(null), null);
});

test("the shoot dialog opens a Duplicate as a new shoot filled from the one copied, Shoot unchosen", () => {
  assert.match(DIALOG, /import \{ duplicateShootValues \} from "@\/lib\/shootDuplicate\.mjs";/);
  assert.match(DIALOG, /useState\(\(\) => emptyShoot\(initialShoot \|\| \(copyOf \? duplicateShootValues\(copyOf\) : null\)\)\)/);
  // The Shoot field starts empty on a Duplicate exactly as on Add Shoot; only Edit opens on a shoot.
  // A Duplicate has no `initialShoot`, so it still opens with nothing ticked; editing opens on the
  // names the shoot already carries.
  assert.match(DIALOG, /const \[selectedShoots, setSelectedShoots\] = useState\(\(\) => \(initialShoot \? shootNamesOf\(initialShoot\.shoot\) : \[\]\)\);/);
  assert.doesNotMatch(DIALOG, /copyOf\?\.shoot/);
  assert.match(DIALOG, /title=\{isEdit \? "Edit Shoot" : copyOf \? "Duplicate Shoot" : "Add Shoot"\}/);
  // A Shoot has to be chosen before it saves - the same check Add Shoot makes.
  assert.match(DIALOG, /if \(!shoot\.shoot\) problems\.shoot = "Choose the shoot\.";/);
  assert.match(DIALOG, /if \(!shoot\.shootPlace\.trim\(\)\) problems\.shootPlace = "Enter the shoot place\.";/);
});

test("the copied shoot's Additional Text goes onto the shoot chosen for the copy", () => {
  // Held aside while nothing is chosen, since the boxes are keyed by the shoot's name.
  assert.match(DIALOG, /const copiedCustomText = copyOf && !initialShoot \? String\(copyOf\.customText \|\| ""\)\.trim\(\) : "";/);
  // Choosing a shoot gives it that text; one already holding typed text keeps it; one taken out of
  // the selection takes its box with it.
  assert.match(DIALOG, /setCustomTextByShoot\(\(current\) => Object\.fromEntries\(values\.map\(\(name\) => \[name, name in current \? current\[name\] : copiedCustomText\]\)\)\);/);
  // Only an Edit opens on a shoot's own text.
  // Keyed by the first name now the boxes are one per name - a shoot of one name is unchanged.
  assert.match(DIALOG, /const \[first\] = shootNamesOf\(initialShoot\?\.shoot \|\| ""\);\n\s*return first && initialShoot\?\.customText \? \{ \[first\]: String\(initialShoot\.customText\) \} : \{\};/);
});

test("both project screens offer Duplicate and hand the dialog the shoot to copy", () => {
  const plan = read("project-management/useProjectPlan.js");
  assert.match(plan, /onDuplicateShoot: openDuplicateShootDialog,/);
  assert.match(plan, /copyOf: copyingShoot,/);
  assert.match(read("project-management/StartProjectFormPanel.js"), /copyOf=\{plan\.shootDialog\.copyOf\}/);
  const create = read("sales/CreateProjectFormPanel.js");
  assert.match(create, /onDuplicateShoot=\{shootsFromQuotation \? undefined : openDuplicateShootDialog\}/);
  assert.match(create, /initialShoot=\{editingShoot\?\.shoot\} copyOf=\{copyingShoot\}/);
  assert.match(create, /initialShoot=\{plan\.shootDialog\.initialShoot\} copyOf=\{plan\.shootDialog\.copyOf\}/);
});

test("the Quotation Generator's Duplicate opens the same dialog, and Save adds the copy with its lines", () => {
  assert.match(PANEL, /const \[copyingShoot, setCopyingShoot\] = useState\(null\);/);
  // Duplicate opens the dialog on the shoot - it adds nothing until Save.
  assert.match(PANEL, /function duplicateShoot\(shoot\) \{\n\s*const source = shoots\.find\(\(row\) => row\.id === shoot\.id\);\n\s*if \(!source\) return;\n\s*setEditingShoot\(null\);\n\s*setCopyingShoot\(source\);\n\s*setShootDialogOpen\(true\);\n\s*\}/);
  assert.match(PANEL, /if \(copyingShoot\) \{\n\s*addDuplicatedShoots\(copyingShoot, rows\);\n\s*setCopyingShoot\(null\);\n\s*setShootDialogOpen\(false\);\n\s*return;\n\s*\}/);
  assert.match(PANEL, /copyOf=\{copyingShoot\}/);
  assert.match(PANEL, /onClose=\{\(\) => \{ setShootDialogOpen\(false\); setEditingShoot\(null\); setCopyingShoot\(null\); \}\}/);
  // Handed over with the section's other editors, which a finalized quotation withholds.
  assert.match(PANEL, /onDuplicateShoot: duplicateShoot,/);
});
