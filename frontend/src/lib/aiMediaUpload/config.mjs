import { COMPRESSION_MODULES, resolveModulePresets } from "../imagePresets.mjs";
import { derivativeOptionsFor } from "../visualCurationCompression.mjs";

/**
 * AI Feature media upload: the numbers, in one place.
 *
 * Compression follows the event's Media Upload settings (Event Default Settings → Media Upload →
 * Compression; an event's own copy under More → Event Settings): a preview preset and a thumbnail
 * preset from the shared table in `lib/imagePresets.mjs`, the same one Image Selection, the
 * albums, the server and the desktop read. The defaults here mirror the server's
 * `settingsDefaults.js` `media` group - `high` and `standard`, which ARE the recipe the AI Feature
 * has always derived on the server (2048 px JPEG q84, 480 px WebP thumbnail) - and a test keeps
 * the two in step. The preview made on the photographer's machine is exactly what the face
 * engine reads, so sending it instead of the original changes nothing about detection, and the
 * AI Feature never steps a preview down for weight. The thumbnail is cut from the same decode of
 * the original and sent beside the preview. The desktop app runs the same recipe natively.
 */
export const AI_MEDIA_COMPRESSION_DEFAULTS = Object.freeze({
  previewPreset: COMPRESSION_MODULES.aiFeature.previewPreset,
  thumbnailPreset: COMPRESSION_MODULES.aiFeature.thumbnailPreset,
  thumbnailFormat: "webp",
  uploadConcurrency: 4,
  compressionConcurrency: 3,
  preserveMetadata: false,
});

/** The bounds the server validates the concurrency pair with; a stored value outside them is clamped, never trusted. */
export const AI_MEDIA_COMPRESSION_BOUNDS = Object.freeze({
  uploadConcurrency: [1, 8],
  compressionConcurrency: [1, 4],
});

const clamp = (value, [min, max], fallback) => { const number = Number(value); return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback; };

/**
 * The worker's recipe, read off an event's resolved `media` settings. `null` or `{}` answers the
 * defaults; a row that still names its recipe in numbers (`previewMaxDimension`, `thumbnailSize`)
 * is read as the nearest presets. `derivatives` is what `buildDerivatives` takes.
 */
export function compressionFromSettings(media) {
  const presets = resolveModulePresets("aiFeature", media);
  // Always compressed: there is no switch. An event row saved when there was one may still say
  // `compressionEnabled: false`; it is not read.
  return Object.freeze({
    previewPreset: presets.previewPreset,
    thumbnailPreset: presets.thumbnailPreset,
    // A JPEG thumbnail is the event's choice; the worker cuts the format the server stores.
    thumbnailType: String(media?.thumbnailFormat || "").toLowerCase() === "jpeg" ? "image/jpeg" : "image/webp",
    derivatives: derivativeOptionsFor("aiFeature", presets),
    // A canvas keeps no EXIF whatever the event asks; the capture date travels as its own field.
    preserveMetadata: media?.preserveMetadata === true,
  });
}

/** How many photos this browser compresses and sends at once, from the same settings. */
export function limitsFromSettings(media) {
  const d = AI_MEDIA_COMPRESSION_DEFAULTS;
  return Object.freeze({
    compressionConcurrency: clamp(media?.compressionConcurrency, AI_MEDIA_COMPRESSION_BOUNDS.compressionConcurrency, d.compressionConcurrency),
    uploadConcurrency: clamp(media?.uploadConcurrency, AI_MEDIA_COMPRESSION_BOUNDS.uploadConcurrency, d.uploadConcurrency),
  });
}

export const AI_MEDIA_COMPRESSION_CONFIG = compressionFromSettings(null);

export const AI_MEDIA_UPLOAD_CONFIG = Object.freeze({
  // The engine's fallback when a session names no limits; the web adapter never runs more workers
  // than the widest bound, whatever an event asks.
  compressionConcurrency: AI_MEDIA_COMPRESSION_DEFAULTS.compressionConcurrency,
  uploadConcurrency: AI_MEDIA_COMPRESSION_DEFAULTS.uploadConcurrency,
  maxCompressionWorkers: AI_MEDIA_COMPRESSION_BOUNDS.compressionConcurrency[1],
  // Compressed files waiting to be sent are held in memory; this caps how far compression may run
  // ahead of the uploads, so ten thousand photos never mean ten thousand blobs at once.
  readyBuffer: 12,
  maxAttempts: 3,
  retryDelaysMs: [1000, 3000],
  // Formats a browser cannot decode (HEIC, TIFF) are sent as they are, because the server converts
  // them itself; the row says so. This is the one documented case where an original travels, and
  // it is by format, never as a fallback for a compression that failed. Off, they fail as
  // "Unsupported image" instead.
  uploadOriginalWhenUndecodable: true,
  maxFilesPerBatch: 50000,
  // How often the Media grid is asked to refresh while photos are landing.
  galleryRefreshMs: 8000,
});

export const UPLOAD_STATUS = Object.freeze({
  SELECTED: "SELECTED",
  QUEUED: "QUEUED",
  COMPRESSING: "COMPRESSING",
  READY: "READY",
  UPLOADING: "UPLOADING",
  UPLOADED: "UPLOADED",
  FACE_PROCESSING_QUEUED: "FACE_PROCESSING_QUEUED",
  COMPLETE: "COMPLETE",
  DUPLICATE: "DUPLICATE",
  CANCELLED: "CANCELLED",
  SKIPPED: "SKIPPED",
  COMPRESSION_FAILED: "COMPRESSION_FAILED",
  UPLOAD_FAILED: "UPLOAD_FAILED",
  PROCESSING_FAILED: "PROCESSING_FAILED",
});

export const TERMINAL_STATUSES = new Set([
  UPLOAD_STATUS.COMPLETE, UPLOAD_STATUS.DUPLICATE, UPLOAD_STATUS.CANCELLED, UPLOAD_STATUS.SKIPPED,
  UPLOAD_STATUS.COMPRESSION_FAILED, UPLOAD_STATUS.UPLOAD_FAILED, UPLOAD_STATUS.PROCESSING_FAILED,
]);
export const FAILED_STATUSES = new Set([UPLOAD_STATUS.COMPRESSION_FAILED, UPLOAD_STATUS.UPLOAD_FAILED, UPLOAD_STATUS.PROCESSING_FAILED]);

export const UPLOAD_STATUS_LABELS = Object.freeze({
  SELECTED: "Preparing",
  QUEUED: "Waiting",
  COMPRESSING: "Compressing…",
  READY: "Ready to upload",
  UPLOADING: "Uploading…",
  UPLOADED: "Uploaded",
  FACE_PROCESSING_QUEUED: "Queued for faces",
  COMPLETE: "Complete",
  DUPLICATE: "Already uploaded",
  CANCELLED: "Cancelled",
  SKIPPED: "Skipped",
  COMPRESSION_FAILED: "Compression failed",
  UPLOAD_FAILED: "Upload failed",
  PROCESSING_FAILED: "Processing failed",
});

/** Tailwind text tones for the status word on a row. */
export const UPLOAD_STATUS_TONES = Object.freeze({
  SELECTED: "text-slate-500",
  QUEUED: "text-slate-500",
  COMPRESSING: "text-blue-700",
  READY: "text-slate-600",
  UPLOADING: "text-blue-700",
  UPLOADED: "text-blue-700",
  FACE_PROCESSING_QUEUED: "text-blue-700",
  COMPLETE: "text-green-700",
  DUPLICATE: "text-amber-700",
  CANCELLED: "text-slate-500",
  SKIPPED: "text-slate-500",
  COMPRESSION_FAILED: "text-red-700",
  UPLOAD_FAILED: "text-red-700",
  PROCESSING_FAILED: "text-red-700",
});
