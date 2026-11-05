import test from "node:test";
import assert from "node:assert/strict";

import {
  QUOTATION_BRANDS,
  brandBadgeLabel,
  brandCodeForVertical,
  brandDeliverableDefinitions,
  brandFieldsForServiceRow,
  brandOfQuotation,
  brandServiceDefinitions,
  deliverableUnitPrice,
  packageRowsForShoot,
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

test("a line prices at the price stamped on it, and only falls back to the rates without one", () => {
  // Stamped when added: the brand's default for the service at that moment.
  assert.equal(serviceUnitPrice({ serviceDefinitionId: "candid", unitPrice: 25000 }, rates), 25000);
  // A stamped zero is a price - a complimentary line - not an absence.
  assert.equal(serviceUnitPrice({ serviceDefinitionId: "candid", unitPrice: 0 }, rates), 0);
  // No stamp: the per-definition rate the studio set, then the flat rate. This is every row raised
  // before brands existed, and every row picked off the project catalogue since.
  assert.equal(serviceUnitPrice({ serviceDefinitionId: "candid" }, rates), 30000);
  assert.equal(serviceUnitPrice({ serviceDefinitionId: "drone" }, rates), 2000);
  assert.equal(serviceUnitPrice({ serviceDefinitionId: "drone", unitPrice: "" }, rates), 2000);
  assert.equal(deliverableUnitPrice({ deliverableDefinitionId: "album" }, rates), 5000);
  assert.equal(deliverableUnitPrice({ deliverableDefinitionId: "reels", unitPrice: 750 }, rates), 750);
  assert.equal(deliverableUnitPrice({ deliverableDefinitionId: "reels" }, rates), 1000);
});

test("the totals are the rows' prices times their quantities, less the discount, with GST stated on top", () => {
  const totals = quotationTotals({
    services: [{ serviceDefinitionId: "candid", quantity: 2, unitPrice: 30000 }, { serviceDefinitionId: "drone" }],
    deliverables: [{ deliverableDefinitionId: "album", quantity: 1 }],
    rates,
    discountPercent: 10,
  });
  assert.equal(totals.subtotal, 60000 + 2000 + 5000);
  assert.equal(totals.discountAmount, 6700);
  assert.equal(totals.amount, 60300);
  assert.equal(totals.gstPercent, 18);
  assert.equal(totals.gstAmount, 10854);
  assert.equal(totals.grandTotal, 71154);
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

test("a configured brand offers its own list: linked rows carry their definition, plain rows stand alone", () => {
  const offered = brandServiceDefinitions([
    { id: "bs-candid", name: "Candid Photography", serviceDefinitionId: "def-candid", defaultPrice: 30000, isActive: true },
    { id: "bs-live", name: "Live Streaming", serviceDefinitionId: null, defaultPrice: 15000, isActive: true },
    { id: "bs-hidden", name: "Retired", serviceDefinitionId: "def-drone", defaultPrice: 1, isActive: false },
  ], catalogue);
  assert.equal(offered.usingCatalogue, false);
  assert.equal(offered.definitions.length, 2, "a hidden service is not offered");
  const [candid, live] = offered.definitions;
  // Linked: the catalogue definition, under the brand's name, with the brand's price beside it.
  assert.equal(candid.id, "def-candid");
  assert.equal(candid.name, "Candid Photography");
  assert.deepEqual(candid.timingModes, ["HOURS_MINUTES"]);
  assert.equal(candid.brandServiceId, "bs-candid");
  assert.equal(candid.brandDefaultPrice, 30000);
  // Plain: a made-up id the table can key, and no project definition behind it.
  assert.equal(live.id, "brand-service:bs-live");
  assert.equal(live.brandServiceId, "bs-live");
  assert.deepEqual(brandFieldsForServiceRow(live), { brandServiceId: "bs-live", unitPrice: 15000, serviceDefinitionId: "" });
  assert.deepEqual(brandFieldsForServiceRow(candid), { brandServiceId: "bs-candid", unitPrice: 30000 });
  // A catalogue definition stamps nothing at all.
  assert.deepEqual(brandFieldsForServiceRow(catalogue[1]), {});
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
