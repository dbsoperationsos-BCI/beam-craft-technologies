import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * The Quotation Generator's cost summary sits beside the shoots and follows the scroll.
 *
 * It used to sit under the last shoot, so on a quotation with several the figures were a long
 * scroll away from the rows that change them. It is the same block - one render, the same
 * `totals`, the same discount box on the same state - in a sticky column on the right at `lg`,
 * and ordinary content under Additional Notes below that. Read off the source, like the calculator
 * tests beside it.
 */
const PAGE = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "QuotationGeneratorPanel.js"), "utf8");
const PANEL = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "schema-form", "SchemaFormPanel.js"), "utf8");

test("the summary is one block, sticky at lg, inside the section's two-column grid", () => {
  assert.match(PAGE, /<SchemaFormSection id="service-creation" title="Service Creation" wide>/);
  assert.match(PAGE, /lg:grid-cols-\[minmax\(0,1fr\)_18rem\] lg:items-start/);
  const summaries = PAGE.match(/bg-blue-50 px-4 py-3 text-slate-700/g) || [];
  assert.equal(summaries.length, 1, "the summary is rendered once, not once per breakpoint");
  assert.match(PAGE, /bg-blue-50 px-4 py-3 text-slate-700 lg:sticky lg:top-\[77px\]/);
});

test("it sticks to the panel's own scroller, which is the only thing that scrolls", () => {
  // The panel's `main` owns the scroll; sections sit directly in it through a `contents` fieldset,
  // so nothing between the summary and the scroller carries an overflow that would defeat sticky.
  assert.match(PANEL, /<main ref=\{contentRef\}[^>]*className="min-w-0 flex-1 overflow-y-auto overscroll-contain"/);
  assert.match(PANEL, /<ReadOnlyFieldset canWrite=\{!readOnly\} reason=\{readOnlyReason\} className="contents">/);
});

test("the figures and the discount box are unchanged", () => {
  assert.match(PAGE, /<span>Service Cost :<\/span><span>\{currency\(subtotal\)\}<\/span>/);
  assert.match(PAGE, /<span>Total Cost :<\/span><span>\{currency\(total\)\}<\/span>/);
  assert.match(PAGE, /input type="number" min="0" max="100" value=\{discount\} onChange=\{\(event\) => \{ setDiscountTouched\(true\); setDiscount\(Math\.min\(100, Number\(event\.target\.value \|\| 0\)\)\); \}\}/);
  // Additional Notes stays in the main column, before the summary.
  assert.ok(PAGE.indexOf('label="Additional Notes"') < PAGE.indexOf("Quotation Summary"));
});
