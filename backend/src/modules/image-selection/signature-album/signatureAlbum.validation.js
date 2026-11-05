const { z } = require("zod");
const { THEMES, COVER_STYLES, LAYOUT_STYLES, IMAGE_SPACINGS, BACKGROUNDS, COVER_ALIGNMENTS, ITEM_SOURCES, DISPLAY_MODES, TRANSFORM_LIMITS, LOGO_VARIANTS, HEADING_FONTS, BODY_FONTS, LIMITS } = require("./signatureAlbum.constants");

// How a photo sits in its frame. Every field may be null, which puts that value back to the
// default; sent together by Apply, one at a time by a preset.
const focal = z.number().int().min(TRANSFORM_LIMITS.MIN_FOCAL).max(TRANSFORM_LIMITS.MAX_FOCAL).nullable().optional();
const transformFields = {
  displayMode: z.enum(DISPLAY_MODES).nullable().optional(),
  focalX: focal,
  focalY: focal,
  zoom: z.number().min(TRANSFORM_LIMITS.MIN_ZOOM).max(TRANSFORM_LIMITS.MAX_ZOOM).nullable().optional(),
};

const id = z.string().trim().min(1).max(191);
const hexColor = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #1a1a1a.");
const optionalText = (max) => z.string().trim().max(max).nullish().transform((value) => (value == null ? "" : value));
// A day from the calendar ("2027-03-23") or an instant; a blank clears the date.
const optionalDate = z.union([z.string().trim(), z.null()]).optional().transform((value) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999+05:30` : value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid date.");
  return date;
});

const projectParamsSchema = z.object({ projectId: id });
const albumParamsSchema = z.object({ albumId: id });
// Photos sent into the album from another tab (AI Culling's review): by project photo id, or every
// photo a culling run decided one way (its Keeps unless another decision is named; `limit`, the
// first that many of them).
const importUploadsSchema = z.union([
  z.object({ imageIds: z.array(id).min(1).max(2000) }).strict(),
  // Ticked in a run's review: the run is named and must be finalized.
  z.object({ imageIds: z.array(id).min(1).max(2000), cullingSessionId: id }).strict(),
  z.object({ cullingSessionId: id, decision: z.enum(["KEEP", "MAYBE", "REJECT"]).optional().default("KEEP"), limit: z.coerce.number().int().min(1).max(2000).optional() }).strict(),
]);
const chapterParamsSchema = albumParamsSchema.extend({ chapterId: id });
const itemParamsSchema = albumParamsSchema.extend({ itemId: id });
const mediaParamsSchema = z.object({ projectId: id, imageId: id });
const photoParamsSchema = albumParamsSchema.extend({ photoId: id });

const albumUpdateSchema = z.object({
  title: z.string().trim().min(1).max(LIMITS.MAX_TITLE).optional(),
  subtitle: optionalText(LIMITS.MAX_SUBTITLE).optional(),
  eventDate: optionalDate,
  coverImageId: id.nullable().optional(),
  // A cover chosen from the album's own uploads - how every cover is chosen now.
  coverAlbumPhotoId: id.nullable().optional(),
  coverAlignment: z.enum(COVER_ALIGNMENTS).optional(),
  endingMessage: optionalText(LIMITS.MAX_ENDING).optional(),
  coverDisplayMode: transformFields.displayMode,
  coverFocalX: transformFields.focalX,
  coverFocalY: transformFields.focalY,
  coverZoom: transformFields.zoom,
}).strict();

const designSchema = z.object({
  theme: z.enum(THEMES).optional(),
  coverStyle: z.enum(COVER_STYLES).optional(),
  layoutStyle: z.enum(LAYOUT_STYLES).optional(),
  imageSpacing: z.enum(IMAGE_SPACINGS).optional(),
  coverAlignment: z.enum(COVER_ALIGNMENTS).optional(),
  backgroundColor: hexColor.nullable().optional(),
  textColor: hexColor.nullable().optional(),
  accentColor: hexColor.nullable().optional(),
  headingFont: z.enum(HEADING_FONTS).nullable().optional(),
  bodyFont: z.enum(BODY_FONTS).nullable().optional(),
  logoVariant: z.enum(LOGO_VARIANTS).optional(),
  // With `theme`: write that theme's five defaults over the album's own (the studio chose "Apply
  // Theme Defaults"); without it, or alone: put the current theme's defaults back (Reset).
  applyThemeDefaults: z.boolean().optional(),
}).strict();

const accessSchema = z.object({
  requirePin: z.boolean().optional(),
  expiresAt: optionalDate,
  allowDownload: z.boolean().optional(),
  allowShare: z.boolean().optional(),
}).strict();

const chapterSchema = z.object({
  name: z.string().trim().min(1).max(191),
  subtitle: optionalText(255).optional(),
  coverImageId: id.nullable().optional(),
  layoutStyle: z.enum(LAYOUT_STYLES).nullable().optional(),
  // Where the cover photo sits in the chapter's band - the album cover's four values, on the chapter.
  coverDisplayMode: transformFields.displayMode,
  coverFocalX: transformFields.focalX,
  coverFocalY: transformFields.focalY,
  coverZoom: transformFields.zoom,
});
const chapterUpdateSchema = chapterSchema.partial();
const reorderChaptersSchema = z.object({ chapterIds: z.array(id).min(1).max(LIMITS.MAX_CHAPTERS) });

const addItemsSchema = z.object({
  chapterId: id,
  source: z.enum(ITEM_SOURCES),
  folderId: id.optional(),
  includeSubfolders: z.boolean().optional(),
  imageIds: z.array(id).max(LIMITS.MAX_ITEMS_PER_REQUEST).optional(),
}).superRefine((value, ctx) => {
  if (value.source === "FOLDER" && !value.folderId) ctx.addIssue({ code: "custom", path: ["folderId"], message: "Choose a folder." });
  if (value.source === "MANUAL" && !(value.imageIds && value.imageIds.length)) ctx.addIssue({ code: "custom", path: ["imageIds"], message: "Choose at least one photo." });
});
// The album's own library, a page at a time.
const photosQuerySchema = z.object({
  search: z.string().trim().max(191).optional().default(""),
  order: z.enum(["asc", "desc"]).optional().default("desc"),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(60),
});
// One photo uploaded to the album: what the browser says about the original it kept, beside the two
// derivatives it built. Multipart fields arrive as text, so the numbers are coerced.
const photoUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().regex(/^image\/[a-z0-9.+-]+$/i, "Only images can be uploaded.").max(100),
  sizeBytes: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  width: z.coerce.number().int().min(1).max(100000),
  height: z.coerce.number().int().min(1).max(100000),
  // The project photo the desktop compressed this copy from (AI Culling -> Send Photos). Checked to
  // be the album's project's photo before anything is stored; never taken on trust.
  sourceUploadId: id.optional(),
});
// AI Culling -> Send Photos -> Signature Album from the desktop: which of a finalized run's photos
// still need the album's own copy.
const importPlanSchema = z.union([
  z.object({ cullingSessionId: id, decision: z.enum(["KEEP", "MAYBE", "REJECT"]).optional().default("KEEP"), limit: z.coerce.number().int().min(1).max(2000).optional() }).strict(),
  z.object({ cullingSessionId: id, uploadIds: z.array(id).min(1).max(2000) }).strict(),
]);
const removeItemsSchema = z.object({ itemIds: z.array(id).min(1).max(LIMITS.MAX_ITEMS_PER_REQUEST) });
// Select All's question, and the photos it then deletes.
const photoIdsQuerySchema = z.object({ search: z.string().trim().max(191).optional().default("") });
const removePhotosSchema = z.object({ photoIds: z.array(id).min(1).max(LIMITS.MAX_ITEMS_PER_REQUEST) });
const reorderItemsSchema = z.object({ chapterId: id, itemIds: z.array(id).min(1).max(LIMITS.MAX_ITEMS_PER_REQUEST) });
const itemUpdateSchema = z.object({ chapterId: id.optional(), isHighlight: z.boolean().optional(), ...transformFields }).strict();
const reorderHighlightsSchema = z.object({ itemIds: z.array(id).min(1).max(LIMITS.MAX_HIGHLIGHTS) });
const chapterItemsQuerySchema = z.object({ page: z.coerce.number().int().min(1).optional().default(1), pageSize: z.coerce.number().int().min(1).max(500).optional().default(200) });
const sourceImagesQuerySchema = z.object({
  albumId: id.optional(),
  folderId: id.optional(),
  selected: z.enum(["true", "false"]).optional().transform((value) => value === "true"),
  search: z.string().trim().max(191).optional().default(""),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(60),
});

// Settings: every field optional, so a section can be saved on its own; the controller keeps only
// the keys the request named.
// A web address the ending links to. Typed without its scheme - "instagram.com/studio" - it would
// have been read as a path of the album's own page, so https:// is put in front; anything with a
// space in it is refused rather than half-linked.
const linkUrl = z.string().trim().max(255).nullish().transform((value, ctx) => {
  if (!value) return null;
  if (/\s/.test(value)) { ctx.addIssue({ code: "custom", message: "Enter a web address without spaces." }); return z.NEVER; }
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
});

const settingsSchema = z.object({
  defaultTheme: z.enum(THEMES).optional(),
  defaultLayoutStyle: z.enum(LAYOUT_STYLES).optional(),
  defaultCoverStyle: z.enum(COVER_STYLES).optional(),
  defaultExpiryMonths: z.coerce.number().int().min(LIMITS.MIN_EXPIRY_MONTHS).max(LIMITS.MAX_EXPIRY_MONTHS).optional(),
  useGlobalLogo: z.boolean().optional(),
  showStudioName: z.boolean().optional(),
  showStudioLogo: z.boolean().optional(),
  showBrandingFooter: z.boolean().optional(),
  footerText: z.string().trim().max(255).nullish().transform((value) => (value ? value : null)),
  allowDownloadDefault: z.boolean().optional(),
  allowShareDefault: z.boolean().optional(),
  showImageNumbers: z.boolean().optional(),
  requirePin: z.boolean().optional(),
  pinLength: z.coerce.number().int().min(LIMITS.MIN_PIN_LENGTH).max(LIMITS.MAX_PIN_LENGTH).optional(),
  autoUnpublishAfterExpiry: z.boolean().optional(),
  defaultBackground: z.enum(BACKGROUNDS).optional(),
  imageSpacing: z.enum(IMAGE_SPACINGS).optional(),
  initialPhotosLoaded: z.coerce.number().int().min(LIMITS.MIN_BATCH).max(LIMITS.MAX_BATCH).optional(),
  lazyLoadBatch: z.coerce.number().int().min(LIMITS.MIN_BATCH).max(LIMITS.MAX_BATCH).optional(),
  preloadNextImages: z.boolean().optional(),
  defaultEndingMessage: z.string().trim().max(LIMITS.MAX_ENDING).nullish().transform((value) => (value ? value : null)),
  endingShowLogo: z.boolean().optional(),
  endingShowWebsite: z.boolean().optional(),
  endingShowInstagram: z.boolean().optional(),
  websiteUrl: linkUrl,
  instagramUrl: linkUrl,
});

// Public: the short code alone names an album; a PIN is digits only.
const publicTokenSchema = z.object({ token: z.string().trim().regex(/^[A-Za-z0-9]{4,8}$/) });
const publicChapterSchema = publicTokenSchema.extend({ chapterId: id });
const publicImageSchema = publicTokenSchema.extend({ imageId: id });
const verifySchema = z.object({ pin: z.string().trim().regex(/^\d{0,6}$/).optional().default("") });
const publicItemsQuerySchema = z.object({ offset: z.coerce.number().int().min(0).optional().default(0), limit: z.coerce.number().int().min(1).max(LIMITS.MAX_BATCH).optional() });
// The PDF's URL carries the download ticket the session was given; a JWT is three base64url parts.
const downloadTicketQuerySchema = z.object({ ticket: z.string().trim().regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/).max(2048) });

module.exports = {
  importUploadsSchema, importPlanSchema,
  projectParamsSchema, albumParamsSchema, chapterParamsSchema, itemParamsSchema, mediaParamsSchema,
  albumUpdateSchema, designSchema, accessSchema, chapterSchema, chapterUpdateSchema, reorderChaptersSchema,
  photoParamsSchema, photosQuerySchema, photoUploadSchema, photoIdsQuerySchema, removePhotosSchema,
  addItemsSchema, removeItemsSchema, reorderItemsSchema, itemUpdateSchema, reorderHighlightsSchema, chapterItemsQuerySchema, sourceImagesQuerySchema,
  settingsSchema,
  publicTokenSchema, publicChapterSchema, publicImageSchema, verifySchema, publicItemsQuerySchema, downloadTicketQuerySchema,
};
