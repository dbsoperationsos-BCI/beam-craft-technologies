import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  QUOTATION_BRANDS,
  brandBadgeLabel,
  brandCodeForVertical,
  brandDeliverableDefinitions,
  brandFieldsForServiceRow,
  brandOfQuotation,
  brandServiceDefinitions,
  deliverableUnitPrice,
  extraDiscountsOf,
  MAX_EXTRA_DISCOUNTS,
  packageRowsForShoot,
  quotationDiscountBreakdown,
  quotationTotals,
  selectionsLostOnBrandSwitch,
  serviceUnitPrice,
  splitRowsForBrandSwitch,
  verticalForBrand,
} from "../src/lib/quotationBrand.mjs";
import { planFromQuotation, projectDefinitionId } from "../src/components/sales/quotationProjectPlan.js";

/*
 * The brand rules the Quotation Generator and the register lean on.
 *
 * The one that matters most is pricing: a line keeps the price it was added at, whatever the
 * brand's default becomes later, and a line from before brands existed prices exactly as it did.
 * Getting either wrong reprices a quotation the client already has.
 */

test("the vertical and the brand are one fact under two names", () => {
  for (const brand of QUOTATION_BRANDS) {
    assert.equal(brandCodeForVertical(brand.vertical), brand.code);
    assert.equal(verticalForBrand(brand.code), brand.vertical);
  }
  assert.equal(brandCodeForVertical("WED"), "DUM_DUM");
  assert.equal(brandCodeForVertical("corporate"), "CORP");
  assert.equal(brandCodeForVertical(""), null);
});

test("a register row reads its brand from the column, then the payload, then Dum Dum", () => {
  assert.equal(brandOfQuotation({ quotationBrand: "CORP", payload: { vertical: "Dum Dum" } }), "CORP");
  assert.equal(brandOfQuotation({ payload: { vertical: "Qua Qua" } }), "QUA_QUA");
  assert.equal(brandOfQuotation({ vertical: "Corp" }), "CORP");
  assert.equal(brandOfQuotation({}), "DUM_DUM");
  assert.equal(brandBadgeLabel("QUA_QUA"), "QUA QUA");
  assert.equal(brandBadgeLabel("Dum Dum"), "DUM DUM");
});

/* ── Pricing ── */

const rates = { serviceRate: 2000, deliverableRate: 1000, servicePricing: { candid: 30000 }, deliverablePricing: { album: 5000 }, gstPercent: 18 };

test("a line prices at the price stamped on it, then the price configured for it, and never at a blanket rate", () => {
  // Stamped when added: the brand's default for the service at that moment.
  assert.equal(serviceUnitPrice({ serviceDefinitionId: "candid", unitPrice: 25000 }, rates), 25000);
  // A stamped zero is a price - a complimentary line - not an absence.
  assert.equal(serviceUnitPrice({ serviceDefinitionId: "candid", unitPrice: 0 }, rates), 0);
  // No stamp: the per-definition price configured for it. Nothing configured: ₹0 - never the
  // blanket ₹2,000 / ₹1,000 rate, even though the rates still carry one.
  assert.equal(serviceUnitPrice({ serviceDefinitionId: "candid" }, rates), 30000);
  assert.equal(serviceUnitPrice({ serviceDefinitionId: "drone" }, rates), 0);
  assert.equal(serviceUnitPrice({ serviceDefinitionId: "drone", unitPrice: "" }, rates), 0);
  assert.equal(deliverableUnitPrice({ deliverableDefinitionId: "album" }, rates), 5000);
  assert.equal(deliverableUnitPrice({ deliverableDefinitionId: "reels", unitPrice: 750 }, rates), 750);
  assert.equal(deliverableUnitPrice({ deliverableDefinitionId: "reels" }, rates), 0);
});

test("the totals are the rows' prices times their quantities, less the discount, with GST stated on top", () => {
  const totals = quotationTotals({
    services: [{ serviceDefinitionId: "candid", quantity: 2, unitPrice: 30000 }, { serviceDefinitionId: "drone" }],
    deliverables: [{ deliverableDefinitionId: "album", quantity: 1 }],
    rates,
    discountPercent: 10,
  });
  // The unpriced drone line adds nothing; it is not charged at the studio's ₹2,000.
  assert.equal(totals.subtotal, 60000 + 0 + 5000);
  assert.equal(totals.discountAmount, 6500);
  assert.equal(totals.amount, 58500);
  assert.equal(totals.gstPercent, 18);
  assert.equal(totals.gstAmount, 10530);
  assert.equal(totals.grandTotal, 69030);
  // A brand's own GST rate, where one is given, is the one stated.
  assert.equal(quotationTotals({ services: [], deliverables: [], rates, discountPercent: 0, gstPercent: 5 }).gstPercent, 5);
});

test("a master price change reprices nothing already stamped: the old quotation keeps ₹30,000", () => {
  const oldLine = { serviceDefinitionId: "candid", brandServiceId: "bs1", unitPrice: 30000 };
  const before = quotationTotals({ services: [oldLine], rates, discountPercent: 0 });
  // The brand's default moves to 35,000. A new line stamps the new price; the old line is untouched.
  const newLine = { serviceDefinitionId: "candid", brandServiceId: "bs1", unitPrice: 35000 };
  const after = quotationTotals({ services: [oldLine], rates, discountPercent: 0 });
  assert.equal(before.amount, 30000);
  assert.equal(after.amount, 30000);
  assert.equal(quotationTotals({ services: [newLine], rates, discountPercent: 0 }).amount, 35000);
});

/* ── What a brand offers ── */

const catalogue = [
  { id: "def-candid", name: "Candid Photo", timingModes: ["HOURS_MINUTES"] },
  { id: "def-drone", name: "Drone" },
];

test("a brand with no services of its own offers the whole catalogue, as every brand did before", () => {
  const offered = brandServiceDefinitions([], catalogue);
  assert.equal(offered.usingCatalogue, true);
  assert.deepEqual(offered.definitions, catalogue);
  assert.equal(brandDeliverableDefinitions(null, catalogue).usingCatalogue, true);
});

test("a brand's own masters are laid over the catalogue, never in place of it", () => {
  /*
   * Settings -> Project -> Services is the list, on every brand. A brand master names and prices
   * one entry of it; it does not decide which entries exist.
   *
   * It used to replace the list outright, which was safe only while the studio could see and edit
   * the masters. Quotation Settings lost its Services, Deliverables, Packages and Pricing tabs at
   * the studio's request and the rows behind them stayed, so a brand configured before that went
   * on answering with the handful it had been given - Corp offered five services against a
   * catalogue of ten - and no screen was left that could change it.
   */
  const offered = brandServiceDefinitions([
    { id: "bs-candid", name: "Candid Photography", serviceDefinitionId: "def-candid", defaultPrice: 30000, isActive: true },
    { id: "bs-live", name: "Live Streaming", serviceDefinitionId: null, defaultPrice: 15000, isActive: true },
    { id: "bs-hidden", name: "Retired", serviceDefinitionId: "def-drone", defaultPrice: 1, isActive: false },
  ], catalogue);
  assert.equal(offered.usingCatalogue, false);
  const names = offered.definitions.map((definition) => definition.name);
  // Every catalogue service is offered. Drone is named only by a retired master, and a retired
  // master is not a reason to stop offering a service the studio has active in Settings.
  assert.deepEqual(names, ["Candid Photography", "Drone", "Live Streaming"]);
  const [candid, drone, live] = offered.definitions;
  // Overlaid: the catalogue definition, under the brand's name, with the brand's price beside it.
  assert.equal(candid.id, "def-candid");
  assert.equal(candid.name, "Candid Photography");
  assert.deepEqual(candid.timingModes, ["HOURS_MINUTES"]);
  assert.equal(candid.brandServiceId, "bs-candid");
  assert.equal(candid.brandDefaultPrice, 30000);
  // Untouched: no active master names it, so it is the catalogue entry exactly as Settings holds
  // it, and a line off it prices from the studio rates.
  assert.deepEqual(drone, catalogue[1]);
  assert.deepEqual(brandFieldsForServiceRow(drone), {});
  // Bespoke: a master naming no catalogue entry still stands on its own, under a made-up id the
  // table can key and with no project definition behind it.
  assert.equal(live.id, "brand-service:bs-live");
  assert.equal(live.brandServiceId, "bs-live");
  assert.deepEqual(brandFieldsForServiceRow(live), { brandServiceId: "bs-live", unitPrice: 15000, serviceDefinitionId: "" });
  assert.deepEqual(brandFieldsForServiceRow(candid), { brandServiceId: "bs-candid", unitPrice: 30000 });
  // A catalogue definition stamps nothing at all.
  assert.deepEqual(brandFieldsForServiceRow(catalogue[1]), {});
});

test("the production case: five configured masters no longer hide five active services", () => {
  /*
   * The studio's own numbers. Ten services in Settings, five masters left behind on Corp from
   * before the screens were removed, and a Choose Services list of five - with the other five
   * unreachable and no way to configure them back.
   */
  const settings = ["360 Camera Videography", "360 Video Stand", "AI Face Recognition", "Arial Photography & Videography",
    "Cinematic Indoor Reels", "Cinematic Photography", "Cinematic Videography", "Conventional Photography",
    "Conventional Videography", "LED Wall"].map((name, index) => ({ id: `def-${index}`, name }));
  const leftovers = ["AI Face Recognition", "Cinematic Indoor Reels", "Cinematic Photography", "Conventional Photography", "LED Wall"]
    .map((name, index) => ({ id: `bs-${index}`, name, isActive: true, serviceDefinitionId: settings.find((row) => row.name === name).id }));

  const offered = brandServiceDefinitions(leftovers, settings);
  assert.deepEqual(offered.definitions.map((row) => row.name), settings.map((row) => row.name));
  // And the five that were already offered keep the master they were offered under, so nothing
  // about a line already being priced from Corp's own figure changes.
  assert.equal(offered.definitions.find((row) => row.name === "LED Wall").brandServiceId, "bs-4");
  assert.equal(offered.definitions.find((row) => row.name === "360 Video Stand").brandServiceId, undefined);

  // Deliverables lost the same screen and carry the same rows behind it, so they read the same way.
  const deliverables = brandDeliverableDefinitions(
    [{ id: "bd-1", name: "Album", isActive: true, deliverableDefinitionId: "def-0" }],
    [{ id: "def-0", name: "Album" }, { id: "def-1", name: "Frame" }],
  );
  assert.deepEqual(deliverables.definitions.map((row) => row.name), ["Album", "Frame"]);
});

test("a plain brand line crosses into a project with no definition rather than a made-up one", () => {
  assert.equal(projectDefinitionId("brand-service:bs-live"), "");
  assert.equal(projectDefinitionId("brand-deliverable:bd-1"), "");
  assert.equal(projectDefinitionId("def-candid"), "def-candid");
  const plan = planFromQuotation({
    shoots: [{ id: "q1", shootId: "Q-SID-0001", shoot: "Wedding" }],
    services: [{ id: "s1", shootId: "q1", serviceDefinitionId: "brand-service:bs-live", serviceName: "Live Streaming" }, { id: "s2", shootId: "q1", serviceDefinitionId: "def-candid", serviceName: "Candid" }],
    deliverables: [],
  }, () => "k1");
  assert.equal(plan.services[0].serviceDefinitionId, "");
  assert.equal(plan.services[1].serviceDefinitionId, "def-candid");
});

/* ── Switching brand ── */

test("switching brand loses only the lines the new brand does not offer", () => {
  const rows = [
    { id: "a", brandServiceId: "qq-1", serviceName: "Newborn Session" },
    { id: "b", serviceDefinitionId: "def-drone", serviceName: "Drone" },
    { id: "c", brandServiceId: "shared", serviceName: "Reels" },
  ];
  const lost = selectionsLostOnBrandSwitch(rows, new Set(["shared", "corp-1"]), "brandServiceId");
  assert.deepEqual(lost.map((row) => row.id), ["a"]);
  const split = splitRowsForBrandSwitch(rows, ["shared"], "brandServiceId");
  assert.deepEqual(split.kept.map((row) => row.id), ["b", "c"]);
  assert.deepEqual(split.lost.map((row) => row.id), ["a"]);
  // Nothing of the new brand known: every brand-specific line goes, the catalogue lines stay.
  assert.deepEqual(selectionsLostOnBrandSwitch(rows, new Set(), "brandServiceId").map((row) => row.id), ["a", "c"]);
});

/* ── Packages ── */

test("a package becomes ordinary rows on the shoot, at its own quantities and prices, skipping what is held", () => {
  const serviceDefinitions = brandServiceDefinitions([
    { id: "bs-candid", name: "Candid", serviceDefinitionId: "def-candid", defaultPrice: 30000, isActive: true },
    { id: "bs-drone", name: "Drone", serviceDefinitionId: "def-drone", defaultPrice: 8000, isActive: true },
  ], catalogue).definitions;
  const deliverableDefinitions = brandDeliverableDefinitions([{ id: "bd-album", name: "Album", deliverableDefinitionId: null, defaultPrice: 5000, isActive: true }], []).definitions;
  const pkg = { id: "pkg", name: "Silver", items: [
    { itemType: "SERVICE", masterId: "bs-candid", quantity: 2, defaultPrice: 27000 },
    { itemType: "SERVICE", masterId: "bs-drone", quantity: 1, defaultPrice: null },
    { itemType: "DELIVERABLE", masterId: "bd-album", quantity: 1, defaultPrice: null },
    { itemType: "SERVICE", masterId: "bs-gone", quantity: 1 },
  ] };
  const plan = packageRowsForShoot({ pkg, shoot: { id: "q1" }, serviceDefinitions, deliverableDefinitions, existingServices: [{ brandServiceId: "bs-drone" }], existingDeliverables: [] });
  assert.equal(plan.shootId, "q1");
  assert.equal(plan.services.length, 1, "the drone is already on the shoot");
  assert.equal(plan.services[0].definition.brandServiceId, "bs-candid");
  assert.equal(plan.services[0].quantity, 2);
  assert.equal(plan.services[0].unitPrice, 27000, "the package's own price wins");
  assert.equal(plan.deliverables[0].unitPrice, 5000, "no package price: the master's default");
  assert.equal(plan.skipped.length, 1, "an item the brand no longer offers is left out, and reported");
});

test("the percentage comes off first, then the extra discount in rupees, and the total never goes below nothing", () => {
  const priced = [{ quantity: 1, unitPrice: 2000 }];
  const plain = quotationTotals({ services: priced, rates: {}, discountPercent: 20 });
  assert.deepEqual([plain.subtotal, plain.discountAmount, plain.extraDiscountAmount, plain.amount], [2000, 400, 0, 1600]);
  const extra = quotationTotals({ services: priced, rates: {}, discountPercent: 20, extraDiscountAmount: 100 });
  assert.deepEqual([extra.discountAmount, extra.extraDiscountAmount, extra.amount], [400, 100, 1500], "the extra is rupees, not a percentage, and the percentage is not taken again");
  const tenThousand = quotationTotals({ services: [{ quantity: 1, unitPrice: 10000 }], rates: {}, discountPercent: 10, extraDiscountAmount: 500 });
  assert.equal(tenThousand.amount, 8500);
  // Too much is capped at what is left, and the form is told how much that is.
  const over = quotationTotals({ services: priced, rates: {}, discountPercent: 50, extraDiscountAmount: 2000 });
  assert.deepEqual([over.extraDiscountLimit, over.extraDiscountAmount, over.amount], [1000, 1000, 0]);
  // Nothing typed, or nonsense, is no extra discount.
  assert.equal(quotationTotals({ services: priced, rates: {}, discountPercent: 0, extraDiscountAmount: "" }).amount, 2000);
  assert.equal(quotationTotals({ services: priced, rates: {}, discountPercent: 0, extraDiscountAmount: -50 }).amount, 2000);
});

test("the Performance Cost is added before the percentage, and up to three extra discounts come off after it", () => {
  const priced = [{ quantity: 1, unitPrice: 10000 }];
  const totals = quotationTotals({ services: priced, rates: {}, discountPercent: 10, performanceCost: 2000, extraDiscounts: [{ amount: "500" }, { amount: 300 }] });
  assert.deepEqual([totals.subtotal, totals.performanceCost, totals.grossCost, totals.discountAmount, totals.extraDiscountAmount, totals.amount], [10000, 2000, 12000, 1200, 800, 10000]);
  // Together they stop at nothing, and an empty or nonsense entry is none.
  const over = quotationTotals({ services: priced, rates: {}, discountPercent: 90, extraDiscounts: [{ amount: 600 }, { amount: 600 }, { amount: "" }] });
  assert.deepEqual([over.extraDiscountLimit, over.extraDiscountAmount, over.amount], [1000, 1000, 0]);
  assert.equal(quotationTotals({ services: priced, rates: {}, performanceCost: -50, extraDiscounts: [{ amount: "abc" }] }).amount, 10000);
  // A quotation raised with one extra discount still reads the same.
  assert.equal(quotationTotals({ services: priced, rates: {}, discountPercent: 0, extraDiscountAmount: 500 }).amount, 9500);
});

test("a saved quotation's extra discounts read from the list, or from the single one an older quotation carries", () => {
  assert.deepEqual(extraDiscountsOf({ extraDiscountReason: " Referral ", extraDiscountAmount: 500 }), [{ reason: "Referral", amount: 500 }]);
  assert.deepEqual(extraDiscountsOf({ extraDiscounts: [{ reason: "A", amount: 1 }, { reason: "", amount: 0 }, { reason: "B", amount: "2" }], extraDiscountAmount: 3 }), [{ reason: "A", amount: 1 }, { reason: "B", amount: 2 }], "the list wins, and an empty entry is not one");
  assert.equal(extraDiscountsOf({ extraDiscounts: [1, 2, 3, 4].map((n) => ({ reason: `r${n}`, amount: n })) }).length, MAX_EXTRA_DISCOUNTS);
  assert.deepEqual(extraDiscountsOf({}), []);
  assert.deepEqual(extraDiscountsOf(null), []);
});

test("the client's copy lists the saved discounts and nothing at zero, and never takes them off again", () => {
  const saved = { amount: 8200, discount: 10, payload: { subtotal: 10000, discount: 10, discountAmount: 1000, extraDiscounts: [{ reason: "Referral concession", amount: 500 }, { reason: "", amount: 300 }, { reason: "Nothing", amount: 0 }], amount: 8200 } };
  const breakdown = quotationDiscountBreakdown(saved);
  // The rupees only: the client is never told the percentage.
  assert.deepEqual(breakdown.discount, { amount: 1000 });
  assert.deepEqual(breakdown.extras, [{ reason: "Referral concession", amount: 500 }, { reason: "", amount: 300 }]);
  assert.equal(breakdown.any, true);
  // No discount at all: nothing to print.
  assert.deepEqual(quotationDiscountBreakdown({ amount: 2000, payload: { subtotal: 2000, discount: 0, discountAmount: 0 } }), { discount: null, extras: [], any: false });
  // A payload from before `discountAmount` was saved is worked out the same way the summary does.
  assert.deepEqual(quotationDiscountBreakdown({ discount: 20, payload: { subtotal: 2000 } }).discount, { amount: 400 });
  // And from what the public API now sends: the rupees, and no percentage at all.
  assert.deepEqual(quotationDiscountBreakdown({ payload: { subtotal: 2000, discountAmount: 300 } }).discount, { amount: 300 });
  // Only extra discounts.
  const extrasOnly = quotationDiscountBreakdown({ payload: { subtotal: 2000, discount: 0, extraDiscountReason: "Festival offer", extraDiscountAmount: 200 } });
  assert.equal(extrasOnly.discount, null);
  assert.deepEqual(extrasOnly.extras, [{ reason: "Festival offer", amount: 200 }]);
});

test("the discount card sits between the events and the price, and prints the saved total unchanged", () => {
  const page = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "PublicQuotationPage.js"), "utf8");
  const at = (text) => page.indexOf(text);
  assert.ok(at("{content.deliverableFootnote}") < at("<DiscountCard breakdown={quotationDiscountBreakdown(quotation)} />"));
  assert.ok(at("<DiscountCard breakdown={quotationDiscountBreakdown(quotation)} />") < at("{/* ── The money ── */}"));
  assert.match(page, /\{currency\(quotation\.amount\)\}/, "the price is still the saved total");
  assert.match(page, /if \(!breakdown\.any\) return null;/);
  assert.match(page, /import LocalOfferOutlined from "@mui\/icons-material\/LocalOfferOutlined";/);
  assert.match(page, /import LoyaltyOutlined from "@mui\/icons-material\/LoyaltyOutlined";/);
  assert.ok(!/Extra Discount \$\{|Extra Discount \{index/.test(page), "no numbering on the client's copy");
});
