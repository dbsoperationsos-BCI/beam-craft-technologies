/**
 * The image compression presets every Virtual Curation module shares - one definition, mirrored
 * byte for byte in `frontend/src/lib/imagePresets.mjs` (a test keeps the two in step). Anything
 * that sizes a preview or a thumbnail - the browser, the desktop, the server's own sharp
 * fallbacks - reads its numbers from here, so "High" means the same picture whichever machine made
 * it.
 *
 * A preset is a long edge, a quality and (for previews) an approximate target weight. The weight
 * is what the label promises, not what the encoder is held to: the browser walks a short ladder
 * down from the preset's quality until the encode is under the target and accepts the last rung
 * whatever it weighs, so a detailed frame comes out a little heavier rather than a lot uglier.
 * The AI Feature never walks the ladder at all (`byteLadder: false`), because the preview is the
 * frame the face engine reads and its detail is worth more than its weight.
 *
 * `standard` is the exact recipe Image Selection has always produced (1600 px, the 0.82 ladder,
 * 480 px WebP thumbnail), and `high` is the exact frame the AI Feature has always derived for its
 * engine (2048 px q84), so nothing already stored looks any different from what is stored next.
 */
const PRESET_KEYS = Object.freeze(["high", "standard", "compact", "light", "smallest"]);

const IMAGE_PREVIEW_PRESETS = Object.freeze({
  high: Object.freeze({ label: "High", longEdge: 2048, targetKb: 300, quality: 0.84 }),
  standard: Object.freeze({ label: "Standard", longEdge: 1600, targetKb: 200, quality: 0.82 }),
  compact: Object.freeze({ label: "Compact", longEdge: 1200, targetKb: 150, quality: 0.8 }),
  light: Object.freeze({ label: "Light", longEdge: 1000, targetKb: 100, quality: 0.76 }),
  smallest: Object.freeze({ label: "Smallest", longEdge: 800, targetKb: 50, quality: 0.72 }),
});

const IMAGE_THUMBNAIL_PRESETS = Object.freeze({
  high: Object.freeze({ label: "High", longEdge: 640, targetKb: 80, quality: 0.8 }),
  standard: Object.freeze({ label: "Standard", longEdge: 480, targetKb: 50, quality: 0.76 }),
  compact: Object.freeze({ label: "Compact", longEdge: 360, targetKb: 35, quality: 0.74 }),
  light: Object.freeze({ label: "Light", longEdge: 240, targetKb: 20, quality: 0.72 }),
  smallest: Object.freeze({ label: "Smallest", longEdge: 160, targetKb: 12, quality: 0.7 }),
});

/**
 * The preview ladder, as offsets from the preset's own quality and scales of its long edge. At
 * `standard` this is exactly the fixed ladder Image Selection always used - 1600@0.82, 1600@0.72,
 * 1400@0.66, 1200@0.60, 1000@0.55.
 */
const PREVIEW_LADDER = Object.freeze([
  Object.freeze({ scale: 1.0, qualityOffset: 0 }),
  Object.freeze({ scale: 1.0, qualityOffset: -0.1 }),
  Object.freeze({ scale: 0.875, qualityOffset: -0.16 }),
  Object.freeze({ scale: 0.75, qualityOffset: -0.22 }),
  Object.freeze({ scale: 0.625, qualityOffset: -0.27 }),
]);
const MIN_LADDER_QUALITY = 0.4;

/**
 * Every module that uploads images, with the presets it starts on. Image Selection stays on the
 * recipe it has always shipped; the client-facing albums and the AI Feature start on High because
 * a spread's text, a premium album and a face all want the detail. `byteLadder` is whether the
 * preview may step down to land near the target weight: never for the AI Feature.
 */
const COMPRESSION_MODULES = Object.freeze({
  imageSelection: Object.freeze({ label: "Image Selection", previewPreset: "standard", thumbnailPreset: "standard", byteLadder: true }),
  albumProofing: Object.freeze({ label: "Album Proofing", previewPreset: "high", thumbnailPreset: "standard", byteLadder: true }),
  signatureAlbum: Object.freeze({ label: "Signature Album", previewPreset: "high", thumbnailPreset: "standard", byteLadder: true }),
  aiFeature: Object.freeze({ label: "AI Feature", previewPreset: "high", thumbnailPreset: "standard", byteLadder: false }),
});
const MODULE_KEYS = Object.freeze(Object.keys(COMPRESSION_MODULES));

const isPresetKey = (value) => PRESET_KEYS.includes(value);

/** A stored preset key, or the fallback when the row holds something that is not one. */
const presetOr = (value, fallback) => (isPresetKey(value) ? value : fallback);

/**
 * The preset nearest a long edge, for a record that predates the presets and still carries a
 * number (`previewMaxDimension`, `thumbnailSize`). Null when there is no number to read.
 */
function nearestPreset(presets, longEdge) {
  const edge = Number(longEdge);
  if (!Number.isFinite(edge) || edge <= 0) return null;
  let best = null;
  for (const key of PRESET_KEYS) {
    const distance = Math.abs(presets[key].longEdge - edge);
    if (!best || distance < best.distance) best = { key, distance };
  }
  return best.key;
}
const previewPresetFromLegacy = (longEdge) => nearestPreset(IMAGE_PREVIEW_PRESETS, longEdge);
const thumbnailPresetFromLegacy = (longEdge) => nearestPreset(IMAGE_THUMBNAIL_PRESETS, longEdge);

/**
 * A module's effective presets from whatever is stored for it: a valid key wins, a legacy number
 * is translated, and nothing at all is the module's recommended default.
 */
function resolveModulePresets(module, stored = {}) {
  const defaults = COMPRESSION_MODULES[module] || COMPRESSION_MODULES.imageSelection;
  return {
    previewPreset: presetOr(stored?.previewPreset, previewPresetFromLegacy(stored?.previewMaxDimension) || defaults.previewPreset),
    thumbnailPreset: presetOr(stored?.thumbnailPreset, thumbnailPresetFromLegacy(stored?.thumbnailSize) || defaults.thumbnailPreset),
  };
}

/** The numbers the encoders work with, for a pair of preset keys. */
function recipeFor({ previewPreset, thumbnailPreset, byteLadder = true } = {}) {
  const preview = IMAGE_PREVIEW_PRESETS[previewPreset] || IMAGE_PREVIEW_PRESETS.standard;
  const thumbnail = IMAGE_THUMBNAIL_PRESETS[thumbnailPreset] || IMAGE_THUMBNAIL_PRESETS.standard;
  return {
    preview: { longEdge: preview.longEdge, quality: preview.quality, targetBytes: preview.targetKb * 1024, byteLadder: byteLadder !== false },
    thumbnail: { longEdge: thumbnail.longEdge, quality: thumbnail.quality },
  };
}

/** The rungs the browser or a server walks for a preview: `[{ longEdge, quality }]`, heaviest first. */
function previewRungs(preview) {
  if (preview.byteLadder === false) return [{ longEdge: preview.longEdge, quality: preview.quality }];
  return PREVIEW_LADDER.map((rung) => ({ longEdge: Math.round(preview.longEdge * rung.scale), quality: Math.max(MIN_LADDER_QUALITY, Math.round((preview.quality + rung.qualityOffset) * 100) / 100) }));
}

/** "High (2048px, ~300 KB)" - the one line a picker shows for a preset. */
const presetLabel = (presets, key) => { const preset = presets[key]; return preset ? `${preset.label} (${preset.longEdge}px, ~${preset.targetKb} KB)` : key; };
const previewPresetLabel = (key) => presetLabel(IMAGE_PREVIEW_PRESETS, key);
const thumbnailPresetLabel = (key) => presetLabel(IMAGE_THUMBNAIL_PRESETS, key);

module.exports = {
  PRESET_KEYS, IMAGE_PREVIEW_PRESETS, IMAGE_THUMBNAIL_PRESETS, PREVIEW_LADDER, MIN_LADDER_QUALITY, COMPRESSION_MODULES, MODULE_KEYS,
  isPresetKey, previewPresetFromLegacy, thumbnailPresetFromLegacy, resolveModulePresets, recipeFor, previewRungs, previewPresetLabel, thumbnailPresetLabel,
};
