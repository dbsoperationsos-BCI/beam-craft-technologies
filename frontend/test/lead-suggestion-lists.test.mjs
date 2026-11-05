import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { referredFromOptions, relationshipOptions, verticalFieldRows } from "../src/components/sales/quotationVerticalConfig.js";

/*
 * Relationship and Referred From are suggested from one list on every screen that asks.
 *
 * They were two arrays written out twice - `CRMPage.js` for Add Lead and the lead popup,
 * `quotationVerticalConfig.js` for the Quotation Generator - so the same field on two screens could
 * suggest different things, and neither could be added to by the studio. Both screens read the
 * lists from Settings → Field Settings → Quotation now, through one hook, and the arrays that are
 * left are the fallback it stands on.
 *
 * Reads the source, the way the other Field Settings tests here do: there is no DOM in this suite.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

const HOOK = read("components", "sales", "useLeadSuggestionLists.js");
const CRM = read("components", "sales", "CRMPage.js");
const QUOTATION_FIELDS = read("components", "sales", "QuotationVerticalFields.js");

test("the CRM no longer keeps a copy of either list", () => {
  // One list, one place. A second array in the CRM is exactly the drift this replaces.
  assert.doesNotMatch(CRM, /const relationshipOptions = \[/, "CRMPage.js still holds its own relationship list");
  assert.doesNotMatch(CRM, /const referredFromOptions = \[/, "CRMPage.js still holds its own referred-from list");
  assert.match(CRM, /useLeadSuggestionLists\(\)/, "the CRM does not read the studio's lists");
});

test("Add Lead, the lead popup and the quotation all read the hook, not an array", () => {
  // Every Relationship / Referred From combo on the CRM takes its suggestions from the hook.
  // Up to the combo's own `options`, not up to the next `>`: every one of these carries an arrow
  // function in its `onChange`, so a class that stops at `>` stops inside the first handler and
  // matches nothing at all.
  const combos = CRM.match(/<ComboBoxField label="(?:Relationship|Referred From)"[\s\S]{0,400}?options=\{[^}]+\}/g) || [];
  assert.ok(combos.length >= 5, `expected the five Add Lead combos, found ${combos.length}`);
  for (const combo of combos) assert.match(combo, /options=\{suggestions\.(relationship|referredFrom)\}/, combo);
  // The popup's combo map is the hook's answer rather than a module-level constant.
  assert.doesNotMatch(CRM, /const COMBO_FIELD_OPTIONS = \{/, "the lead popup still reads a compiled-in combo map");
  // With the vertical, because Category is read from that vertical's own tab of the list.
  assert.match(QUOTATION_FIELDS, /useLeadSuggestionLists\(\{ vertical \}\)/, "the quotation's Client Details do not read the studio's lists for their vertical");
  assert.match(QUOTATION_FIELDS, /suggestions\[item\.key\] \|\| item\.options/, "a combo on the quotation does not fall back to its own list");
});

test("the hook reads the two resources Field Settings edits, and falls back to what was always suggested", () => {
  assert.match(HOOK, /\["relationship", "lead-relationships"\]/);
  assert.match(HOOK, /\["referredFrom", "referral-sources"\]/);
  assert.match(HOOK, /relationship: relationshipOptions, referredFrom: referredFromOptions/, "the fallback is not the original arrays");
  assert.equal(relationshipOptions.length, 20);
  assert.equal(referredFromOptions.length, 17);
  assert.equal(relationshipOptions.at(-1), "Other");
  assert.equal(referredFromOptions.at(-1), "Other");
});

test("the quotation rows still name both fields as combos, so free typing is kept", () => {
  // The list is a suggestion, not a rule: making it a closed select would refuse every answer a
  // lead was filed with before the list existed.
  for (const vertical of ["Dum Dum", "Qua Qua"]) {
    const fields = verticalFieldRows[vertical].flat();
    for (const key of ["relationship", "referredFrom"]) {
      const field = fields.find((item) => item.key === key);
      assert.ok(field, `${vertical} no longer asks for ${key}`);
      assert.equal(field.type, "combo", `${vertical} → ${key} is no longer typed-with-suggestions`);
    }
  }
  assert.equal(verticalFieldRows.Corp.flat().find((item) => item.key === "referredFrom")?.type, "combo");
});
