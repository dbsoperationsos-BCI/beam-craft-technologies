import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { quotationTotals } from "../src/lib/quotationBrand.mjs";
import { unpricedDeliverableNote, unpricedServiceNote } from "../src/lib/quotationLinePricing.mjs";
import { generatorDraftFromCalculator } from "../src/lib/quotationCalculatorHandoff.mjs";

/*
 * Every shoot on a quotation is counted, and every service on it is priced at its one price in
 * Settings - whatever the shoot's type or session. A line Settings prices nothing for says so
 * instead of quietly counting ₹0.
 *
 * The per-booking pricing lines a service may still store (Studio + Half Session at one figure,
 * Outdoor + Full at another) are not read: Settings no longer asks Shoot Type, Session Timing,
 * Duration or Size. They are kept on the definitions below to prove it.
 */

const PANEL = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "QuotationGeneratorPanel.js"), "utf8");
const SECTION = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "project-management", "ProjectServiceCreationSection.js"), "utf8");

const SESSIONS = { values: [{ id: "half", code: "HALF_SESSION", label: "Half Session" }, { id: "full", code: "FULL_SESSION", label: "Full Session" }] };
const BOOTH_789 = { id: "s-789", name: "789 booth", price: "30000", timingOptionSet: SESSIONS, pricing: [{ shootType: "STUDIO", timingMode: "HALF_SESSION", price: 1 }, { shootType: "STUDIO", timingMode: "FULL_SESSION", price: 2 }] };
// Priced only per session until now: no single Price yet.
const PHOTOBOOTH = { id: "s-360", name: "360 PhotoBooth", price: null, timingOptionSet: SESSIONS, pricing: [{ shootType: "STUDIO", timingMode: "HALF_SESSION", price: 4000 }, { shootType: "STUDIO", timingMode: "FULL_SESSION", price: 5000 }] };
const ADVANT = { id: "s-adv", name: "advant", price: "2450.00", timingOptionSet: SESSIONS, pricing: [
  { shootType: "STUDIO", timingMode: "FULL_SESSION", price: 1 }, { shootType: "OUTDOOR", timingMode: "HALF_SESSION", price: 2 },
] };
const shoot = (id, type, session) => ({ id, shootTypes: [type], sessionTimings: [session] });
const STUDIO = "Studio / In-House";
const OUTDOOR = "Outdoor / On-Location";
// A line as `serviceRowFor` makes it: stamped with the service's one price, where it has one.
const flat = (definition) => (definition.price == null ? null : Number(definition.price));
const lineOn = (definition, on, extra = {}) => {
  const timed = flat(definition);
  return { id: `${on.id}-${definition.id}`, shootId: on.id, serviceDefinitionId: definition.id, serviceDefinition: definition, serviceName: definition.name, sessionOptionId: on.sessionTimings[0] === "Full Session" ? "full" : "half", quantity: 1, ...(timed !== null ? { unitPrice: timed } : {}), ...extra };
};

test("the generator stamps the service's one price, and reads no pricing line", () => {
  const rowFor = PANEL.slice(PANEL.indexOf("function serviceRowFor("), PANEL.indexOf("\n  }\n", PANEL.indexOf("function serviceRowFor(")));
  assert.match(rowFor, /const timed = flatPriceOf\(definition\);/);
  assert.doesNotMatch(PANEL, /servicePriceForShoot\(|servicePricingRowForLine\(|servicePricingRowForShoot\(/);
});

test("a service is the same price on every shoot, whatever its type or session", () => {
  const shoots = [shoot("h", STUDIO, "Full Session"), shoot("m", OUTDOOR, "Full Session"), shoot("w", STUDIO, "Half Session"), shoot("r", OUTDOOR, "Half Session")];
  assert.deepEqual(shoots.map((on) => lineOn(ADVANT, on).unitPrice), [2450, 2450, 2450, 2450]);
});

test("a service with no price counts ₹0 on any shoot, and says so", () => {
  const s1 = shoot("q1", STUDIO, "Half Session");
  const s2 = shoot("q2", OUTDOOR, "Half Session");
  const lines = [lineOn(BOOTH_789, s1), lineOn(PHOTOBOOTH, s2), lineOn(PHOTOBOOTH, s1)];
  assert.equal(lines[1].unitPrice, undefined, "its old per-session figures are not read");
  assert.equal(quotationTotals({ services: lines, rates: {} }).subtotal, 30000);
  assert.equal(unpricedServiceNote(lines[0], s1), null);
  assert.equal(unpricedServiceNote(lines[1], s2), "Not priced in Settings");
  assert.equal(unpricedServiceNote(lines[2], s1), "Not priced in Settings", "a Studio shoot too: no session prices it now");
  // The note survives a save: the line is saved at ₹0 and is still read as unpriced.
  assert.equal(unpricedServiceNote({ ...lines[1], unitPrice: 0 }, s2), "Not priced in Settings");
  // Once its Price is entered, it is priced everywhere.
  assert.equal(lineOn({ ...PHOTOBOOTH, price: "4500" }, s2).unitPrice, 4500);
});

test("the line and the summary show it", () => {
  assert.match(PANEL, /serviceLineNote=\{serviceNote\}\n\s*deliverableLineNote=\{deliverableNote\}/);
  // Asked of the service as Settings holds it now, by the line's own id.
  assert.match(PANEL, /return \(row, shoot\) => unpricedServiceNote\(row, shoot, live\.get\(row\.serviceDefinitionId\)\);/);
  assert.match(PANEL, /\{unpricedLineCount > 0 && <p role="status" className="mt-1 text-xs font-medium text-amber-700">/);
  assert.match(SECTION, /cell: \(\{ row \}\) => lineName\(allocationServiceName\(row\.original\), serviceLineNote\?\.\(row\.original, shootsById\.get\(row\.original\.shootId\)\)\) \},/);
  assert.match(SECTION, /cell: \(\{ row \}\) => lineName\(allocationDeliverableName\(row\.original\), deliverableLineNote\?\.\(row\.original, shootsById\.get\(row\.original\.shootId\)\)\) \},/);
});

test("no note for what is priced: a package, a complimentary line, a flat price, a variant", () => {
  const out = shoot("o", OUTDOOR, "Half Session");
  assert.equal(unpricedServiceNote(lineOn(PHOTOBOOTH, out, { packageId: "p1", unitPrice: 3000 }), out), null);
  assert.equal(unpricedServiceNote(lineOn(PHOTOBOOTH, out, { complimentary: true }), out), null);
  assert.equal(unpricedServiceNote(lineOn({ ...PHOTOBOOTH, price: "2500" }, out), out), null);
  assert.equal(unpricedDeliverableNote({ deliverableDefinition: { price: null }, deliverableVariantId: "v1", unitPrice: 0 }, out), null);
  assert.equal(unpricedDeliverableNote({ deliverableDefinition: { price: "300" } }, out), null);
  assert.equal(unpricedDeliverableNote({ deliverableDefinition: { price: null, pricing: [] } }, out), "Not priced in Settings");
});

test("one shoot: the discount works as before", () => {
  const s1 = shoot("a", STUDIO, "Full Session");
  assert.equal(quotationTotals({ services: [lineOn(ADVANT, s1)], rates: {}, discountPercent: 10, gstPercent: 18 }).amount, 2205);
});

test("every shoot is counted, with nothing crossing between them", () => {
  const shoots = [shoot("h", STUDIO, "Full Session"), shoot("m", OUTDOOR, "Full Session"), shoot("w", STUDIO, "Half Session"), shoot("r", OUTDOOR, "Half Session")];
  const services = shoots.map((on) => lineOn(ADVANT, on));
  // Different lines on different shoots; a complimentary one on the third.
  services.push(lineOn(BOOTH_789, shoots[2], { complimentary: true }));
  const deliverables = [{ shootId: "h", unitPrice: 500, quantity: 2 }, { shootId: "r", unitPrice: 300, quantity: 1 }];
  const totals = quotationTotals({ services, deliverables, rates: {}, discountSource: "PERCENTAGE", discountValue: 10, performanceCost: 1000, extraDiscounts: [{ amount: 500 }], gstPercent: 18 });
  assert.equal(totals.subtotal, 2450 * 4 + 0 + 1000 + 300);
  // The discounts and GST work on the combined figure, in their usual order.
  assert.equal(totals.grossCost, totals.subtotal + 1000);
  assert.equal(totals.discountAmount, Math.round(totals.grossCost * 0.1));
  assert.equal(totals.amount, totals.grossCost - totals.discountAmount - 500);
  assert.equal(totals.gstAmount, Math.round(totals.amount * 0.18));
});

test("editing a shoot's type or session keeps its service lines' price, and still re-reads its deliverables", () => {
  const reprice = PANEL.slice(PANEL.indexOf("function repriceShootLines("), PANEL.indexOf("\n  }\n", PANEL.indexOf("function repriceShootLines(")));
  // Only the edited shoot's lines, never a package's, and only when the type, session or length moved.
  assert.match(reprice, /if \(!before \|\| pricedBy\(before\) === pricedBy\(after\)\) return;/);
  assert.match(reprice, /if \(row\.shootId !== after\.id \|\| row\.packageId\) return row;/);
  // A service's Session Timing still follows its shoot; its price is the service's one price.
  assert.match(reprice, /return followed \? \{ \.\.\.row, sessionOptionId: defaultSessionOptionId\(definition, after\) \|\| "" \} : row;/);
  assert.doesNotMatch(reprice.slice(0, reprice.indexOf("setDeliverables(")), /unitPrice/, "a service line's price is not touched");
  // A deliverable without a variant is still re-read for the shoot (a full-length video by session).
  assert.match(reprice, /if \(row\.shootId !== after\.id \|\| row\.packageId \|\| row\.deliverableVariantId\) return row;/);
  assert.match(PANEL, /if \(after\) repriceShootLines\(before, after\);/);
  // A change on one line touches that line alone, and reprices nothing.
  const update = PANEL.slice(PANEL.indexOf("async function updateService("), PANEL.indexOf("\n  }\n", PANEL.indexOf("async function updateService(")));
  assert.match(update, /const next = serviceRowsRef\.current\.map\(\(item\) => \(item\.id === row\.id \? normalizeService\(\{ \.\.\.item, \.\.\.data \}, offeredServiceDefinitions\) : item\)\);/);
  assert.doesNotMatch(update, /unitPrice/);
});

/* ── The CRM Quotation Calculator's hand-off: one flat line per service ── */

const catalogue = {
  services: [
    { id: "s-adv", name: "advant", lines: [{ id: "s-adv:flat", shootType: "", timing: "", price: 2450, deliverables: [] }] },
    { id: "s-drone", name: "Drone", lines: [{ id: "s-drone:flat", shootType: "", timing: "", price: 5000, deliverables: [] }] },
  ],
  deliverables: [{ id: "d-album", name: "Album" }],
};
const DRONE = { id: "s-drone", name: "Drone", price: "5000", pricing: [] };
const ALBUM = { id: "d-album", name: "Album", price: "700", brands: [] };
const durationFor = (timings) => (timings.includes("Full Session") ? { sessionDurationHours: 12, sessionDurationMinutes: 0 } : { sessionDurationHours: 5, sessionDurationMinutes: 0 });
const handOff = (lineIds) => generatorDraftFromCalculator({
  catalogue, serviceRows: lineIds.map((lineId) => ({ serviceId: lineId.split(":")[0], lineId, quantity: 1 })),
  deliverableQuantities: { "d-album": 1 }, serviceDefinitions: [ADVANT, DRONE], deliverableDefinitions: [ALBUM], durationFor, eventDate: "2026-11-01", now: 1700000000000,
}).draft;

test("the calculator's services arrive on one shoot, each at its one price", () => {
  const draft = handOff(["s-adv:flat", "s-drone:flat"]);
  assert.equal(draft.shoots.length, 1);
  assert.equal(draft.shoots[0].isMainEvent, true);
  assert.deepEqual(draft.services.map((row) => [row.serviceName, row.unitPrice, row.shootId === draft.shoots[0].id]), [["advant", 2450, true], ["Drone", 5000, true]]);
  assert.equal(quotationTotals({ services: draft.services, deliverables: draft.deliverables, rates: {} }).subtotal, 2450 + 5000 + 700);
});

test("the note reads the service as Settings holds it now, not the copy frozen on a reopened line", () => {
  // A quotation saved before the service had a price carries that old copy on its line.
  const studioFull = shoot("q", STUDIO, "Full Session");
  const frozen = { ...ADVANT, price: null };
  const reopened = { id: "l", shootId: "q", serviceDefinitionId: ADVANT.id, serviceDefinition: frozen, sessionOptionId: "full", quantity: 1, unitPrice: 0 };
  assert.equal(unpricedServiceNote(reopened, studioFull), "Not priced in Settings", "read off the frozen copy");
  assert.equal(unpricedServiceNote(reopened, studioFull, ADVANT), null, "Settings prices it today");
  // A service gone from the catalogue is still judged by its own copy.
  assert.equal(unpricedServiceNote(reopened, studioFull, undefined), "Not priced in Settings");
});

test("a line that carries a price is never called unpriced", () => {
  const out = shoot("o", OUTDOOR, "Half Session");
  assert.equal(unpricedServiceNote(lineOn(PHOTOBOOTH, out, { unitPrice: 2000 }), out, PHOTOBOOTH), null);
  assert.equal(unpricedDeliverableNote({ deliverableDefinition: { price: null, pricing: [] }, unitPrice: 700 }, out), null);
  // At ₹0 with nothing in Settings, it is.
  assert.equal(unpricedServiceNote(lineOn(PHOTOBOOTH, out, { unitPrice: 0 }), out, PHOTOBOOTH), "Not priced in Settings");
});
