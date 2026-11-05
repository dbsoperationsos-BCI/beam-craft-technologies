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
  // With the vertical, because the Shoot Types are read for the lead's own brand.
  assert.match(CRM, /useLeadSuggestionLists\(\{ vertical: addLeadForm\.vertical \}\)/, "Add Lead does not read the studio's lists for its vertical");
  assert.match(CRM, /useLeadSuggestionLists\(\{ vertical \}\)/, "the lead popup does not read the studio's lists for its vertical");
});

test("Add Lead, the lead popup and the quotation all read the hook, not an array", () => {
  // Every Relationship / Referred From combo on the CRM takes its suggestions from the hook.
  // Up to the combo's own `options`, not up to the next `>`: every one of these carries an arrow
  // function in its `onChange`, so a class that stops at `>` stops inside the first handler and
  // matches nothing at all.
  const combos = CRM.match(/<ComboBoxField (?:helperText=\{[^}]+\} )?label="(?:Relationship|Referred From)"[\s\S]{0,400}?options=\{[^}]+\}/g) || [];
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

test("Shoot Type and Offer Type are read from Settings, with no array left behind and no fallback to one", () => {
  /*
   * `shootOptions` was twenty-one words in the CRM that fed the Shoot Type on every Event Details
   * row and the Offer Type beside Relationship - and no studio could add to it, and it was a second
   * vocabulary beside the one the Quotation Generator offered. Both read the hook now: Shoot Type
   * is the brand's own shoots for the lead's vertical (Settings → Fields → Shoot Types, the list
   * Add Shoot on a quotation reads), Offer Type the `offer-types` list Field Settings had always
   * named for it.
   */
  assert.doesNotMatch(CRM, /const shootOptions = \[/, "CRMPage.js still holds its own shoot type list");
  assert.match(HOOK, /import \{ getQuotationBrandShoots \} from "@\/services\/sales\/quotation-brands.service";/, "the hook does not read the brand's shoots");
  assert.match(HOOK, /readShootTypes\(brand\),/, "the shoots are not read for the vertical's brand alongside the other lists");
  assert.doesNotMatch(HOOK, /lead-shoot-types/, "a second shoot list beside the brand's is exactly the drift this replaces");
  // No fallback: an entry removed in Settings must not be offered from an array, and an empty list
  // is the answer rather than a reason to reach for one.
  assert.match(HOOK, /NO_FALLBACK = new Set\(\["religion", "shootType"\]\)/, "shoot types fall back to something");
  assert.match(HOOK, /shootType: \[\]/, "shoot types start from an array rather than nothing");
  // The hook says why the list is empty, and the table says it to the person.
  assert.match(HOOK, /status: \{ \.\.\.current\.status, shootType: shootTypes\?\.failed \? "error" : "ready" \}/);
  const tables = CRM.match(/<ShootDetailsTable[\s\S]{0,200}?shootTypeOptions=\{suggestions\.shootType\}/g) || [];
  assert.equal(tables.length, 2, "Add Lead and the lead popup both pass the studio's shoot types to the rows");
  assert.match(CRM, /shootTypeStatus=\{suggestions\.status\?\.shootType\}/);
  assert.match(CRM, /Shoot types could not be loaded/, "a failed load says nothing");
  // A way back that keeps what was typed: the hook's `reload`, offered as Try again under the rows.
  assert.match(HOOK, /return \{ \.\.\.lists, reload \};/, "the hook offers no way to try again");
  assert.match(CRM, /onRetryShootTypes=\{suggestions\.reload\}/);
  assert.match(CRM, /<Button type="button" variant="secondary" size="sm" onClick=\{onRetryShootTypes\}>Try again<\/Button>/);
  assert.match(CRM, /No shoot types for this vertical yet\./, "an empty list says nothing");
  // The Settings path is offered only to somebody who can open it.
  assert.match(CRM, /canEditFieldLists \? "Add them in Settings → Fields → Sales & CRM → Leads & Followups → Shoot Types\." : "Ask an administrator to add them in Settings\."/);
  // The list is the brand's, so the way to it is the permission that owns the brand's settings.
  assert.match(CRM, /useModuleAccess\("SETTINGS", "Quotation Settings"\)/);
  // A row filed under a word the list no longer has keeps it as a choice, so old leads still read.
  assert.match(CRM, /options=\{shootTypeRowOptions\(shootTypeOptions, shoot\.shootType\)\}/);
  assert.match(CRM, /return current && !options\.includes\(current\) \? \[\.\.\.options, current\] : options;/);
  // Offer Type reads the Offer Types list Field Settings has offered for it all along.
  // Up to its own `options`, not up to `>`: the `onChange` between carries an arrow function.
  assert.match(CRM, /label="Offer Type"[\s\S]{0,200}?options=\{suggestions\.offerType\}/);
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
