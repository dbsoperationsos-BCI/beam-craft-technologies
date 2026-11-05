const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createCompressionService, resolve } = require("../src/modules/image-selection/compression/service");
const { compressionBodySchema } = require("../src/modules/image-selection/compression/validation");

/*
 * Visual Curation Settings → Processing / Compression: the studio's preset pair per module, on
 * the Image Selection settings row. A fake repository stands in for Prisma; the service is the
 * real one.
 */
function fakeRepository(initial = null) {
  let row = initial;
  return {
    find: async () => row,
    upsert: async (data) => { row = { ...(row || {}), ...data }; return row; },
    row: () => row,
  };
}

test("an install that never saved answers every module's recommended pair, marked as such", async () => {
  const service = createCompressionService(fakeRepository(null));
  const read = await service.read();
  assert.deepEqual(Object.keys(read), ["imageSelection", "albumProofing", "signatureAlbum", "aiFeature"]);
  assert.deepEqual(read.imageSelection, { previewPreset: "standard", thumbnailPreset: "standard", recommended: { previewPreset: "standard", thumbnailPreset: "standard" } });
  assert.deepEqual(read.albumProofing, { previewPreset: "high", thumbnailPreset: "standard", recommended: { previewPreset: "high", thumbnailPreset: "standard" } });
  assert.deepEqual(read.signatureAlbum.recommended, { previewPreset: "high", thumbnailPreset: "standard" });
  assert.deepEqual(read.aiFeature.recommended, { previewPreset: "high", thumbnailPreset: "standard" });
});

test("a save names one module and one key, and every other module and key is left as it was", async () => {
  const repo = fakeRepository({ compression: { imageSelection: { previewPreset: "light", thumbnailPreset: "compact" }, signatureAlbum: { previewPreset: "compact" } } });
  const service = createCompressionService(repo);
  const saved = await service.save({ imageSelection: { previewPreset: "high" } }, 42);
  assert.deepEqual(saved.imageSelection, { previewPreset: "high", thumbnailPreset: "compact", recommended: { previewPreset: "standard", thumbnailPreset: "standard" } });
  assert.equal(saved.signatureAlbum.previewPreset, "compact");
  assert.equal(saved.signatureAlbum.thumbnailPreset, "standard", "unset falls to the recommended default");
  assert.equal(repo.row().updatedByUserId, 42);
  assert.deepEqual(repo.row().compression, { imageSelection: { previewPreset: "high", thumbnailPreset: "compact" }, signatureAlbum: { previewPreset: "compact" } }, "only what was chosen is stored");
});

test("a column holding something that is not an object, or keys that are not presets, resolves to the defaults rather than breaking an upload", () => {
  assert.equal(resolve("garbage").imageSelection.previewPreset, "standard");
  assert.equal(resolve([1, 2]).albumProofing.previewPreset, "high");
  assert.equal(resolve({ imageSelection: { previewPreset: "ultra", thumbnailPreset: 480 } }).imageSelection.previewPreset, "standard");
  assert.equal(resolve({ imageSelection: "high" }).imageSelection.previewPreset, "standard");
});

test("the body takes only the three studio modules and only preset names; the AI Feature is saved on its own record", () => {
  assert.equal(compressionBodySchema.safeParse({ imageSelection: { previewPreset: "high" } }).success, true);
  assert.equal(compressionBodySchema.safeParse({ signatureAlbum: { previewPreset: "high", thumbnailPreset: "light" }, albumProofing: {} }).success, true);
  assert.equal(compressionBodySchema.safeParse({}).success, true);
  assert.equal(compressionBodySchema.safeParse({ imageSelection: { previewPreset: "ultra" } }).success, false);
  assert.equal(compressionBodySchema.safeParse({ imageSelection: { previewMaxDimension: 2048 } }).success, false, "numbers are not a preset");
  assert.equal(compressionBodySchema.safeParse({ aiFeature: { previewPreset: "high" } }).success, false);
  assert.equal(compressionBodySchema.safeParse({ bogus: {} }).success, false);
});

test("the route reads for any Visual Curation uploader and writes for ADMIN / System Settings only; the column is nullable and additive", () => {
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", "compression", "routes.js"), "utf8");
  assert.match(routes, /router\.use\(protect\)/);
  assert.match(routes, /router\.get\("\/", checkAnyPermission\(\[\s*\{ module: "IMAGE_SELECTION", feature: "Project Management", level: "READ" \},\s*\{ module: "IMAGE_SELECTION", feature: "Album Proofing", level: "READ" \},\s*\{ module: "IMAGE_SELECTION", feature: "Signature Album", level: "READ" \},[\s\S]*?\{ module: "IMAGE_SELECTION", feature: "AI Culling", level: "READ" \},\s*\{ module: "IMAGE_SELECTION", feature: "AI Editing", level: "READ" \},\s*\{ module: "SETTINGS", feature: "Organization", level: "READ" \},\s*\]\), getCompression\)/);
  assert.match(routes, /router\.put\("\/", checkPermission\("SETTINGS", "Organization", "READ_WRITE"\), saveCompression\)/);
  const server = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");
  assert.match(server, /app\.use\("\/api\/image-selection\/compression", imageSelectionCompressionRoutes\)/);
  const schema = fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
  assert.match(schema, /compression\s+Json\?\s+@map\("compression"\)/);
  const migration = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20260930100000_visual_curation_compression_settings", "migration.sql"), "utf8");
  assert.match(migration, /ADD COLUMN `compression` JSON NULL/);
  // The Image Selection derivative route stores nothing it has not read the first bytes of.
  const receiver = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", "uploads", "derivativeController.js"), "utf8");
  assert.match(receiver, /if \(!isPlainWebp\(thumbnail\.buffer\) \|\| !isPlainJpeg\(preview\.buffer\)\) return res\.status\(400\)/);
  // The legacy sharp worker follows the studio's preset for the project's module, through the shared
  // ladder, reads the record at most every ten seconds, and never fails a photo on a settings read.
  const worker = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", "processing", "service.js"), "utf8");
  assert.match(worker, /const module = upload\.project\?\.albumProofing \? "albumProofing" : "imageSelection";/);
  assert.match(worker, /rungs: previewRungs\(recipe\.preview\)/);
  assert.match(worker, /STUDIO_PRESETS_TTL_MS = 10 \* 1000/);
  assert.match(worker, /try \{ presets = \(await studioPresets\(\)\)\?\.\[module\] \|\| \{\}; \} catch/);
  assert.doesNotMatch(worker, /quality: 76, effort: 4/, "no thumbnail number of its own");
});
