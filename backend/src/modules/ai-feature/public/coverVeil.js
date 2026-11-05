const sharp = require("sharp");
const objectStorage = require("../../../services/objectStorage");
const keys = require("../shared/storageKeys");

/**
 * How dark a veil the guest join page lays over an event's cover - "light", "medium" or "strong" -
 * decided from how bright the cover is where the page's text sits. The words over the cover are
 * always white; only the veil changes, so a bright photograph is dimmed more and a dark one less.
 *
 * Measured here rather than in the guest's browser: the cover is a public object in our own
 * bucket, but the bucket sends no CORS headers, so a canvas could never read its pixels (the same
 * reason the share poster reads the studio logo server-side). It is read by its key, from our own
 * storage only, and only a key under an event's cover folder.
 *
 * A cover key is a fresh UUID per upload, so a measurement never goes stale and is kept in memory
 * by key - except a read that storage failed, which is tried again on the next visit. "medium" -
 * the veil the page always drew before measuring - stands whenever the cover cannot be read, and
 * for a guest whose page asked before a slow read finished.
 */
const SAMPLE = 32;
// The band the mark, the name and the details sit on.
const TEXT_BAND = 0.62;
const MAX_BYTES = 10 * 1024 * 1024;
const CACHE_LIMIT = 500;
const WAIT_MS = 1500;

/** Perceived brightness of one pixel, 0 (black) to 1 (white), weighted the way the eye weights the channels. */
function pixelLuminance(r, g, b) {
  return Math.min(1, Math.max(0, (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255));
}

/**
 * The mean brightness, 0 to 1, of the pixels in `data` (RGBA bytes) across the top `fraction` of
 * an image `width` pixels wide. Null when there is nothing to measure.
 */
function regionLuminance(data, width, height, fraction = TEXT_BAND) {
  if (!data?.length || !width || !height) return null;
  const rows = Math.max(1, Math.round(height * fraction));
  let total = 0; let count = 0;
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 4;
    if (offset + 2 >= data.length) break;
    total += pixelLuminance(data[offset], data[offset + 1], data[offset + 2]); count += 1;
  }
  return count ? total / count : null;
}

/** "light" on a dark photograph, "strong" on a bright one, "medium" between and when unmeasured. */
function veilLevelFor(luminance) {
  if (typeof luminance !== "number" || Number.isNaN(luminance)) return "medium";
  if (luminance < 0.35) return "light";
  if (luminance > 0.6) return "strong";
  return "medium";
}

/** Only an event's own cover is ever read. */
const isCoverKey = (key) => typeof key === "string" && key.startsWith(`${keys.ROOT}/event-`)
  && key.includes(`/${keys.FOLDERS.cover}/`) && !key.includes("..");

function createCoverVeil(dependencies = {}) {
  const readObject = dependencies.readObject || objectStorage.getPublicObjectBuffer;
  const waitMs = dependencies.waitMs ?? WAIT_MS;
  const known = new Map();

  async function measure(key) {
    let bytes;
    try { bytes = await readObject(key); } catch (error) {
      // Storage itself failed - perhaps for a moment - so the next guest asks again.
      console.error("[ai-feature] cover could not be read for its brightness:", error.message);
      known.delete(key);
      return "medium";
    }
    // A missing, empty or oversized cover is an answer, and is kept like any other.
    if (!bytes || !bytes.length || bytes.length > MAX_BYTES) return "medium";
    try {
      // Stretched to a 32-pixel square, as the page once drew it to a canvas. Covers are stored at
      // 2000px at most, so the pixel cap only ever stops one that was not.
      const data = await sharp(bytes, { failOn: "none", limitInputPixels: 64_000_000, sequentialRead: true })
        .rotate().resize(SAMPLE, SAMPLE, { fit: "fill" }).ensureAlpha().raw().toBuffer();
      return veilLevelFor(regionLuminance(data, SAMPLE, SAMPLE));
    } catch (error) {
      console.error("[ai-feature] cover brightness could not be measured:", error.message);
      return "medium";
    }
  }

  /** The veil for a cover key; null when there is no cover. Never throws. */
  async function veilFor(key) {
    if (!key) return null;
    if (!isCoverKey(key)) return "medium";
    let pending = known.get(key);
    if (!pending) {
      if (known.size >= CACHE_LIMIT) known.delete(known.keys().next().value);
      pending = measure(key);
      known.set(key, pending);
    }
    let timer;
    const late = new Promise((resolve) => { timer = setTimeout(() => resolve("medium"), waitMs); });
    try { return await Promise.race([pending, late]); } finally { clearTimeout(timer); }
  }

  return { veilFor };
}

module.exports = { createCoverVeil, pixelLuminance, regionLuminance, veilLevelFor, isCoverKey, ...createCoverVeil() };
