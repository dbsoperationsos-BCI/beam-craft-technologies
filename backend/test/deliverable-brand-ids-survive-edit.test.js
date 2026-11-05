const test = require("node:test");
const assert = require("node:assert/strict");

const { saveDeliverableBrands, deliverableBrandsForSave } = require("../src/modules/sales/projects/controller");

/*
 * A deliverable's brands and variants keep their ids across an edit. A service maps each booking
 * to the variants it brings by deliverable + brand + variant id; the save used to delete every
 * brand and write the list again, so renaming a deliverable - or repricing one size - gave every
 * variant a new id and every service mapped to it read "This deliverable is no longer offered".
 */

// A transaction over an in-memory store, holding only what `saveDeliverableBrands` touches.
function fakeTransaction(seed) {
  const brands = new Map(seed.map((brand) => [brand.id, { ...brand, variants: undefined }]));
  const variants = new Map(seed.flatMap((brand) => brand.variants.map((variant) => [variant.id, { ...variant, brandId: brand.id }])));
  let n = 0;
  const fresh = (prefix) => `${prefix}-new-${n++}`;
  const tx = {
    projectDeliverableBrand: {
      findMany: async ({ where }) => [...brands.values()].filter((b) => b.definitionId === where.definitionId).map((b) => ({ id: b.id, variants: [...variants.values()].filter((v) => v.brandId === b.id).map((v) => ({ id: v.id })) })),
      deleteMany: async ({ where }) => { for (const id of where.id.in) if (brands.get(id)?.definitionId === where.definitionId) { brands.delete(id); for (const [vid, v] of variants) if (v.brandId === id) variants.delete(vid); } },
      create: async ({ data }) => { const id = fresh("b"); brands.set(id, { id, definitionId: data.definitionId, name: data.name, sortOrder: data.sortOrder }); for (const v of data.variants.create) { const vid = fresh("v"); variants.set(vid, { ...v, id: vid, brandId: id }); } },
      update: async ({ where, data }) => Object.assign(brands.get(where.id), data),
    },
    projectDeliverableVariant: {
      deleteMany: async ({ where }) => { for (const id of where.id.in) if (variants.get(id)?.brandId === where.brandId) variants.delete(id); },
      create: async ({ data }) => { const id = fresh("v"); variants.set(id, { ...data, id }); },
      update: async ({ where, data }) => Object.assign(variants.get(where.id), data),
    },
  };
  const read = () => [...brands.values()].sort((a, b) => a.sortOrder - b.sortOrder).map((b) => ({ id: b.id, name: b.name, variants: [...variants.values()].filter((v) => v.brandId === b.id).sort((x, y) => x.sortOrder - y.sortOrder).map(({ brandId, ...v }) => v) }));
  return { tx, read };
}

const SEED = [
  { id: "b1", definitionId: "d1", name: "cancera", sortOrder: 0, variants: [{ id: "v1", size: "2123", frameInches: "12", videoLength: null, price: 12434, sortOrder: 0 }] },
  { id: "b2", definitionId: "d1", name: "textra", sortOrder: 1, variants: [{ id: "v2", size: "12x6", frameInches: "2", videoLength: null, price: 300, sortOrder: 0 }, { id: "v3", size: "12x8", frameInches: "2", videoLength: null, price: 400, sortOrder: 1 }] },
];
const sent = (brands) => deliverableBrandsForSave(brands, "IMAGE");

test("an edit that sends every row back keeps every id, whatever else changed", async () => {
  const { tx, read } = fakeTransaction(SEED);
  // Brand renamed, size changed, frame changed, price changed - one each.
  await saveDeliverableBrands(tx, "d1", sent([
    { id: "b1", name: "Canvera", variants: [{ id: "v1", size: "12x18", frameInches: "1.5", price: 15000 }] },
    { id: "b2", name: "textra", variants: [{ id: "v2", size: "12x6", frameInches: "2", price: 300 }, { id: "v3", size: "12x8", frameInches: "2", price: 450 }] },
  ]));
  const after = read();
  assert.deepEqual(after.map((b) => [b.id, b.variants.map((v) => v.id)]), [["b1", ["v1"]], ["b2", ["v2", "v3"]]]);
  assert.deepEqual(after[0].variants[0], { id: "v1", size: "12x18", frameInches: "1.5", videoLength: null, price: 15000, sortOrder: 0 });
  assert.equal(after[0].name, "Canvera");
  assert.equal(after[1].variants[1].price, 450);
});

test("a row removed on the form is deleted, and a row added is created - the rest keep their ids", async () => {
  const { tx, read } = fakeTransaction(SEED);
  await saveDeliverableBrands(tx, "d1", sent([
    { id: "b2", name: "textra", variants: [{ id: "v3", size: "12x8", frameInches: "2", price: 400 }, { size: "16x24", frameInches: "2", price: 900 }] },
    { name: "Pictoo", variants: [{ size: "8x10", price: 100 }] },
  ]));
  const after = read();
  assert.deepEqual(after.map((b) => b.id), ["b2", "b-new-1"]);
  assert.deepEqual(after[0].variants.map((v) => v.id), ["v3", "v-new-0"]);
  // Only the variant actually removed - v2 - and the brand actually removed - b1 - are gone.
  assert.ok(!JSON.stringify(after).includes('"v2"') && !JSON.stringify(after).includes('"b1"'));
});

test("an id that is not this deliverable's own is never updated: it is created new", async () => {
  const { tx, read } = fakeTransaction([...SEED, { id: "bX", definitionId: "d2", name: "other", sortOrder: 0, variants: [{ id: "vX", size: "1", frameInches: null, videoLength: null, price: 1, sortOrder: 0 }] }]);
  await saveDeliverableBrands(tx, "d1", sent([{ id: "bX", name: "copied", variants: [{ id: "vX", size: "9", price: 9 }] }]));
  const all = read();
  // The other deliverable's rows are exactly as they were.
  assert.deepEqual(all.find((b) => b.id === "bX"), { id: "bX", name: "other", variants: [{ id: "vX", size: "1", frameInches: null, videoLength: null, price: 1, sortOrder: 0 }] });
  assert.ok(all.some((b) => b.name === "copied" && b.id !== "bX" && b.variants[0].id !== "vX"));
});

test("an id named twice keeps one row; the second is new", async () => {
  const { tx, read } = fakeTransaction(SEED);
  await saveDeliverableBrands(tx, "d1", sent([
    { id: "b1", name: "cancera", variants: [{ id: "v1", size: "2123", frameInches: "12", price: 12434 }, { id: "v1", size: "999", price: 1 }] },
  ]));
  const [brand] = read();
  assert.equal(brand.id, "b1");
  assert.equal(brand.variants[0].id, "v1");
  assert.equal(brand.variants[0].size, "2123");
  assert.notEqual(brand.variants[1].id, "v1");
});

test("ids ride through the type rule, and are absent where none was sent", () => {
  assert.deepEqual(deliverableBrandsForSave([{ id: "b1", name: "A", variants: [{ id: "v1", size: "1", videoLength: "x", price: 1 }] }], "IMAGE"), [{ id: "b1", name: "A", variants: [{ id: "v1", size: "1", frameInches: null, videoLength: null, price: 1 }] }]);
  assert.deepEqual(deliverableBrandsForSave([{ name: "A", variants: [{ size: "1" }] }], "IMAGE"), [{ name: "A", variants: [{ size: "1", frameInches: null, videoLength: null, price: null }] }]);
});
