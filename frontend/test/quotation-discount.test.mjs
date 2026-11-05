import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { DISCOUNT_SOURCES, MAX_DISCOUNT_PERCENT, calculateDiscount, maxDiscountAmount, savedDiscountOf, shownPercentage } from "../src/lib/quotationDiscount.mjs";
import { quotationDiscountBreakdown, quotationTotals } from "../src/lib/quotationBrand.mjs";
import { calculatorTotals } from "../src/lib/quotationCalculator.mjs";

const { PERCENTAGE, AMOUNT } = DISCOUNT_SOURCES;
const priced = (rupees) => [{ quantity: 1, unitPrice: rupees }];
// What the Summary's two boxes show: the source as typed, the other worked out from it.
const boxes = (totals) => ({ percent: shownPercentage(totals.discountPercent), amount: totals.discountAmount, total: totals.amount });

test("20% of ₹20,000 shows ₹4,000, and ₹5,000 of ₹20,000 shows 25%", () => {
  assert.deepEqual(boxes(quotationTotals({ services: priced(20000), discountSource: PERCENTAGE, discountValue: "20" })), { percent: 20, amount: 4000, total: 16000 });
  assert.deepEqual(boxes(quotationTotals({ services: priced(20000), discountSource: AMOUNT, discountValue: "5000" })), { percent: 25, amount: 5000, total: 15000 });
  // ₹50,000: 10% is ₹5,000; ₹7,500 typed after it is 15%, and ₹7,500 is what comes off.
  assert.deepEqual(boxes(quotationTotals({ services: priced(50000), discountSource: PERCENTAGE, discountValue: "10" })), { percent: 10, amount: 5000, total: 45000 });
  assert.deepEqual(boxes(quotationTotals({ services: priced(50000), discountSource: AMOUNT, discountValue: "7500" })), { percent: 15, amount: 7500, total: 42500 });
});

test("20% then ₹4,000 changed to ₹6,000 is 30%", () => {
  assert.deepEqual(boxes(quotationTotals({ services: priced(20000), discountSource: AMOUNT, discountValue: "6000" })), { percent: 30, amount: 6000, total: 14000 });
});

test("a change in the cost keeps whichever box was typed last", () => {
  // ₹4,000 typed, then ₹20,000 becomes ₹40,000: still ₹4,000, now 10%.
  assert.deepEqual(boxes(quotationTotals({ services: priced(40000), discountSource: AMOUNT, discountValue: "4000" })), { percent: 10, amount: 4000, total: 36000 });
  // 20% typed, then the same change: still 20%, now ₹8,000.
  assert.deepEqual(boxes(quotationTotals({ services: priced(40000), discountSource: PERCENTAGE, discountValue: "20" })), { percent: 20, amount: 8000, total: 32000 });
  // ₹4,000 of ₹30,000 shows 13.33%, but the exact figure is kept, and ₹4,000 is still what comes off.
  const third = quotationTotals({ services: priced(30000), discountSource: AMOUNT, discountValue: "4000" });
  assert.equal(shownPercentage(third.discountPercent), 13.33);
  assert.equal(third.discountAmount, 4000);
  assert.equal(third.discountPercent, (4000 / 30000) * 100);
});

test("nothing to take it off, blanks, text and negatives never show NaN or Infinity or a negative total", () => {
  for (const source of [PERCENTAGE, AMOUNT]) {
    for (const value of ["", null, undefined, "abc", NaN, -5, "12."]) {
      const totals = quotationTotals({ services: [], discountSource: source, discountValue: value });
      assert.ok(Number.isFinite(totals.discountPercent) && Number.isFinite(totals.discountAmount) && totals.amount === 0, `${source} ${String(value)}`);
    }
  }
  assert.deepEqual(boxes(quotationTotals({ services: [], discountSource: AMOUNT, discountValue: "4000" })), { percent: 0, amount: 0, total: 0 });
  // More than the cost is held to the cost - the Summary also says so and refuses to generate.
  assert.equal(quotationTotals({ services: priced(20000), discountSource: AMOUNT, discountValue: "25000" }).amount, 0);
  assert.equal(calculateDiscount({ discountSource: PERCENTAGE, discountValue: 150, discountableSubtotal: 20000 }).discountAmount, 20000);
  // Decimals: a percentage's rupees round to the rupee as they always did; typed rupees are used as typed.
  assert.equal(calculateDiscount({ discountSource: PERCENTAGE, discountValue: "12.5", discountableSubtotal: 999 }).discountAmount, 125);
  assert.equal(calculateDiscount({ discountSource: AMOUNT, discountValue: "4000.50", discountableSubtotal: 20000 }).discountAmount, 4000.5);
});

test("an older quotation opens on its percentage, with the same discount and total as before", () => {
  assert.deepEqual(savedDiscountOf({ discount: 20, discountAmount: 4000 }, 20), { discountSource: PERCENTAGE, discountValue: 20 });
  assert.deepEqual(savedDiscountOf({}, 0), { discountSource: PERCENTAGE, discountValue: 0 });
  const before = quotationTotals({ services: priced(20000), discountPercent: 20, performanceCost: 1234, extraDiscounts: [{ amount: 500 }] });
  const now = quotationTotals({ services: priced(20000), discountSource: PERCENTAGE, discountValue: "20", performanceCost: 1234, extraDiscounts: [{ amount: 500 }] });
  assert.deepEqual(now, before);
  assert.equal(before.discountAmount, Math.round(21234 * 0.2));
});

test("rupees typed and saved come back as the same rupees, on reopening and on a duplicate", () => {
  const saved = quotationTotals({ services: priced(30000), discountSource: AMOUNT, discountValue: "4000" });
  const payload = { discount: shownPercentage(saved.discountPercent), discountInputSource: AMOUNT, discountAmount: saved.discountAmount };
  const reopened = savedDiscountOf(payload, payload.discount);
  assert.deepEqual(reopened, { discountSource: AMOUNT, discountValue: 4000 });
  assert.equal(quotationTotals({ services: priced(30000), discountSource: reopened.discountSource, discountValue: String(reopened.discountValue) }).amount, saved.amount);
  // A duplicate opens on the source's payload laid over its columns.
  const draft = { discount: 13.33, ...payload };
  assert.deepEqual(savedDiscountOf(draft, draft.discount), { discountSource: AMOUNT, discountValue: 4000 });
});

test("the Performance Cost is added before the discount and extra discounts come off after it, as before", () => {
  const totals = quotationTotals({ services: priced(20000), discountSource: AMOUNT, discountValue: "4000", performanceCost: 2000, extraDiscounts: [{ amount: 500 }, { amount: 300 }], gstPercent: 18 });
  assert.deepEqual([totals.grossCost, totals.discountAmount, totals.extraDiscountLimit, totals.extraDiscountAmount, totals.amount, totals.gstAmount], [22000, 4000, 18000, 800, 17200, 3096]);
});

test("the client's copy and its PDF print the discount and total the editor showed", () => {
  const totals = quotationTotals({ services: priced(30000), discountSource: AMOUNT, discountValue: "4000" });
  const saved = { amount: totals.amount, payload: { subtotal: totals.subtotal, discount: shownPercentage(totals.discountPercent), discountInputSource: AMOUNT, discountAmount: totals.discountAmount, amount: totals.amount } };
  assert.deepEqual(quotationDiscountBreakdown(saved).discount, { amount: 4000 }, "the rupees, never the 13.33%");
  assert.equal(saved.amount, 26000);
});

test("the calculator's discount is the same calculation, still rounded to the paisa", () => {
  const base = { services: [], deliverables: [], serviceQuantities: {}, deliverableQuantities: {}, deliverableCounts: {}, extras: "" };
  // Above the cap is held at it: 20% of 20,000 comes off as 15%.
  assert.equal(calculatorTotals({ ...base, basePackagePrice: "20000", discountPercent: "20" }).totalCost, 17000);
  assert.equal(calculatorTotals({ ...base, basePackagePrice: "999.99", discountPercent: "15" }).totalCost, Math.round((999.99 - (999.99 * 15) / 100) * 100) / 100);
  assert.equal(calculatorTotals({ ...base, basePackagePrice: "20000", discountPercent: "150" }).discount, 15);
});

test("the Summary has two discount boxes, both typed into, and no selector between them", () => {
  const panel = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "QuotationGeneratorPanel.js"), "utf8");
  const row = panel.slice(panel.search(/<span>Discount(?:<HelpTip text="[^"]*" \/>)?<\/span>/), panel.indexOf(">Extra Discount +</Button>"));
  assert.ok(!/<Dropdown|readOnly/.test(row), "no selector and no read-only box");
  assert.match(row, /aria-label="Discount in %"[^>]*suffix="%"[^>]*onChange=\{\(event\) => typeDiscount\(DISCOUNT_SOURCES\.PERCENTAGE, event\.target\.value\)\}/);
  assert.match(row, /aria-label="Discount amount in rupees"[^>]*prefix="₹"[^>]*onChange=\{\(event\) => typeDiscount\(DISCOUNT_SOURCES\.AMOUNT, event\.target\.value\)\}/);
  assert.ok(row.indexOf("Discount in %") < row.indexOf("Discount amount in rupees"), "percentage first");
  // Neither box writes to the other: the one not typed is worked out on render.
  assert.match(panel, /const discountPercentText = discountInRupees \? String\(shownPercentage\(totals\.discountPercent\)\) : discount;/);
  assert.match(panel, /const discountAmountText = discountInRupees \? discount : String\(totals\.discountAmount\);/);
  assert.match(panel, /discountInputSource: discountSource,/);
});

/*
 * The 15% cap, as the Quotation Generator applies it (`discountCapPercent`). The task's own example:
 * 15% of ₹1,29,204 is ₹19,380.60, which the generator's whole-rupee rounding makes ₹19,381.
 */
const capped = (extra) => quotationTotals({ services: priced(129204), discountCapPercent: MAX_DISCOUNT_PERCENT, ...extra });

test("the cap is 15% of what the discount comes off, to the whole rupee", () => {
  assert.equal(MAX_DISCOUNT_PERCENT, 15);
  assert.equal(maxDiscountAmount(129204), 19381);
  assert.equal(maxDiscountAmount(-5), 0);
  assert.equal(capped({}).discountCap, 19381);
  // The Performance Cost is part of what it is taken of, as it is part of what the discount comes off.
  assert.equal(capped({ performanceCost: 10796 }).discountCap, 21000);
});

test("0, 10 and exactly 15% apply as typed; anything above is applied at 15% and never more", () => {
  for (const percent of [0, 10, 15]) {
    const totals = capped({ discountSource: PERCENTAGE, discountValue: String(percent) });
    assert.equal(totals.discountPercent, percent);
    assert.equal(totals.discountAmount, Math.round(129204 * percent / 100));
  }
  for (const percent of [16, 20, 50]) {
    const totals = capped({ discountSource: PERCENTAGE, discountValue: String(percent) });
    assert.equal(totals.discountAmount, 19381, `${percent}% comes off as 15%`);
    assert.equal(totals.amount, 129204 - 19381);
  }
});

test("rupees above the cap are applied at it, and the extra discounts are not held to it", () => {
  assert.equal(capped({ discountSource: AMOUNT, discountValue: "50000" }).discountAmount, 19381);
  // 15% and a ₹4,500 Diwali offer: Service + Performance - Discount - Extras, each taken once.
  const diwali = capped({ discountSource: PERCENTAGE, discountValue: "15", extraDiscounts: [{ reason: "Diwali offer", amount: 4500 }] });
  assert.equal(diwali.discountAmount, 19381);
  assert.equal(diwali.extraDiscountAmount, 4500);
  assert.equal(diwali.amount, 129204 - 19381 - 4500);
  // 10% and the same offer.
  const ten = capped({ discountSource: PERCENTAGE, discountValue: "10", extraDiscounts: [{ amount: 4500 }] });
  assert.equal(ten.amount, 129204 - 12920 - 4500);
  // Several extras, each deducted exactly once; a Performance Cost is part of what they come off.
  const several = capped({ discountSource: PERCENTAGE, discountValue: "15", performanceCost: 10796, extraDiscounts: [{ amount: 3000 }, { amount: 5000 }, { amount: 1000 }] });
  assert.equal(several.extraDiscountAmount, 9000);
  assert.equal(several.amount, 140000 - 21000 - 9000);
  // Removing one recalculates: the total is worked out from the list as it stands.
  assert.equal(capped({ discountSource: PERCENTAGE, discountValue: "15", performanceCost: 10796, extraDiscounts: [{ amount: 3000 }, { amount: 1000 }] }).amount, 140000 - 21000 - 4000);
  // The extras take the total to nothing and no further.
  const all = capped({ discountSource: PERCENTAGE, discountValue: "15", extraDiscounts: [{ amount: 500000 }] });
  assert.equal(all.extraDiscountLimit, 129204 - 19381);
  assert.equal(all.amount, 0);
  // GST is stated on what is left, at its own rate, exactly as before.
  const withGst = capped({ discountSource: PERCENTAGE, discountValue: "10", gstPercent: 18 });
  assert.equal(withGst.gstAmount, Math.round(withGst.amount * 0.18));
});

test("the generator applies the cap, says it, and refuses to save past it", () => {
  const panel = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "QuotationGeneratorPanel.js"), "utf8");
  assert.match(panel, /discountCapPercent: MAX_DISCOUNT_PERCENT \}\);/);
  assert.match(panel, /typedDiscount > MAX_DISCOUNT_PERCENT \? `Discount can be at most \$\{MAX_DISCOUNT_PERCENT\}% \(\$\{currency\(totals\.discountCap\)\}\)\.`/);
  assert.match(panel, /typedDiscount > totals\.discountCap \?/);
  // Extras are refused only past what the Discount leaves, never because the Discount is at 15%.
  assert.match(panel, /typedExtraDiscount > totals\.extraDiscountLimit \? `Extra discounts can come to at most \$\{currency\(totals\.extraDiscountLimit\)\} together\.`/);
  assert.doesNotMatch(panel, /No room left for extra discounts/);
  // Both saves - Save Draft and Generate - go through the same refusal.
  assert.match(panel, /if \(discountError\) return `/);
  assert.match(panel, /if \(extraDiscountError\) return `/);
});

test("the client's page prints the discount as an amount under a plain label", () => {
  const page = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "PublicQuotationPage.js"), "utf8");
  assert.match(page, /<DiscountLine label="Discount" amount=\{breakdown\.discount\.amount\} \/>/);
  assert.doesNotMatch(page, /percent\}%|Discount \(/);
});
