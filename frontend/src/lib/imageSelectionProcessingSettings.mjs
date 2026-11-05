// This computer's processing choices for Image Selection uploads. The preview quality is the one
// stored, per-machine choice; how many photos to decode and encode at once is no longer a setting
// at all — it is derived from the machine itself (CPU cores and reported device memory) so an
// editing tower runs wide and an old laptop stays comfortable without anyone touching a slider.
// The desktop app derives its concurrency the same way, from the same idea, in its Rust worker.
const KEY = "dbs.imageSelection.processingSettings";

/*
 * Heaviest first, and the picker is given this order as it stands (`sorted={false}`): the list is a
 * scale, so the alphabet — Compact, High, Light, Smallest, Standard — would read as noise.
 *
 * Each preset is a long edge *and* a byte ceiling, and the two are chosen together. The encoder
 * works down a ladder of scales of the long edge and accepts the last rung whatever it weighs
 * (`PREVIEW_LADDER` in `imageDerivatives.mjs`), so a ceiling the ladder cannot reach from a given
 * long edge is not a smaller file — it is the same file with a number beside it that lies. The
 * lighter presets therefore drop the long edge alongside the ceiling, which is what actually makes
 * the preview smaller; the bottom rung of each lands under its target with room to spare.
 */
export const QUALITY_PRESETS = {
  high: { label: "High (2048px, ~300 KB)", previewLongEdge: 2048, previewTargetKb: 300 },
  standard: { label: "Standard (1600px, ~200 KB)", previewLongEdge: 1600, previewTargetKb: 200 },
  compact: { label: "Compact (1200px, ~150 KB)", previewLongEdge: 1200, previewTargetKb: 150 },
  light: { label: "Light (1000px, ~100 KB)", previewLongEdge: 1000, previewTargetKb: 100 },
  smallest: { label: "Smallest (800px, ~50 KB)", previewLongEdge: 800, previewTargetKb: 50 },
};

const MIN_CONCURRENCY = 2;
const MAX_CONCURRENCY = 16;

/**
 * How many photos this browser works on at once, sized to the machine: half the logical cores
 * (the browser decodes and encodes on the main thread, so running one pipeline per core would
 * starve the tab), further capped by reported device memory so a 2 GB machine never queues eight
 * decodes at once. `navigator.deviceMemory` is Chrome-only and caps at 8, so on other browsers
 * the core count alone decides. An 8-core machine lands on the 4 pipelines the uploader always
 * shipped with; a 16-core tower doubles it.
 */
export function getAutoConcurrency() {
  if (typeof navigator === "undefined") return 4;
  const cores = Number(navigator.hardwareConcurrency) || 4;
  const memoryGb = Number(navigator.deviceMemory) || 4;
  const byCores = Math.floor(cores / 2);
  const byMemory = Math.round(memoryGb * 2);
  return Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, Math.min(byCores, byMemory)));
}

export function readProcessingSettings() {
  const concurrency = getAutoConcurrency();
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || "{}");
    return {
      concurrency,
      quality: QUALITY_PRESETS[stored.quality] ? stored.quality : "standard",
    };
  } catch {
    return { concurrency, quality: "standard" };
  }
}

export function storeProcessingSettings(settings) {
  // Only the quality is worth keeping; a concurrency stored by an older build is dropped here.
  try { localStorage.setItem(KEY, JSON.stringify({ quality: settings.quality })); } catch { /* defaults next visit */ }
}
