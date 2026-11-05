const { z } = require("zod");

const projectParamsSchema = z.object({ projectId: z.string().trim().min(1).max(191) });
const imageParamsSchema = projectParamsSchema.extend({ imageId: z.string().trim().min(1).max(191) });
const galleryQuerySchema = z.object({
  folderId: z.string().trim().min(1).max(191).nullable().optional(),
  search: z.string().trim().max(200).optional().default(""),
  format: z.enum(["all", "jpeg", "png", "webp", "tiff", "gif", "heif", "avif"]).optional().default("all"),
  sort: z.enum(["createdAt", "fileName", "sizeBytes", "capturedAt"]).optional().default("createdAt"),
  order: z.enum(["asc", "desc"]).optional().default("desc"),
  selected: z.enum(["all", "selected", "unselected"]).optional().default("all"),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(24),
});
const selectionBodySchema = z.object({ selected: z.boolean() });
// The download manifest can be scoped to one shoot folder; without a folderId it still covers the
// whole project, which is what galleries from before per-shoot downloads keep using.
const manifestQuerySchema = z.object({ folderId: z.string().trim().min(1).max(191).optional() });
// The selection state a finished Download Selected run saved: the `asOf` its manifest was read at.
// Optional, so a browser from before it was sent is still recorded - at the moment it reports.
// `folderId` is the folder the run downloaded, so only the items it covered are stamped; absent, the run was the whole project.
const downloadedBodySchema = z.object({ asOf: z.string().datetime({ offset: true }).optional(), folderId: z.string().trim().min(1).max(191).optional() }).optional().default({});

module.exports = { projectParamsSchema, imageParamsSchema, galleryQuerySchema, selectionBodySchema, manifestQuerySchema, downloadedBodySchema };

