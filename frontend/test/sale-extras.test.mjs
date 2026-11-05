import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { KIND_LABELS, STATUS_LABELS, amountEntryProblem, amountLabel, currentLines, draftsFirst, formatDay, formatRupees, formatSignedRupees, modifiedSummary, signedFromTyped, splitAddedRemoved, typedAmount } from "../src/lib/saleExtras.mjs";

const read = (file) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");

/*
 * Sale Extras on screen: amounts carry their sign the way the client reads them, a modified line says
 * what changed in the studio's words, and the section sits above Shedule Payment for the sale's editors.
 */

test("signed rupees read as additions, reductions and a plain zero", () => {
  assert.equal(formatSignedRupees(15000), "+₹15,000");
  assert.equal(formatSignedRupees(-10000), "−₹10,000");
  assert.equal(formatSignedRupees(0), "₹0");
  assert.equal(formatRupees(248000), "₹2,48,000");
});

test("labels and a modified line's summary", () => {
  assert.deepEqual(KIND_LABELS, { ADDED: "Added", REMOVED: "Removed", MODIFIED: "Modified", CORRECTION: "Correction" });
  assert.equal(formatDay("2026-11-01T10:32:00Z"), "01 Nov 2026");
  assert.deepEqual(draftsFirst([{ id: 1, status: "PUBLISHED" }, { id: 2, status: "DRAFT" }, { id: 3, status: "PUBLISHED" }]).map((line) => line.id), [2, 1, 3]);
  assert.equal(amountLabel("REMOVED"), "Reduction (₹)");
  assert.equal(modifiedSummary({ before: { quantity: 1, size: "12x36" }, after: { quantity: 3, size: "12x36" } }), "Quantity 1 → 3");
  assert.equal(modifiedSummary({ before: { durationHours: null }, after: { durationHours: 6 } }), "Duration (hours) — → 6");
});

test("the Extra section sits between Service Creation and Shedule Payment, in edit mode only", () => {
  const panel = read("components/sales/CreateProjectFormPanel.js");
  const service = panel.indexOf('<SchemaFormSection id="service-creation"');
  const extras = panel.indexOf("<SaleExtrasSection");
  const schedule = panel.indexOf("<SchedulePaymentSection");
  assert.ok(service > -1 && extras > service && schedule > extras);
  assert.match(panel, /\["service-creation", "Service Creation"\], \["sale-extras", "Extra"\], \["schedule-payment", "Shedule Payment"\]/);
  assert.ok(panel.includes('{mode === "edit" && project?.id && <SchemaFormSection id="sale-extras" title="Extra – Additional & Removed Items">'));
});

test("no button in the Extra section submits Edit Sale Details, which it sits inside", () => {
  const source = read("components/sales/SaleExtrasSection.js");
  const buttons = source.match(/<Button\b[^>]*>/g) || [];
  assert.ok(buttons.length > 0);
  assert.deepEqual(buttons.filter((tag) => !/type="button"/.test(tag)), [], "every Button is type=\"button\"");
  // The table's one button - Restore - is type="button", and its boxes hold Enter rather than submitting the sale.
  const table = read("components/sales/SaleExtrasItemsTable.js");
  assert.doesNotMatch(table, /<button\b/);
  assert.deepEqual((table.match(/<Button\b[^>]*>/g) || []).filter((tag) => !/type="button"/.test(tag)), [], "every Button in the table is type=\"button\"");
  assert.equal((table.match(/onKeyDown=\{holdEnter\}/g) || []).length, 2);
  // Required is the section's own check, never the browser's, which would stop Update Project.
  assert.doesNotMatch(table, /^\s+required\b/m);
});

test("added and removed apart, a correction beside what it corrects, unpublished first", () => {
  const lines = [
    { id: "a", kind: "ADDED", status: "PUBLISHED" },
    { id: "r", kind: "REMOVED", status: "PUBLISHED" },
    { id: "m", kind: "MODIFIED", status: "DRAFT" },
    { id: "c", kind: "CORRECTION", status: "DRAFT", correctsExtraId: "r" },
    { id: "n", kind: "ADDED", status: "DRAFT" },
  ];
  const { added, removed } = splitAddedRemoved(lines);
  assert.deepEqual(added.map((line) => line.id), ["m", "n", "a"]);
  assert.deepEqual(removed.map((line) => line.id), ["c", "r"]);
});

test("an amount is typed as the studio reads it: ₹0 allowed, empty unpriced, reductions positive", () => {
  assert.equal(amountEntryProblem("ADDED", "0"), "", "₹0 is an amount");
  assert.equal(amountEntryProblem("ADDED", ""), "", "empty leaves the line unpriced");
  assert.notEqual(amountEntryProblem("REMOVED", "-500"), "");
  assert.equal(amountEntryProblem("MODIFIED", "-500"), "");
  assert.notEqual(amountEntryProblem("ADDED", "abc"), "");
  assert.notEqual(amountEntryProblem("CORRECTION", ""), "");
  assert.equal(signedFromTyped("REMOVED", "1500"), -1500);
  assert.equal(signedFromTyped("ADDED", "0"), 0);
  assert.equal(signedFromTyped("ADDED", ""), null);
  assert.equal(typedAmount({ kind: "REMOVED", amount: -1500 }), "1500");
  assert.equal(typedAmount({ kind: "ADDED", amount: null }), "");
});

test("the section says Not published, never Draft, publishes what is in the boxes, and guards unsaved amounts", () => {
  assert.equal(STATUS_LABELS.DRAFT, "Not published");
  for (const file of ["SaleExtrasSection.js", "SaleExtrasItemsTable.js", "SaleExtrasShootCard.js"]) {
    // What reaches the screen - quoted strings and JSX text - never says Draft; the code's "DRAFT" is the server's word.
    const shown = (read(`components/sales/${file}`).match(/"[^"\n]*"|`[^`\n]*`|>[^<>{}\n]+</g) || []).filter((text) => /\bDrafts?\b/.test(text));
    assert.deepEqual(shown, [], `no Draft wording in ${file}`);
  }
  const section = read("components/sales/SaleExtrasSection.js");
  // No Save Changes: Publish sends what is typed, and is open whenever something changed.
  assert.doesNotMatch(section, /Save Changes|saveSaleExtras|correctSaleExtra|withdrawSaleExtraCorrection/);
  assert.match(section, /const hasChanges = waiting\.length > 0 \|\| editedPublished\.length > 0 \|\| pendingCorrections\.length > 0;/);
  assert.match(section, /disabled=\{!hasChanges\} onClick=\{openReview\}/);
  assert.match(section, /lines: waiting\.map\(entry\),/);
  // Every amount is required before the review opens - ₹0 where there is no charge.
  assert.match(section, /typed === "" \? "Enter the amount\." : amountEntryProblem\(line\.kind, typed\)/);
  assert.match(section, /useUnloadWarning\(canWrite, \(\) => unsaved\);/);
  const table = read("components/sales/SaleExtrasItemsTable.js");
  assert.match(table, /render: \(line\) => \(canWrite && !fromExtraQuotation\(line\)\n\s+\? <TextField\n\s+aria-label=\{`\$\{amountLabel\(line\.kind\)\} for \$\{line\.itemName\}`\}/, "every line's Amount is a box, published or not - except an extra quotation's, counted on Payments");
  assert.match(table, /aria-required="true"/);
  // Extras: two headings, Added then Removed, each listing the shoots it happened on - a card per
  // shoot, as Service Creation draws one, with that shoot's lines in that group priced in its table.
  assert.match(section, /\{ key: "added", title: "Added", empty: "Nothing added since booking\." \},\n\s+\{ key: "removed", title: "Removed", empty: "Nothing removed since booking\." \},/);
  assert.match(section, /const shoots = cards\.filter\(\(card\) => card\[key\]\.length\);/);
  assert.match(section, /<SaleExtrasShootCard key=\{card\.shoot\.id\} shoot=\{card\.shoot\} group=\{title\} lines=\{card\[key\]\} \{\.\.\.tableProps\} \/>/);
  assert.match(section, /state\?\.extraShoots/);
  assert.doesNotMatch(section, /Published Revisions|setViewing|title="Added Items"|title="Removed Items"/);
  const card = read("components/sales/SaleExtrasShootCard.js");
  assert.match(card, /ring-1 ring-blue-200/);
  assert.match(card, /<h4 className="[^"]*text-lg font-semibold text-slate-800">\{shoot\.name\}<\/h4>/);
  assert.match(card, /\[shoot\.shootCode, shoot\.date \? formatDay\(shoot\.date\) : "", shoot\.place\]\.filter\(Boolean\)\.join\(" \| "\)/);
  assert.match(card, /<SaleExtrasItemsTable title=\{`\$\{group\} - \$\{shoot\.name\}`\} hideTitle lines=\{lines\} showShoot=\{false\}/);
  // The panel asks before it closes or saves over unsaved Extra amounts.
  const panel = read("components/sales/CreateProjectFormPanel.js");
  assert.match(panel, /onClose=\{closePanel\}/);
  assert.match(panel, /onSubmit=\{guardedSubmit\}/);
  assert.match(panel, /onUnsavedChange=\{markExtrasUnsaved\}/);
});

test("Shedule Payment shows Net Extra and Updated Total only once extras are published, and changes no row", () => {
  const schedule = read("components/project-management/SchedulePaymentSection.js");
  // Net Extra is the form's published figure, or - on a screen without the Extra section - the ledger's.
  assert.match(schedule, /const netExtra = publishedExtra \? Number\(publishedExtra\.net \|\| 0\) : Number\(ledger\?\.saleExtras \|\| 0\);/);
  assert.match(schedule, /const showNetExtra = Boolean\(publishedExtra\) \|\| netExtra !== 0;/);
  assert.match(schedule, /\{\(showNetExtra \|\| extraQuotations !== 0\) && <dl/);
  assert.match(schedule, /formatCurrency\(Number\(signedQuotation \|\| 0\) \+ netExtra \+ extraQuotations\)/);
  const section = read("components/sales/SaleExtrasSection.js");
  assert.match(section, /onPublishedChange\?\.\(data\?\.tracked && data\.publishedCount > 0 \? \{ net: data\.publishedNet \} : null\)/);
  assert.match(read("components/sales/CreateProjectFormPanel.js"), /publishedExtra=\{mode === "edit" \? publishedExtra : null\}/);
});

test("the client's quotation: original card, then EXTRA, then the Updated Total - no prices, no revision", () => {
  const page = read("components/sales/PublicQuotationPage.js");
  const cards = read("components/sales/QuotationPricingCards.js");
  const section = read("components/sales/QuotationExtraSection.js");
  // The order, and the original card exactly as it is drawn without extras.
  assert.match(page, /<QuotationPricingCard label=\{content\.pricingLabel\} amountText=\{currency\(quotation\.amount\)\} gstLine=\{gstLine\} paymentHref=\{paymentHref\} paymentLabel=\{paymentLabel\} validityText=\{validityText\} \/>\s*\{quotation\.saleExtras && <>\s*<QuotationExtraSection extras=\{quotation\.saleExtras\} \/>\s*<UpdatedTotalCard extras=\{quotation\.saleExtras\} gstLine=\{gstLine\} \/>/);
  // GST on the Updated Total is the quotation's own General Settings switch, not a second one.
  assert.match(page, /const gstLine = content\.sections\.gst && content\.gstLine \? content\.gstLine : "";/);
  assert.doesNotMatch(cards, /Net Extra|Original |Revision|caption=|QuotationExtrasCards/);
  assert.match(cards, /Updated \{updated\}/);
  // Two groups, four columns, no amount; nothing drawn when nothing was published.
  for (const text of ["Added Items", "Removed Items", "<span>Item</span><span>Category</span><span>Related Shoot</span><span>Created Date</span>"]) assert.ok(section.includes(text), text);
  assert.doesNotMatch(section, /amount|formatRupees|formatSignedRupees/);
  assert.match(section, /if \(!extras\?\.added\?\.length && !extras\?\.removed\?\.length\) return null;/);
  assert.match(section, /if \(!items\?\.length\) return null;/);
});

test("while Publish Updated Quotation is open, Update Project is held - the button and Enter alike", () => {
  const section = read("components/sales/SaleExtrasSection.js");
  assert.match(section, /const publishPending = canWrite && Boolean\(state\?\.tracked\) && hasChanges;/);
  assert.match(section, /onPublishPendingChange\?\.\(publishPending\)/);
  const panel = read("components/sales/CreateProjectFormPanel.js");
  assert.match(panel, /onPublishPendingChange=\{setExtrasPublishPending\}/);
  assert.match(panel, /<button disabled=\{isSaving \|\| extrasPublishPending\}/);
  assert.match(panel, /if \(extrasPublishPending\) \{ setError\(EXTRAS_PENDING\); return; \}/);
  assert.match(panel, /\{extrasPublishPending && <p [^>]*>Publish the Extra changes first\.<\/p>\}/);
});

test("each line's ⋮ offers what the server decided - Remove on an Added item, Add back on a Removed one - and reloads Service Creation", () => {
  const table = read("components/sales/SaleExtrasItemsTable.js");
  assert.match(table, /const ACTION_LABELS = \{ REMOVE: \["Remove", "Removing\.\.\."\], ADD_BACK: \["Add back", "Adding back\.\.\."\] \};/);
  // Drawn only where the section passes `onAction`, and only on a line the server gave an action.
  assert.match(table, /\.\.\.\(onAction && lines\.some\(\(line\) => ACTION_LABELS\[line\.action\]\) \?/);
  assert.match(table, /onSelect: \(\) => onAction\(line, line\.action\),/);
  // Where a removed item came from and its value, and an item added back after a published removal.
  assert.match(table, /const REMOVED_FROM = \{ QUOTATION: \(\) => "From the quotation", EXTRA: \(\) => "Added as an extra",/);
  assert.match(table, /Added back after its removal was published/);
  const section = read("components/sales/SaleExtrasSection.js");
  // Offered to whoever may change the plan - what the server's own guard asks.
  assert.match(section, /const canChangePlan = canWrite && hasAnyPermission\(\[\{ module: "PROJECT", feature: "Projects", level: "READ_WRITE" \}, \{ module: "PROJECT", feature: "Show All Projects", level: "READ_WRITE" \}\]\);/);
  assert.match(section, /onAction: canChangePlan \? actOnLine : undefined/);
  assert.match(section, /const result = await \(action === "REMOVE" \? removeSaleExtra : restoreSaleExtra\)\(projectId, line\.id\);/);
  assert.match(section, /await load\(\);\n\s+onPlanChanged\?\.\(\);/);
  assert.match(read("components/sales/CreateProjectFormPanel.js"), /onPlanChanged=\{\(\) => void plan\.load\(\)\}/);
  const api = read("services/sales/sale-extras.service.js");
  assert.match(api, /\/sale-extras\/\$\{encodeURIComponent\(extraId\)\}\/restore`, \{ method: "POST" \}/);
  assert.match(api, /\/sale-extras\/\$\{encodeURIComponent\(extraId\)\}\/remove`, \{ method: "POST" \}/);
});

test("items an approved raised request added read as their extra quotation - no amount to type - and Updated Total includes the approved extra quotations", () => {
  const table = read("components/sales/SaleExtrasItemsTable.js");
  assert.match(table, /const fromExtraQuotation = \(line\) => line\.status === "EXTRA_QUOTATION";/);
  // Neither box is offered on such a line: its amount is its extra quotation's, counted on Payments.
  assert.match(table, /render: \(line\) => \(canWrite && !fromExtraQuotation\(line\)\n\s+\? <TextField/);
  assert.match(table, /Extra quotation \{line\.details\?\.reference\} · \{Number\(line\.amount\) === 0 \? "complimentary" : "already counted in Payments"\}/);
  assert.match(table, /EXTRA_QUOTATION: \(line\) => `From extra quotation \$\{line\.details\.reference \|\| ""\}`\.trim\(\)/);
  const section = read("components/sales/SaleExtrasSection.js");
  assert.match(section, /const projectTotal = Number\(state\.updatedTotal \|\| 0\) \+ extraQuotationTotal;/);
  assert.match(section, /incl\. \$\{formatRupees\(extraQuotationTotal\)\} extra quotations/);
});

test("each item shows once, where it stands now - taken off and put back, it moves between Added and Removed", () => {
  const line = (id, kind, status, revision, changedAt, extra = {}) => ({ id, kind, status, category: "SERVICE", shootRef: "s1", itemName: "360 Video Booth", publishedRevisionNumber: revision, changedAt, ...extra });
  const history = [
    line("a", "ADDED", "PUBLISHED", 1, "2026-11-01"),
    line("b", "REMOVED", "PUBLISHED", 2, "2026-11-02"),
    line("c", "ADDED", "PUBLISHED", 3, "2026-11-03"),
  ];
  assert.deepEqual(currentLines(history).map((entry) => entry.id), ["c"], "on again: only the latest addition");
  const { added, removed } = splitAddedRemoved(currentLines(history));
  assert.deepEqual([added.length, removed.length], [1, 0]);
  // Taken off again, not yet published: the removal waiting to be priced is what shows - under Removed.
  const off = currentLines([...history, line("d", "REMOVED", "DRAFT", null, "2026-11-04")]);
  assert.deepEqual(off.map((entry) => entry.id), ["d"]);
  // Every unpublished line stays, each needing its amount; another item is untouched.
  const other = line("e", "ADDED", "PUBLISHED", 1, "2026-11-01", { itemName: "Drone" });
  assert.deepEqual(currentLines([...history, line("d", "REMOVED", "DRAFT", null, "2026-11-04"), line("f", "ADDED", "DRAFT", null, "2026-11-05"), other]).map((entry) => entry.id), ["d", "f", "e"]);
  // The section draws its cards from these.
  assert.match(read("components/sales/SaleExtrasSection.js"), /const shown = currentLines\(lines\);/);
});
