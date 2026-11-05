import { COMPRESSION_MODULES, MODULE_KEYS, recipeFor, resolveModulePresets } from "./imagePresets.mjs";

/**
 * The pure half of Visual Curation's compression settings: from what the studio stored (the
 * `GET /api/image-selection/compression` answer, or an AI event's `media` group) to the options
 * `buildDerivatives` takes. The half that talks to the server is
 * `services/image-selection/compression.service.js`.
 *
 * Hierarchy, as the product defines it: the studio's per-module preset (Visual Curation Settings →
 * Processing / Compression) is what Image Selection, Album Proofing and Signature Album uploads
 * follow. The AI Feature's studio default is its Event Default Settings → Media Upload pair; an
 * event takes its own copy of that when it is created and can be changed on its own, so two events
 * tuned differently upload as each asks. A change of preset touches future uploads only.
 */
export { COMPRESSION_MODULES, MODULE_KEYS };

/** `{ previewPreset, thumbnailPreset }` for a module, from the studio answer; the recommended pair when the answer is missing. */
export function studioPresetsFor(studio, module) {
  return resolveModulePresets(module, studio?.[module] || null);
}

/**
 * What `buildDerivatives` is handed for one module: the preset recipe, with the module's own rule
 * on whether the preview may step down for weight (never for the AI Feature).
 */
export function derivativeOptionsFor(module, presets = {}) {
  const resolved = resolveModulePresets(module, presets);
  return recipeFor({ ...resolved, byteLadder: COMPRESSION_MODULES[module]?.byteLadder !== false });
}

/** The module's recommended pair, for a Restore recommended defaults button. */
export function recommendedPresetsFor(module) {
  const defaults = COMPRESSION_MODULES[module] || COMPRESSION_MODULES.imageSelection;
  return { previewPreset: defaults.previewPreset, thumbnailPreset: defaults.thumbnailPreset };
}

/** Whether a module's stored pair is its recommended one. */
export function isRecommended(module, presets) {
  const resolved = resolveModulePresets(module, presets);
  const recommended = recommendedPresetsFor(module);
  return resolved.previewPreset === recommended.previewPreset && resolved.thumbnailPreset === recommended.thumbnailPreset;
}
