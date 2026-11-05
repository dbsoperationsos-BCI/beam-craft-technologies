const { z } = require("zod");
const { PRESET_KEYS } = require("../../../services/imagePresets");

const bool = z.boolean();
const handling = z.enum(["AUTO", "REVIEW", "HIDE"]);

const general = z.object({
  defaultEventType: z.string().trim().min(1).max(60),
  defaultTimezone: z.string().trim().min(1).max(64),
  defaultDurationDays: z.number().int().min(1).max(30),
  eventTypes: z.array(z.string().trim().min(1).max(60)).min(1).max(40),
}).partial();

const guestAccess = z.object({ allowRegistration: bool, requireName: bool, requirePhone: bool, enableRsvp: bool, enableSelfie: bool, allowTakeSelfie: bool, allowUploadSelfie: bool, enableGuestUploads: bool, verifyPhone: bool }).partial()
  // Find My Photos with no way to hand over a selfie is a dead card, so a save that turns both ways
  // off while the selfie stays on is refused. Only judged when the save says enough to judge: a
  // patch naming neither way leaves the stored answer as it is.
  .refine((value) => !(value.enableSelfie !== false && value.allowTakeSelfie === false && value.allowUploadSelfie === false), { message: "Enable at least one selfie option: Take Selfie or Upload Selfie.", path: ["allowTakeSelfie"] });

const ai = z.object({
  faceRecognition: bool, faceClustering: bool, selfieSearch: bool, automaticMatching: bool,
  minFaceQuality: z.number().min(0).max(1),
  similarityHigh: z.number().min(0).max(1), similarityMedium: z.number().min(0).max(1), clusterThreshold: z.number().min(0).max(1),
  lowConfidenceHandling: handling, mediumConfidenceHandling: handling,
}).partial().refine((value) => value.similarityHigh === undefined || value.similarityMedium === undefined || value.similarityHigh >= value.similarityMedium, { message: "The high-confidence threshold must be at or above the medium one.", path: ["similarityHigh"] });

const media = z.object({
  // No `videoUpload`, `keepOriginals` or `compressionEnabled`: the AI Feature takes photos only,
  // keeps no original and always compresses. An older client still sending them has them stripped.
  photoUpload: bool, allowedFormats: z.array(z.string().trim().toLowerCase().min(1).max(10)).max(20), maxFileSizeMb: z.number().int().min(1).max(500),
  // Compression: the preview and thumbnail are each one of the shared presets (services/imagePresets),
  // never a free number, so the face engine always reads a frame at least 800 px on its long edge
  // and every module means the same thing by "High".
  previewPreset: z.enum(PRESET_KEYS), thumbnailPreset: z.enum(PRESET_KEYS), thumbnailFormat: z.enum(["webp", "jpeg"]),
  uploadConcurrency: z.number().int().min(1).max(8), compressionConcurrency: z.number().int().min(1).max(4), preserveMetadata: bool,
}).partial();
// `watermarkSnapshot` is not here on purpose: the server writes it, a client cannot. `watermarkRefresh`
// is a request, not a setting - "copy the preset again" - and is never stored. `watermark` is the old
// single switch: a client that still sends only it (an older desktop build) sets both new switches.
const gallery = z.object({ allowDownloads: bool, allowSharing: bool, showAllPhotos: bool, showMyPhotos: bool, showPeople: bool, watermark: bool, watermarkOnView: bool, watermarkOnDownload: bool, watermarkPresetId: z.string().trim().min(1).max(191).nullable(), watermarkRefresh: bool }).partial()
  .transform((value) => (value.watermark !== undefined && value.watermarkOnView === undefined && value.watermarkOnDownload === undefined ? { ...value, watermarkOnView: value.watermark, watermarkOnDownload: value.watermark } : value));
const privacy = z.object({ guestPhotoVisibility: z.enum(["ALL", "MATCHED_ONLY", "SUB_EVENT"]), selfieRetentionDays: z.number().int().min(1).max(3650), faceDataRetentionDays: z.number().int().min(1).max(3650) }).partial();
const notifications = z.object({ newPhoto: bool, processingCompleted: bool, newMatch: bool, guestWhatsAppSummary: bool }).partial();

const GROUP_SCHEMAS = { general, guestAccess, ai, media, gallery, privacy, notifications };

/** The defaults panel saves any subset of groups; each group any subset of its keys. */
const defaultsBodySchema = z.object(GROUP_SCHEMAS).partial().strict();
/** An event's own settings never carry `general`, which only shapes new events. */
const eventSettingsBodySchema = z.object({ guestAccess, ai, media, gallery, privacy, notifications }).partial().strict();

module.exports = { GROUP_SCHEMAS, defaultsBodySchema, eventSettingsBodySchema };
