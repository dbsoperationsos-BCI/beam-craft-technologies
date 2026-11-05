import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { VERTICALS, requiredFieldsFor, verticalFieldRows } from "../src/components/sales/quotationVerticalConfig.js";
import { FIELD_LISTS } from "../src/constants/moduleFieldLists.js";

/*
 * Category is asked on every vertical's quotation, from that vertical's own list.
 *
 * It was Dum Dum's alone. Now each brand has a tab of its own under Settings → Field Settings →
 * Sales & CRM → Quotations → Categories, and the quotation form reads the tab of the vertical being
 * raised - so a Qua Qua quotation is never offered a Dum Dum category.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

test("every vertical asks for a Category, closed and mandatory, under the payload's original key", () => {
  for (const vertical of VERTICALS) {
    const field = verticalFieldRows[vertical].flat().find((item) => item.key === "religion");
    assert.ok(field, `${vertical} does not ask for a category`);
    assert.equal(field.label, "Category");
    assert.equal(field.type, "select", `${vertical}'s category is not a closed list`);
    assert.equal(field.required, true, `${vertical}'s category is not mandatory`);
  }
});

test("a brand with no categories yet is not asked for one; a brand with a list is", () => {
  for (const vertical of VERTICALS) {
    const empty = requiredFieldsFor(vertical, { religion: [] }).map((field) => field.key);
    assert.ok(!empty.includes("religion"), `${vertical} demands a category from an empty list`);
    const filled = requiredFieldsFor(vertical, { religion: ["General"] }).map((field) => field.key);
    assert.ok(filled.includes("religion"), `${vertical} does not demand a category once the list has one`);
  }
});

test("the Categories list is kept per vertical in Field Settings, and the form reads its own vertical's tab", () => {
  const list = FIELD_LISTS.find((item) => item.value === "religions");
  assert.equal(list?.scopedBy, "vertical", "Field Settings does not tab the Categories by brand");
  assert.deepEqual(list.screens, ["quotations"]);
  const fields = read("components", "sales", "QuotationVerticalFields.js");
  const panel = read("components", "sales", "QuotationGeneratorPanel.js");
  assert.match(fields, /useLeadSuggestionLists\(\{ vertical \}\)/);
  assert.match(panel, /useLeadSuggestionLists\(\{ vertical \}\)/, "the generator's required check does not read the vertical's own list");
  const hook = read("components", "sales", "useLeadSuggestionLists.js");
  assert.match(hook, /vertical: brand/, "the hook does not pass the brand to the categories read");
});

/*
 * Category is typed into to find an entry, and is still a closed list.
 *
 * The brand's Categories tab is the studio's own and has no ceiling, so the menu grows with it and
 * reaching one entry meant scrolling past the rest. The field is searchable now - the same control
 * Assigned Branch beside it already uses - and searching a `select` filters the options rather
 * than accepting what was typed, so the answer is still one of that brand's categories.
 */
test("the Category field is searched by typing, and Offer Type is left alone", () => {
  for (const vertical of VERTICALS) {
    const field = verticalFieldRows[vertical].flat().find((item) => item.key === "religion");
    assert.equal(field.searchable, true, `${vertical}'s category cannot be searched`);
    // Searching must not turn it into free text: a closed list is why this is a select.
    assert.equal(field.type, "select", `${vertical}'s category stopped being a closed list`);
  }
  // The other select. Its list is written into the config and short, so it is not searchable -
  // which is also what proves the flag is the field's own rather than every select's.
  const offerType = VERTICALS.flatMap((vertical) => verticalFieldRows[vertical].flat()).find((item) => item.key === "offerType");
  assert.ok(offerType, "Offer Type is no longer asked for");
  assert.ok(!offerType.searchable, "Offer Type was made searchable, which was not asked for");
});

test("the renderer asks each select whether it is searchable rather than deciding for all of them", () => {
  const fields = read("components", "sales", "QuotationVerticalFields.js");
  const select = fields.slice(fields.indexOf('item.type === "select"'), fields.indexOf('item.type === "branch"'));
  assert.match(select, /searchable=\{Boolean\(item\.searchable\)\}/, "the select branch does not read the field's own flag");
  // Still the same closed dropdown, on the same list, writing the same key.
  assert.match(select, /mode="input"/);
  assert.match(select, /options=\{suggestions\[item\.key\] \|\| item\.options\}/);
  assert.match(select, /onChange=\{\(next\) => onChange\(item\.key, next\)\}/);
});
