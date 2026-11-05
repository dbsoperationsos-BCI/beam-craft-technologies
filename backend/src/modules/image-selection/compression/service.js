const settingsRepository = require("../settings/repository");
const { COMPRESSION_MODULES, MODULE_KEYS, resolveModulePresets } = require("../../../services/imagePresets");

/**
 * The studio's per-module compression presets, stored as one JSON column (`compression`) on the
 * Image Selection settings row and answered resolved - every module present, every key a valid
 * preset - so a browser, the desktop and a server-side fallback all read one shape. The AI
 * Feature's pair is read from its Event Default Settings by whoever needs it; it is listed here
 * only as the module's recommended defaults so the settings screen can draw all four alike.
 *
 * Applies to future uploads only: nothing stored is ever re-derived when a preset changes.
 */
const STUDIO_MODULES = MODULE_KEYS.filter((key) => key !== "aiFeature");

const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);

function resolve(stored) {
  const column = isObject(stored) ? stored : {};
  const out = {};
  for (const module of MODULE_KEYS) out[module] = { ...resolveModulePresets(module, column[module]), recommended: { previewPreset: COMPRESSION_MODULES[module].previewPreset, thumbnailPreset: COMPRESSION_MODULES[module].thumbnailPreset } };
  return out;
}

function createCompressionService(repo = settingsRepository) {
  async function read() {
    const row = await repo.find();
    return resolve(row?.compression);
  }

  /** Merges the patch over what is stored, module by module, so a save naming one module leaves the others alone. */
  async function save(patch, userId) {
    const row = await repo.find();
    const current = isObject(row?.compression) ? row.compression : {};
    const next = { ...current };
    for (const module of STUDIO_MODULES) if (isObject(patch[module])) next[module] = { ...(isObject(current[module]) ? current[module] : {}), ...patch[module] };
    const saved = await repo.upsert({ compression: next, updatedByUserId: userId ?? null });
    return resolve(saved.compression);
  }

  return { read, save };
}

module.exports = { createCompressionService, resolve, STUDIO_MODULES };
