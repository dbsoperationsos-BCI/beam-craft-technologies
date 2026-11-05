import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { brandFormRows, brandsForSave, deliverableVariantOptions } from "../src/lib/deliverableBrands.mjs";

/*
 * A service maps its bookings to deliverable variants by id, and shows each one under the
 * deliverable's current name. Editing a deliverable used to replace its brands and variants - new
 * ids every save - so every service mapped to it read "This deliverable is no longer offered". The
 * dialog now sends each row's id back and the server updates it in place.
 */

const DIALOG = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "project-management", "DeliverableDefinitionDialog.js"), "utf8");
const SAVED = [{ id: "b1", name: "cancera", variants: [{ id: "v1", size: "2123", frameInches: "12", price: 12434 }] }];

test("editing sends every brand and variant back with its own id", () => {
  const rows = brandFormRows(SAVED, { keepServerIds: true });
  rows[0].variants[0].price = "15000";
  assert.deepEqual(brandsForSave(rows, "IMAGE"), [{ id: "b1", name: "cancera", variants: [{ id: "v1", size: "2123", frameInches: "12", videoLength: null, price: 15000 }] }]);
});

test("a row added while editing is sent without an id, so it is created", () => {
  const rows = brandFormRows(SAVED, { keepServerIds: true });
  rows[0].variants.push({ id: "variant-new-0", size: "12x18", frameInches: "", videoLength: "", price: "" });
  const [brand] = brandsForSave(rows, "IMAGE");
  assert.deepEqual(brand.variants.map((variant) => variant.id), ["v1", undefined]);
});

test("a duplicate, and anything opened without ids, sends none", () => {
  assert.doesNotMatch(JSON.stringify(brandsForSave(brandFormRows(SAVED), "IMAGE")), /"id"/);
  // Only an edit keeps them: the dialog asks for them by the record being edited, not the copy.
  assert.match(DIALOG, /brands: brandFormRows\(source\?\.brands, \{ keepServerIds: Boolean\(deliverable\?\.id\) \}\),/);
});

test("with the ids kept, a service mapped to the variant shows the deliverable's current name", () => {
  // The service's dialog names a mapping by looking its three ids up among the options.
  const mapping = { deliverableId: "d1", brandId: "b1", variantId: "v1" };
  const lookUp = (definitions) => deliverableVariantOptions(definitions).find((option) => option.id === `${mapping.deliverableId}::${mapping.brandId}::${mapping.variantId}`)?.name || "This deliverable is no longer offered";
  assert.equal(lookUp([{ id: "d1", name: "nothing", mediaType: "IMAGE", brands: SAVED }]), "nothing - cancera - 2123 - 12");
  assert.equal(lookUp([{ id: "d1", name: "Premium Album", mediaType: "IMAGE", brands: SAVED }]), "Premium Album - cancera - 2123 - 12");
  // A variant genuinely removed still says so.
  assert.equal(lookUp([{ id: "d1", name: "Premium Album", mediaType: "IMAGE", brands: [{ id: "b1", name: "cancera", variants: [] }] }]), "This deliverable is no longer offered");
});
