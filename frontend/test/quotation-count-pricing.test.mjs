import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { deliverableUnits, quotationTotals } from "../src/lib/quotationBrand.mjs";

/*
 * A counted deliverable is priced by its count as well as its quantity.
 *
 * "Album Printing" at ₹2,200 with a count of 10 is ten albums, so two of that line is twenty. A
 * deliverable that is not counted, or one whose count has not been typed yet, is quantity × price
 * exactly as it always was - and an empty count is not a count of nothing, which is the one reading
 * that would quietly price a line at zero the moment it was added.
 */

const counted = (row) => ({ deliverableDefinition: { photoCountEnabled: "Yes" }, unitPrice: 2200, ...row });
const uncounted = (row) => ({ deliverableDefinition: { photoCountEnabled: "No" }, unitPrice: 2200, ...row });
const costOf = (row) => quotationTotals({ services: [], deliverables: [row], rates: {}, discountPercent: 0 }).deliverableCost;

test("a counted deliverable multiplies by its count", () => {
  assert.equal(costOf(counted({ quantity: 1, numberOfPhotos: 10 })), 22000);
  assert.equal(costOf(counted({ quantity: 2, numberOfPhotos: 10 })), 44000);
  assert.equal(deliverableUnits(counted({ quantity: 2, numberOfPhotos: 10 })), 20);
});

test("a deliverable that is not counted is quantity times price, as it always was", () => {
  assert.equal(costOf(uncounted({ quantity: 2 })), 4400);
  // Even carrying a count: the answer is No, so the cell does not show one and it must not price.
  assert.equal(costOf(uncounted({ quantity: 2, numberOfPhotos: 10 })), 4400);
  // A deliverable nobody has answered for is not counted either.
  assert.equal(costOf({ unitPrice: 2200, quantity: 2, numberOfPhotos: 10 }), 4400);
});

test("an empty count is not a count of nothing", () => {
  // The line would otherwise be worth nothing from the moment it was added until somebody typed a
  // figure - a quotation quietly short, rather than an obvious blank.
  for (const value of ["", null, undefined, 0, -5, "abc", NaN]) {
    assert.equal(costOf(counted({ quantity: 2, numberOfPhotos: value })), 4400, `count ${String(value)}`);
  }
});

test("nothing about it can produce NaN", () => {
  for (const row of [{}, { quantity: "x" }, { quantity: null, numberOfPhotos: {} }, counted({ quantity: "2", numberOfPhotos: "10" })]) {
    const cost = costOf(row);
    assert.ok(Number.isFinite(cost), `${JSON.stringify(row)} produced ${cost}`);
  }
  // Numbers arriving as strings still count, since a cell commits what was typed.
  assert.equal(costOf(counted({ quantity: "2", numberOfPhotos: "10" })), 44000);
});

test("services are untouched by any of this", () => {
  const totals = quotationTotals({
    services: [{ unitPrice: 5000, quantity: 2, numberOfPhotos: 10 }],
    deliverables: [],
    rates: {},
    discountPercent: 0,
  });
  // A service has no count; its line is quantity × price and a stray count changes nothing.
  assert.equal(totals.serviceCost, 10000);
});

test("the count rides through discount and GST rather than around them", () => {
  const totals = quotationTotals({
    services: [],
    deliverables: [counted({ quantity: 2, numberOfPhotos: 10 })],
    rates: {},
    discountPercent: 10,
    gstPercent: 18,
  });
  assert.equal(totals.deliverableCost, 44000);
  assert.equal(totals.subtotal, 44000);
  assert.equal(totals.discountAmount, 4400);
  assert.equal(totals.amount, 39600);
  assert.equal(totals.gstAmount, 7128);
});

/*
 * A line given rather than charged for comes to nothing.
 */
test("a complimentary line costs nothing, whatever its quantity, count or price", () => {
  assert.equal(costOf(counted({ quantity: 2, numberOfPhotos: 10, complimentary: true })), 0);
  // The service side too, and each independently of the other.
  const totals = quotationTotals({
    services: [{ unitPrice: 5000, quantity: 2, complimentary: true }],
    deliverables: [counted({ quantity: 2, numberOfPhotos: 10 })],
    rates: {},
    discountPercent: 0,
  });
  assert.equal(totals.serviceCost, 0);
  assert.equal(totals.deliverableCost, 44000);
  assert.equal(totals.subtotal, 44000);
});

test("only an explicit Yes is free, so every line raised before the question is charged", () => {
  assert.equal(costOf(counted({ quantity: 2, numberOfPhotos: 10 })), 44000, "no answer at all");
  assert.equal(costOf(counted({ quantity: 2, numberOfPhotos: 10, complimentary: false })), 44000, "answered No");
  for (const loose of ["true", 1, "Yes", {}]) {
    assert.equal(costOf(counted({ quantity: 2, numberOfPhotos: 10, complimentary: loose })), 44000, `complimentary ${JSON.stringify(loose)}`);
  }
});

test("a complimentary line keeps the units it is for - it is the money that goes", () => {
  // The row still shows its quantity, count and price: what is being given away is worth seeing.
  assert.equal(deliverableUnits(counted({ quantity: 2, numberOfPhotos: 10, complimentary: true })), 20);
});

test("one function does the arithmetic, and every screen reads it", () => {
  /*
   * `quotationTotals` is the only place a line is priced: the generator's own figures, the subtotal
   * it stamps into the payload, and therefore the register, the client's copy and the PDF, which
   * all read what was stamped rather than working it out again.
   */
  const src = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");
  assert.match(src("lib", "quotationBrand.mjs"), /deliverables\.reduce\(\(total, row\) => total \+ \(given\(row\) \? 0 : deliverableUnits\(row\) \* deliverableUnitPrice\(row, rates\)\), 0\)/);
  assert.match(src("lib", "quotationBrand.mjs"), /services\.reduce\(\(total, row\) => total \+ \(given\(row\) \? 0 : quantityOf\(row\) \* serviceUnitPrice\(row, rates\)\), 0\)/);
  // The public page prints the quantity and no arithmetic of its own.
  assert.doesNotMatch(src("components", "sales", "PublicQuotationPage.js"), /unitPrice/);
});
