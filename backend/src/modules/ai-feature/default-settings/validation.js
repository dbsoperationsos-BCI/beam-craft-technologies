const { z } = require("zod");

const bool = z.boolean();
const handling = z.enum(["AUTO", "REVIEW", "HIDE"]);

const general = z.object({
  defaultEventType: z.string().trim().min(1).max(60),
  defaultTimezone: z.string().trim().min(1).max(64),
  defaultDurationDays: z.number().int().min(1).max(30),
  eventTypes: z.array(z.string().trim().min(1).max(60)).min(1).max(40),
}).partial();

const guestAccess = z.object({ allowRegistration: bool, requireName: bool, requirePhone: bool, enableRsvp: bool, enableSelfie: bool, enableGuestUploads: bool }).partial();

const ai = z.object({
  faceRecognition: bool, faceClustering: bool, selfieSearch: bool, automaticMatching: bool,
  minFaceQuality: z.number().min(0).max(1),
  similarityHigh: z.number().min(0).max(1), similarityMedium: z.number().min(0).max(1), clusterThreshold: z.number().min(0).max(1),
  lowConfidenceHandling: handling, mediumConfidenceHandling: handling,
}).partial().refine((value) => value.similarityHigh === undefined || value.similarityMedium === undefined || value.similarityHigh >= value.similarityMedium, { message: "The high-confidence threshold must be at or above the medium one.", path: ["similarityHigh"] });

const media = z.object({ photoUpload: bool, videoUpload: bool, allowedFormats: z.array(z.string().trim().toLowerCase().min(1).max(10)).max(20), maxFileSizeMb: z.number().int().min(1).max(500), keepOriginals: bool }).partial();
const gallery = z.object({ allowDownloads: bool, allowSharing: bool, showAllPhotos: bool, showMyPhotos: bool, showPeople: bool, watermark: bool }).partial();
const privacy = z.object({ guestPhotoVisibility: z.enum(["ALL", "MATCHED_ONLY", "SUB_EVENT"]), selfieRetentionDays: z.number().int().min(1).max(3650), faceDataRetentionDays: z.number().int().min(1).max(3650) }).partial();
const notifications = z.object({ newPhoto: bool, processingCompleted: bool, newMatch: bool }).partial();

const GROUP_SCHEMAS = { general, guestAccess, ai, media, gallery, privacy, notifications };

/** The defaults panel saves any subset of groups; each group any subset of its keys. */
const defaultsBodySchema = z.object(GROUP_SCHEMAS).partial().strict();
/** An event's own settings never carry `general`, which only shapes new events. */
const eventSettingsBodySchema = z.object({ guestAccess, ai, media, gallery, privacy, notifications }).partial().strict();

module.exports = { GROUP_SCHEMAS, defaultsBodySchema, eventSettingsBodySchema };
