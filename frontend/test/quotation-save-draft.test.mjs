import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isDraftQuotation, linkStatusLabel, QUOTATION_DRAFT_STATUS } from "../src/components/sales/quotationLinkStatus.js";

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");
const PAGE = read("components", "sales", "QuotationPage.js");
const GENERATOR = read("components", "sales", "QuotationGeneratorPanel.js");
const SERVICE = read("services", "sales", "projects.service.js");

/*
 * Save Draft on the Quotation Generator, and the Draft tab on the register.
 *
 * A draft is numbered on its first save, rewritten in place by every later one, and generated in
 * place under the same number. The backend suite (`sales-quotation-draft.test.js`) holds the
 * lifecycle itself; these hold the screen to it.
 */

test("a draft reads as one: status Draft, and its link column says it was never sent", () => {
  assert.equal(QUOTATION_DRAFT_STATUS, "Draft");
  assert.equal(isDraftQuotation({ status: "Draft" }), true);
  assert.equal(isDraftQuotation({ status: "Generated" }), false);
  assert.equal(isDraftQuotation(null), false);
  assert.equal(linkStatusLabel({ status: "Draft", linkExpiresAt: null }), "Not sent");
  // A generated version reads exactly as it always has.
  assert.equal(linkStatusLabel({ status: "Generated", linkExpiresAt: null }), "Expired");
  assert.equal(linkStatusLabel({ status: "Generated", linkExpiresAt: new Date(Date.now() + 60000).toISOString() }), "Live");
});

test("the three draft calls go to their own routes", () => {
  assert.match(SERVICE, /export function createSalesQuotationDraft\(payload\) \{\s*return apiRequest\("\/api\/sales\/quotations\/drafts", \{\s*method: "POST"/);
  assert.match(SERVICE, /export function updateSalesQuotationDraft\(id, payload\) \{\s*return apiRequest\(`\/api\/sales\/quotations\/\$\{id\}\/draft`, \{\s*method: "PUT"/);
  assert.match(SERVICE, /export function generateSalesQuotationDraft\(id, payload\) \{\s*return apiRequest\(`\/api\/sales\/quotations\/\$\{id\}\/generate`, \{\s*method: "POST"/);
});

test("Save Draft sits beside Generate Quotation, secondary, on a new quotation or a draft only", () => {
  assert.match(GENERATOR, /const canSaveDraft = Boolean\(onSaveDraft\) && \(!initialQuotation \|\| isDraft\);/);
  const footer = GENERATOR.slice(GENERATOR.indexOf("const footer = <>"), GENERATOR.indexOf("</>;", GENERATOR.indexOf("const footer = <>")));
  const close = footer.indexOf(">Close</Button>");
  const draft = footer.indexOf(">Save Draft</Button>");
  const generate = footer.indexOf('type="submit" variant="primary"');
  assert.ok(close > -1 && draft > close && generate > draft, "Close, then Save Draft, then the primary save");
  // Secondary (Button's default variant), never a submit, and held shut while any save is in flight.
  assert.match(footer, /\{canSaveDraft && <Button type="button" onClick=\{saveDraft\} busy=\{savingDraft\} disabled=\{saving\}/);
  // A draft is generated in place, so its primary button says Generate Quotation, not "new version".
  assert.match(GENERATOR, /\{isDraft \? "Generate Quotation" : initialQuotation \? "Save as new version"/);
});

test("a draft asks only for the Assigned Branch its number is drawn from", () => {
  const saveDraft = GENERATOR.slice(GENERATOR.indexOf("function saveDraft()"), GENERATOR.indexOf("What stands between this form and Generate Quotation"));
  assert.match(saveDraft, /identification\.assignedBranch/);
  assert.doesNotMatch(saveDraft, /requiredFieldsFor/, "the full required list is Generate's, not the draft's");
  assert.match(saveDraft, /onSaveDraft\?\.\(quotationPayload\(\)\)/);
  // Generate builds the same payload, so a draft holds every field a generated quotation does.
  assert.match(GENERATOR, /onGenerate\?\.\(quotationPayload\(\)\);/);
});

test("the first save creates the draft; every later one updates it, never a second", () => {
  const save = PAGE.slice(PAGE.indexOf("async function saveQuotationDraft"), PAGE.indexOf("function applyRenewedVersion"));
  assert.match(save, /const draft = isDraftQuotation\(editingQuotation\) \? editingQuotation : null;/);
  assert.match(save, /draft\s*\? await updateSalesQuotationDraft\(draft\.id, \{ \.\.\.quotation, draftUpdatedAt: draft\.updatedAt \}\)\s*: await createSalesQuotationDraft\(quotation\)/);
  // The generator is now editing the saved draft, so the next press is an update.
  assert.match(save, /setEditingQuotation\(saved\);/);
  // One press is one save, shared with Generate.
  assert.match(save, /await runSave\(async \(\) => \{/);
  // The form is not rebuilt under the person typing in it when the new quotation gets its id.
  assert.match(save, /if \(!draft\) setHeldGeneratorKey\(keyBeforeSave\);/);
  assert.match(PAGE, /const generatorKey = heldGeneratorKey \|\| editingQuotation\?\.id/);
  // The tab counts are re-read from the server, not patched.
  assert.match(save, /await loadQuotations\(\{ notifyOnError: false \}\);/);
});

test("Generate Quotation on a draft generates that draft, not a new quotation", () => {
  assert.match(PAGE, /mode === "draft"\s*\? await generateSalesQuotationDraft\(source\.id, \{ \.\.\.quotation, draftUpdatedAt: source\.updatedAt \}\)/);
});

test("the Draft tab lists drafts alone; All and the brand tabs keep listing generated quotations", () => {
  assert.match(PAGE, /\{ id: DRAFT_TAB, label: "Draft", count: drafts \}/);
  assert.match(PAGE, /\{ id: BRAND_TAB_ALL, label: "All", count: quotations\.length - drafts \}/);
  assert.match(PAGE, /if \(tab === DRAFT_TAB\) return quotations\.filter\(\(chain\) => chain\.isDraft\);/);
  assert.match(PAGE, /return quotations\.filter\(\(chain\) => !chain\.isDraft && \(tab === BRAND_TAB_ALL \|\| chain\.quotationBrand === tab\)\);/);
});

test("a draft row offers nothing that needs a sent quotation", () => {
  assert.match(PAGE, /\.\.\.\(quotation\.isDraft \? \[\] : \[\{ label: \(quotation\.versions\?\.length \|\| 0\) > 1 \? "Versions" : "Link"/);
  // Create Project also waits for the version to be finalized (`project-finalized-quotation.test.mjs`).
  assert.match(PAGE, /canCreateProject && !quotation\.isDraft && finalizedVersionOf\(quotation\) && !bookedFromChain\(quotation\)/);
  assert.match(PAGE, /canWrite && !quotation\.isDraft \? \[\{ label: "Duplicate"/);
  // Edit and Delete stay, behind READ_WRITE as before - Delete giving way only on a finalized
  // quotation (`quotation-finalize.test.mjs`), which a draft never is.
  assert.match(PAGE, /\.\.\.\(canWrite \? \[\{ label: "Edit", onSelect: \(\) => void openGenerator\(quotation\) \}\] : \[\]\),/);
  assert.match(PAGE, /\.\.\.\(canWrite && !finalizedVersionOf\(quotation\) \? \[\{ label: "Delete", tone: "danger"/);
});
