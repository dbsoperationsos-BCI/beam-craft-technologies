const test = require("node:test");
const assert = require("node:assert/strict");
const presets = require("../src/services/imagePresets");
const sharp = require("sharp");
const { isJpeg, isWebp, isPng, sniffImageType, isPlainJpeg, isPlainWebp, hasOnlyImageMarkers } = require("../src/services/imageBytes");

const { PRESET_KEYS, IMAGE_PREVIEW_PRESETS, IMAGE_THUMBNAIL_PRESETS, COMPRESSION_MODULES, MODULE_KEYS, previewRungs, recipeFor, resolveModulePresets, previewPresetFromLegacy, thumbnailPresetFromLegacy, previewPresetLabel, thumbnailPresetLabel } = presets;

test("both preset families carry the five names, heaviest first, each with a long edge, a quality and a target", () => {
  assert.deepEqual(PRESET_KEYS, ["high", "standard", "compact", "light", "smallest"]);
  for (const family of [IMAGE_PREVIEW_PRESETS, IMAGE_THUMBNAIL_PRESETS]) {
    assert.deepEqual(Object.keys(family), PRESET_KEYS);
    const edges = PRESET_KEYS.map((key) => family[key].longEdge);
    const qualities = PRESET_KEYS.map((key) => family[key].quality);
    const targets = PRESET_KEYS.map((key) => family[key].targetKb);
    assert.deepEqual(edges, [...edges].sort((a, b) => b - a), "long edges descend");
    assert.deepEqual(qualities, [...qualities].sort((a, b) => b - a), "qualities descend");
    assert.deepEqual(targets, [...targets].sort((a, b) => b - a), "targets descend");
    for (const key of PRESET_KEYS) { assert.ok(family[key].quality > 0.5 && family[key].quality < 1, key); assert.ok(Object.isFrozen(family[key])); }
  }
  // A thumbnail is always smaller than the preview of the same name.
  for (const key of PRESET_KEYS) assert.ok(IMAGE_THUMBNAIL_PRESETS[key].longEdge < IMAGE_PREVIEW_PRESETS[key].longEdge, key);
});

test("Standard is the exact recipe Image Selection always produced, High the exact frame the AI Feature always derived", () => {
  assert.deepEqual(previewRungs(recipeFor({ previewPreset: "standard" }).preview), [
    { longEdge: 1600, quality: 0.82 }, { longEdge: 1600, quality: 0.72 }, { longEdge: 1400, quality: 0.66 }, { longEdge: 1200, quality: 0.6 }, { longEdge: 1000, quality: 0.55 },
  ]);
  assert.deepEqual(recipeFor({ previewPreset: "standard", thumbnailPreset: "standard" }).thumbnail, { longEdge: 480, quality: 0.76 });
  const ai = recipeFor({ previewPreset: "high", thumbnailPreset: "standard", byteLadder: false });
  assert.deepEqual(previewRungs(ai.preview), [{ longEdge: 2048, quality: 0.84 }], "the AI Feature never steps a face's frame down for weight");
  assert.equal(ai.preview.targetBytes, 300 * 1024);
});

test("the ladder never falls below the floor quality, and the lightest preset still has five rungs", () => {
  const rungs = previewRungs(recipeFor({ previewPreset: "smallest" }).preview);
  assert.equal(rungs.length, 5);
  assert.deepEqual(rungs[0], { longEdge: 800, quality: 0.72 });
  assert.deepEqual(rungs[4], { longEdge: 500, quality: 0.45 });
  for (const rung of rungs) assert.ok(rung.quality >= presets.MIN_LADDER_QUALITY);
});

test("every module names its recommended pair and whether it walks the ladder; a stored key wins, a legacy number is translated, nothing is the default", () => {
  assert.deepEqual(MODULE_KEYS, ["imageSelection", "albumProofing", "signatureAlbum", "aiFeature"]);
  assert.deepEqual(COMPRESSION_MODULES.imageSelection, { label: "Image Selection", previewPreset: "standard", thumbnailPreset: "standard", byteLadder: true });
  assert.deepEqual(COMPRESSION_MODULES.aiFeature, { label: "AI Feature", previewPreset: "high", thumbnailPreset: "standard", byteLadder: false });
  for (const module of MODULE_KEYS) { assert.ok(PRESET_KEYS.includes(COMPRESSION_MODULES[module].previewPreset)); assert.ok(PRESET_KEYS.includes(COMPRESSION_MODULES[module].thumbnailPreset)); }
  assert.deepEqual(resolveModulePresets("signatureAlbum", null), { previewPreset: "high", thumbnailPreset: "standard" });
  assert.deepEqual(resolveModulePresets("imageSelection", { previewPreset: "light" }), { previewPreset: "light", thumbnailPreset: "standard" });
  assert.deepEqual(resolveModulePresets("imageSelection", { previewPreset: "ultra", thumbnailPreset: "" }), { previewPreset: "standard", thumbnailPreset: "standard" });
  assert.deepEqual(resolveModulePresets("aiFeature", { previewMaxDimension: 2560, thumbnailSize: 200 }), { previewPreset: "high", thumbnailPreset: "light" });
  assert.deepEqual(resolveModulePresets("aiFeature", { previewPreset: "compact", previewMaxDimension: 2560 }), { previewPreset: "compact", thumbnailPreset: "standard" }, "a key beats a number");
  assert.deepEqual(resolveModulePresets("nope", {}), { previewPreset: "standard", thumbnailPreset: "standard" });
});

test("a legacy long edge maps to the nearest preset, and nothing to null", () => {
  assert.equal(previewPresetFromLegacy(2048), "high");
  assert.equal(previewPresetFromLegacy(1500), "standard");
  assert.equal(previewPresetFromLegacy(1024), "light");
  assert.equal(previewPresetFromLegacy(4096), "high");
  assert.equal(previewPresetFromLegacy("x"), null);
  assert.equal(previewPresetFromLegacy(undefined), null);
  assert.equal(thumbnailPresetFromLegacy(480), "standard");
  assert.equal(thumbnailPresetFromLegacy(1024), "high");
  assert.equal(thumbnailPresetFromLegacy(0), null);
});

test("a preset's label quotes the numbers it carries", () => {
  assert.equal(previewPresetLabel("high"), "High (2048px, ~300 KB)");
  assert.equal(thumbnailPresetLabel("standard"), "Standard (480px, ~50 KB)");
  assert.equal(previewPresetLabel("nope"), "nope");
});

test("the byte sniffer answers by the bytes, never the name", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  assert.ok(isJpeg(jpeg) && !isWebp(jpeg) && !isPng(jpeg));
  assert.ok(isWebp(webp) && !isJpeg(webp));
  assert.ok(isPng(png));
  assert.equal(sniffImageType(jpeg), "image/jpeg");
  assert.equal(sniffImageType(webp), "image/webp");
  assert.equal(sniffImageType(png), "image/png");
  assert.equal(sniffImageType(Buffer.from("GIF89a")), null);
  assert.equal(sniffImageType(Buffer.alloc(0)), null);
  assert.equal(isJpeg("not a buffer"), false);
});

test("a plain JPEG is walked to its last byte: baseline and progressive pass, a comment, a stray APPn, a non-ICC APP2, a trailing payload or a missing EOI do not", async () => {
  const frame = { create: { width: 96, height: 64, channels: 3, background: "#123456" } };
  const baseline = await sharp(frame).jpeg({ quality: 80, progressive: false }).toBuffer();
  const progressive = await sharp(frame).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
  assert.equal(isPlainJpeg(baseline), true);
  assert.equal(isPlainJpeg(progressive), true, "every scan of a progressive JPEG is walked");
  assert.equal(hasOnlyImageMarkers(progressive), true);
  const segment = (marker, payload) => Buffer.concat([Buffer.from([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload]);
  const before = (jpeg, extra) => Buffer.concat([jpeg.subarray(0, 2), extra, jpeg.subarray(2)]);
  const afterFirstScan = (jpeg, extra) => { const eoi = jpeg.length - 2; return Buffer.concat([jpeg.subarray(0, eoi), extra, jpeg.subarray(eoi)]); };
  assert.equal(isPlainJpeg(before(baseline, segment(0xfe, Buffer.from("hello")))), false, "COM before the scan");
  assert.equal(isPlainJpeg(afterFirstScan(progressive, segment(0xfe, Buffer.from("hello")))), false, "COM between scans, where a header-only walk never looked");
  assert.equal(isPlainJpeg(before(baseline, segment(0xef, Buffer.alloc(4)))), false, "APP15");
  assert.equal(isPlainJpeg(before(baseline, segment(0xe2, Buffer.from("not an icc profile at all")))), false, "APP2 that is not an ICC profile");
  assert.equal(isPlainJpeg(before(baseline, segment(0xe2, Buffer.concat([Buffer.from("ICC_PROFILE\0"), Buffer.alloc(8)])))), true, "APP2 as an ICC profile");
  assert.equal(isPlainJpeg(Buffer.concat([baseline, Buffer.from("payload")])), false, "bytes after EOI");
  assert.equal(isPlainJpeg(baseline.subarray(0, baseline.length - 2)), false, "no EOI");
  assert.equal(isPlainJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), false, "no scan at all");
  assert.equal(isPlainJpeg(Buffer.from("RIFF")), false);
});

test("a plain WebP is walked chunk by chunk: an encoder's output passes, a metadata chunk, a trailing payload or a lying RIFF size do not", async () => {
  const frame = { create: { width: 96, height: 64, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 0.5 } } };
  const lossy = await sharp(frame).webp({ quality: 76 }).toBuffer();
  const lossless = await sharp(frame).webp({ lossless: true }).toBuffer();
  assert.equal(isPlainWebp(lossy), true);
  assert.equal(isPlainWebp(lossless), true);
  const withExif = await sharp(lossy).withExif({ IFD0: { Make: "Canon" } }).webp({ quality: 76 }).toBuffer();
  assert.equal(isPlainWebp(withExif), false, "an EXIF chunk is not the image's own");
  assert.equal(isPlainWebp(Buffer.concat([lossy, Buffer.from("payload")])), false, "bytes past the RIFF size");
  const lying = Buffer.from(lossy); lying.writeUInt32LE(lossy.length + 100, 4);
  assert.equal(isPlainWebp(lying), false, "a RIFF size that is not the file");
  assert.equal(isPlainWebp(lossy.subarray(0, 20)), false, "a short file");
  assert.equal(isPlainWebp(Buffer.concat([Buffer.from("RIFF"), Buffer.from([4, 0, 0, 0]), Buffer.from("WEBP")])), false, "a container with no image chunk is not an image");
});

test("a WebP carrying its colour profile is still plain: Chrome's canvas writes one on every thumbnail", async () => {
  // Exactly the shape Chrome's convertToBlob({ type: "image/webp" }) produces: an extended header,
  // the ICC profile, then the frame. Built by hand so the test does not depend on any encoder.
  const chunk = (type, body) => Buffer.concat([Buffer.from(type, "ascii"), Buffer.from([body.length & 255, (body.length >> 8) & 255, 0, 0]), body, body.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)]);
  const body = Buffer.concat([Buffer.from("WEBP", "ascii"), chunk("VP8X", Buffer.from([0x20, 0, 0, 0, 95, 0, 0, 63, 0, 0])), chunk("ICCP", Buffer.alloc(456, 1)), chunk("VP8 ", Buffer.alloc(29370, 2))]);
  const chrome = Buffer.concat([Buffer.from("RIFF", "ascii"), Buffer.from([body.length & 255, (body.length >> 8) & 255, (body.length >> 16) & 255, 0]), body]);
  assert.equal(isPlainWebp(chrome), true, "a colour profile is the image's own");
  const frame = { create: { width: 96, height: 64, channels: 3, background: { r: 1, g: 2, b: 3 } } };
  const withIcc = await sharp(frame).withIccProfile("srgb").webp({ quality: 76 }).toBuffer();
  assert.equal(isPlainWebp(withIcc), true, "sharp's attached profile too");
  // The chunks that carry a payload, not the picture, are still refused.
  const exif = Buffer.concat([Buffer.from("RIFF", "ascii"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP", "ascii"), chunk("VP8X", Buffer.alloc(10)), chunk("EXIF", Buffer.alloc(8)), chunk("VP8 ", Buffer.alloc(8))]);
  exif.writeUInt32LE(exif.length - 8, 4);
  assert.equal(isPlainWebp(exif), false, "an EXIF chunk is not the image's own");
  const xmp = Buffer.concat([Buffer.from("RIFF", "ascii"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP", "ascii"), chunk("VP8X", Buffer.alloc(10)), chunk("XMP ", Buffer.alloc(8)), chunk("VP8 ", Buffer.alloc(8))]);
  xmp.writeUInt32LE(xmp.length - 8, 4);
  assert.equal(isPlainWebp(xmp), false, "nor an XMP chunk");
});
