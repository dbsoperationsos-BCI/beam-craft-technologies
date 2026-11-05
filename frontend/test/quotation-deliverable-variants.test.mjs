import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { deliverableVariantLabel, deliverableVariantOptions } from "../src/lib/deliverableBrands.mjs";
import { deliverableUnitPrice, quotationTotals } from "../src/lib/quotationBrand.mjs";

/*
 * One selection is one exact variant, and that variant's price is what the quotation is built on.
 *
 * The Quotation Generator's Choose Deliverables listed a deliverable and nothing else, so a
 * deliverable sold by two companies in three sizes each was one line that had to be priced by hand.
 * It lists every brand-and-variant now, and choosing one stamps that variant's own price onto the
 * line - which is all that changes about pricing: `quotationTotals` goes on totalling quantity
 * times unit price exactly as it did, and `deliverableUnitPrice` already read a stamped price
 * before anything else.
 */

const DEFINITIONS = [
  { id: "d1", name: "Acrylic Printing", mediaType: "IMAGE", brands: [
    { id: "b1", name: "Canvera", variants: [
      { id: "v1", size: "12x18", frameInches: "1.5 inch", price: 2500 },
      { id: "v2", size: "16x24", frameInches: "2 inch", price: 3500 },
    ] },
    { id: "b2", name: "Pictoo", variants: [{ id: "v3", size: "12x18", frameInches: "1 inch", price: 2200 }] },
  ] },
  { id: "d2", name: "Cinematic Full Length", mediaType: "VIDEO", brands: [
    { id: "b3", name: "In-House Edit", variants: [{ id: "v4", videoLength: "45 minutes", size: "stray", frameInches: "stray", price: 38000 }] },
  ] },
  // Sold by nobody yet: it must still be offerable, or a deliverable disappears the day this ships.
  { id: "d3", name: "Photo Selection", mediaType: null, brands: [] },
];

test("every brand and variant is its own option, and only the ones that exist", () => {
  const options = deliverableVariantOptions(DEFINITIONS);
  assert.deepEqual(options.map((option) => option.name), [
    "Acrylic Printing - Canvera - 12x18 - 1.5 inch",
    "Acrylic Printing - Canvera - 16x24 - 2 inch",
    "Acrylic Printing - Pictoo - 12x18 - 1 inch",
    "Cinematic Full Length - In-House Edit - 45 minutes",
    "Photo Selection",
  ]);
  // Canvera's sizes are never offered under Pictoo: a variant is listed under the brand holding it.
  assert.equal(options.filter((option) => option.name.includes("Pictoo")).length, 1);
});

test("a video is named by its length, and never by a size or a frame", () => {
  const video = deliverableVariantOptions(DEFINITIONS).find((option) => option.name.startsWith("Cinematic"));
  assert.equal(video.name, "Cinematic Full Length - In-House Edit - 45 minutes");
  // The row carries stray image fields; the label must not read them.
  assert.doesNotMatch(video.name, /stray/);
  assert.equal(deliverableVariantLabel({ name: "X", mediaType: "VIDEO" }, { name: "B" }, { videoLength: "3 min", size: "12x18" }), "X - B - 3 min");
});

test("an option is identified by three ids, never by its words", () => {
  // Two brands sell a 12x18 and two deliverables may share a name, so the words cannot identify one.
  const options = deliverableVariantOptions(DEFINITIONS);
  assert.deepEqual(options.slice(0, 4).map((option) => option.id), ["d1::b1::v1", "d1::b1::v2", "d1::b2::v3", "d2::b3::v4"]);
  assert.equal(new Set(options.map((option) => option.id)).size, options.length);
  const [first] = options;
  assert.equal(first.variant.brandId, "b1");
  assert.equal(first.variant.variantId, "v1");
  assert.equal(first.definition.id, "d1");
});

test("a deliverable sold by nobody is still offered, under its own name and with no variant", () => {
  const plain = deliverableVariantOptions(DEFINITIONS).find((option) => option.id === "d3");
  assert.equal(plain.name, "Photo Selection");
  assert.equal(plain.variant, null);
  // A brand holding no variants yet counts as none, rather than listing a brand nothing can price.
  assert.deepEqual(deliverableVariantOptions([{ id: "d9", name: "Empty", brands: [{ id: "b9", name: "B", variants: [] }] }]).map((o) => o.name), ["Empty"]);
});

/*
 * Two remarks, and they never touch.
 *
 * The deliverable's own note is written once in Settings and describes the thing - "Sent flat,
 * never rolled." - so a quotation line says what it is *and* what is always true of it. The Remarks
 * box on the line is a different value entirely, typed for that one quotation and stored on that
 * one row. Neither ever writes to the other.
 */
test("a quotation line carries the deliverable's own note in its name", () => {
  const withNote = [{ ...DEFINITIONS[0], remarksEnabled: "Sent flat, never rolled." }];
  assert.deepEqual(deliverableVariantOptions(withNote, { withRemarks: true }).map((option) => option.name), [
    "Acrylic Printing - Canvera - 12x18 - 1.5 inch - Sent flat, never rolled.",
    "Acrylic Printing - Canvera - 16x24 - 2 inch - Sent flat, never rolled.",
    "Acrylic Printing - Pictoo - 12x18 - 1 inch - Sent flat, never rolled.",
  ]);
  // A deliverable sold by nobody carries its note too.
  assert.deepEqual(deliverableVariantOptions([{ id: "d9", name: "Photo Selection", remarksEnabled: "Client picks." }], { withRemarks: true }).map((o) => o.name), ["Photo Selection - Client picks."]);
  // A deliverable with no note reads exactly as it did.
  assert.equal(deliverableVariantOptions(DEFINITIONS, { withRemarks: true })[0].name, "Acrylic Printing - Canvera - 12x18 - 1.5 inch");
});

test("the note is asked for, not forced on every list", () => {
  // The Settings → Services mapping picker identifies a variant; the note is only noise there.
  const withNote = [{ ...DEFINITIONS[0], remarksEnabled: "Sent flat, never rolled." }];
  assert.equal(deliverableVariantOptions(withNote)[0].name, "Acrylic Printing - Canvera - 12x18 - 1.5 inch");
  assert.match(src("components", "project-management", "ServiceDefinitionDialog.js"), /deliverableVariantOptions\(deliverableDefinitions\)/);
  // Both quotation paths ask for it: the picker a person chooses from, and what a service brings.
  assert.match(SECTION, /deliverableVariantOptions\(servicesForShootType\(deliverableDefinitions, shoot\), \{ withRemarks: true \}\)/);
  assert.match(PANEL, /deliverableVariantLabel\(deliverable, brand, variant, \{ withRemarks: true \}\)/);
});

test("the line's own Remarks box stays its own", () => {
  // Typed for this quotation, stored on this row, and never written from the definition's note.
  assert.match(SECTION, /onCommit=\{\(value\) => updateDeliverableCell\(row\.original, \{ remarks: value \|\| null \}\)\}/);
  assert.match(SECTION, /function displayDeliverableRemarks\(row\) \{[\s\S]{0,120}?return row\.remarks \|\| "-";/);
});

test("the label carries everything the box searches on", () => {
  // The picker filters on the option's name, so brand, size, frame and length are searchable
  // without the search itself being changed.
  const options = deliverableVariantOptions(DEFINITIONS);
  const find = (query) => options.filter((option) => option.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map((option) => option.id);
  assert.deepEqual(find("Canvera"), ["d1::b1::v1", "d1::b1::v2"]);
  assert.deepEqual(find("12x18"), ["d1::b1::v1", "d1::b2::v3"]);
  assert.deepEqual(find("Acrylic"), ["d1::b1::v1", "d1::b1::v2", "d1::b2::v3"]);
  assert.deepEqual(find("45 minutes"), ["d2::b3::v4"]);
  assert.deepEqual(find("1.5 inch"), ["d1::b1::v1"]);
});

/*
 * The price, and the sum it feeds - neither of which is a new calculation.
 */
test("a stamped variant price is what the line is priced at, over every fallback", () => {
  const rates = { deliverableRate: 999, deliverablePricing: { d1: 777 } };
  assert.equal(deliverableUnitPrice({ deliverableDefinitionId: "d1", unitPrice: 2500 }, rates), 2500);
  // And a line with no stamp still falls back exactly as it always did.
  assert.equal(deliverableUnitPrice({ deliverableDefinitionId: "d1" }, rates), 777);
  assert.equal(deliverableUnitPrice({ deliverableDefinitionId: "other" }, rates), 999);
});

test("the existing total is the one used: quantity times the variant's price", () => {
  const totals = quotationTotals({
    services: [],
    deliverables: [{ deliverableDefinitionId: "d1", deliverableVariantId: "v1", unitPrice: 2500, quantity: 2 }],
    rates: { deliverableRate: 999 },
    discountPercent: 0,
  });
  assert.equal(totals.deliverableCost, 5000);
  assert.equal(totals.subtotal, 5000);
  // Discount and GST go on behaving as they do; nothing here introduces a second sum.
  const discounted = quotationTotals({ services: [], deliverables: [{ unitPrice: 2500, quantity: 2 }], rates: {}, discountPercent: 10, gstPercent: 18 });
  assert.equal(discounted.discountAmount, 500);
  assert.equal(discounted.amount, 4500);
  assert.equal(discounted.gstAmount, 810);
});

/*
 * The wiring, read off the source: there is no DOM in this suite.
 */
const src = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");
const PANEL = src("components", "sales", "QuotationGeneratorPanel.js");
const SECTION = src("components", "project-management", "ProjectServiceCreationSection.js");

test("only the Quotation Generator asks for variant options", () => {
  // The project screens hold one allocation per deliverable per shoot - the server answers 409 to a
  // second - so listing six variants there would offer five that cannot be added.
  assert.match(PANEL, /\n\s*deliverableVariants\n/);
  assert.match(SECTION, /deliverableVariants = false,/);
  assert.match(SECTION, /options=\{deliverableVariants \? deliverableVariantOptions\(servicesForShootType\(deliverableDefinitions, shoot\), \{ withRemarks: true \}\) : servicesForShootType\(deliverableDefinitions, shoot\)\}/);
  for (const file of ["StartProjectFormPanel.js"]) {
    assert.doesNotMatch(src("components", "project-management", file), /deliverableVariants/);
  }
  assert.doesNotMatch(src("components", "sales", "CreateProjectFormPanel.js"), /deliverableVariants/);
});

test("the variant's own price is stamped, and an unpriced variant is quoted at zero", () => {
  assert.match(PANEL, /const priced = variant \? \(Number\.isFinite\(Number\(variant\.price\)\) \? Number\(variant\.price\) : 0\) : \(deliverablePriceForRow\(definition, \{\}, shoot\) \?\? flat\);/);
});

test("two variants of one deliverable are two rows, not one overwriting the other", () => {
  assert.match(PANEL, /id: `quote-deliverable-\$\{shoot\.id\}-\$\{definition\.id\}\$\{variant \? `-\$\{variant\.variantId\}` : ""\}`,/);
  // And the picker stops offering the variant chosen, not every variant of its deliverable.
  assert.match(SECTION, /row\.deliverableOptionId \|\| row\.deliverableDefinitionId/);
});

test("the three ids are carried on the row, and the deliverable keeps its own name", () => {
  assert.match(PANEL, /deliverableBrandId: variant\.brandId,/);
  assert.match(PANEL, /deliverableVariantId: variant\.variantId,/);
  // `deliverableName` stays the deliverable's - it is what the PDF prints and what a project raised
  // off the quotation matches by. The variant's label is carried beside it, for the table.
  assert.match(PANEL, /deliverableName: definition\.name,/);
  assert.match(SECTION, /return row\.deliverableVariantLabel \|\| row\.deliverableDefinition\?\.name \|\| row\.deliverableName \|\| "—";/);
});
