/**
 * What an event is configured as when nobody has said otherwise: the code's own defaults, the
 * studio's saved defaults over them, and an event's own copy over both.
 *
 * Pure data and pure functions, so the panel, the wizard and the worker all read one definition
 * and the unit tests need no database.
 */
const EVENT_TYPES = ["Wedding", "Engagement", "Reception", "Corporate Event", "Birthday", "Baby Event", "Conference", "Other"];

const DEFAULTS = Object.freeze({
  general: { defaultEventType: "Wedding", defaultTimezone: "Asia/Kolkata", defaultDurationDays: 1, eventTypes: EVENT_TYPES },
  guestAccess: { allowRegistration: true, requireName: true, requirePhone: true, enableRsvp: true, enableSelfie: true, enableGuestUploads: false },
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
  media: { photoUpload: true, videoUpload: true, allowedFormats: ["jpg", "jpeg", "png", "webp", "heic", "mp4", "mov"], maxFileSizeMb: 60, keepOriginals: false },
  gallery: { allowDownloads: true, allowSharing: true, showAllPhotos: true, showMyPhotos: true, showPeople: false, watermark: false },
  privacy: { guestPhotoVisibility: "MATCHED_ONLY", selfieRetentionDays: 90, faceDataRetentionDays: 365 },
  notifications: { newPhoto: false, processingCompleted: true, newMatch: true },
});

const GROUPS = Object.keys(DEFAULTS);
const EVENT_GROUPS = GROUPS.filter((group) => group !== "general");

const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);

/** One group's effective values: the code's defaults with the stored object's known keys over them. */
function mergeGroup(group, stored) {
  const base = DEFAULTS[group];
  if (!base) return {};
  const out = { ...base };
  if (isObject(stored)) for (const key of Object.keys(base)) if (stored[key] !== undefined && stored[key] !== null) out[key] = stored[key];
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
