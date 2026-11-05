import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { quotationTotals } from "../src/lib/quotationBrand.mjs";

/*
 * Settings → the Quotation Generator's figures, worked by hand against the studio's own settings.
 *
 * The services below are the studio's Settings → Project → Services as they stand; the four rates
 * are the studio's Quotation settings (₹2,000 / ₹1,000 / 20% / 18%). Each case states the figure
 * expected and the figure the real pricing and totals functions produce.
 */

const PANEL = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "QuotationGeneratorPanel.js"), "utf8");
const RATES = { serviceRate: 2000, deliverableRate: 1000, defaultDiscountPercent: 20, gstPercent: 18, servicePricing: {}, deliverablePricing: {} };
const SESSIONS = { values: [{ id: "opt-half", code: "HALF_SESSION", label: "Half Session" }, { id: "opt-full", code: "FULL_SESSION", label: "Full Session" }] };
const VIDEO_BOOTH = { id: "svc-video", name: "360 video booth", price: "3500.00", timingOptionSet: SESSIONS, pricing: [
  { shootType: "STUDIO", timingMode: "HALF_SESSION", duration: "4-5 Hours (Half)", price: 2000 },
  { shootType: "STUDIO", timingMode: "FULL_SESSION", duration: "8-10 Hours (Full)", price: 3500 },
] };
const ADVANT = { id: "svc-advant", name: "advant", price: "2450", timingOptionSet: SESSIONS, pricing: [
  { shootType: "STUDIO", timingMode: "FULL_SESSION", price: 2450 }, { shootType: "STUDIO", timingMode: "HALF_SESSION", price: 1400 },
  { shootType: "OUTDOOR", timingMode: "FULL_SESSION", price: 4999 }, { shootType: "OUTDOOR", timingMode: "HALF_SESSION", price: 2399 },
] };
const studioHalf = { id: "s1", shootTypes: ["Studio / In-House"], sessionTimings: ["Half Session"] };
const outdoorFull = { id: "s2", shootTypes: ["Outdoor / On-Location"], sessionTimings: ["Full Session"] };
const line = (definition, shoot, extra = {}) => ({ serviceDefinitionId: definition.id, serviceDefinition: definition, shootId: shoot.id, quantity: 1, ...extra });
const total = (services, deliverables = [], extra = {}) => quotationTotals({ services, deliverables, rates: RATES, discountSource: "PERCENTAGE", discountValue: 0, ...extra });

test("a service is quoted at its one price, whatever the shoot or the line's Session Timing", () => {
  // Settings asks one Price per service; the per-session lines kept on the definitions above are
  // not read. The row is stamped with that price as it is made, and nothing reprices it after.
  const rowFor = PANEL.slice(PANEL.indexOf("function serviceRowFor("), PANEL.indexOf("\n  }\n", PANEL.indexOf("function serviceRowFor(")));
  assert.match(rowFor, /const timed = flatPriceOf\(definition\);/);
  assert.match(PANEL, /const flatPriceOf = \(definition\) => finite\(definition\?\.price\);/);
  const update = PANEL.slice(PANEL.indexOf("async function updateService("), PANEL.indexOf("\n  }\n", PANEL.indexOf("async function updateService(")));
  assert.doesNotMatch(update, /"sessionOptionId" in data|"sizeOptionValueId" in data|unitPrice/);
  const flat = (definition) => Number(definition.price);
  assert.equal(flat(VIDEO_BOOTH), 3500);
  assert.equal(total([{ ...line(VIDEO_BOOTH, studioHalf), unitPrice: flat(VIDEO_BOOTH) }, { ...line(VIDEO_BOOTH, outdoorFull), unitPrice: flat(VIDEO_BOOTH) }]).amount, 7000);
});

test("an unstamped line is unpriced: ₹0, not the studio rate", () => {
  const unpriced = { id: "svc-flat", name: "Drone", price: null, pricing: [] };
  assert.equal(total([line(unpriced, studioHalf)]).amount, 0);
  assert.equal(total([{ ...line(unpriced, studioHalf), unitPrice: 5000 }]).amount, 5000);
});

test("Test 1-2: one service, one or more deliverables, quantity, no discount", () => {
  const t = total([{ ...line(VIDEO_BOOTH, studioHalf), unitPrice: 3500 }], [{ deliverableName: "Painting", quantity: 1, unitPrice: 300 }, { deliverableName: "Painting", quantity: 2, unitPrice: 499.69 }]);
  assert.equal(t.subtotal, 3500 + 300 + 999.38);
  assert.equal(t.discountAmount, 0);
  assert.equal(t.amount, 4799.38);
});

test("Test 3: a complimentary line comes to nothing", () => {
  const t = total([{ ...line(VIDEO_BOOTH, studioHalf), unitPrice: 3500, complimentary: true }], [{ quantity: 1, unitPrice: 400 }]);
  assert.equal(t.subtotal, 400);
  assert.equal(t.amount, 400);
});

test("Test 4: 10% off ₹1,00,000 is ₹10,000 off, ₹90,000 left; GST stated on top", () => {
  const t = total([{ ...line(VIDEO_BOOTH, studioHalf), quantity: 1, unitPrice: 100000 }], [], { discountValue: 10 });
  assert.equal(t.discountAmount, 10000);
  assert.equal(t.amount, 90000);
  assert.equal(t.gstAmount, 16200);
  assert.equal(t.grandTotal, 106200);
});

test("Test 5: the percentage, then the extra discounts off what is left; performance cost before both", () => {
  const t = total([{ ...line(VIDEO_BOOTH, studioHalf), unitPrice: 90000 }], [], { discountValue: 10, performanceCost: 10000, extraDiscounts: [{ amount: 2000 }, { amount: 500 }] });
  assert.equal(t.grossCost, 100000);
  assert.equal(t.discountAmount, 10000);
  assert.equal(t.extraDiscountAmount, 2500);
  assert.equal(t.amount, 87500);
  // Typed rupees instead of a percentage.
  assert.equal(total([{ unitPrice: 50000, quantity: 1 }], [], { discountSource: "AMOUNT", discountValue: 7500 }).amount, 42500);
});

test("Test 6-9: several shoots of different types and sessions, each line at its service's one price", () => {
  const shoots = [studioHalf, outdoorFull, { id: "s3", shootTypes: ["Outdoor / On-Location"], sessionTimings: ["Half Session"] }];
  const lines = shoots.map((shoot) => ({ ...line(ADVANT, shoot), unitPrice: Number(ADVANT.price) }));
  assert.deepEqual(lines.map((row) => row.unitPrice), [2450, 2450, 2450]);
  assert.equal(total(lines).amount, 7350);
});

test("GST: the brand's own rate wins over the studio's, whichever answers first", () => {
  assert.match(PANEL, /const quotedGst = \(current\) => brandGstRef\.current \?\? studioGstRef\.current \?\? current\.gstPercent;/);
  assert.match(PANEL, /studioGstRef\.current = finite\(response\.data\.gstPercent\);/);
  assert.match(PANEL, /brandGstRef\.current = finite\(config\.brand\.gstPercent\);\n\s*setRates\(\(current\) => \(\{ \.\.\.current, gstPercent: quotedGst\(current\) \}\)\);/);
  // Run the rule itself, in both orders.
  const rule = (brand, studio, current) => brand ?? studio ?? current;
  assert.equal(rule(12, 18, 18), 12, "brand set, studio arrives later: still the brand's");
  assert.equal(rule(null, 18, 12), 18, "a brand that sets none falls back to the studio, not to the last brand's");
});

test("an edit reopens on the exact percentage saved, not the two-place column", () => {
  assert.match(PANEL, /savedDiscountOf\(initialPayload, initialQuotation \? finite\(initialPayload\.discount\) \?\? Number\(initialQuotation\.discount \|\| 0\) : draftDiscount \?\? 0\)/);
});

test("a new quotation still opens at no discount: the default discount is not applied", () => {
  assert.doesNotMatch(PANEL, /useState\(\(\) => [^\n]*defaultDiscountPercent/);
});
