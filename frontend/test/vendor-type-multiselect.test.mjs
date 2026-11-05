import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { vendorFormSections, emptyValues } from "../src/constants/formPanelConfig.js";

/*
 * Vendors → Add Vendor → Business Details: Vendor Type is a multi-select, held in the form as the
 * comma-joined string the column stores ("Photographer, Editor") - the shape Employee's Department
 * uses - so nothing converts it between the record, the form and the API.
 */

const PANEL = fs.readFileSync(path.join(process.cwd(), "src", "components", "assets", "VendorFormPanel.js"), "utf8");
const field = vendorFormSections.find((section) => section.id === "business").fields.find((entry) => entry.name === "vendorType");

test("Vendor Type is the panel's own multi-select, still required, in Business Details", () => {
  assert.equal(field.type, "custom");
  assert.equal(field.required, true);
  // Drawn with the shared MultiSelectField, searchable, and joined back into one string.
  assert.match(PANEL, /vendorType: \(\{ values, context \}\) => <VendorTypeField/);
  assert.match(PANEL, /<MultiSelectField\s+label="Vendor Type"\s+(?:helperText="[^"]*"\s+)?required/);
  assert.match(PANEL, /onChange=\{\(next\) => onChange\(next\.join\(", "\)\)\}/);
  // Offered the Vendor Types list the form already loads.
  assert.match(PANEL, /options=\{context\.options\?\.vendorTypes\}/);
});

test("editing a vendor opens with its saved types, as the string the record holds", () => {
  assert.equal(emptyValues(vendorFormSections, { vendorType: "Photographer, Editor" }).vendorType, "Photographer, Editor");
  assert.equal(emptyValues(vendorFormSections, null).vendorType, "");
});

test("saving with no type is stopped on the field, before it reaches the server", () => {
  assert.match(PANEL, /vendorType: splitTypes\(form\.vendorType\)\.length \? "" : "Choose at least one vendor type\.",/);
  assert.match(PANEL, /if \(!ok\) return;\s+const \{ vendorId, \.\.\.payload \} = form;/);
  assert.match(PANEL, /error=\{context\.errors\?\.vendorType\}/);
  // A type on the record that has left the list is still shown, so it can be removed.
  assert.match(PANEL, /const all = \[\.\.\.listed, \.\.\.selected\.filter\(\(item\) => !listed\.includes\(item\)\)\];/);
});

test("Preferred Languages and Skills show their chips inside the input box, through the shared fields", () => {
  // Languages: the shared chips-in-the-box field, with its email rule switched off - a space does not
  // split "Old English", only a comma or semicolon does.
  assert.match(PANEL, /preferredLanguages: \(\{ values, context \}\) => <EmailChipsField/);
  assert.match(PANEL, /isValid=\{anyLanguage\}/);
  assert.match(PANEL, /const LANGUAGE_SEPARATORS = \/\[,;\]\+\/;/);
  assert.doesNotMatch(PANEL, /function LanguageField/);
  // Skills: the grouped list stays, with the chosen skills as chips inside its search box.
  assert.match(PANEL, /<SearchableMultiSelect chips label="Skills"/);
});

test("the shared fields keep their old behaviour for every caller that does not opt in", () => {
  const chipsField = fs.readFileSync(path.join(process.cwd(), "src", "components", "shared", "EmailChipsField.js"), "utf8");
  assert.match(chipsField, /isValid = isEmail,\s+invalidMessage = notAnEmail,\s+separators = SEPARATORS,/);
  const searchable = fs.readFileSync(path.join(process.cwd(), "src", "components", "shared", "SearchableMultiSelect.js"), "utf8");
  assert.match(searchable, /chips = false,/);
  // Without `chips` it is still the plain search box.
  assert.match(searchable, /: <TextField label=\{label\} required=\{required\} type="search"/);
});

test("Capabilities has Supported Branches: a multi-select of the studio's branches, sent as ids", () => {
  const capabilities = vendorFormSections.find((section) => section.id === "capabilities").fields.map((entry) => entry.name);
  assert.deepEqual(capabilities, ["preferredLanguages", "skills", "supportedBranchIds", "canBeProductionTeamMember"]);
  assert.match(PANEL, /supportedBranchIds: \(\{ values, context \}\) => <SupportedBranchesField/);
  assert.match(PANEL, /<MultiSelectField\s+label="Supported Branches"\s+(?:helperText="[^"]*"\s+)?searchable/);
  // The live branch list, re-read when a branch is saved in Settings.
  assert.match(PANEL, /getMasterData\("branches", \{ active: true \}\)/);
  assert.match(PANEL, /\}, \[branchRegistryRevision\]\);/);
  // Held as strings by the picker, opened from the vendor's ids, and sent back as numbers.
  assert.match(PANEL, /supportedBranchIds: \(vendor\?\.supportedBranchIds \|\| \[\]\)\.map\(String\),/);
  assert.match(PANEL, /supportedBranchIds: \(payload\.supportedBranchIds \|\| \[\]\)\.map\(Number\),/);
  // And the details panel lists them by name.
  const info = fs.readFileSync(path.join(process.cwd(), "src", "constants", "infoPanelConfig.js"), "utf8");
  assert.match(info, /\["supportedBranchNames", "Supported Branches"\]/);
});

test("Capabilities ends with a Yes / No radio: can this vendor be a production team member", () => {
  const fields = vendorFormSections.find((section) => section.id === "capabilities").fields;
  assert.deepEqual(fields.map((entry) => entry.name), ["preferredLanguages", "skills", "supportedBranchIds", "canBeProductionTeamMember"]);
  const radio = fields.at(-1);
  assert.equal(radio.type, "radio");
  assert.equal(radio.label, "Can be a production team member?");
  // Two answers, so only one can be chosen.
  assert.deepEqual(radio.options, ["Yes", "No"]);
  // No unless the record says Yes, so a new vendor's form opens with No chosen; sent back as true / false.
  assert.match(PANEL, /const toYesNo = \(value\) => \(value === true \? "Yes" : "No"\);/);
  assert.match(PANEL, /const fromYesNo = \(value\) => value === "Yes";/);
  assert.match(PANEL, /canBeProductionTeamMember: toYesNo\(vendor\?\.canBeProductionTeamMember\),/);
  assert.match(PANEL, /canBeProductionTeamMember: fromYesNo\(payload\.canBeProductionTeamMember\),/);
  // And the details panel reads it as Yes / No.
  const info = fs.readFileSync(path.join(process.cwd(), "src", "constants", "infoPanelConfig.js"), "utf8");
  assert.match(info, /\["canBeProductionTeamMember", "Can Be a Production Team Member", "boolean"\]/);
});

test("a new vendor's form opens with No chosen for the production-team question", () => {
  // The panel's own conversion, run: a new vendor has no record, an old one may have false.
  const toYesNo = new Function(`return ${PANEL.match(/const toYesNo = (\(value\) => \(value === true \? "Yes" : "No"\));/)[1]}`)();
  assert.equal(toYesNo(undefined), "No");
  assert.equal(toYesNo(false), "No");
  assert.equal(toYesNo(true), "Yes");
});
