import test from "node:test";
import assert from "node:assert/strict";

import { calculatorTotals, deliverableDetailLabel, linesCost, serviceLineLabel } from "../src/lib/quotationCalculator.mjs";

/*
 * The CRM Quotation Calculator prices a lead from the studio's own services and deliverables.
 */

const services = [
  { id: "s1", name: "Booth", lines: [
    { id: "s1:0", shootType: "Studio / In-House", timing: "Full Session", duration: "8-10 Hours (Full)", size: "", price: 9000 },
    { id: "s1:1", shootType: "Studio / In-House", timing: "Hours / Minutes", duration: "3 hours", size: "55 inch", price: 2800 },
  ] },
  { id: "s3", name: "Unpriced", lines: [{ id: "s3:flat", shootType: "", timing: "", duration: "", size: "", price: null }] },
];
const deliverables = [
  { id: "d1", name: "Acrylic Printing", brandName: "Canvera", imageSize: "12x18", videoLength: "", frameInches: "1.5 inch", price: 1200 },
  { id: "d2", name: "Teaser", brandName: "", imageSize: "", videoLength: "3 minutes", frameInches: "", price: null },
];

test("a line and a deliverable read as the words Settings gave them", () => {
  assert.equal(serviceLineLabel(services[0].lines[0]), "Studio / In-House · Full Session · 8-10 Hours (Full)");
  assert.equal(serviceLineLabel(services[0].lines[1]), "Studio / In-House · Hours / Minutes · 3 hours · 55 inch");
  assert.equal(serviceLineLabel(services[1].lines[0]), "");
  assert.equal(deliverableDetailLabel(deliverables[0]), "Canvera · 12x18 · 1.5 inch");
  assert.equal(deliverableDetailLabel(deliverables[1]), "3 minutes");
});

test("every quantity counts at its own price, and an unpriced row counts nothing", () => {
  const cost = linesCost({ services, deliverables, serviceQuantities: { "s1:0": 1, "s1:1": 2, "s3:flat": 5 }, deliverableQuantities: { d1: 3, d2: 4 } });
  assert.equal(cost, 9000 + 2 * 2800 + 3 * 1200);
  assert.equal(linesCost({ services, deliverables }), 0);
  // A nonsense quantity is nothing, not NaN.
  assert.equal(linesCost({ services, deliverables, serviceQuantities: { "s1:0": "x" } }), 0);
});

test("the total is base package plus extras plus the lines, less the discount, held to 0..15", () => {
  const totals = calculatorTotals({ services, deliverables, serviceQuantities: { "s1:0": 1 }, deliverableQuantities: { d1: 1 }, basePackagePrice: "10,000", extras: "500", discountPercent: "10" });
  assert.equal(totals.lines, 10200);
  assert.equal(totals.serviceCost, 20700);
  assert.equal(totals.discount, 10);
  assert.equal(totals.totalCost, 18630);
  assert.equal(calculatorTotals({ services: [], deliverables: [], basePackagePrice: "100", extras: "", discountPercent: "250" }).totalCost, 85);
  assert.equal(calculatorTotals({ services: [], deliverables: [], basePackagePrice: "", extras: "", discountPercent: "abc" }).discount, 0);
});

/*
 * Rows are chosen the way the Quotation Generator chooses them - a service by its pricing line, a
 * deliverable by brand and variant - and priced at the Settings figure behind the choice, which the
 * screen no longer prints.
 */
import { deliverableOptions, deliverableRowFor, deliverableRows, quotedLines, serviceDisplayLabel, serviceIdOfLine, serviceLineRows, serviceQuantitiesFromRows, serviceRowsFromQuantities, syncAutoDeliverables } from "../src/lib/quotationCalculator.mjs";

const album = {
  id: "d3", name: "Album Printing", mediaType: "IMAGE", brandName: "Canvera", imageSize: "12x18", videoLength: "", frameInches: "1 inch", price: 2200, photoCountEnabled: "Yes", remarksEnabled: "Sent flat.",
  brands: [
    { id: "b1", name: "Canvera", variants: [{ id: "v1", size: "12x18", frameInches: "1 inch", videoLength: "", price: 2200 }, { id: "v2", size: "16x24", frameInches: "", videoLength: "", price: null }] },
    { id: "b2", name: "Pictoo", variants: [{ id: "v3", size: "12x36", frameInches: "", videoLength: "", price: 3100 }] },
  ],
};
const photoStrip = { id: "d4", name: "Photo Strip", mediaType: "IMAGE", brandName: "", imageSize: "", videoLength: "", frameInches: "", price: 150, brands: [{ id: "b9", name: "", variants: [{ id: "v9", size: "2x6", frameInches: "", videoLength: "", price: 80 }] }] };
const rawFilesIn = { id: "d5", name: "Raw - File IN", brandName: "", imageSize: "", videoLength: "", frameInches: "", price: 500, brands: [] };
const finalFilesOut = { id: "d6", name: "Final Files Out", brandName: "", imageSize: "", videoLength: "", frameInches: "", price: null, brands: [] };
const catalogueDeliverables = [...deliverables, album, photoStrip, rawFilesIn, finalFilesOut];
const booth = { id: "s2", name: "360 Booth", lines: [
  { id: "s2:0", shootType: "Studio / In-House", timing: "Half Session", duration: "", size: "", price: 7000, deliverables: [{ deliverableId: "d4", brandId: "b9", variantId: "v9" }] },
  { id: "s2:1", shootType: "Studio / In-House", timing: "Full Session", duration: "", size: "", price: 12000, deliverables: [{ deliverableId: "d4", brandId: "b9", variantId: "v9" }, { deliverableId: "d3", brandId: "b1", variantId: "gone" }] },
] };
const drone = { id: "s9", name: "Drone", lines: [{ id: "s9:flat", shootType: "", timing: "", duration: "", size: "", price: 5000, deliverables: [] }] };
const catalogueServices = [...services, booth, drone];

test("the picker offers the Quotation Generator's own variant list, worded the same way", () => {
  const options = deliverableOptions([album, rawFilesIn]);
  assert.deepEqual(options.map((option) => [option.id, option.name]), [
    ["d3::b1::v1", "Album Printing - Canvera - 12x18 - 1 inch - Sent flat."],
    ["d3::b1::v2", "Album Printing - Canvera - 16x24 - Sent flat."],
    ["d3::b2::v3", "Album Printing - Pictoo - 12x36 - Sent flat."],
    ["d5", "Raw - File IN"],
  ]);
});

test("a chosen row reads as its name and its words, at the price behind the choice", () => {
  const rows = serviceLineRows({ services: catalogueServices, serviceQuantities: { "s2:1": 2, "s9:flat": 1, "s3:flat": 3, "missing:0": 1, "s1:0": 0 } });
  assert.deepEqual(rows.map((row) => [row.id, row.name, row.detail, row.price, row.quantity]), [
    ["s2:1", "360 Booth", "Studio / In-House · Full Session", 12000, 2],
    ["s9:flat", "Drone", "Flat price", 5000, 1],
    // An unpriced line is a row - chosen on purpose - that counts nothing.
    ["s3:flat", "Unpriced", "Flat price", null, 3],
  ]);
  // A variant key is that variant, at its own price; a deliverable's id alone is the flat row every
  // earlier draft saved, at the flat price.
  assert.deepEqual(deliverableRowFor(catalogueDeliverables, "d3::b2::v3"), { id: "d3::b2::v3", definitionId: "d3", name: "Album Printing", photoCountEnabled: "Yes", detail: "Pictoo · 12x36", price: 3100 });
  assert.deepEqual(deliverableRowFor(catalogueDeliverables, "d3"), { id: "d3", definitionId: "d3", name: "Album Printing", photoCountEnabled: "Yes", detail: "Canvera · 12x18 · 1 inch", price: 2200 });
  // A variant nobody has priced is quoted at zero - the generator's rule - not at the flat figure.
  assert.equal(deliverableRowFor(catalogueDeliverables, "d3::b1::v2").price, 0);
  assert.equal(deliverableRowFor(catalogueDeliverables, "d3::b1::gone"), null);
  assert.equal(deliverableRowFor(catalogueDeliverables, "nobody"), null);
  const rowsOut = deliverableRows({ deliverables: catalogueDeliverables, deliverableQuantities: { "d3::b2::v3": 1, d1: 0, d5: 2 }, deliverableCounts: { "d3::b2::v3": 10 } });
  assert.deepEqual(rowsOut.map((row) => [row.id, row.quantity, row.count]), [["d3::b2::v3", 1, 10], ["d5", 2, 0]]);
});

test("No. of Count multiplies a counted deliverable, as it does on the Quotation Generator", () => {
  const base = { services: catalogueServices, deliverables: catalogueDeliverables, serviceQuantities: {} };
  assert.equal(linesCost({ ...base, deliverableQuantities: { "d3::b2::v3": 2 }, deliverableCounts: { "d3::b2::v3": 10 } }), 2 * 10 * 3100);
  // A blank count is not a count of nothing.
  assert.equal(linesCost({ ...base, deliverableQuantities: { "d3::b2::v3": 2 } }), 2 * 3100);
  // A deliverable not counted ignores a count it was somehow given.
  assert.equal(linesCost({ ...base, deliverableQuantities: { d5: 2 }, deliverableCounts: { d5: 10 } }), 2 * 500);
  assert.equal(calculatorTotals({ ...base, deliverableQuantities: { "d3::b2::v3": 1 }, deliverableCounts: { "d3::b2::v3": 3 }, basePackagePrice: "", extras: "", discountPercent: "0" }).totalCost, 9300);
});

test("a service line brings the deliverables Settings mapped onto it, and takes them away again", () => {
  const base = { services: catalogueServices, deliverables: catalogueDeliverables, deliverableCounts: {}, autoDeliverables: {} };
  // Half Session brings the photo strip; the mapping's second entry names a variant Settings no
  // longer holds, and brings nothing.
  const added = syncAutoDeliverables({ ...base, serviceQuantities: { "s2:1": 1 }, deliverableQuantities: { "d3::b2::v3": 1 } });
  assert.deepEqual(added.deliverableQuantities, { "d3::b2::v3": 1, "d4::b9::v9": 1 });
  assert.deepEqual(added.autoDeliverables, { "d4::b9::v9": "s2:1" });
  // The other booking maps the same variant: already on the quote, so not added twice, and now
  // accounted for by whichever line is still chosen.
  const both = syncAutoDeliverables({ ...base, serviceQuantities: { "s2:1": 1, "s2:0": 1 }, deliverableQuantities: added.deliverableQuantities, autoDeliverables: added.autoDeliverables });
  assert.deepEqual(both.deliverableQuantities, { "d3::b2::v3": 1, "d4::b9::v9": 1 });
  const oneLeft = syncAutoDeliverables({ ...base, serviceQuantities: { "s2:0": 1 }, deliverableQuantities: both.deliverableQuantities, autoDeliverables: both.autoDeliverables });
  assert.deepEqual(oneLeft.autoDeliverables, { "d4::b9::v9": "s2:0" });
  // The last line that brought it goes: the row goes with it, and its count goes too. The row
  // added by hand stays.
  const removed = syncAutoDeliverables({ ...base, serviceQuantities: {}, deliverableQuantities: { ...oneLeft.deliverableQuantities, "d4::b9::v9": 3 }, deliverableCounts: { "d4::b9::v9": 2, "d3::b2::v3": 5 }, autoDeliverables: oneLeft.autoDeliverables });
  assert.deepEqual(removed.deliverableQuantities, { "d3::b2::v3": 1 });
  assert.deepEqual(removed.deliverableCounts, { "d3::b2::v3": 5 });
  assert.deepEqual(removed.autoDeliverables, {});
  // A row somebody added by hand that a service also maps is theirs: not recorded as automatic,
  // so removing the service leaves it where it is.
  const manual = syncAutoDeliverables({ ...base, serviceQuantities: { "s2:0": 1 }, deliverableQuantities: { "d4::b9::v9": 2 } });
  assert.deepEqual(manual.autoDeliverables, {});
  assert.deepEqual(syncAutoDeliverables({ ...base, serviceQuantities: {}, deliverableQuantities: manual.deliverableQuantities }).deliverableQuantities, { "d4::b9::v9": 2 });
});

test("the names the generator pairs with a service follow it in, where the catalogue offers them", () => {
  const base = { services: [...catalogueServices, { id: "s7", name: "Drone", lines: [{ id: "s7:0", shootType: "Outdoor / On-Location", timing: "Full Session", duration: "", size: "", price: 4000, deliverables: [] }] }], deliverables: catalogueDeliverables, deliverableCounts: {}, autoDeliverables: {} };
  // "Drone" pairs with Raw - File IN and Final Files Out; both are offered here, so both arrive by
  // the deliverable's id at its flat price - Final Files Out unpriced, and counting nothing.
  const synced = syncAutoDeliverables({ ...base, serviceQuantities: { "s7:0": 1 }, deliverableQuantities: {} });
  assert.deepEqual(synced.deliverableQuantities, { d5: 1, d6: 1 });
  assert.deepEqual(synced.autoDeliverables, {});
  // Already held - by a variant of it, or by hand - is already quoted.
  const held = syncAutoDeliverables({ ...base, serviceQuantities: { "s7:0": 1 }, deliverableQuantities: { d5: 4 } });
  assert.deepEqual(held.deliverableQuantities, { d5: 4, d6: 1 });
  // A name the catalogue does not offer is not invented.
  const sparse = syncAutoDeliverables({ ...base, deliverables: [album], serviceQuantities: { "s7:0": 1 }, deliverableQuantities: {} });
  assert.deepEqual(sparse.deliverableQuantities, {});
});

test("the lines applied to a lead say what was chosen, at what price, and what each came to", () => {
  const lines = quotedLines({
    services: catalogueServices,
    deliverables: catalogueDeliverables,
    serviceQuantities: { "s2:1": 2, "s3:flat": 1 },
    deliverableQuantities: { "d3::b2::v3": 1, d5: 2 },
    deliverableCounts: { "d3::b2::v3": 10 },
  });
  assert.deepEqual(lines, [
    { kind: "SERVICE", id: "s2:1", name: "360 Booth", detail: "Studio / In-House · Full Session", quantity: 2, count: null, unitPrice: 12000, total: 24000 },
    { kind: "SERVICE", id: "s3:flat", name: "Unpriced", detail: "Flat price", quantity: 1, count: null, unitPrice: null, total: 0 },
    { kind: "DELIVERABLE", id: "d3::b2::v3", name: "Album Printing", detail: "Pictoo · 12x36", quantity: 1, count: 10, unitPrice: 3100, total: 31000 },
    { kind: "DELIVERABLE", id: "d5", name: "Raw - File IN", detail: "", quantity: 2, count: null, unitPrice: 500, total: 1000 },
  ]);
});

test("service rows are read back from a draft's quantities, and resolve to quantities again", () => {
  assert.equal(serviceIdOfLine("clx123:0"), "clx123");
  assert.equal(serviceIdOfLine("clx123:flat"), "clx123");
  assert.equal(serviceIdOfLine("nocolon"), "");
  // A draft saved before rows existed: one row per line that counts, in the order it was saved.
  assert.deepEqual(serviceRowsFromQuantities({ "s2:1": 2, "s9:flat": 0, "s1:0": 1, junk: 3 }), [
    { serviceId: "s2", lineId: "s2:1", quantity: 2 },
    { serviceId: "s1", lineId: "s1:0", quantity: 1 },
  ]);
  // A row still waiting for its option prices nothing; a row with one counts at its line.
  assert.deepEqual(serviceQuantitiesFromRows([{ serviceId: "s2", lineId: "", quantity: 3 }, { serviceId: "s9", lineId: "s9:flat", quantity: 2 }, { serviceId: "s1", lineId: "s1:0", quantity: 0 }]), { "s9:flat": 2 });
  assert.deepEqual(serviceQuantitiesFromRows(undefined), {});
});

test("a service reads as its name, shoot type, session timing and duration, with no gap for a part it lacks", () => {
  assert.equal(serviceDisplayLabel("360 Camera Booth", { shootType: "Studio / In-House", timing: "Half Session", duration: "4-5 Hours (Half)", size: "" }), "360 Camera Booth - Studio / In-House - Half Session - 4-5 Hours (Half)");
  assert.equal(serviceDisplayLabel("Booth", { shootType: "Outdoor / On-Location", timing: "Full Session", duration: "", size: "55 inch" }), "Booth - Outdoor / On-Location - Full Session - 55 inch");
  assert.equal(serviceDisplayLabel("Drone", { shootType: "", timing: "", duration: "", size: "" }), "Drone");
  assert.equal(serviceDisplayLabel("Drone", null), "Drone");
});
