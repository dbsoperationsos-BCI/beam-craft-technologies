import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { derivativeOptionsFor, isRecommended, recommendedPresetsFor, studioPresetsFor } from "../src/lib/visualCurationCompression.mjs";

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");

/*
 * Visual Curation Settings → Processing / Compression, from the studio's answer to the options
 * every uploader builds its derivatives with; and the wiring that makes each module read it.
 */
test("a module's options come from the studio's pair for it, the recommended pair when the studio never chose", () => {
  const studio = { imageSelection: { previewPreset: "light", thumbnailPreset: "smallest" }, albumProofing: {} };
  assert.deepEqual(studioPresetsFor(studio, "imageSelection"), { previewPreset: "light", thumbnailPreset: "smallest" });
  assert.deepEqual(studioPresetsFor(studio, "albumProofing"), { previewPreset: "high", thumbnailPreset: "standard" });
  assert.deepEqual(studioPresetsFor(null, "signatureAlbum"), { previewPreset: "high", thumbnailPreset: "standard" });
  const light = derivativeOptionsFor("imageSelection", studioPresetsFor(studio, "imageSelection"));
  assert.deepEqual(light, { preview: { longEdge: 1000, quality: 0.76, targetBytes: 100 * 1024, byteLadder: true }, thumbnail: { longEdge: 160, quality: 0.7 } });
  assert.equal(derivativeOptionsFor("aiFeature", { previewPreset: "high" }).preview.byteLadder, false, "the AI Feature never walks the ladder");
  assert.deepEqual(derivativeOptionsFor("signatureAlbum").preview, { longEdge: 2048, quality: 0.84, targetBytes: 300 * 1024, byteLadder: true });
});

test("Restore recommended defaults knows each module's pair and whether it is already there", () => {
  assert.deepEqual(recommendedPresetsFor("imageSelection"), { previewPreset: "standard", thumbnailPreset: "standard" });
  assert.deepEqual(recommendedPresetsFor("aiFeature"), { previewPreset: "high", thumbnailPreset: "standard" });
  assert.equal(isRecommended("imageSelection", null), true);
  assert.equal(isRecommended("imageSelection", { previewPreset: "high" }), false);
  assert.equal(isRecommended("albumProofing", { previewPreset: "high", thumbnailPreset: "standard" }), true);
});

test("every Virtual Curation upload prepares its photos through the one engine, to the studio's or the event's presets", () => {
  const store = read("lib", "imageSelectionUploadStore.js");
  assert.match(store, /await buildDerivatives\(runtime\.file, session\.compression \|\| derivativeOptionsFor\(session\.compressionModule\)\)/);
  assert.match(store, /session\.compression = derivativeOptionsFor\(session\.compressionModule, presets\)/);
  assert.doesNotMatch(store, /QUALITY_PRESETS|localStorage\.getItem\("dbs\.imageSelection/, "the per-machine preset is gone");
  assert.match(read("components", "image-selection", "album-proofing", "AlbumPagesPane.js"), /compressionModule="albumProofing"/);
  const album = read("components", "image-selection", "signature-album", "useAlbumUploadQueue.js");
  assert.match(album, /studioCompressionFor\("signatureAlbum"\)/);
  assert.match(album, /const prepared = await buildDerivatives\(file, options \|\| derivativeOptionsFor\("signatureAlbum"\)\);/);
  const worker = read("components", "ai-feature", "media-upload", "workers", "compress.worker.js");
  assert.match(worker, /import \{ buildDerivatives \} from "\.\.\/\.\.\/\.\.\/\.\.\/lib\/imageDerivatives\.mjs"/, "the AI worker runs the shared engine, not a recipe of its own");
  assert.doesNotMatch(worker, /OffscreenCanvas|convertToBlob/, "no second canvas encoder");
  assert.match(worker, /thumbnail: made\.thumbnail/);
  const guest = read("components", "ai-feature", "guest", "GuestGallery.js");
  assert.match(guest, /buildDerivatives\(file, derivativeOptionsFor\("aiFeature", meta\?\.media\)\)/);
  assert.match(guest, /if \(error\?\.code !== "UNDECODABLE"\) throw error;/, "only a format the phone cannot decode goes whole");
  const service = read("services", "ai-feature", "ai-media-upload.service.js");
  assert.match(service, /if \(optimized && thumbnail\) body\.append\("thumbnail", thumbnail/);
});

test("the engine decodes once, upright, and hands back both derivatives or a coded failure - never the original", () => {
  const engine = read("lib", "imageDerivatives.mjs");
  assert.match(engine, /createImageBitmap\(file, \{ imageOrientation: "from-image" \}\)/);
  assert.match(engine, /const thumbnail = await encode\(bitmap, plan\.thumbnail\.longEdge/);
  assert.match(engine, /const preview = await previewUnder\(bitmap, plan\)/);
  assert.match(engine, /bitmap\.close\?\.\(\)/);
  assert.match(engine, /"UNDECODABLE"\)/);
  assert.match(engine, /"COMPRESSION_FAILED"\)/);
  assert.doesNotMatch(engine, /return \{ [^}]*file[^}]*\}/, "the original is never a result");
});

test("the settings screens draw the two presets and nothing that reads like developer configuration", () => {
  const section = read("components", "image-selection", "compression", "CompressionSettingsSection.js");
  for (const key of ["imageSelection", "albumProofing", "signatureAlbum", "aiFeature"]) assert.match(section, new RegExp(`module: "${key}"`));
  assert.match(section, /saveVisualCurationCompression\(\{ \[module\]: patch \}\)/);
  assert.match(section, /saveAiEventDefaults\(\{ media: patch \}\)/, "the AI card writes the AI Feature's own record");
  assert.match(section, /useModuleAccess\("IMAGE_SELECTION", "AI Event Default Settings"\)/);
  assert.match(section, /if \(isAi && !aiAccess\.canRead\) return null;/);
  const mediaUpload = read("components", "ai-feature", "settings", "MediaUploadSettings.js");
  assert.match(mediaUpload, /<CompressionPresetFields/);
  assert.doesNotMatch(mediaUpload, /previewQuality|previewMaxDimension|thumbnailSize/);
  const groupForm = read("components", "ai-feature", "shared", "SettingsGroupForm.js");
  // An event's own form (Create Event, Event Settings) offers no compression at all: it is always
  // on, and the presets are the studio's, copied into the event.
  assert.doesNotMatch(groupForm, /<CompressionPresetFields|compressionEnabled|previewQuality|previewMaxDimension|thumbnailSize/);
  assert.doesNotMatch(mediaUpload, /compressionEnabled/);
  assert.doesNotMatch(section, /compressionEnabled/);
  const fields = read("components", "image-selection", "compression", "CompressionPresetFields.js");
  assert.match(fields, /<Dropdown label="Preview quality"[^\n]*sorted=\{false\}/);
  assert.match(fields, /<Dropdown label="Thumbnail quality"[^\n]*sorted=\{false\}/);
  assert.doesNotMatch(fields, /<select/);
  assert.equal(fs.existsSync(path.join(process.cwd(), "src", "components", "image-selection", "ProcessingSettingsField.js")), false);
});
