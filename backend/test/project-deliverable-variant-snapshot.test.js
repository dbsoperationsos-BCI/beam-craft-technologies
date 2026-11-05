const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { deliverableVariantSnapshotFor, deliverableLineKey } = require("../src/modules/sales/projects/controller");

/*
 * A project deliverable line keeps the variant it was sold as - brand, size, frame, length - as a
 * snapshot, because a deliverable's brands and variants are rewritten on every Settings save. The
 * variant named is looked up against the deliverable as it stands; the words sent beside it answer
 * only for a variant Settings has since rewritten.
 */

const PAINTING = {
  id: "d1",
  mediaType: "IMAGE",
  brands: [
    { id: "b1", name: "textra", variants: [{ id: "v1", size: "12x6", frameInches: "2", videoLength: null }] },
    { id: "b2", name: "Canvera", variants: [{ id: "v3", size: "12x8", frameInches: "2", videoLength: null }] },
  ],
};

test("a live variant is saved as the deliverable holds it, not as the client typed it", () => {
  assert.deepEqual(
    deliverableVariantSnapshotFor(PAINTING, { variantId: "v3", brandName: "Something else", size: "99x99" }),
    { brandName: "Canvera", size: "12x8", frameInches: "2", videoLength: null },
  );
});

test("a variant Settings has since rewritten keeps the words the quotation kept, held to the type", () => {
  assert.deepEqual(
    deliverableVariantSnapshotFor(PAINTING, { variantId: "gone", brandName: " textra ", size: "12x6", frameInches: "2", videoLength: "3 minutes" }),
    { brandName: "textra", size: "12x6", frameInches: "2", videoLength: null },
  );
  assert.deepEqual(
    deliverableVariantSnapshotFor({ mediaType: "VIDEO", brands: [] }, { brandName: "Studio", size: "12x6", videoLength: "45 minutes" }),
    { brandName: "Studio", size: null, frameInches: null, videoLength: "45 minutes" },
  );
});

test("a line added as the deliverable alone saves no variant", () => {
  const empty = { brandName: null, size: null, frameInches: null, videoLength: null };
  assert.deepEqual(deliverableVariantSnapshotFor(PAINTING, null), empty);
  assert.deepEqual(deliverableVariantSnapshotFor(PAINTING, undefined), empty);
  assert.deepEqual(deliverableVariantSnapshotFor(PAINTING, { variantId: null, brandName: "", size: "" }), empty);
});

test("one line per variant: another brand or size is a line of its own, the same one twice is not", () => {
  const a = deliverableLineKey("d1", { brandName: "textra", size: "12x6", frameInches: "2" });
  assert.equal(deliverableLineKey("d1", { brandName: "TEXTRA", size: " 12x6", frameInches: "2", videoLength: null }), a);
  assert.notEqual(deliverableLineKey("d1", { brandName: "Canvera", size: "12x6", frameInches: "2" }), a);
  assert.notEqual(deliverableLineKey("d1", { brandName: "textra", size: "12x8", frameInches: "2" }), a);
  // A line from before variants reached projects is the deliverable alone, as it always was.
  assert.equal(deliverableLineKey("d1", { brandName: null, size: null, frameInches: null, videoLength: null }), "d1");
  assert.equal(deliverableLineKey("d1"), "d1");
});

test("the frontend refuses by the same key the server does", async () => {
  const { deliverableIdentityKey } = await import("../../frontend/src/lib/deliverableBrands.mjs");
  for (const variant of [null, { brandName: "textra", size: "12x6", frameInches: "2" }, { brandName: "", size: "", frameInches: "", videoLength: "3 minutes" }, { brandName: " A  B ", size: "X" }]) {
    assert.equal(deliverableIdentityKey("d1", variant), deliverableLineKey("d1", variant || {}));
  }
});

test("the variant is written on create only, and the migration only adds nullable columns", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/modules/sales/projects/controller.js"), "utf8");
  // Both create paths spread the snapshot; the shared builder no longer forces `size` null, so an
  // edit to a line's quantity or remarks leaves what it was sold as alone.
  assert.equal((source.match(/\.\.\.variantData,/g) || []).length, 2);
  assert.doesNotMatch(source, /selectionLimit: input\.selectionLimit \?\? null,\n\s*size: null,/);
  const migration = fs.readFileSync(path.join(__dirname, "../prisma/migrations/20261007120000_project_deliverable_variant_snapshot/migration.sql"), "utf8");
  const statements = migration.split("\n").filter((line) => line.trim() && !line.trim().startsWith("--"));
  assert.ok(statements.every((line) => /ALTER TABLE|ADD COLUMN `\w+` VARCHAR\(\d+\) NULL[,;]/.test(line)), statements.join("\n"));
  assert.doesNotMatch(migration, /DROP|NOT NULL|UPDATE /);
});
