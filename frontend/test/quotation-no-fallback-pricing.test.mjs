import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { deliverableUnitPrice, quotationTotals, serviceUnitPrice, withSavedUnitPrices } from "../src/lib/quotationBrand.mjs";
import { gstLabel } from "../src/components/sales/quotationTemplateContent.js";

/*
 * The Quotation Generator never invents a price. A line is priced by what Settings configures for
 * it - the service's one price, a deliverable's own pricing or variant, a package's price, the per-definition
 * price in the rates - and a line nothing prices is ₹0. The studio's blanket ₹2,000 service rate
 * and ₹1,000 deliverable rate, and an assumed 18% GST, are never applied in its place.
 *
 * The rates below still carry the blanket figures, as the studio's settings row does, so each case
 * proves they are not reached.
 */

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");
const RATES = { serviceRate: 2000, deliverableRate: 1000, servicePricing: {}, deliverablePricing: {}, gstPercent: 18 };

test("an unpriced service is ₹0, not ₹2,000", () => {
  assert.equal(serviceUnitPrice({ serviceDefinitionId: "drone" }, RATES), 0);
  assert.equal(serviceUnitPrice({ serviceDefinitionId: "drone", unitPrice: null }, RATES), 0);
  assert.equal(serviceUnitPrice({ serviceDefinitionId: "drone", unitPrice: "" }, RATES), 0);
  assert.notEqual(serviceUnitPrice({ serviceDefinitionId: "drone" }, RATES), 2000);
});

test("an unpriced deliverable is ₹0, not ₹1,000", () => {
  assert.equal(deliverableUnitPrice({ deliverableDefinitionId: "album" }, RATES), 0);
  assert.notEqual(deliverableUnitPrice({ deliverableDefinitionId: "album" }, RATES), 1000);
});

test("a configured price is still used: stamped, per-definition, package", () => {
  assert.equal(serviceUnitPrice({ serviceDefinitionId: "drone", unitPrice: 4500 }, RATES), 4500);
  assert.equal(serviceUnitPrice({ serviceDefinitionId: "drone" }, { ...RATES, servicePricing: { drone: 3300 } }), 3300);
  assert.equal(deliverableUnitPrice({ deliverableDefinitionId: "album" }, { ...RATES, deliverablePricing: { album: 750 } }), 750);
  // A package's price is stamped on the line, and stands.
  assert.equal(serviceUnitPrice({ serviceDefinitionId: "drone", unitPrice: 1800, packageId: "p1" }, RATES), 1800);
});

test("the total adds only configured prices; complimentary, discount and GST work as before", () => {
  const services = [{ serviceDefinitionId: "drone" }, { serviceDefinitionId: "candid", unitPrice: 10000 }, { serviceDefinitionId: "gift", unitPrice: 5000, complimentary: true }];
  const deliverables = [{ deliverableDefinitionId: "album" }, { deliverableDefinitionId: "frame", unitPrice: 2000, quantity: 2 }];
  const totals = quotationTotals({ services, deliverables, rates: RATES, discountSource: "PERCENTAGE", discountValue: 10 });
  assert.equal(totals.subtotal, 10000 + 4000, "no ₹2,000 for the drone, no ₹1,000 for the album");
  assert.equal(totals.discountAmount, 1400);
  assert.equal(totals.amount, 12600);
  assert.equal(totals.gstPercent, 18);
  assert.equal(totals.gstAmount, 2268);
  // Nothing priced at all: ₹0, not ₹2,000 + ₹1,000.
  assert.equal(quotationTotals({ services: [{ serviceDefinitionId: "drone" }], deliverables: [{ deliverableDefinitionId: "album" }], rates: RATES }).amount, 0);
});

test("no GST rate is assumed: 18% only where it is configured", () => {
  assert.equal(quotationTotals({ services: [{ unitPrice: 1000 }], rates: {} }).gstPercent, 0);
  assert.equal(quotationTotals({ services: [{ unitPrice: 1000 }], rates: {} }).gstAmount, 0);
  assert.equal(quotationTotals({ services: [{ unitPrice: 1000 }], rates: { gstPercent: 18 } }).gstAmount, 180);
  assert.equal(quotationTotals({ services: [{ unitPrice: 1000 }], rates: { gstPercent: 18 }, gstPercent: 5 }).gstPercent, 5);
  // The client copy states the configured rate, and nothing where there is none.
  assert.equal(gstLabel(18), "+ 18% GST APPLICABLE");
  assert.equal(gstLabel(12.5), "+ 12.5% GST APPLICABLE");
  for (const none of [null, undefined, "", 0]) assert.equal(gstLabel(none), "", String(none));
});

test("a quotation saved before this keeps the price each line was charged at", () => {
  // DBS-QO-DD-ERD-000004-01 saved lines with no stamped price; they were charged at its own saved
  // rates. They are stamped with that figure as it opens, so it reads exactly as it was saved.
  const saved = withSavedUnitPrices([{ serviceDefinitionId: "drone" }, { serviceDefinitionId: "candid" }, { serviceDefinitionId: "x", unitPrice: 4500 }], { serviceRate: 2000, servicePricing: { candid: 30000 } }, "service");
  assert.deepEqual(saved.map((row) => row.unitPrice), [2000, 30000, 4500]);
  assert.deepEqual(withSavedUnitPrices([{ deliverableDefinitionId: "album" }], { deliverableRate: 1000 }, "deliverable").map((row) => row.unitPrice), [1000]);
  // A saved quotation with no rates at all is charged nothing for an unpriced line.
  assert.deepEqual(withSavedUnitPrices([{ serviceDefinitionId: "drone" }], {}, "service").map((row) => row.unitPrice), [0]);
  assert.deepEqual(withSavedUnitPrices(undefined, {}, "service"), []);
});

test("the generator assumes no rates, saves every line priced, and sends GST only where configured", () => {
  const panel = read("components", "sales", "QuotationGeneratorPanel.js");
  assert.doesNotMatch(panel, /fallbackRates|serviceRate: 2000|deliverableRate: 1000|gstPercent: 18/);
  assert.match(panel, /const \[rates, setRates\] = useState\(\(\) => \(\{ \.\.\.\(initialPayload\.rates \|\| \{\}\) \}\)\);/);
  assert.match(panel, /services: withSavedUnitPrices\(initialPayload\.services, initialPayload\.rates, "service"\),/);
  assert.match(panel, /services: services\.map\(\(row\) => \(\{ \.\.\.row, unitPrice: serviceUnitPrice\(row, rates\) \}\)\),/);
  assert.match(panel, /deliverables: deliverables\.map\(\(row\) => \(\{ \.\.\.row, unitPrice: deliverableUnitPrice\(row, rates\) \}\)\),/);
  assert.match(panel, /\.\.\.\(finite\(rates\.gstPercent\) !== null \? \{ gstPercent: totals\.gstPercent \} : \{\}\),/);
});

test("nothing in the pricing path falls back to ₹2,000, ₹1,000 or 18%", () => {
  const files = [["lib", "quotationBrand.mjs"], ["lib", "servicePricing.mjs"], ["lib", "deliverablePricing.mjs"], ["lib", "quotationCalculator.mjs"], ["lib", "quotationCalculatorHandoff.mjs"], ["components", "sales", "QuotationGeneratorPanel.js"], ["components", "sales", "quotationTemplateContent.js"]];
  for (const file of files) {
    const source = read(...file);
    assert.doesNotMatch(source, /(\?\?|\|\|)\s*(2000|1000|18)\b/, file.join("/"));
    assert.doesNotMatch(source, /DEFAULT_GST_PERCENT/, file.join("/"));
  }
  // The blanket rates are read in one place only: stamping lines saved before this rule.
  const brand = read("lib", "quotationBrand.mjs");
  assert.equal((brand.match(/rates\??\.serviceRate|rates\??\.deliverableRate/g) || []).length, 2);
  assert.ok(brand.indexOf("rates?.serviceRate") > brand.indexOf("export function withSavedUnitPrices"));
});
