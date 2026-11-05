/**
 * Pure helpers behind the AI Feature's Event Default Settings workspace: which section owns which
 * stored group and key, what the server is sent, whether anything has changed, how a chip list is
 * edited, and which switches make which other settings inert. `.mjs` so `node --test` can import it
 * without the bundler.
 *
 * The stored shape is the server's: one object per group, keys as `settingsDefaults.js` names them.
 * Nothing here renames or reshapes a value - the sections only decide where each one is drawn.
 */
export const GROUPS = ["general", "guestAccess", "ai", "media", "gallery", "privacy", "notifications"];

/**
 * The rail, in order. `keys` is every stored setting the section draws, by group, and is what the
 * drift test checks against the server's defaults: a key the server knows and no section lists
 * would be a setting nobody could configure any more.
 */
export const SECTIONS = [
  { id: "general", title: "General", keys: { general: ["defaultEventType", "defaultTimezone", "defaultDurationDays", "eventTypes"] } },
  { id: "guestAccess", title: "Guest Access", keys: { guestAccess: ["allowRegistration", "requireName", "requirePhone", "verifyPhone", "enableSelfie", "allowTakeSelfie", "allowUploadSelfie", "enableGuestUploads", "enableRsvp"] } },
  { id: "ai", title: "AI & Face Recognition", keys: { ai: ["faceRecognition", "faceClustering", "selfieSearch", "automaticMatching"] } },
  { id: "matching", title: "Face Matching", keys: { ai: ["mediumConfidenceHandling", "lowConfidenceHandling", "minFaceQuality", "similarityHigh", "similarityMedium", "clusterThreshold"] } },
  { id: "processing", title: "Processing", keys: { media: ["photoUpload", "maxFileSizeMb", "allowedFormats"], notifications: ["guestWhatsAppSummary"] } },
  { id: "mediaUpload", title: "Media Upload", keys: { media: ["previewPreset", "thumbnailPreset", "thumbnailFormat", "uploadConcurrency", "compressionConcurrency", "preserveMetadata"] } },
  { id: "privacy", title: "Privacy & Access", keys: { privacy: ["guestPhotoVisibility", "selfieRetentionDays", "faceDataRetentionDays"], gallery: ["showMyPhotos", "allowDownloads", "allowSharing", "watermarkOnView", "watermarkOnDownload", "watermarkPresetId"] } },
];

/** Every `group.key` the sections draw, flattened - for the drift test. */
/**
 * Stored keys no section draws on purpose, because the server alone writes them: an event's copy of
 * its watermark preset (`watermarks/service.snapshotFor`), and the old single `watermark` switch, which
 * the server keeps as "view or download is on". A client sending either has it ignored.
 */
export const SERVER_WRITTEN_KEYS = Object.freeze(["gallery.watermarkSnapshot", "gallery.watermark"]);

/**
 * Stored keys that are no longer settings. Show All Photos and Show People to guests: a guest sees
 * only the photos their own selfie matched, whatever an older event stored, so no section draws them
 * and the server reads neither (`public/service.js`). New photo, Processing completed and the studio's
 * New match: notifications nothing ever sent - the one notification left is the guest's WhatsApp
 * match message (`notifications.guestWhatsAppSummary`, shown as New match notification).
 */
export const RETIRED_KEYS = Object.freeze(["gallery.showAllPhotos", "gallery.showPeople", "notifications.newPhoto", "notifications.processingCompleted", "notifications.newMatch"]);

export function keysDrawn(sections = SECTIONS) {
  const out = [];
  for (const section of sections) for (const [group, keys] of Object.entries(section.keys)) for (const key of keys) out.push(`${group}.${key}`);
  return out;
}

/** The record as the panel holds it: every group present, each a copy of what the server sent. */
export function formState(data) {
  return Object.fromEntries(GROUPS.map((group) => [group, { ...(data?.[group] || {}) }]));
}

/**
 * The groups as the server takes them: a number field left empty is not sent, so the stored value
 * survives, exactly as the previous panel did. Unknown groups are not sent either - the schema is
 * strict about the top level.
 */
export function payloadOf(values) {
  const out = {};
  for (const group of GROUPS) {
    if (!values?.[group]) continue;
    out[group] = Object.fromEntries(Object.entries(values[group]).filter(([, value]) => value !== "" && value !== undefined));
  }
  return out;
}

const isObject = (value) => value !== null && typeof value === "object";

/** Structural equality over plain JSON - what a saved snapshot and an edited copy are made of. */
export function sameValue(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => sameValue(item, b[index]));
  }
  if (isObject(a) && isObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) if (!sameValue(a[key], b[key])) return false;
    return true;
  }
  return false;
}

/**
 * Whether Save has anything to send: the edited copy differs from what was last read or saved.
 * Compared on what would be *sent*, so typing a value and deleting it again leaves the button off.
 */
export function hasChanges(saved, current) {
  if (!saved || !current) return false;
  return !sameValue(payloadOf(saved), payloadOf(current));
}

/**
 * Adds one typed entry to a chip list. Returns the next list and, when the entry is refused, why -
 * the list is returned unchanged in that case. `normalize` shapes the text the way the server will
 * (formats are lower-cased); a duplicate is refused rather than doubled.
 */
export function addListEntry(list, raw, { max = 40, maxLength = 60, normalize = (text) => text } = {}) {
  const current = Array.isArray(list) ? list : [];
  const text = normalize(String(raw ?? "").trim());
  if (!text) return { list: current, error: "" };
  if (text.length > maxLength) return { list: current, error: `Keep it under ${maxLength} characters.` };
  if (current.some((item) => item.toLowerCase() === text.toLowerCase())) return { list: current, error: `"${text}" is already listed.` };
  if (current.length >= max) return { list: current, error: `Up to ${max} entries.` };
  return { list: [...current, text], error: "" };
}

/** Takes one entry off a chip list, never below `min` entries. */
export function removeListEntry(list, item, { min = 0 } = {}) {
  const current = Array.isArray(list) ? list : [];
  if (current.length <= min) return current;
  return current.filter((entry) => entry !== item);
}

/**
 * Which settings the AI switches make inert, read off the values the way the worker reads them:
 *
 * - Face recognition off: processing skips every photo (`processing/service.js`), so clustering,
 *   selfie search, automatic matching and every threshold do nothing.
 * - Clustering off: `clusterThreshold` is read by clustering alone (`people/clustering.js`).
 * - Selfie search is offered to a guest only with face recognition, selfie search *and* Guest
 *   Access → Enable guest selfie all on (`public/service.js`).
 *
 * Nothing here changes a stored value; the screen dims what is inert and keeps it as it was.
 */
export function aiDependencies(values) {
  const ai = values?.ai || {};
  const guestAccess = values?.guestAccess || {};
  const faceOn = Boolean(ai.faceRecognition);
  return {
    faceOn,
    clusteringOn: faceOn && Boolean(ai.faceClustering),
    matchingOn: faceOn && Boolean(ai.automaticMatching),
    selfieSearchOn: faceOn && Boolean(ai.selfieSearch),
    selfieSearchUsable: faceOn && Boolean(ai.selfieSearch) && Boolean(guestAccess.enableSelfie),
  };
}

/**
 * The one cross-field rule the server enforces on the thresholds, asked before the save so the
 * field itself can say so: the high-confidence cut-off is at or above the medium one.
 */
export function matchingProblems(ai) {
  const problems = {};
  const high = ai?.similarityHigh; const medium = ai?.similarityMedium;
  if (typeof high === "number" && typeof medium === "number" && high < medium) problems.similarityHigh = "Must be at or above the medium-confidence similarity.";
  return problems;
}

/**
 * The one rule on Guest Access the server enforces, asked before the save: Find My Photos with
 * both ways of handing over a selfie turned off is a dead card, so while the guest selfie is on
 * at least one of Take Selfie and Upload Selfie must be too.
 */
export function guestAccessProblems(guestAccess) {
  const problems = {};
  if (guestAccess?.enableSelfie && guestAccess.allowTakeSelfie === false && guestAccess.allowUploadSelfie === false) problems.allowTakeSelfie = "Enable at least one selfie option: Take Selfie or Upload Selfie.";
  return problems;
}

/**
 * The two watermark switches of a gallery group: `{ view, download }`. A group that names neither -
 * one saved when the watermark was a single switch - reads as both set to the old `watermark`, as
 * the server reads it.
 */
export function watermarkSwitches(gallery) {
  const legacy = gallery?.watermarkOnView == null && gallery?.watermarkOnDownload == null;
  return {
    view: legacy ? Boolean(gallery?.watermark) : Boolean(gallery?.watermarkOnView),
    download: legacy ? Boolean(gallery?.watermark) : Boolean(gallery?.watermarkOnDownload),
  };
}

/** A watermark switched on with no preset to draw would draw nothing; it is refused before Save. */
export function watermarkProblems(gallery) {
  const { view, download } = watermarkSwitches(gallery);
  return (view || download) && !gallery?.watermarkPresetId ? { watermarkPresetId: "Choose a watermark preset, or turn the watermark off." } : {};
}

/** Every client-side rule, by section, so the panel can refuse Save and each section can say why. */
export function settingsProblems(values) {
  // The watermark is drawn in the panel's Privacy & Access section, so its rule is filed there.
  return { matching: matchingProblems(values?.ai), guestAccess: guestAccessProblems(values?.guestAccess), privacy: watermarkProblems(values?.gallery) };
}

/**
 * The rules an event's own form can show a field for - Create Event and the event's Settings. The
 * thresholds are not drawn there (they come from the studio defaults, validated when those are
 * saved), so their rule is not asked: a Create refused for a field nobody can see is a dead end.
 */
export function eventFormProblems(values) {
  return { guestAccess: guestAccessProblems(values?.guestAccess), gallery: watermarkProblems(values?.gallery) };
}

/** Whether any rule in `settingsProblems` is broken. */
export function hasProblems(problems) {
  return Object.values(problems || {}).some((section) => Object.keys(section || {}).length > 0);
}

/** The first broken rule's sentence, for a surface with one line to say it in; "" when none. */
export function firstProblem(problems) {
  for (const section of Object.values(problems || {})) for (const message of Object.values(section || {})) if (message) return message;
  return "";
}

/** Which wizard step a broken rule belongs to, so a refused Create can land on it. */
export const PROBLEM_STEPS = Object.freeze({ guestAccess: "guests", gallery: "settings" });

/** The three handling answers, as the matcher reads them. */
export const HANDLING_OPTIONS = [
  { label: "Match automatically", value: "AUTO" },
  { label: "Send to the review queue", value: "REVIEW" },
  { label: "Do not show", value: "HIDE" },
];

export const VISIBILITY_OPTIONS = [
  { label: "Every photo in the event", value: "ALL" },
  { label: "Only the photos they are in", value: "MATCHED_ONLY" },
];

/**
 * The visibility a settings form shows. "Their group's sub-events" (`SUB_EVENT`) went with sub
 * events; a value still saved as it shows as "Only the photos they are in" - what every guest now
 * sees, since the guest page lists only a guest's own matches - and becomes that the next time the
 * settings are saved.
 */
export const shownVisibility = (value) => (value === "SUB_EVENT" ? "MATCHED_ONLY" : value || "");
