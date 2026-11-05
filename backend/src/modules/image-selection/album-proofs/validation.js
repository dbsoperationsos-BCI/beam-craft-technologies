const { z } = require("zod");
const { ALBUM_STATES, VIEWER_MODES } = require("./constants");

const id = z.string().trim().min(1).max(191);
const albumIdSchema = z.object({ albumId: id });
const folderIdSchema = albumIdSchema.extend({ folderId: id });

// The revision limit as the form offers it: 1–4 rounds, or null for unlimited.
const revisionLimitSchema = z.union([z.literal(null), z.coerce.number().int().min(1).max(4)]).optional();

const createAlbumSchema = z.object({
  projectId: id,
  name: z.string().trim().min(1).max(191),
  albumType: z.string().trim().max(100).nullish().transform((value) => (value == null ? value : value || null)),
  viewerMode: z.enum(VIEWER_MODES).optional().default("SPREAD"),
  revisionLimit: revisionLimitSchema,
  proofExpiryDays: z.coerce.number().int().min(1).max(365).optional().default(30),
});
const editAlbumSchema = z.object({
  name: z.string().trim().min(1).max(191).optional(),
  albumType: z.string().trim().max(100).nullish().transform((value) => (value == null ? value : value || null)),
  viewerMode: z.enum(VIEWER_MODES).optional(),
  revisionLimit: revisionLimitSchema,
  proofExpiryDays: z.coerce.number().int().min(1).max(365).optional(),
});
const listAlbumsSchema = z.object({
  projectId: id.optional(),
  search: z.string().trim().max(500).optional().default(""),
  status: z.enum(ALBUM_STATES).optional(),
  archived: z.enum(["true", "false"]).optional().default("false"),
});

const folderNameSchema = z.object({ name: z.string().trim().min(1).max(191) });
const createFolderSchema = folderNameSchema.extend({ parentId: id.nullish() });

const listActivitySchema = z.object({ albumId: id.optional(), limit: z.coerce.number().int().min(1).max(200).optional().default(100) });

// A relative path under the Original Storage Path — the originals module re-resolves and
// re-checks it against the configured root; this only screens out garbage.
const relativePathSchema = z.string().trim().max(1024).optional().default("");
const browseOriginalsSchema = z.object({ path: relativePathSchema });
const importPagesSchema = z.object({
  folderId: id.nullish(),
  relativePath: relativePathSchema,
  recursive: z.boolean().optional().default(false),
});
// Pages that came through the upload dock: the rows already exist, so only the target folder
// is named — the album-level bookkeeping is what this request asks for.
const pagesUploadedSchema = z.object({ folderId: id.nullish() });

// ----- QC & corrections -----
const versionParamsSchema = albumIdSchema.extend({ versionId: id });
const correctionParamsSchema = albumIdSchema.extend({ correctionId: id });
// Pin coordinates normalized 0..1 — the one representation that stays put on every screen size.
const normalized = z.number().min(0).max(1);
const correctionRadius = z.number().min(0.005).max(0.5).nullish().transform((value) => value ?? null);

/*
 * A painted correction: strokes of normalized points, drawn on the spread itself.
 *
 * The caps are the ones `frontend/src/lib/proofPaint.mjs` trims a drawing to before it is sent —
 * `album-proof-paint.test.js` reads that file and fails if the two ever disagree. The browser
 * trimming is a courtesy; this is the guard, so a request that skips the browser is held to the
 * same limits. Colours are any hex: which six the toolbar offers is a matter of taste, not of
 * what may be stored.
 */
const PAINT_LIMITS = { strokes: 24, pointsPerStroke: 400, totalPoints: 3000 };
const paintPoint = z.tuple([normalized, normalized]);
const paintStroke = z.object({
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  points: z.array(paintPoint).min(1).max(PAINT_LIMITS.pointsPerStroke),
});
const correctionPath = z
  .array(paintStroke)
  .max(PAINT_LIMITS.strokes)
  .nullish()
  .transform((value) => (value && value.length ? value : null))
  .superRefine((value, ctx) => {
    if (!value) return;
    const total = value.reduce((count, stroke) => count + stroke.points.length, 0);
    if (total > PAINT_LIMITS.totalPoints)
      ctx.addIssue({ code: "custom", message: `A drawing may hold at most ${PAINT_LIMITS.totalPoints} points.` });
  });

const addCorrectionSchema = z.object({
  versionPageId: id,
  x: normalized,
  y: normalized,
  radius: correctionRadius,
  path: correctionPath,
  comment: z.string().trim().min(1).max(2000),
});
// Editing an unsent QC pin: the comment, or the spot — the same shape the client's edit takes.
const qcCorrectionEditSchema = z.object({
  comment: z.string().trim().min(1).max(2000).optional(),
  x: normalized.optional(),
  y: normalized.optional(),
  path: correctionPath.optional(),
});
const qcNoteSchema = z.object({ note: z.string().trim().max(2000).nullish().transform((value) => (value == null ? value : value || null)) });
const updateCorrectionSchema = z.object({
  status: z.enum(["IN_PROGRESS", "RESOLVED"]),
  resolutionNote: z.string().trim().max(2000).nullish().transform((value) => (value == null ? value : value || null)),
});
const reprocessSchema = z.object({ uploadIds: z.array(id).max(2000).optional() });
const resubmitSchema = z.object({ scope: z.enum(["FULL", "CHANGED_ONLY"]).optional().default("CHANGED_ONLY") });
const listCorrectionsSchema = z.object({
  versionId: id.optional(),
  source: z.enum(["QC", "CLIENT"]).optional(),
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "REOPENED"]).optional(),
});

// ----- public client API -----
/*
 * The last segment of a public proof URL: either the short code the links carry now, or the
 * 43-character token the links shared before it carry. One schema for both, because one link can
 * be reached by either spelling and the route cannot know in advance which it was sent.
 */
const tokenParamsSchema = z.object({ token: z.string().regex(/^([A-Za-z0-9]{4,8}|[A-Za-z0-9_-]{43})$/) });
const clientCorrectionParamsSchema = tokenParamsSchema.extend({ correctionId: id });
/*
 * Four digits, or the six a link issued before this change still carries.
 *
 * Narrowing it to four would have locked out every client already holding a six-digit PIN - links
 * that are out with people and cannot be edited - and leaving it at six would refuse every PIN
 * issued from now on. Both lengths are accepted until the old links have expired or been reissued;
 * nothing else about the gate changes, and the PIN is still checked against its hash.
 */
const pinBodySchema = z.object({ pin: z.string().regex(/^(\d{4}|\d{6})$/) });
const clientCorrectionSchema = z.object({
  versionPageId: id,
  x: normalized,
  y: normalized,
  radius: correctionRadius,
  path: correctionPath,
  comment: z.string().trim().min(1).max(2000),
});
const clientCorrectionEditSchema = z.object({
  comment: z.string().trim().min(1).max(2000).optional(),
  x: normalized.optional(),
  y: normalized.optional(),
  path: correctionPath.optional(),
});
const approveBodySchema = z.object({ confirmation: z.string().trim().max(500).optional() });
// Reopening an approved album is never silent: the reason is mandatory and lands in the audit.
const reopenSchema = z.object({ reason: z.string().trim().min(3).max(1000) });

/*
 * An expiry the studio types. It must be in the future - a date already past would revoke the link
 * by the back door - and no more than five years out, which is far past any real proofing job and
 * stops a mistyped year from making a link that never expires.
 */
const FIVE_YEARS_MS = 5 * 365 * 24 * 60 * 60 * 1000;
const expirySchema = z.object({
  expiresAt: z.coerce
    .date()
    .refine((value) => value.getTime() > Date.now(), { message: "Expiry must be in the future." })
    .refine((value) => value.getTime() <= Date.now() + FIVE_YEARS_MS, { message: "Expiry cannot be more than five years away." }),
});

module.exports = {
  albumIdSchema, folderIdSchema, expirySchema, createAlbumSchema, editAlbumSchema, listAlbumsSchema,
  folderNameSchema, createFolderSchema, listActivitySchema,
  browseOriginalsSchema, importPagesSchema, pagesUploadedSchema,
  versionParamsSchema, correctionParamsSchema, addCorrectionSchema, qcCorrectionEditSchema, qcNoteSchema,
  updateCorrectionSchema, reprocessSchema, resubmitSchema, listCorrectionsSchema,
  tokenParamsSchema, clientCorrectionParamsSchema, pinBodySchema, clientCorrectionSchema,
  clientCorrectionEditSchema, approveBodySchema, reopenSchema,
};
