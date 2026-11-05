const { z } = require("zod");
const { PRESET_KEYS, MODULE_KEYS } = require("../../../services/imagePresets");

const presetKey = z.enum(PRESET_KEYS);
const modulePresets = z.object({ previewPreset: presetKey, thumbnailPreset: presetKey }).partial().strict();

/**
 * The studio's compression choices, a module at a time: `{ imageSelection: { previewPreset,
 * thumbnailPreset }, albumProofing: {...}, signatureAlbum: {...} }`. Any subset of modules, any
 * subset of the two keys; a module left out keeps what it has. The AI Feature is not here - its
 * presets live on the Event Default Settings `media` group, which its own route saves.
 */
const compressionBodySchema = z.object(Object.fromEntries(MODULE_KEYS.filter((key) => key !== "aiFeature").map((key) => [key, modulePresets.optional()]))).strict();

module.exports = { compressionBodySchema };
