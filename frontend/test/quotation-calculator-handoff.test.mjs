import test from "node:test";
import assert from "node:assert/strict";

import { generatorDraftFromCalculator, pricingRowForLine } from "../src/lib/quotationCalculatorHandoff.mjs";
import { quotationTotals } from "../src/lib/quotationBrand.mjs";
import { servicePricingRowForLine } from "../src/lib/servicePricing.mjs";

/*
 * Apply to Quotation on the CRM's Quotation Calculator hands the Quotation Generator its choices
 * as the generator's own rows: one shoot, dated from the calculator, and every service and
 * deliverable exactly as `serviceRowFor` and `deliverableRowFor` would have built it there.
 */

const timingSet = { values: [{ id: "t-half", code: "HALF_SESSION", label: "Half Session" }, { id: "t-full", code: "FULL_SESSION", label: "Full Session" }] };
const boothDefinition = {
  id: "s2", name: "360 Booth", complimentary: true, deliverableAdded: true, sizeEnabled: false, timingOptionSet: timingSet,
  pricing: [
    { shootType: "STUDIO", timingMode: "HALF_SESSION", duration: "4-5 Hours (Half)", price: 7000, deliverables: [{ deliverableId: "d4", brandId: "b9", variantId: "v9" }] },
    { shootType: "OUTDOOR", timingMode: "FULL_SESSION", duration: "8-10 Hours (Full)", price: null },
    { shootType: "STUDIO", timingMode: "HOURS_MINUTES", hours: 3, price: 2800 },
  ],
};
const droneDefinition = { id: "s9", name: "Drone", price: "5000", pricing: [] };
const catalogue = {
  services: [
    { id: "s2", name: "360 Booth", lines: [
      { id: "s2:0", shootType: "Studio / In-House", timing: "Half Session", duration: "4-5 Hours (Half)", size: "", price: 7000, deliverables: [{ deliverableId: "d4", brandId: "b9", variantId: "v9" }] },
      { id: "s2:1", shootType: "Studio / In-House", timing: "Hours / Minutes", duration: "3 hours", size: "", price: 2800, deliverables: [] },
    ] },
    { id: "s9", name: "Drone", lines: [{ id: "s9:flat", shootType: "", timing: "", duration: "", size: "", price: 5000, deliverables: [] }] },
  ],
  deliverables: [{ id: "d4", name: "Photo Strip" }, { id: "d3", name: "Album Printing" }, { id: "d5", name: "Raw - File IN" }],
};
const albumDefinition = { id: "d3", name: "Album Printing", mediaType: "IMAGE", photoCountEnabled: "Yes", remarksEnabled: "Sent flat.", complimentary: false, price: 2200, brands: [{ id: "b2", name: "Pictoo", variants: [{ id: "v3", size: "12x36", frameInches: "", videoLength: null, price: 3100 }] }] };
const stripDefinition = { id: "d4", name: "Photo Strip", mediaType: "IMAGE", price: 150, brands: [{ id: "b9", name: "", variants: [{ id: "v9", size: "2x6", price: 80 }] }] };
const rawDefinition = { id: "d5", name: "Raw - File IN", price: null, brands: [] };
const durationFor = (timings, hours) => timings.includes("Hourly") ? { sessionDurationHours: hours, sessionDurationMinutes: 0 } : timings.includes("Full Session") ? { sessionDurationHours: 12, sessionDurationMinutes: 0 } : { sessionDurationHours: 5, sessionDurationMinutes: 0 };

const build = (overrides = {}) => generatorDraftFromCalculator({
  catalogue,
  serviceRows: [{ serviceId: "s2", lineId: "s2:0", quantity: 2 }, { serviceId: "s9", lineId: "s9:flat", quantity: 1 }],
  deliverableQuantities: { "d4::b9::v9": 1, "d3::b2::v3": 1, d5: 2 },
  deliverableCounts: { "d3::b2::v3": 10 },
  autoDeliverables: { "d4::b9::v9": "s2:0" },
  eventDate: "2026-10-04",
  basePackagePrice: "",
  extras: "",
  discountPercent: "20",
  serviceDefinitions: [boothDefinition, droneDefinition],
  deliverableDefinitions: [albumDefinition, stripDefinition, rawDefinition],
  lead: { enquiryId: "DD-ERD-000123", vertical: "Dum Dum" },
  leadId: "DD-ERD-000123",
  durationFor,
  now: 1700000000000,
  ...overrides,
});

test("the pricing row a calculator line was quoted from is found by its place among the priced rows", () => {
  // The catalogue skips the unpriced Outdoor row, so line 1 is the hourly row, not the outdoor one.
  assert.equal(pricingRowForLine(boothDefinition, "s2:0").timingMode, "HALF_SESSION");
  assert.equal(pricingRowForLine(boothDefinition, "s2:1").timingMode, "HOURS_MINUTES");
  assert.equal(pricingRowForLine(boothDefinition, "s2:7"), null);
  assert.equal(pricingRowForLine(droneDefinition, "s9:flat"), null);
});

test("the choices become one shoot, dated from the calculator, booked as its lines are priced", () => {
  const { draft, skipped, carriedAsNote } = build();
  assert.deepEqual(skipped, []);
  assert.deepEqual(carriedAsNote, []);
  assert.equal(draft.shoots.length, 1);
  const [shoot] = draft.shoots;
  assert.equal(shoot.id, "quote-shoot-1700000000000-0");
  assert.equal(shoot.shootId, "Q-SID-0001");
  assert.equal(shoot.dateCreated, "2026-10-04");
  assert.deepEqual(shoot.shootTypes, ["Studio / In-House"]);
  assert.deepEqual(shoot.sessionTimings, ["Half Session"]);
  assert.equal(shoot.sessionDurationHours, 5);
  assert.equal(shoot.isMainEvent, true);
  // The generator's own answers for the questions the calculator never asked.
  assert.equal(shoot.shoot, "");
  assert.equal(shoot.foodTakenCareBy, "Studio");
  assert.equal(draft.vertical, "Dum Dum");
  assert.equal(draft.enquiryId, "DD-ERD-000123");
  // The estimate said 20%; the quotation is handed it at the cap, the most it can be saved at.
  assert.equal(draft.discount, 15);
  assert.equal(draft.additionalNotes, "");
});

test("a service is the row the generator would have made, at the price the calculator quoted", () => {
  const { draft } = build();
  const [booth, drone] = draft.services;
  assert.equal(booth.id, `quote-service-${draft.shoots[0].id}-s2`);
  assert.equal(booth.shootId, draft.shoots[0].id);
  assert.equal(booth.serviceDefinitionId, "s2");
  assert.equal(booth.serviceDefinition, boothDefinition);
  assert.equal(booth.serviceName, "360 Booth");
  assert.equal(booth.quantity, 2);
  assert.equal(booth.unitPrice, 7000);
  // Its Session Timing is the timing set's entry for the line's mode - which is what lets the
  // generator resolve the very same pricing row again, mapped deliverables and all.
  assert.equal(booth.sessionOptionId, "t-half");
  assert.equal(servicePricingRowForLine(boothDefinition, draft.shoots[0], booth), boothDefinition.pricing[0]);
  // The master's Complimentary is a permission the row carries; the answer starts at No.
  assert.equal(booth.complimentaryAllowed, true);
  assert.equal(booth.complimentary, false);
  assert.equal(drone.unitPrice, 5000);
  assert.equal(drone.sessionOptionId, "");
});

test("an hourly line books the shoot by the hour, at the line's hours", () => {
  const { draft } = build({ serviceRows: [{ serviceId: "s2", lineId: "s2:1", quantity: 1 }] });
  assert.deepEqual(draft.shoots[0].sessionTimings, ["Hourly"]);
  assert.equal(draft.shoots[0].sessionDurationHours, 3);
  assert.equal(draft.services[0].durationHours, 3);
  assert.equal(draft.services[0].unitPrice, 2800);
});

test("a deliverable is the row its variant makes, with its count and where it came from", () => {
  const { draft } = build();
  const strip = draft.deliverables.find((row) => row.deliverableVariantId === "v9");
  const album = draft.deliverables.find((row) => row.deliverableVariantId === "v3");
  const raw = draft.deliverables.find((row) => row.deliverableDefinitionId === "d5");
  assert.equal(strip.id, `quote-deliverable-${draft.shoots[0].id}-d4-v9`);
  assert.equal(strip.unitPrice, 80);
  assert.equal(strip.deliverableOptionId, "d4::b9::v9");
  // Brought in by the booth's line: recorded against the booth's generator row, so the generator
  // takes it away again if the booth goes.
  assert.equal(strip.autoFromService, draft.services[0].id);
  assert.equal(strip.autoSourceType, "SERVICE_PRICING");
  assert.equal(strip.autoServiceDefinitionId, "s2");
  // Named without the Settings note, which arrives as the line's own editable Remarks instead.
  assert.equal(album.deliverableVariantLabel, "Album Printing - Pictoo - 12x36");
  assert.equal(album.remarks, "Sent flat.");
  assert.equal(album.deliverableBrandName, "Pictoo");
  assert.equal(album.size, "12x36");
  assert.equal(album.numberOfPhotos, 10);
  assert.equal(album.unitPrice, 3100);
  assert.equal(album.autoFromService, undefined);
  // A flat row, unpriced in Settings, is left unstamped: the generator's own rule prices it.
  assert.equal(raw.quantity, 2);
  assert.equal(raw.numberOfPhotos, "");
  assert.ok(!("unitPrice" in raw));
  assert.ok(!("deliverableVariantId" in raw));
});

test("the generator's own arithmetic gives the calculator's figure for the same choices", () => {
  const { draft } = build({ deliverableQuantities: { "d4::b9::v9": 1, "d3::b2::v3": 1 } });
  const totals = quotationTotals({ services: draft.services, deliverables: draft.deliverables, rates: {}, discountPercent: draft.discount });
  // 2 × 7000 + 5000 + 80 + 1 × 10 × 3100, less the 15% it was handed over at.
  assert.equal(totals.subtotal, 14000 + 5000 + 80 + 31000);
  assert.equal(totals.amount, Math.round((14000 + 5000 + 80 + 31000) * 0.85));
});

test("what the generator cannot carry stops the handoff and is named", () => {
  const unchosen = build({ serviceRows: [{ serviceId: "s2", lineId: "", quantity: 1 }] });
  assert.deepEqual(unchosen.skipped, ["360 Booth: choose its option before applying."]);
  const gone = build({ serviceDefinitions: [droneDefinition] });
  assert.deepEqual(gone.skipped, ["360 Booth: no longer offered under Settings → Project → Services."]);
  const variantGone = build({ deliverableDefinitions: [albumDefinition, { ...stripDefinition, brands: [] }, rawDefinition] });
  assert.deepEqual(variantGone.skipped, ["Photo Strip: that variant is no longer offered."]);
});

test("a base package and extras travel as words, and are said before leaving", () => {
  const { draft, carriedAsNote } = build({ basePackagePrice: "25,000", extras: "1500" });
  assert.deepEqual(carriedAsNote, ["Base package price: ₹25,000.", "Extras: ₹1,500."]);
  assert.equal(draft.additionalNotes, "Base package price: ₹25,000. Extras: ₹1,500.");
  assert.deepEqual(draft.calculator, { leadId: "DD-ERD-000123", eventDate: "2026-10-04", basePackagePrice: 25000, extras: 1500 });
});

test("no lead, no date: the draft still stands", () => {
  const { draft } = build({ lead: null, leadId: "", eventDate: "" });
  assert.equal(draft.vertical, "");
  assert.equal(draft.enquiryId, "");
  assert.equal(draft.shoots[0].dateCreated, null);
});
