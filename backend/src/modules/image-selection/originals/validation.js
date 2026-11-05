const { z } = require("zod");

// A browser only ever names a location *relative* to the configured Original Storage Path, and even
// that is re-resolved against the root before it is opened. An absolute path, a drive letter or a
// `..` step is refused here so it never reaches the filesystem layer at all.
const relativePathSchema = z
  .string()
  .trim()
  .max(1024)
  .optional()
  .default("")
  .refine((value) => !/^[A-Za-z]:/.test(value) && !/^[/\\]/.test(value), { message: "Give a folder inside the Original Storage Path, not a full path." })
  .refine((value) => !value.split(/[/\\]+/).some((segment) => segment === "." || segment === ".."), { message: "A folder path cannot contain . or .. steps." });

// One file named the same way, but it has to name something: an empty string is a folder request,
// not a file. This is what a browser's `webkitRelativePath` gives for a picked folder — a trail
// beginning with the folder's own name, never an absolute location.
const relativeFilePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .refine((value) => !/^[A-Za-z]:/.test(value) && !/^[/\\]/.test(value), { message: "Give a path inside the Original Storage Path, not a full path." })
  .refine((value) => !value.split(/[/\\]+/).some((segment) => segment === "." || segment === ".."), { message: "A file path cannot contain . or .. steps." });

// One folder of photos at a time. The ceiling is a guard on the request body rather than a limit on
// a shoot: the upload UI sends a folder per batch, and a batch this size is already far beyond one.
const MAX_REGISTER_FILES = 5000;

const projectParamsSchema = z.object({ projectId: z.string().trim().min(1).max(191) });
const browseQuerySchema = z.object({ path: relativePathSchema });
const registerSchema = z.object({
  path: relativePathSchema,
  folderId: z.string().trim().min(1).max(191).nullish(),
  recursive: z.coerce.boolean().optional().default(false),
});
// What the existing upload control posts: the relative trail of every file the studio picked, and
// not one byte of any of them.
const registerFilesSchema = z.object({
  folderId: z.string().trim().min(1).max(191).nullish(),
  // The batch the upload dock is already tracking, so a registered photo reports its progress
  // through exactly the same counters a chunk-uploaded one did.
  batchId: z.string().trim().min(1).max(191).nullish(),
  files: z.array(relativeFilePathSchema).min(1).max(MAX_REGISTER_FILES),
});
const copySelectedSchema = z.object({ deliverableConfigId: z.string().trim().min(1).max(191).nullish() });

// What the desktop app posts after a scan: for each photo, the trail relative to a named storage
// root plus the metadata its own filesystem answered. The same path rules the browser trails
// obey; the size is required because it is the one number every later screen reports.
const registerBatchSchema = z.object({
  folderId: z.string().trim().min(1).max(191).nullish(),
  storageRootId: z.string().trim().min(1).max(191),
  files: z
    .array(z.object({
      relativePath: relativeFilePathSchema,
      fileName: z.string().trim().min(1).max(500).optional(),
      sizeBytes: z.coerce.number().int().min(0),
      width: z.coerce.number().int().positive().nullish(),
      height: z.coerce.number().int().positive().nullish(),
      capturedAt: z.string().datetime({ offset: true }).nullish(),
    }))
    .min(1)
    .max(MAX_REGISTER_FILES),
});

module.exports = { projectParamsSchema, browseQuerySchema, registerSchema, registerFilesSchema, registerBatchSchema, copySelectedSchema, relativePathSchema, relativeFilePathSchema, MAX_REGISTER_FILES };
