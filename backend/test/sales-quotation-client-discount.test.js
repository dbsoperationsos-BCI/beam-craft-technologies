const test = require("node:test");
const assert = require("node:assert/strict");
const { clientFacingQuotation } = require("../src/modules/sales/projects/controller");

/*
 * The client is told what the discount took off, never what share of the price that was.
 *
 * The public quotation page prints the discount in rupees, and the record the page is served must
 * not carry the percentage it leaves out: not the quotation's own, and not a default discount rate
 * riding along in a brand or rates snapshot.
 */

const percentKeys = (value, path = "") => {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, entry]) => [
    ...(/^discount$|discount.*(percent|pct|rate)/i.test(key) ? [`${path}${key}`] : []),
    ...percentKeys(entry, `${path}${key}.`),
  ]);
};

test("the quotation goes out with the discount in rupees and no percentage anywhere", () => {
  const out = clientFacingQuotation({
    id: "q1",
    subtotal: 129204,
    discount: 15,
    amount: 109823,
    createdAt: new Date("2026-10-14T09:00:00Z"),
    brandSnapshot: { brand: { name: "Dum Dum", gstPercent: 18, defaultDiscountPercent: 20 } },
    payload: {
      subtotal: 129204,
      discount: 15,
      discountAmount: 19381,
      gstPercent: 18,
      rates: { gstPercent: 18, defaultDiscountPercent: 20 },
      brandSnapshot: { brand: { defaultDiscountPercent: 20 } },
      extraDiscounts: [{ reason: "Referral", amount: 0 }],
      // Spellings no writer uses today, but the payload is free JSON: none of them goes out either.
      discountPercentage: 15,
      calculator: { discountPct: 15, discountRate: 0.15, discount: 15 },
    },
  });
  assert.deepEqual(percentKeys(out), [], "nothing says the percentage");
  assert.equal(out.payload.discountAmount, 19381);
  // What the page prints besides is untouched: the price, the GST rate, the extras, the dates.
  assert.equal(out.amount, 109823);
  assert.equal(out.payload.gstPercent, 18);
  assert.equal(out.payload.rates.gstPercent, 18);
  assert.equal(out.brandSnapshot.brand.gstPercent, 18);
  assert.deepEqual(out.payload.extraDiscounts, [{ reason: "Referral", amount: 0 }]);
  assert.ok(out.createdAt instanceof Date);
});

test("a quotation saved before the rupees were kept prints the same rupees it always did", () => {
  // Worked out from the percentage exactly as the page used to: 20% of 12,000 + 1,000 Performance Cost.
  const out = clientFacingQuotation({ subtotal: 12000, discount: 20, payload: { subtotal: 12000, performanceCost: 1000, discount: 20 } });
  assert.equal(out.payload.discountAmount, 2600);
  assert.deepEqual(percentKeys(out), []);
  // No discount at all is nothing to print.
  assert.equal(clientFacingQuotation({ subtotal: 5000, discount: 0, payload: { subtotal: 5000 } }).payload.discountAmount, 0);
});
