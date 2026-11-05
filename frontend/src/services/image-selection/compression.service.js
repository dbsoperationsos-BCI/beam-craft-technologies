import { apiRequest } from "@/services/api/client";
import { studioPresetsFor } from "@/lib/visualCurationCompression.mjs";

/**
 * Visual Curation Settings → Processing / Compression: the studio's preview and thumbnail preset
 * per module (Image Selection, Album Proofing, Signature Album), one record behind
 * `/api/image-selection/compression`. Any Visual Curation uploader may read it; saving is the
 * Settings panel's, behind ADMIN / System Settings.
 */
const base = "/api/image-selection/compression";

export const getVisualCurationCompression = () => apiRequest(base);
export const saveVisualCurationCompression = (patch) => apiRequest(base, { method: "PUT", body: JSON.stringify(patch) });

/*
 * The studio's answer, held for a while so a thousand-photo batch asks the server once, not once
 * per photo, and every batch started in the next few minutes asks not at all. A save from the
 * Settings panel primes it, so the very next batch follows the new preset without waiting the
 * cache out. Never blocks an upload: when the server cannot be asked, the module's recommended
 * presets stand, which is what an install that never saved would have answered anyway.
 */
const CACHE_MS = 5 * 60 * 1000;
let cached = null;
let cachedAt = 0;
let inFlight = null;

export function primeVisualCurationCompression(data) {
  cached = data || null;
  cachedAt = data ? Date.now() : 0;
}

export async function loadVisualCurationCompression({ fresh = false } = {}) {
  if (!fresh && cached && Date.now() - cachedAt < CACHE_MS) return cached;
  if (!inFlight) {
    inFlight = getVisualCurationCompression()
      .then((response) => { primeVisualCurationCompression(response?.data || null); return cached; })
      .catch(() => cached)
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

/** `{ previewPreset, thumbnailPreset }` the studio chose for one module - the recommended pair when nothing is stored or the server cannot be asked. */
export async function studioCompressionFor(module) {
  const studio = await loadVisualCurationCompression();
  return studioPresetsFor(studio, module);
}
