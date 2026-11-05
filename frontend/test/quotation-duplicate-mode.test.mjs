import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (file) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", file), "utf8");
const PAGE = read("QuotationPage.js");
const GENERATOR = read("QuotationGeneratorPanel.js");

/*
 * Duplicate and Edit are two flows through one form. Edit raises the next version of the quotation
 * it was opened on; Duplicate opens a copy that saves as a new quotation - a new number, version 01 -
 * and never writes to the source. These hold the two apart.
 */

test("Duplicate opens the generator on a copy, not as an edit of the source", () => {
  assert.match(PAGE, /label: "Duplicate", onSelect: \(\) => void openDuplicate\(quotation\.id\)/);
  // The source goes into its own state and never into `editingQuotation`, which is what means "edit".
  const opener = PAGE.slice(PAGE.indexOf("const openDuplicate = useCallback"), PAGE.indexOf("}, [showError]);", PAGE.indexOf("const openDuplicate = useCallback")));
  assert.match(opener, /setEditingQuotation\(null\);/);
  assert.match(opener, /setDuplicateSource\(response\.data\);/);
  assert.match(PAGE, /duplicateOf=\{editingQuotation \? null : duplicateSource\}/);
  assert.doesNotMatch(PAGE, /QuotationDuplicateDialog/, "the enquiry-picker dialog is gone");
});

test("only an edit raises a version; a duplicate is created as a new quotation", () => {
  assert.match(PAGE, /const mode = isDraftQuotation\(editingQuotation\) \? "draft" : editingQuotation \? "edit" : duplicateSource \? "duplicate" : "create";/);
  assert.match(PAGE, /mode === "edit"\s*\? await createSalesQuotationVersion\(source\.id, quotation\)\s*: await createSalesQuotation\(quotation\)/);
  // One press is one quotation.
  assert.match(PAGE, /const \{ busy: savingQuotation, run: runSave \} = useSubmitOnce\(\);/);
  assert.match(PAGE, /await runSave\(async \(\) => \{/);
  assert.match(GENERATOR, /<Button type="submit" variant="primary" busy=\{saving && !savingDraft\} disabled=\{saving \|\| locked\}/);
});

test("the copy carries none of the source's identity", () => {
  const draft = PAGE.slice(PAGE.indexOf("function duplicateDraft"), PAGE.indexOf("/** The earlier versions of a chain."));
  for (const field of ["source.id", "quotationNumber", "quotationId", "version", "publicToken", "createdAt", "linkExpiresAt"]) {
    assert.ok(!draft.includes(field), `duplicateDraft must not copy ${field}`);
  }
});

test("the generator says which flow it is in", () => {
  assert.match(GENERATOR, /\{isDraft \? "Generate Quotation" : initialQuotation \? "Save as new version" : duplicateOf \? "Save as Duplication" : "Generate Quotation"\}/);
  assert.match(GENERATOR, /Duplicating \$\{duplicateOf\.quotationId \|\| "a quotation"\} — saving raises a new quotation, version 01\./);
  // A duplicate is a new quotation, so its brand is as free as a new one's: only an edit locks it.
  assert.match(GENERATOR, /const verticalLocked = Boolean\(initialQuotation\);/);
  // And it keeps the source's pricing rather than taking today's rates.
  assert.match(GENERATOR, /if \(initialQuotation \|\| duplicateOf\) return undefined;/);
});

test("a reload keeps the duplicate open", () => {
  assert.match(PAGE, /const DUPLICATE_PARAM = "duplicate";/);
  assert.match(PAGE, /new URLSearchParams\(window\.location\.search\)\.get\(DUPLICATE_PARAM\)/);
  assert.match(PAGE, /setDuplicateParam\(null\);/, "closing the form takes the duplicate out of the address");
});

test("a duplicate starts with the enquiry empty, to be chosen afresh", () => {
  const draft = PAGE.slice(PAGE.indexOf("function duplicateDraft"), PAGE.indexOf("/** The earlier versions of a chain."));
  assert.match(draft, /\.\.\.\(source\.payload \|\| \{\}\),\n    enquiryId: "",/);
  assert.doesNotMatch(draft, /enquiryId: source\.enquiryId/);
});
