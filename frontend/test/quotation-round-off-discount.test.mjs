import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { quotationDiscountBreakdown, quotationTotals } from "../src/lib/quotationBrand.mjs";

/*
 * The Round Off Discount: one rupee figure taken off the quotation total last, exactly once, and
 * listed nowhere the client reads.
 */
// One service line of 10,000.
const lines = { services: [{ quantity: 1, unitPrice: 10000 }], deliverables: [], rates: {} };
const totals = (extra) => quotationTotals({ ...lines, discountCapPercent: 15, ...extra });

test("an empty round off discount leaves the total exactly as it was", () => {
  for (const empty of [undefined, "", null, 0, "abc", Number.NaN, -50]) {
    const result = totals({ roundOffDiscount: empty });
    assert.equal(result.amount, 10000, String(empty));
    assert.equal(result.roundOffDiscount, 0, String(empty));
  }
  // A caller that never names it - every caller before it existed - is unchanged too.
  assert.equal(quotationTotals(lines).amount, 10000);
});

test("₹100 takes ₹100 off, and changing it to ₹250 takes only the ₹250", () => {
  assert.equal(totals({ roundOffDiscount: 100 }).amount, 9900);
  assert.equal(totals({ roundOffDiscount: "100" }).amount, 9900, "as typed into the box");
  assert.equal(totals({ roundOffDiscount: 250 }).amount, 9750);
});

test("with the regular discount, both come off, each once", () => {
  const percent = totals({ discountSource: "PERCENTAGE", discountValue: 10, roundOffDiscount: 100 });
  assert.equal(percent.discountAmount, 1000);
  assert.equal(percent.roundOffDiscount, 100);
  assert.equal(percent.amount, 8900);
  const rupees = totals({ discountSource: "AMOUNT", discountValue: 500, roundOffDiscount: 100 });
  assert.equal(rupees.amount, 9400);
  // The regular discount's own figures are untouched by it.
  assert.equal(rupees.discountAmount, 500);
});

test("with extra discounts, nothing is counted twice and the extras keep all their room", () => {
  const result = totals({ discountSource: "PERCENTAGE", discountValue: 10, extraDiscounts: [{ reason: "Referral", amount: 500 }], roundOffDiscount: 100 });
  assert.equal(result.extraDiscountAmount, 500);
  assert.equal(result.roundOffDiscount, 100);
  assert.equal(result.amount, 10000 - 1000 - 500 - 100);
  // The round off is taken last, so it never narrows what the extra discounts may come to.
  assert.equal(result.extraDiscountLimit, totals({ discountSource: "PERCENTAGE", discountValue: 10 }).extraDiscountLimit);
});

test("it never takes the total below nothing, and says how much it could have been", () => {
  const result = totals({ discountSource: "PERCENTAGE", discountValue: 10, extraDiscounts: [{ reason: "x", amount: 500 }], roundOffDiscount: 99999 });
  assert.equal(result.roundOffLimit, 8500);
  assert.equal(result.roundOffDiscount, 8500);
  assert.equal(result.amount, 0);
});

test("GST is still stated on the total, which already has the round off taken off", () => {
  const result = totals({ roundOffDiscount: 100, gstPercent: 18 });
  assert.equal(result.gstAmount, Math.round(9900 * 0.18));
  assert.equal(result.grandTotal, 9900 + Math.round(9900 * 0.18));
});

test("the client's copy lists no line for it - only the discounts it always listed", () => {
  const payload = { subtotal: 10000, discount: 10, discountAmount: 1000, extraDiscounts: [{ reason: "Referral", amount: 500 }], roundOffDiscount: 100 };
  const breakdown = quotationDiscountBreakdown({ payload, amount: 8400 });
  assert.deepEqual(breakdown.discount, { amount: 1000 });
  assert.deepEqual(breakdown.extras, [{ reason: "Referral", amount: 500 }]);
  // A quotation with nothing but a round off shows no discount card at all.
  assert.equal(quotationDiscountBreakdown({ payload: { subtotal: 10000, roundOffDiscount: 100 } }).any, false);
  const page = fs.readFileSync(new URL("../src/components/sales/PublicQuotationPage.js", import.meta.url), "utf8");
  assert.doesNotMatch(page, /roundOff/i, "the client's page (and the PDF printed from it) never reads it");
});

test("the generator restores it, totals with it, refuses an over-large one and saves it", () => {
  const panel = fs.readFileSync(new URL("../src/components/sales/QuotationGeneratorPanel.js", import.meta.url), "utf8");
  assert.match(panel, /useState\(\(\) => \(Number\(initialPayload\.roundOffDiscount\) > 0/, "restored on edit, version, duplicate and draft");
  assert.match(panel, /quotationTotals\(\{[^}]*roundOffDiscount[^}]*\}\)/, "through the one calculation");
  assert.match(panel, /roundOffDiscount: totals\.roundOffDiscount,/, "saved as what was actually taken off");
  assert.match(panel, /if \(roundOffError\) return/, "an over-large one blocks both saves");
  // Directly under the regular Discount and before the Extra Discount, as an amount only.
  const discountRow = panel.indexOf('aria-label="Discount amount in rupees"');
  // Named for what it is to the client - hidden - as well as for what it does.
  assert.match(panel, /<span>Hidden\/Round Off Discount(?:<HelpTip text="[^"]*" \/>)?<\/span>/, "the Summary names it Hidden/Round Off Discount");
  const roundOffRow = panel.indexOf('aria-label="Hidden/Round off discount in rupees"');
  const extraRow = panel.indexOf("Extra Discount +");
  assert.ok(discountRow > 0 && roundOffRow > discountRow && extraRow > roundOffRow);
  assert.doesNotMatch(panel, /Round off discount in %/i, "no percentage box");
});
