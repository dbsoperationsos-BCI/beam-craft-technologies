import test from "node:test";
import assert from "node:assert/strict";
import {
  BRAND_NAME_MAX_LENGTH,
  brandFormRows,
  brandsForSave,
  emptyDeliverableBrand,
  emptyDeliverableVariant,
  variantFieldsFor,
  variantsLosingValues,
} from "../src/lib/deliverableBrands.mjs";
import {
  deliverableAnswerOn,
  deliverableAnswerText,
  deliverableAnswered,
} from "../src/lib/deliverableAnswers.mjs";

/*
 * The rules behind Settings → Project → Deliverables → Add / Edit Deliverable.
 *
 * A deliverable is sold by brands, each in variants, and what a variant is asked for follows the
 * deliverable's type and nothing else. The three questions underneath it are typed words that still
 * have to be read back into an answer, because Image Selection admits a deliverable on one of them.
 */

test("a deliverable with no brands opens on one empty brand holding one empty variant", () => {
  const rows = brandFormRows(null);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "");
  assert.equal(rows[0].variants.length, 1);
  assert.deepEqual(Object.keys(rows[0].variants[0]).sort(), ["frameInches", "id", "price", "size", "videoLength"]);
});

test("edit mode preloads every brand and variant, with the price as the box's own string", () => {
  const rows = brandFormRows([
    { id: "b1", name: "Canvera", variants: [{ id: "v1", size: "12x18", frameInches: "1.5 inch", price: 2000 }, { id: "v2", size: "16x24", price: 3500 }] },
    { id: "b2", name: "Pictoo", variants: [{ id: "v3", size: "8x10", price: null }] },
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((brand) => brand.name), ["Canvera", "Pictoo"]);
  assert.equal(rows[0].variants[0].price, "2000");
  assert.equal(rows[0].variants[1].frameInches, "");
  // Null is not priced yet, and the box for it is empty rather than reading "null".
  assert.equal(rows[1].variants[0].price, "");
});

test("a brand that somehow holds no variants still gets a row to fill in", () => {
  const rows = brandFormRows([{ id: "b1", name: "Canvera", variants: [] }]);
  assert.equal(rows[0].variants.length, 1);
  assert.equal(rows[0].variants[0].size, "");
});

test("a variant is asked for what its deliverable's type asks for, and nothing else", () => {
  assert.deepEqual(variantFieldsFor("IMAGE"), ["size", "frameInches", "price"]);
  assert.deepEqual(variantFieldsFor("VIDEO"), ["videoLength", "price"]);
  // Nothing has decided which of the two it is yet, so only the price is drawn.
  assert.deepEqual(variantFieldsFor(""), ["price"]);
});

test("only what the type asks for is saved, so a video variant carries no frame size", () => {
  const brands = [{ name: "Canvera", variants: [{ size: "12x18", frameInches: "1.5 inch", videoLength: "3 minutes", price: "2000" }] }];
  assert.deepEqual(brandsForSave(brands, "VIDEO"), [
    { name: "Canvera", variants: [{ size: null, frameInches: null, videoLength: "3 minutes", price: 2000 }] },
  ]);
  assert.deepEqual(brandsForSave(brands, "IMAGE"), [
    { name: "Canvera", variants: [{ size: "12x18", frameInches: "1.5 inch", videoLength: null, price: 2000 }] },
  ]);
});

test("a brand still being filled in is not a brand, and an empty variant is not a variant", () => {
  const brands = [
    { name: "Canvera", variants: [{ size: "12x18", price: "2000" }, { size: "", frameInches: "", price: "" }] },
    { name: "", variants: [{ size: "", frameInches: "", price: "" }] },
  ];
  const saved = brandsForSave(brands, "IMAGE");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].variants.length, 1);
});

test("a brand with no name but a priced variant is still its own brand", () => {
  // A studio selling its own albums has nobody to name, and the variants are still real.
  const saved = brandsForSave([{ name: "", variants: [{ size: "12x18", price: "2000" }] }], "IMAGE");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].name, "");
});

test("an unpriced variant is saved as not priced yet rather than as free", () => {
  const saved = brandsForSave([{ name: "Canvera", variants: [{ size: "12x18", price: "" }] }], "IMAGE");
  assert.equal(saved[0].variants[0].price, null);
});

test("a change of type counts exactly the variants it would empty", () => {
  const brands = [
    { name: "Canvera", variants: [{ size: "12x18", frameInches: "1.5 inch" }, { size: "16x24" }] },
    { name: "Pictoo", variants: [{ size: "" }] },
  ];
  assert.equal(variantsLosingValues(brands, "VIDEO").length, 2);
  // Going the way the values already suit throws nothing away, so nothing is asked.
  assert.equal(variantsLosingValues(brands, "IMAGE").length, 0);
});

test("the three answers read back the way they always did, whatever is typed", () => {
  // The words the dropdown used to write, and the booleans they were stored as.
  assert.equal(deliverableAnswerText(true), "Yes");
  assert.equal(deliverableAnswerText(false), "No");
  assert.equal(deliverableAnswerText(null), "");
  assert.equal(deliverableAnswerText("  50 photos "), "50 photos");

  // On, where blank counts as off - what `=== true` used to be.
  assert.equal(deliverableAnswerOn("Yes"), true);
  assert.equal(deliverableAnswerOn(true), true);
  assert.equal(deliverableAnswerOn("No"), false);
  assert.equal(deliverableAnswerOn(false), false);
  assert.equal(deliverableAnswerOn(null), false);
  assert.equal(deliverableAnswerOn(""), false);
  // Anything else typed is an answer of Yes, with the words kept beside it.
  assert.equal(deliverableAnswerOn("50 photos"), true);
  assert.equal(deliverableAnswerOn("N/A"), true);
  // Whatever the case, and whatever follows it.
  assert.equal(deliverableAnswerOn("no - not this one"), false);
  assert.equal(deliverableAnswerOn("NONE"), false);

  // Blank is a real state, and it is not a No.
  assert.equal(deliverableAnswered(null), false);
  assert.equal(deliverableAnswered("   "), false);
  assert.equal(deliverableAnswered("No"), true);
});

/*
 * Every row the dialog holds is held by an id of its own.
 *
 * A new deliverable opened on `brand-0`, and the dialog counted the rows it added from zero too, so
 * "+ Add Another Brand" made a second `brand-0`: typing a name into either wrote it into both, and
 * Delete Brand on one took both. The rows the form opens on and the rows the dialog adds are named
 * in vocabularies that cannot meet.
 */
test("the rows a form opens on can never share an id with the rows the dialog adds", () => {
  const added = [emptyDeliverableBrand("new-0"), emptyDeliverableBrand("new-1")];
  const addedIds = added.flatMap((brand) => [brand.id, ...brand.variants.map((variant) => variant.id), emptyDeliverableVariant("new-2").id]);
  for (const opened of [
    brandFormRows(null),
    brandFormRows([{ name: "Canvera", variants: [{ size: "12x18" }] }, { name: "Pictoo", variants: [] }]),
    brandFormRows([{ id: "b1", name: "Canvera", variants: [{ id: "v1", size: "12x18" }] }]),
  ]) {
    const openedIds = opened.flatMap((brand) => [brand.id, ...brand.variants.map((variant) => variant.id)]);
    assert.equal(new Set(openedIds).size, openedIds.length, "a form opened on two rows under one id");
    for (const id of openedIds) assert.ok(!addedIds.includes(id), `${id} is also what an added row is called`);
  }
});

test("a brand's name is held to the column behind it, since the box it is typed into is not", () => {
  const saved = brandsForSave([{ name: "x".repeat(300), variants: [{ price: "10" }] }], "IMAGE");
  assert.equal(saved[0].name.length, BRAND_NAME_MAX_LENGTH);
});
