import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isCompletePhoneNumber } from "../src/lib/phoneNumber.js";
import { phoneFieldsFor, requiredFieldsFor } from "../src/components/sales/quotationVerticalConfig.js";

/*
 * Generate Quotation refuses a quotation that is not whole: every required field filled, every
 * number typed in whole, the discount within its limit - worked out from the values on screen, and
 * each problem marked under its own box on the press. Save Draft asks less and is not held to it.
 */
const PANEL = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "QuotationGeneratorPanel.js"), "utf8");
const footer = PANEL.slice(PANEL.indexOf("const footer = <>"), PANEL.indexOf("</>;", PANEL.indexOf("const footer = <>")));

test("the required fields are the ones the form already stars, and the numbers are every phone field", () => {
  assert.deepEqual(requiredFieldsFor("Dum Dum", { religion: [{ value: "Hindu" }] }).map((field) => field.key), ["name", "contactNumber", "assignedBranch", "religion"]);
  // A closed list the studio has not filled in is still not demanded.
  assert.ok(!requiredFieldsFor("Dum Dum", { religion: [] }).some((field) => field.key === "religion"));
  assert.deepEqual(phoneFieldsFor("Dum Dum").map((field) => field.key), ["contactNumber", "groomContact", "brideContact", "referenceContact"]);
});

test("a number is whole at ten Indian digits, and half a number is not", () => {
  assert.equal(isCompletePhoneNumber("+91 9876543210"), true);
  assert.equal(isCompletePhoneNumber("+91 98765"), false);
  assert.equal(isCompletePhoneNumber(""), false);
});

test("the press is refused by the problems worked out from the values, each marked under its box", () => {
  assert.match(PANEL, /const missingForGenerate = \[\{ key: "enquiryId", label: "Enquire ID" \}, \.\.\.requiredFieldsFor\(vertical, suggestionLists\)\]\s*\.filter\(\(\{ key \}\) => !String\(identification\[key\] \|\| ""\)\.trim\(\)\)/);
  assert.match(PANEL, /String\(identification\[key\] \|\| ""\)\.trim\(\) && !isCompletePhoneNumber\(identification\[key\]\)/);
  const problems = PANEL.slice(PANEL.indexOf("const generateProblems = () => ({"), PANEL.indexOf("function submit(event)"));
  assert.match(problems, /missingForGenerate\.map/);
  assert.match(problems, /\.\.\.numberErrors/);
  assert.match(problems, /\.\.\.discountProblems\(\)/);
  // Open while nothing is saving; a press on an unfinished quotation marks it rather than sending it.
  // Disabled, too, while the quotation is finalized or this version superseded (`quotation-lifecycle`).
  assert.match(footer, /<Button type="submit" variant="primary" busy=\{saving && !savingDraft\} disabled=\{saving \|\| locked\}/);
  const submit = PANEL.slice(PANEL.indexOf("function submit(event)"), PANEL.indexOf("/** Everything on screen"));
  assert.match(submit, /if \(refuse\(generateProblems\(\)\)\) return;\s*onGenerate\?\.\(quotationPayload\(\)\);/);
  // `refuse` marks the boxes and says how many in the form's notice.
  assert.match(PANEL, /function refuse\(problems\) \{\s*if \(fields\.check\(problems\)\) return false;\s*showError\(markedFieldsMessage\(/);
});

test("Save Draft is not held to Generate's list, and every problem is said under its own field", () => {
  assert.match(footer, /<Button type="button" onClick=\{saveDraft\} busy=\{savingDraft\} disabled=\{saving\}/);
  const saveDraft = PANEL.slice(PANEL.indexOf("function saveDraft()"), PANEL.indexOf("What stands between this form and Generate Quotation"));
  assert.doesNotMatch(saveDraft, /generateProblems/);
  assert.match(PANEL, /<QuotationVerticalFields vertical=\{vertical\} values=\{identification\} onChange=\{updateIdentification\} errors=\{\{ \.\.\.fields\.errors, \.\.\.numberErrors \}\} \/>/);
  assert.match(PANEL, /onChange=\{\(value\) => updateIdentification\("enquiryId", value\)\}\s*error=\{fields\.errors\.enquiryId\}/);
});
