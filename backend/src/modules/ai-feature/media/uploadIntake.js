const { z } = require("zod");

/**
 * What a client may say about the photo it uploads, beyond the bytes themselves.
 *
 * The web Upload Manager and the Virtual Curation desktop optimize a photo before sending it -
 * the server's own 2048 px preview recipe, made on the uploader's machine - so the bytes that
 * arrive are not the bytes on the photographer's disk. These optional fields carry what the server
 * can no longer see for itself: the source's fingerprint (SHA-256 of the original file, which is
 * what `contentHash` has always held for uploads that arrived whole), its size and name, where it
 * sat in the picked folder, whether the bytes are already the preview, and when the photo was
 * taken. Every field is optional: an older client that sends only `file` is answered exactly as
 * before.
 */
const FINGERPRINT = /^[a-f0-9]{64}$/;

const uploadFieldsSchema = z.object({
  folderId: z.string().trim().min(1).max(191).optional(),
  // "true" from the Virtual Curation desktop: it will describe this photo's faces itself. Read
  // through desktop/flags.deferralRequested, which decides whether it means anything here.
  deferAi: z.string().trim().max(10).optional(),
  sourceFingerprint: z.string().trim().toLowerCase().regex(FINGERPRINT, "sourceFingerprint must be a SHA-256 hex digest.").optional(),
  // An empty field is "not sent", never zero: `coerce` alone would read "" as 0 and open the optimized branch.
  sourceSizeBytes: z.preprocess((value) => (value === "" || value === undefined || value === null ? undefined : value), z.coerce.number().int().nonnegative().max(1024 * 1024 * 1024 * 1024).optional()),
  sourceFileName: z.string().trim().min(1).max(500).optional(),
  relativePath: z.string().trim().min(1).max(1024)
    .refine((value) => !/^[A-Za-z]:/.test(value) && !/^[/\\]/.test(value), { message: "A photo's path must be relative to the folder that was chosen." })
    .refine((value) => !value.split(/[/\\]+/).some((segment) => segment === "." || segment === ".."), { message: "A photo's path cannot contain . or .. steps." })
    .optional(),
  clientOptimized: z.string().trim().max(10).optional(),
  // When the photo was taken, read off the original's EXIF by the client before it re-encoded the
  // frame (a canvas keeps no EXIF). The server reads it from the file itself whenever it can.
  sourceCapturedAt: z.string().trim().datetime({ offset: true }).optional(),
});

// A capture time the client read off a photo, believed only inside a sane window (shared helper).
const { saneCaptureDate } = require("../../../services/captureDate");

/** The last segment of whatever the client called the file: a name is stored, never a path. */
const baseName = (text) => String(text || "").replace(/\\/g, "/").split("/").filter(Boolean).pop() || null;

/**
 * The source description the service works with, or null when the client said nothing about the
 * source - the "upload the whole file" contract every existing client uses.
 */
function sourceOf(fields = {}) {
  const present = ["sourceFingerprint", "sourceSizeBytes", "sourceFileName", "relativePath", "clientOptimized", "sourceCapturedAt"].some((name) => fields[name] !== undefined && fields[name] !== "");
  if (!present) return null;
  return {
    fingerprint: fields.sourceFingerprint || null,
    sizeBytes: Number.isFinite(fields.sourceSizeBytes) ? fields.sourceSizeBytes : null,
    fileName: baseName(fields.sourceFileName),
    relativePath: fields.relativePath ? fields.relativePath.replace(/\\/g, "/") : null,
    optimized: String(fields.clientOptimized || "").trim().toLowerCase() === "true",
    capturedAt: saneCaptureDate(fields.sourceCapturedAt),
  };
}

module.exports = { uploadFieldsSchema, sourceOf, saneCaptureDate, FINGERPRINT };
