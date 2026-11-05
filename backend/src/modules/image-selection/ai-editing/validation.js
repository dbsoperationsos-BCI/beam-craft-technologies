const { z } = require("zod");
const { LOCAL_SOURCE_CODES } = require("../ai-culling/constants");

const id = z.string().trim().min(1).max(191);
const projectParamsSchema = z.object({ projectId: id });
const photoParamsSchema = projectParamsSchema.extend({ uploadId: id });

const listQuerySchema = z.object({
  folderId: id.nullish().transform((value) => value || null),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(60),
  search: z.string().trim().max(191).optional().default(""),
  sort: z.enum(["createdAt", "capturedAt", "fileName"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

// Photo ids sent in from another tab, or sent on from this one. Checked against the project by the
// service; never trusted to be the caller's to touch.
const uploadIdsSchema = z.object({ uploadIds: z.array(id).min(1).max(2000) }).strict();
// AI Culling → AI Editing takes either the ticked photos or a whole decision of a run (its Keeps,
// unless another decision is named; `limit`, the first that many of them): the run must be this
// project's.
// Ticked photos from a run's review name that run (`cullingSessionId`), which must be finalized.
const addPhotosSchema = z.union([
  uploadIdsSchema,
  z.object({ uploadIds: z.array(id).min(1).max(2000), cullingSessionId: id }).strict(),
  // `albumSync`: AI Culling's "AI Editing + Signature Album" - each photo's saved edits go on to the album automatically.
  z.object({ cullingSessionId: id, decision: z.enum(["KEEP", "MAYBE", "REJECT"]).optional().default("KEEP"), limit: z.coerce.number().int().min(1).max(20000).optional(), albumSync: z.boolean().optional() }).strict(),
]);
// A send compresses each edited photo in the request, so one call takes a slice; the client sends
// a long selection in slices (SEND_MAX_PER_REQUEST in service.js).
const sendSchema = z.object({ uploadIds: z.array(id).min(1).max(100), force: z.boolean().optional().default(false) }).strict();

// The recipe arrives as whatever the client holds; `recipe.js` normalizes it, so only its shape is
// checked here (an object, not a string or an array).
const recipeSchema = z.object({ recipe: z.record(z.string(), z.unknown()).nullish() }).strict();
// Where a render may read from. "desktop" (the default) routes a photo whose original lives only
// on a workstation to the desktop app and never substitutes the preview on its own; "preview" is
// the caller's explicit choice to render from the 1600px web preview instead.
const renderSource = z.enum(["desktop", "preview"]).optional().default("desktop");
const renderSchema = recipeSchema.extend({ source: renderSource });
// One recipe onto many photos: the ticked ones, or every photo in the bay scope (`all` with the
// folder the tree stands on, or none for the whole project).
const batchApplySchema = z.object({
  recipe: z.record(z.string(), z.unknown()),
  uploadIds: z.array(id).min(1).max(2000).optional(),
  all: z.boolean().optional().default(false),
  folderId: id.nullish().transform((value) => value || null),
  source: renderSource,
}).strict().refine((value) => value.all || value.uploadIds?.length, { message: "Choose photos, or apply to all." });
// The desktop's drain of edits waiting for it: cursor-paged by edit id.
const pendingQuerySchema = z.object({
  cursor: id.nullish().transform((value) => value || null),
  take: z.coerce.number().int().min(1).max(200).default(100),
});
// What the desktop says when it could not render an edit from the original: one of the three
// local-source states (ai-culling/constants.js) and, optionally, a short detail for the log.
// `fromStatus` is the web-render drain's guard: the report then lands only on an edit still
// WAITING_FOR_DESKTOP, so a stale one cannot flip an edit the web rendered from the preview since.
const localSourceSchema = z.object({
  state: z.enum(LOCAL_SOURCE_CODES),
  detail: z.string().trim().max(200).optional(),
  fromStatus: z.literal("WAITING_FOR_DESKTOP").optional(),
}).strict();

// What the desktop says about an edit it rendered itself, beside the master it uploads: the recipe
// it applied, the engine's own answer (`appliedRecipe`: the numbers the auto tools chose, the
// analysis, the notes) and the engine's version. Normalized by the service; only the shape here.
const outputPayloadSchema = z.object({
  recipe: z.record(z.string(), z.unknown()).nullish(),
  appliedRecipe: z.record(z.string(), z.unknown()).nullish(),
  engineVersion: z.string().trim().min(1).max(60),
}).strict();

// Download Edited: the photos asked for (ticked, or the one open); the server keeps only those
// with a saved edit. The archive takes the ticket the plan answered with, from a form or JSON.
const downloadPlanSchema = z.object({ uploadIds: z.array(id).min(1).max(2000) }).strict();
const downloadArchiveSchema = z.object({ ticket: z.string().min(20).max(200000) });

// Retry the automatic album sync: the project's enrolled photos not in the album yet, or those named.
const albumSyncRetrySchema = z.object({ uploadIds: z.array(id).min(1).max(2000).optional() }).strict();

module.exports = { albumSyncRetrySchema, downloadPlanSchema, downloadArchiveSchema, projectParamsSchema, photoParamsSchema, listQuerySchema, uploadIdsSchema, addPhotosSchema, sendSchema, recipeSchema, renderSchema, batchApplySchema, pendingQuerySchema, localSourceSchema, outputPayloadSchema };
