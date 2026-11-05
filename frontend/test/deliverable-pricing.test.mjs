import test from "node:test";
import assert from "node:assert/strict";

import {
  deliverablePriceForRow, deliverablePricingForSave, deliverablePricingLinesByKind, duplicateDeliverablePricingLines,
  kindOptionsFor, matchSizeOption, pricedLineCount, pricedSizeOptionsOf, pricingShapeFor,
} from "../src/lib/deliverablePricing.mjs";

/*
 * A deliverable is an image or a video, priced under a tab per kind the way each kind is sold.
 */

test("each media type offers its own kinds, and each kind is priced its own way", () => {
  assert.deepEqual(kindOptionsFor("IMAGE").map((option) => option.value), ["FRAMES", "ALBUM", "CALENDAR"]);
  assert.deepEqual(kindOptionsFor("VIDEO").map((option) => option.value), ["TEASER", "FULL_LENGTH", "CANDID"]);
  assert.deepEqual(kindOptionsFor(""), []);
  for (const kind of ["FRAMES", "ALBUM", "CALENDAR"]) assert.equal(pricingShapeFor(kind), "SIZE");
  assert.equal(pricingShapeFor("FULL_LENGTH"), "SESSION");
  assert.equal(pricingShapeFor("TEASER"), "SINGLE");
  assert.equal(pricingShapeFor(""), null);
});

const stored = [
  { kind: "FRAMES", size: "8x10", sizeOptionValueId: "f1", price: 1200 },
  { kind: "FRAMES", size: "12x18", sizeOptionValueId: "f2", price: 2000 },
  { kind: "ALBUM", size: "Square - 12x6", sizeOptionValueId: "a1", price: 5000 },
  { kind: "CALENDAR", size: "Desk A5", price: 900 },
  { kind: "TEASER", price: 3000 },
];

test("a typed size finds the list entry it names, whatever the case, and keeps its words otherwise", () => {
  const values = [{ id: "f1", label: "8x10", value: "8x10" }, { id: "f2", label: "12x18", value: "12x18" }];
  assert.equal(matchSizeOption("8X10", values)?.id, "f1");
  assert.equal(matchSizeOption(" 12x18 ", values)?.id, "f2");
  assert.equal(matchSizeOption("9x12", values), null);
  assert.equal(matchSizeOption("", values), null);
});

test("every kind has a tab to open: stored lines where there are any, one line to fill in otherwise", () => {
  const lines = deliverablePricingLinesByKind(stored);
  assert.deepEqual(lines.FRAMES.map((line) => [line.sizeOptionValueId, line.price]), [["f1", "1200"], ["f2", "2000"]]);
  assert.deepEqual(lines.ALBUM.map((line) => line.sizeOptionValueId), ["a1"]);
  // A size the list does not hold opens as the words it was typed in.
  assert.deepEqual(lines.CALENDAR.map((line) => [line.size, line.sizeOptionValueId]), [["Desk A5", ""]]);
  assert.equal(lines.TEASER.length, 1);
  assert.equal(lines.TEASER[0].price, "3000");
  assert.equal(lines.CANDID.length, 1);
  assert.equal(pricedLineCount(lines, "FRAMES"), 2);
  assert.equal(pricedLineCount(lines, "CALENDAR"), 1);
});

test("only the media type's complete lines with a figure are saved, each carrying its kind, each booking once", () => {
  const lines = deliverablePricingLinesByKind(stored);
  lines.FRAMES.push({ id: "x", size: "8x10", sizeOptionValueId: "f1", timingMode: "", price: "1300" });
  lines.FRAMES.push({ id: "y", size: "", sizeOptionValueId: "", timingMode: "", price: "900" });
  lines.CALENDAR.push({ id: "z", size: " desk a5 ", sizeOptionValueId: "", timingMode: "", price: "950" });
  lines.FULL_LENGTH = [{ id: "s", size: "", sizeOptionValueId: "", timingMode: "HALF_SESSION", price: "7000" }];
  assert.deepEqual(deliverablePricingForSave(lines, "IMAGE"), [
    { kind: "FRAMES", size: "8x10", sizeOptionValueId: "f1", price: 1200 },
    { kind: "FRAMES", size: "12x18", sizeOptionValueId: "f2", price: 2000 },
    { kind: "ALBUM", size: "Square - 12x6", sizeOptionValueId: "a1", price: 5000 },
    { kind: "CALENDAR", size: "Desk A5", price: 900 },
  ]);
  assert.deepEqual(deliverablePricingForSave(lines, "VIDEO"), [
    { kind: "TEASER", price: 3000 },
    { kind: "FULL_LENGTH", timingMode: "HALF_SESSION", price: 7000 },
  ]);
  // A repeat by id and a repeat by words are both repeats.
  assert.deepEqual(duplicateDeliverablePricingLines(lines, ["FRAMES", "ALBUM", "CALENDAR"]), ["FRAMES:f1", "CALENDAR:desk a5"]);
  assert.deepEqual(duplicateDeliverablePricingLines(lines, ["TEASER", "FULL_LENGTH", "CANDID"]), []);
});

test("a line offers every size its pricing names, from whichever kinds' lists", () => {
  const definition = { pricing: stored, pricedSizeOptions: [{ id: "f1", label: "8x10" }, { id: "a1", label: "Square - 12x6" }, { id: "f2", label: "12x18", isActive: false }, { id: "zz", label: "unpriced" }] };
  assert.deepEqual(pricedSizeOptionsOf(definition).map((option) => option.id), ["f1", "a1"]);
  assert.deepEqual(pricedSizeOptionsOf({ pricing: [{ kind: "TEASER", price: 1 }], pricedSizeOptions: [{ id: "f1" }] }), []);
});

test("a quotation line takes its size's price, then its shoot's session, then a lone single figure", () => {
  const definition = { pricing: stored };
  assert.equal(deliverablePriceForRow(definition, { sizeOptionValueId: "a1" }, null), 5000);
  assert.equal(deliverablePriceForRow(definition, { sizeOptionValueId: "f2" }, null), 2000);
  assert.equal(deliverablePriceForRow(definition, { sizeOptionValueId: "zz" }, null), null);
  // A line sized by words alone - a size typed on the pricing line, not in any list - prices by them.
  assert.equal(deliverablePriceForRow(definition, { size: "desk a5" }, null), 900);
  // Priced under several kinds and no size chosen yet: nothing to say.
  assert.equal(deliverablePriceForRow(definition, {}, null), null);
  const film = { pricing: [{ kind: "FULL_LENGTH", timingMode: "HALF_SESSION", price: 5000 }, { kind: "FULL_LENGTH", timingMode: "FULL_SESSION", price: 9000 }] };
  assert.equal(deliverablePriceForRow(film, {}, { sessionTimings: ["Full Session"] }), 9000);
  assert.equal(deliverablePriceForRow(film, {}, { sessionTiming: "Half Session" }), 5000);
  assert.equal(deliverablePriceForRow(film, {}, { sessionTimings: ["Hourly"] }), null);
  assert.equal(deliverablePriceForRow({ pricing: [{ kind: "TEASER", price: 3000 }] }, {}, null), 3000);
  assert.equal(deliverablePriceForRow({ pricing: [{ kind: "TEASER", price: 3000 }, { kind: "CANDID", price: 2000 }] }, {}, null), null);
  assert.equal(deliverablePriceForRow({ pricing: [] }, {}, null), null);
});
