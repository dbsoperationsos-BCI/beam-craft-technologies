/**
 * What an event is configured as when nobody has said otherwise: the code's own defaults, the
 * studio's saved defaults over them, and an event's own copy over both.
 *
 * Pure data and pure functions, so the panel, the wizard and the worker all read one definition
 * and the unit tests need no database.
 */
const { COMPRESSION_MODULES, previewPresetFromLegacy, thumbnailPresetFromLegacy } = require("../../../services/imagePresets");

const EVENT_TYPES = ["Wedding", "Engagement", "Reception", "Corporate Event", "Birthday", "Baby Event", "Conference", "Other"];

const DEFAULTS = Object.freeze({
  general: { defaultEventType: "Wedding", defaultTimezone: "Asia/Kolkata", defaultDurationDays: 1, eventTypes: EVENT_TYPES },
  // `allowTakeSelfie` / `allowUploadSelfie` are the two ways into Find My Photos - the camera and
  // the file picker - under `enableSelfie`. Both default on, so an event stored before they existed
  // keeps both buttons. `enableGuestUploads` is something else: guests adding event photos.
  // `verifyPhone` (Confirm phone numbers by SMS) asks every phone join for a code; off, only a guest
  // with something to protect is asked (public/service.join). Off by default, for every event.
  guestAccess: { allowRegistration: true, requireName: true, requirePhone: true, enableRsvp: true, enableSelfie: true, allowTakeSelfie: true, allowUploadSelfie: true, enableGuestUploads: false, verifyPhone: false },
  ai: {
    faceRecognition: true, faceClustering: true, selfieSearch: true, automaticMatching: true,
    // 0-1 quality gate for a detected face: below it the face is stored but never matched.
    minFaceQuality: 0.35,
    // Cosine similarity cut-offs for ArcFace-style vectors. HIGH auto-matches, MEDIUM goes to the review queue, LOW is not shown.
    similarityHigh: 0.62, similarityMedium: 0.48,
    // Similarity at which two faces are the same person for clustering.
    clusterThreshold: 0.55,
    lowConfidenceHandling: "HIDE",
    mediumConfidenceHandling: "REVIEW",
  },
  media: {
    // Photos only, and only the compressed preview and thumbnail are ever stored: the AI Feature
    // takes no video and keeps no original. A row saved when it still offered both carries
    // `videoUpload` / `keepOriginals` / `compressionEnabled`; they are not keys here any more, so
    // `mergeGroup` drops them on read and nothing acts on them.
    photoUpload: true, allowedFormats: ["jpg", "jpeg", "png", "webp", "heic"], maxFileSizeMb: 60,
    // Compression (Event Default Settings → Media Upload; Visual Curation Settings → Processing /
    // Compression → AI Feature draws the same two keys). Always on: the server derives the
    // preview and thumbnail from whatever arrives, and a client that optimizes on the uploader's
    // machine (web worker, desktop) sends only those two. The preview is what the gallery shows
    // AND what the face engine reads, so the module starts on `high` - exactly the 2048 px JPEG
    // q84 the AI Feature has always derived - with a `standard` 480 px WebP thumbnail; the presets
    // themselves live in `services/imagePresets.js`, shared with every Virtual Curation module
    // and the desktop. The concurrency pair is the clients' alone (how many photos they compress
    // and send at once). `preserveMetadata` keeps only an allow-list - camera, lens, capture
    // times - never GPS (derivatives.keptExif). Changing any of these touches future uploads
    // only - nothing stored is ever recompressed. A row written before the presets existed
    // carried `previewMaxDimension` and `thumbnailSize` instead; `mergeGroup` reads those into the
    // nearest preset.
    previewPreset: COMPRESSION_MODULES.aiFeature.previewPreset, thumbnailPreset: COMPRESSION_MODULES.aiFeature.thumbnailPreset, thumbnailFormat: "webp",
    uploadConcurrency: 4, compressionConcurrency: 3, preserveMetadata: false,
  },
  // `watermarkOnView` draws the watermark on what guests look at (gallery tiles, the viewer);
  // `watermarkOnDownload` on what they save. Each on its own; both use `watermarkPresetId`, the
  // Watermark Preset to draw. On the defaults row that id is all there is. An event also carries
  // `watermarkSnapshot`, its own copy of the preset taken when it was chosen - written by the server
  // only (watermarks/service.snapshotFor), never accepted from a client. Either switch with no preset
  // draws nothing, as before presets. `watermark` is the single switch this replaced: a row that has
  // only it reads as both switches set to it (`translateLegacyGallery`), and it is always written as
  // "either is on" so an older client reading it still says the right thing.
  gallery: { allowDownloads: true, allowSharing: true, showAllPhotos: true, showMyPhotos: true, showPeople: false, watermark: false, watermarkOnView: false, watermarkOnDownload: false, watermarkPresetId: null, watermarkSnapshot: null },
  privacy: { guestPhotoVisibility: "MATCHED_ONLY", selfieRetentionDays: 90, faceDataRetentionDays: 365 },
  // `newPhoto`, `processingCompleted` and `newMatch` are the studio's own notifications (the settings
  // card says "for the studio"). `guestWhatsAppSummary` is something else: a WhatsApp message to each
  // guest who verified their number and asked for it, once a processing run settles
  // (notifications/service.js). Off by default, so no event - an existing one included, whose stored
  // group lacks the key - messages anyone until the studio turns it on; and it does nothing at all
  // unless the server's AI_FEATURE_WHATSAPP_ENABLED is "true".
  notifications: { newPhoto: false, processingCompleted: true, newMatch: true, guestWhatsAppSummary: false },
});

/** Extensions a format list may still carry from when the AI Feature took video. */
const VIDEO_FORMATS = new Set(["mp4", "mov", "webm", "m4v", "mkv", "avi"]);

const GROUPS = Object.keys(DEFAULTS);
const EVENT_GROUPS = GROUPS.filter((group) => group !== "general");

const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);

/**
 * A `media` group written before the presets existed named its recipe in numbers -
 * `previewMaxDimension`, `thumbnailSize` - rather than preset keys. Read as the nearest preset,
 * and only where the row names no preset of its own, so a record is never re-interpreted once it
 * has been saved with the keys the app now writes. The numbers themselves are not kept: they were
 * never the stored shape of any released record.
 */
function translateLegacyMedia(stored) {
  if (!isObject(stored)) return stored;
  const out = { ...stored };
  if (out.previewPreset == null && out.previewMaxDimension != null) out.previewPreset = previewPresetFromLegacy(out.previewMaxDimension) || undefined;
  if (out.thumbnailPreset == null && out.thumbnailSize != null) out.thumbnailPreset = thumbnailPresetFromLegacy(out.thumbnailSize) || undefined;
  // A format list saved while the AI Feature still took video names its containers; read without
  // them, since an upload of one is refused whatever the list says. The stored row is not rewritten.
  // A list that held nothing but video falls back to the photo defaults: an empty list would read
  // as "every photo type" at upload, which is wider than anything the event asked for.
  if (Array.isArray(out.allowedFormats) && out.allowedFormats.length) {
    const photos = out.allowedFormats.filter((format) => !VIDEO_FORMATS.has(String(format).toLowerCase()));
    out.allowedFormats = photos.length ? photos : [...DEFAULTS.media.allowedFormats];
  }
  return out;
}
/**
 * A `gallery` group saved before the watermark was split into view and download names neither
 * switch, only `watermark`; it is read as both switches set to it, so such an event draws exactly
 * what it drew before. A row naming either new switch is never re-read this way.
 */
function translateLegacyGallery(stored) {
  if (!isObject(stored)) return stored;
  if (stored.watermarkOnView != null || stored.watermarkOnDownload != null || stored.watermark == null) return stored;
  return { ...stored, watermarkOnView: Boolean(stored.watermark), watermarkOnDownload: Boolean(stored.watermark) };
}
const LEGACY_TRANSLATORS = { media: translateLegacyMedia, gallery: translateLegacyGallery };

/** One group's effective values: the code's defaults with the stored object's known keys over them. */
function mergeGroup(group, stored) {
  const base = DEFAULTS[group];
  if (!base) return {};
  const out = { ...base };
  const translated = LEGACY_TRANSLATORS[group] ? LEGACY_TRANSLATORS[group](stored) : stored;
  if (isObject(translated)) for (const key of Object.keys(base)) if (translated[key] !== undefined && translated[key] !== null) out[key] = translated[key];
  // The old single switch is derived, never set on its own: "is a watermark drawn anywhere".
  if (group === "gallery") out.watermark = Boolean(out.watermarkOnView || out.watermarkOnDownload);
  return out;
}

/** Every group, resolved from a row that may hold nulls (the defaults row) or full objects (an event's). */
function resolveAll(row, groups = GROUPS) {
  const out = {};
  for (const group of groups) out[group] = mergeGroup(group, row?.[group]);
  return out;
}

/** The copy a new event takes: every event group, resolved from the studio defaults, then the wizard's own overrides on top. */
function snapshotForEvent(defaultsRow, overrides = {}) {
  const out = {};
  for (const group of EVENT_GROUPS) out[group] = mergeGroup(group, { ...mergeGroup(group, defaultsRow?.[group]), ...(isObject(overrides[group]) ? overrides[group] : {}) });
  return out;
}

module.exports = { DEFAULTS, EVENT_TYPES, GROUPS, EVENT_GROUPS, mergeGroup, resolveAll, snapshotForEvent };
