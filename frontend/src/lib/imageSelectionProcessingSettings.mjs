// How many photos this browser decodes and encodes at once for an Image Selection or Album
// Proofing upload. Not a setting at all: it is derived from the machine itself (CPU cores and
// reported device memory) so an editing tower runs wide and an old laptop stays comfortable
// without anyone touching a slider. The desktop app derives its concurrency the same way, from
// the same idea, in its Rust worker.
//
// The preview quality used to be this computer's own choice, kept in localStorage beside this.
// It is the studio's now - Visual Curation Settings → Processing / Compression, one preset pair
// per module, read through `services/image-selection/compression.service.js` - so every machine
// in the studio makes the same preview, and the old per-machine value is no longer read.
const MIN_CONCURRENCY = 2;
const MAX_CONCURRENCY = 16;

/**
 * Half the logical cores (the browser decodes and encodes on the main thread, so running one
 * pipeline per core would starve the tab), further capped by reported device memory so a 2 GB
 * machine never queues eight decodes at once. `navigator.deviceMemory` is Chrome-only and caps at
 * 8, so on other browsers the core count alone decides. An 8-core machine lands on the 4
 * pipelines the uploader always shipped with; a 16-core tower doubles it.
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
  return { concurrency: getAutoConcurrency() };
}
