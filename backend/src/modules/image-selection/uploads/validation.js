const { z } = require("zod");

const projectParamsSchema = z.object({ projectId: z.string().trim().min(1).max(191) });
const uploadParamsSchema = projectParamsSchema.extend({ uploadId: z.string().trim().min(1).max(191) });

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
  // BLAKE3 of the ORIGINAL's bytes, lowercase hex, computed by the desktop app when it read the
  // file to build these derivatives. Stored as the photo's identity: the workstation verifies the
  // file against it before any local analysis or edit. Optional - a browser never has it, and an
  // older desktop does not send it.
  checksum: z.string().regex(/^[0-9a-f]{64}$/).optional(),
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
  // When the photo was taken, read off its EXIF by the browser before it re-encoded the frame (a
  // canvas keeps no EXIF). Believed only inside a sane window (services/captureDate.js); a date
  // outside it, or none, leaves the photo without one - never a refusal.
  capturedAt: z.string().trim().max(40).nullish().transform((value) => value || null),
  /*
   * "true" from the Virtual Curation desktop: it will describe this photo's faces itself and hand
   * them over, so the server must not queue its own scan. Kept as the string it arrived as -
   * `desktop/flags.deferralRequested` decides whether it means anything on this server, and with
   * the desktop switches off it means nothing, as if it had not been sent.
   */
  deferFaceScan: z.string().trim().max(10).optional(),
  // "true" when the photo was added through the AI Culling tab: held for culling before it reaches
  // Photo Selection (ImageSelectionUpload.cullingHoldAt). Anything else is Photo Selection's own.
  holdForCulling: z.enum(["true", "false"]).optional().transform((value) => value === "true"),
  // "true" when the photo was added through the AI Editing tab: in the editing bay before Photo
  // Selection (ImageSelectionUpload.editingHoldAt). Anything else is Photo Selection's own.
  holdForEditing: z.enum(["true", "false"]).optional().transform((value) => value === "true"),
});

module.exports = { projectParamsSchema, uploadParamsSchema, derivativeSchema };
