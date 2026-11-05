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
