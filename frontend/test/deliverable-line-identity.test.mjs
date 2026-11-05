import test from "node:test";
import assert from "node:assert/strict";
import {
  deliverableIdentityKey,
  deliverableRowLabel,
  deliverableRowVariant,
  deliverableVariantLabel,
  deliverableVariantOptions,
  deliverableVariantPayload,
  projectDeliverableVariantFields,
} from "../src/lib/deliverableBrands.mjs";
import { planFromProject, planFromQuotation } from "../src/components/sales/quotationProjectPlan.js";

/*
 * A deliverable line is named the same way wherever it is listed - the quotation, the project raised
 * from it, the project's edit screen and its summaries - by `deliverableRowLabel`, which builds the
 * sentence `deliverableVariantLabel` builds for the picker. The variant a line was sold as travels
 * with it from the quotation to the project, so "Painting - textra - 12x6 - 2" does not arrive as
 * "Painting".
 */

const PAINTING = { id: "d1", name: "Painting", mediaType: "IMAGE", brands: [
  { id: "b1", name: "textra", variants: [{ id: "v1", size: "12x6", frameInches: "2", price: 300 }, { id: "v2", size: "12x8", frameInches: "2", price: 400 }] },
  { id: "b2", name: "Canvera", variants: [{ id: "v3", size: "12x6", frameInches: "2", price: 400 }] },
] };

test("a project line is named by the variant it saved, the same words its picker offered", () => {
  const option = deliverableVariantOptions([PAINTING]).find((item) => item.id === "d1::b2::v3");
  const row = { deliverableDefinitionId: "d1", deliverableDefinition: PAINTING, deliverableName: "Painting", ...projectDeliverableVariantFields(option.variant) };
  assert.equal(deliverableRowLabel(row), option.name);
  assert.equal(deliverableRowLabel(row), "Painting - Canvera - 12x6 - 2");
});

test("a summary without the deliverable attached still names the variant", () => {
  // The project list reads `shoots[].deliverables[]` as stored - no definition beside them.
  assert.equal(deliverableRowLabel({ deliverableName: "Painting", brandName: "textra", size: "12x8", frameInches: "2" }), "Painting - textra - 12x8 - 2");
  assert.equal(deliverableRowLabel({ deliverableName: "Highlights", brandName: null, size: null, frameInches: null, videoLength: "3 minutes" }), "Highlights - 3 minutes");
});

test("variants of one deliverable stay distinguishable, by label and by key", () => {
  const labels = deliverableVariantOptions([PAINTING]).map((option) => option.name);
  assert.equal(new Set(labels).size, labels.length);
  const keys = deliverableVariantOptions([PAINTING]).map((option) => deliverableIdentityKey("d1", option.variant));
  assert.equal(new Set(keys).size, keys.length);
  // Case and spacing are not a difference; another brand of the same size is.
  assert.equal(deliverableIdentityKey("d1", { brandName: "Textra ", size: "12x6", frameInches: "2" }), deliverableIdentityKey("d1", { brandName: "textra", size: "12x6", frameInches: "2" }));
  assert.notEqual(deliverableIdentityKey("d1", { brandName: "textra", size: "12x6" }), deliverableIdentityKey("d1", { brandName: "Canvera", size: "12x6" }));
  // A line with no variant is the deliverable alone, and so is a variant holding nothing.
  assert.equal(deliverableIdentityKey("d1", null), "d1");
  assert.equal(deliverableIdentityKey("d1", { brandName: "", size: "" }), "d1");
});

test("a line saved before variants reached projects reads by its name, never undefined or null", () => {
  const historical = { id: "a1", deliverableDefinitionId: "d9", deliverableName: "Signature Album", size: null, sizeOptionValueId: null, remarks: null };
  assert.equal(deliverableRowVariant(historical), null);
  assert.equal(deliverableRowLabel(historical), "Signature Album");
  assert.equal(deliverableRowLabel({ deliverableName: "Signature Album", brandName: undefined, frameInches: "" }), "Signature Album");
  assert.equal(deliverableRowLabel(null), "");
  assert.equal(deliverableRowLabel({}), "");
  // A size picked from the deliverable's own list is not a variant's.
  assert.equal(deliverableRowVariant({ deliverableName: "Album", size: "12x18", sizeOptionValueId: "opt-1" }), null);
  for (const label of [deliverableRowLabel(historical), deliverableRowLabel({ deliverableName: "X", brandName: "B" })]) {
    assert.doesNotMatch(label, /undefined|null|N\/A| - $|^ - | -  - /);
  }
});

test("a quotation line reads the label it was stamped with", () => {
  assert.equal(deliverableRowLabel({ deliverableName: "Painting", deliverableVariantId: "v1", deliverableVariantLabel: "Painting - textra - 12x6 - 2 - Sent flat.", deliverableBrandName: "textra", size: "12x6" }), "Painting - textra - 12x6 - 2 - Sent flat.");
});

test("a deliverable sold by nobody names itself by the brand and size it was given before brands", () => {
  const legacy = { id: "d5", name: "Signature Album", mediaType: "IMAGE", brandName: "Canvera", imageSize: "12x18", frameInches: null, brands: [] };
  assert.equal(deliverableVariantLabel(legacy, null, null), "Signature Album - Canvera - 12x18");
  assert.deepEqual(deliverableVariantOptions([legacy]).map((option) => option.name), ["Signature Album - Canvera - 12x18"]);
  // The option is still the deliverable alone - no variant, so it prices exactly as it did.
  assert.equal(deliverableVariantOptions([legacy])[0].variant, null);
  // A deliverable with variants never reads them, since they mirror its first variant.
  assert.equal(deliverableVariantLabel({ ...PAINTING, brandName: "textra", imageSize: "12x6" }, null, null), "Painting");
});

test("the quoted variant crosses into the project plan, and two variants stay two lines", () => {
  let n = 0;
  const payload = {
    shoots: [{ id: "q-shoot-1", shoot: "Wedding", dateCreated: "2026-11-01" }],
    services: [],
    deliverables: [
      { id: "r1", shootId: "q-shoot-1", deliverableDefinitionId: "d1", deliverableName: "Painting", quantity: 2, deliverableVariantId: "v1", deliverableBrandName: "textra", size: "12x6", frameInches: "2", deliverableVariantLabel: "Painting - textra - 12x6 - 2" },
      { id: "r2", shootId: "q-shoot-1", deliverableDefinitionId: "d1", deliverableName: "Painting", quantity: 1, deliverableVariantId: "v3", deliverableBrandName: "Canvera", size: "12x6", frameInches: "2" },
      { id: "r3", shootId: "q-shoot-1", deliverableDefinitionId: "d9", deliverableName: "Signature Album", quantity: 1 },
    ],
  };
  const plan = planFromQuotation(payload, () => `k${n++}`);
  assert.equal(plan.deliverables.length, 3);
  assert.equal(new Set(plan.deliverables.map((row) => row.id)).size, 3);
  assert.deepEqual(plan.deliverables.map((row) => deliverableRowLabel(row)), ["Painting - textra - 12x6 - 2", "Painting - Canvera - 12x6 - 2", "Signature Album"]);
  // The quantity crosses untouched.
  assert.deepEqual(plan.deliverables.map((row) => row.quantity), [2, 1, 1]);
  // What the server is sent: the variant's id to look up, the words for a variant since rewritten.
  assert.deepEqual(deliverableVariantPayload(plan.deliverables[0]), { variantId: "v1", brandName: "textra", size: "12x6", frameInches: "2", videoLength: null });
  assert.equal(deliverableVariantPayload(plan.deliverables[2]), null);
});

test("a duplicated project carries its saved variants the same way", () => {
  const plan = planFromProject({
    shoots: [{ id: "s1", shoot: "Reception" }],
    services: [],
    deliverables: [{ id: "a1", shootId: "s1", deliverableDefinitionId: "d1", deliverableName: "Painting", brandName: "textra", size: "12x8", frameInches: "2", videoLength: null }],
  }, () => "k");
  assert.equal(deliverableRowLabel(plan.deliverables[0]), "Painting - textra - 12x8 - 2");
  assert.deepEqual(deliverableVariantPayload(plan.deliverables[0]), { variantId: null, brandName: "textra", size: "12x8", frameInches: "2", videoLength: null });
});

test("search finds a variant by its name, its brand or its size", () => {
  // The picker filters on the option's label, so whatever the label holds can be searched.
  const names = deliverableVariantOptions([PAINTING]).map((option) => option.name.toLocaleLowerCase());
  assert.ok(names.filter((name) => name.includes("painting")).length === 3);
  assert.ok(names.filter((name) => name.includes("canvera")).length === 1);
  assert.ok(names.filter((name) => name.includes("12x8")).length === 1);
});
