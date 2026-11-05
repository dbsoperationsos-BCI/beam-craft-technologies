import test from "node:test";
import assert from "node:assert/strict";

import { defaultDurationFor, duplicatePricingLines, matchServiceSize, pricedServiceSizeOptions, pricedTimingModesFor, pricingForSave, pricingFormLines, servicePriceForShoot } from "../src/lib/servicePricing.mjs";

/*
 * A service priced per shoot type and session timing, and the price a quotation's shoot takes.
 */

const pricing = [
  { shootType: "STUDIO", timingMode: "HALF_SESSION", duration: "5-6 Hours", price: 5000 },
  { shootType: "STUDIO", timingMode: "FULL_SESSION", price: 9000 },
  { shootType: "STUDIO", timingMode: "HOURS_MINUTES", hours: 2, price: 2000 },
  { shootType: "STUDIO", timingMode: "HOURS_MINUTES", hours: 3, price: 2800 },
  { shootType: "OUTDOOR", timingMode: "FULL_SESSION", price: 12000 },
];

test("Hours / Minutes is offered to a studio line and to no other", () => {
  assert.deepEqual(pricedTimingModesFor("STUDIO"), ["HALF_SESSION", "FULL_SESSION", "HOURS_MINUTES"]);
  assert.deepEqual(pricedTimingModesFor("OUTDOOR"), ["HALF_SESSION", "FULL_SESSION"]);
  assert.deepEqual(pricedTimingModesFor(""), ["HALF_SESSION", "FULL_SESSION"]);
});

test("a service opens on its stored lines, hours included, or on one empty line to fill in", () => {
  const lines = pricingFormLines(pricing);
  assert.equal(lines.length, 5);
  assert.deepEqual(lines.map((line) => line.price), ["5000", "9000", "2000", "2800", "12000"]);
  assert.deepEqual(lines.map((line) => line.hours), ["", "", "2", "3", ""]);
  // A session line reads the length it was saved with, or the studio's own where none was.
  assert.deepEqual(lines.map((line) => line.duration), ["5-6 Hours", "10-12 Hours (Full)", "", "", "10-12 Hours (Full)"]);
  const fresh = pricingFormLines(null);
  assert.equal(fresh.length, 1);
  // `deliverables` is the variants this booking brings with it, empty until any are mapped.
  assert.deepEqual(fresh[0], { id: "line-first", shootType: "", timingMode: "", hours: "", duration: "", size: "", sizeOptionValueId: "", price: "", deliverables: [] });
});

test("a session line starts on the studio's own length, and an hourly line on none", () => {
  assert.equal(defaultDurationFor("HALF_SESSION"), "4-5 Hours (Half)");
  assert.equal(defaultDurationFor("FULL_SESSION"), "10-12 Hours (Full)");
  assert.equal(defaultDurationFor("HOURS_MINUTES"), "");
});

test("only complete lines with a figure are saved; an hourly line needs its hours, and a repeat is dropped", () => {
  const lines = [
    { id: "a", shootType: "STUDIO", timingMode: "HALF_SESSION", hours: "", duration: "  5-6 Hours ", price: "5000" },
    { id: "b", shootType: "STUDIO", timingMode: "FULL_SESSION", hours: "", price: "" },
    { id: "c", shootType: "", timingMode: "", hours: "", price: "100" },
    { id: "d", shootType: "OUTDOOR", timingMode: "HOURS_MINUTES", hours: "2", price: "700" },
    { id: "e", shootType: "STUDIO", timingMode: "HOURS_MINUTES", hours: "", price: "900" },
    { id: "f", shootType: "STUDIO", timingMode: "HOURS_MINUTES", hours: "2", price: "2000" },
    { id: "g", shootType: "STUDIO", timingMode: "HOURS_MINUTES", hours: "3", price: "2800" },
    { id: "h", shootType: "STUDIO", timingMode: "HOURS_MINUTES", hours: "3", price: "2900" },
    { id: "i", shootType: "STUDIO", timingMode: "HALF_SESSION", hours: "", price: "6000" },
  ];
  assert.deepEqual(pricingForSave(lines), [
    { shootType: "STUDIO", timingMode: "HALF_SESSION", duration: "5-6 Hours", price: 5000 },
    { shootType: "STUDIO", timingMode: "HOURS_MINUTES", hours: 2, price: 2000 },
    { shootType: "STUDIO", timingMode: "HOURS_MINUTES", hours: 3, price: 2800 },
  ]);
  // A session line with its duration left blank is saved with the studio's own length.
  assert.equal(pricingForSave([{ shootType: "OUTDOOR", timingMode: "FULL_SESSION", duration: "", price: "1" }])[0].duration, "10-12 Hours (Full)");
  // Two hours and three hours are two bookings; three hours twice is one booking priced twice.
  assert.deepEqual(duplicatePricingLines(lines).sort(), ["STUDIO:HALF_SESSION", "STUDIO:HOURS_MINUTES:3"]);
  assert.deepEqual(duplicatePricingLines(lines.slice(0, 7)), []);
});

test("a shoot takes the row matching its type and timing, as the shoot words them", () => {
  const definition = { pricing };
  assert.equal(servicePriceForShoot(definition, { shootTypes: ["Studio / In-House"], sessionTimings: ["Half Session"] }), 5000);
  assert.equal(servicePriceForShoot(definition, { shootType: "Outdoor / On-Location", sessionTiming: "Full Session" }), 12000);
  // Codes are accepted too, for a shoot that already stores them.
  assert.equal(servicePriceForShoot(definition, { shootTypes: ["STUDIO"], sessionTimings: ["FULL_SESSION"] }), 9000);
});

test("an hourly shoot takes the line priced for its length, and nothing for a length no line prices", () => {
  const definition = { pricing };
  const hourly = (hours, minutes = 0) => ({ shootTypes: ["Studio / In-House"], sessionTimings: ["Hourly"], sessionDurationHours: hours, sessionDurationMinutes: minutes });
  assert.equal(servicePriceForShoot(definition, hourly(2)), 2000);
  assert.equal(servicePriceForShoot(definition, hourly(3)), 2800);
  assert.equal(servicePriceForShoot(definition, hourly(4)), null);
  assert.equal(servicePriceForShoot(definition, hourly(2, 30)), null);
  assert.equal(servicePriceForShoot(definition, { shootTypes: ["Studio / In-House"], sessionTimings: ["Hourly"] }), null);
});

test("a service sold by size prices the same booking once per size, and a line only once it has a size", () => {
  const values = [{ id: "tv55", label: "55 inch", value: "55 inch" }, { id: "tv65", label: "65 inch", value: "65 inch" }];
  assert.equal(matchServiceSize("55 INCH", values)?.id, "tv55");
  assert.equal(matchServiceSize("50 inch", values), null);
  const lines = [
    { id: "a", shootType: "STUDIO", timingMode: "FULL_SESSION", hours: "", duration: "10-12 Hours (Full)", size: "55 inch", sizeOptionValueId: "tv55", price: "9000" },
    { id: "b", shootType: "STUDIO", timingMode: "FULL_SESSION", hours: "", duration: "10-12 Hours (Full)", size: "65 inch", sizeOptionValueId: "tv65", price: "12000" },
    { id: "c", shootType: "STUDIO", timingMode: "FULL_SESSION", hours: "", duration: "10-12 Hours (Full)", size: "", sizeOptionValueId: "", price: "1" },
    { id: "d", shootType: "STUDIO", timingMode: "FULL_SESSION", hours: "", duration: "10-12 Hours (Full)", size: " 55 Inch ", sizeOptionValueId: "tv55", price: "9500" },
    { id: "e", shootType: "STUDIO", timingMode: "HALF_SESSION", hours: "", duration: "4-5 Hours (Half)", size: "Custom 70", sizeOptionValueId: "", price: "3000" },
  ];
  // Two sizes of one booking are two prices; a line with no size is not a booking; a size twice is a repeat.
  assert.deepEqual(pricingForSave(lines, true).map((row) => [row.size, row.sizeOptionValueId ?? null, row.price]), [["55 inch", "tv55", 9000], ["65 inch", "tv65", 12000], ["Custom 70", null, 3000]]);
  assert.deepEqual(duplicatePricingLines(lines, true), ["STUDIO:FULL_SESSION:tv55"]);
  // Sold without size, the same lines collapse to one booking and carry no size.
  assert.equal(pricingForSave(lines, false).length, 2);
  assert.equal("size" in pricingForSave(lines, false)[0], false);

  const definition = { sizeEnabled: true, pricing: pricingForSave(lines, true), pricedSizeOptions: values };
  const full = { shootTypes: ["Studio / In-House"], sessionTimings: ["Full Session"] };
  assert.equal(servicePriceForShoot(definition, full), null);
  assert.equal(servicePriceForShoot(definition, full, { sizeOptionValueId: "tv65" }), 12000);
  assert.equal(servicePriceForShoot(definition, { shootTypes: ["Studio / In-House"], sessionTimings: ["Half Session"] }, { size: "custom 70" }), 3000);
  assert.deepEqual(pricedServiceSizeOptions(definition).map((option) => option.id), ["tv55", "tv65"]);
  assert.deepEqual(pricedServiceSizeOptions({ pricing: [{ shootType: "STUDIO", timingMode: "HALF_SESSION", price: 1 }] }), []);
});

test("a shoot the pricing does not cover falls back, rather than pricing at zero", () => {
  assert.equal(servicePriceForShoot({ pricing }, { shootTypes: ["Outdoor / On-Location"], sessionTimings: ["Half Session"] }), null);
  assert.equal(servicePriceForShoot({ pricing: [] }, { shootTypes: ["Studio / In-House"], sessionTimings: ["Half Session"] }), null);
  assert.equal(servicePriceForShoot({}, { shootTypes: ["Studio / In-House"], sessionTimings: ["Half Session"] }), null);
});
