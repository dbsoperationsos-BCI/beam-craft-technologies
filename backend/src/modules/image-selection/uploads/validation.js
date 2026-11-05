const { z } = require("zod");

const projectParamsSchema = z.object({ projectId: z.string().trim().min(1).max(191) });
const uploadParamsSchema = projectParamsSchema.extend({ uploadId: z.string().trim().min(1).max(191) });
const chunkParamsSchema = uploadParamsSchema.extend({ chunkIndex: z.coerce.number().int().min(0) });
const initiateUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(500),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/tiff", "image/heic", "image/heif"]),
  sizeBytes: z.coerce.number().int().positive().max(10 * 1024 * 1024 * 1024),
  folderId: z.string().trim().min(1).max(191).nullable().optional(),
  batchId: z.string().trim().min(1).max(191),
});

// What a browser reports about a photo it has prepared itself. Everything here is a claim about a
// file this server will never see, so none of it addresses anything on this machine: `relativePath`
// is a trail inside the folder the studio picked, and it is stored and handed back, never opened.
// An absolute location or a `..` step is refused all the same — a value that cannot be a relative
// trail is a sign something is wrong, not something to keep.
const derivativeSchema = z.object({
  fileName: z.string().trim().min(1).max(500),
  relativePath: z.string().trim().min(1).max(1024)
    .refine((value) => !/^[A-Za-z]:/.test(value) && !/^[/\\]/.test(value), { message: "A photo's path must be relative to the folder that was chosen." })
    .refine((value) => !value.split(/[/\\]+/).some((segment) => segment === "." || segment === ".."), { message: "A photo's path cannot contain . or .. steps." }),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/tiff", "image/heic", "image/heif"]),
  sizeBytes: z.coerce.number().int().positive().max(10 * 1024 * 1024 * 1024),
  width: z.coerce.number().int().positive().max(100_000),
  height: z.coerce.number().int().positive().max(100_000),
  imageFormat: z.string().trim().max(30).nullish().transform((value) => value || null),
  folderId: z.string().trim().min(1).max(191).nullish().transform((value) => value || null),
  batchId: z.string().trim().min(1).max(191).nullish().transform((value) => value || null),
  /*
   * This photo is a corrected version of one the album already holds, not a new one.
   *
   * Off by default, which is what a first import and a gallery want: re-picking a folder to add
   * the few new frames in it must not register everything in it a second time. A revision is the
   * opposite — the file has the same name and path precisely because it is the same spread, done
   * again — and treating it as a duplicate threw the corrected pixels away in silence.
   */
  replaceExisting: z.coerce.boolean().optional().default(false),
});

module.exports = { projectParamsSchema, uploadParamsSchema, chunkParamsSchema, initiateUploadSchema, derivativeSchema };
