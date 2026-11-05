const { z } = require("zod");
const { EMBEDDING_DIMENSION } = require("./flags");

/**
 * The shape of a face hand-off from the desktop, shared by Image Selection's and the AI Feature's
 * ingest routes so the two can never drift apart: which photo, which model produced the
 * descriptors, the frame they were measured on, and one entry per face - its box as fractions of
 * that frame, the detector's confidence, the 0-1 quality score, and the embedding itself.
 *
 * Strict everywhere: an unknown key is refused rather than ignored, so a desktop build that
 * starts sending something new is noticed at once instead of silently dropped.
 */
const MAX_FACES = 100;
/** A face thumbnail is a 160x160 WebP; 64 KB base64 is more than twice what one weighs. */
const MAX_THUMBNAIL_BASE64 = 64 * 1024;

const fraction = z.number().min(0).max(1);
// A box is inside the frame: each edge a fraction, and the far edges no further than the frame's own.
const boxSchema = z.object({ x: fraction, y: fraction, w: fraction, h: fraction }).strict()
  .refine((box) => box.x + box.w <= 1.0001 && box.y + box.h <= 1.0001, { message: "A face box must lie inside the frame." });
// Exactly the server model's width: a wrong-sized vector is refused at the edge, before a hundred
// of them are parsed and allocated only to be turned away by `assertCompatible`.
const embeddingSchema = z.array(z.number().finite()).length(EMBEDDING_DIMENSION);

const faceSchema = z.object({
  box: boxSchema,
  detScore: fraction,
  quality: fraction,
  embedding: embeddingSchema,
}).strict();

const thumbnailSchema = z.string().max(MAX_THUMBNAIL_BASE64).regex(/^[A-Za-z0-9+/]+={0,2}$/, "Not base64.");

const frameSchema = z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict();

/** The body both routes share. `face` lets a route add per-face fields (the AI Feature's optional thumbnail). */
const descriptorBody = ({ face = faceSchema, extra = {} } = {}) => z.object({
  model: z.string().trim().min(1).max(60),
  dimension: z.number().int().positive(),
  frame: frameSchema,
  faces: z.array(face).max(MAX_FACES),
  ...extra,
}).strict();

/** Image Selection: the photo is named in the body, the project in the URL. */
const imageSelectionIngestSchema = descriptorBody({ extra: { imageId: z.string().trim().min(1).max(191) } });

/** AI Feature: the media is in the URL; each face may carry its own private crop. */
const aiFeatureIngestSchema = descriptorBody({ face: faceSchema.extend({ thumbnail: thumbnailSchema.optional() }) });

const httpError = (status, message) => Object.assign(new Error(message), { status });

/**
 * Descriptors are only comparable with the server's own when they come from the same model at the
 * same width: a different model is a different vector space, and a mixed table would match
 * strangers. Model mismatch is a 409 (the server and the desktop disagree; update one of them),
 * a wrong width a 400 (the body is malformed for this server).
 */
function assertCompatible(body, { model, dimension = EMBEDDING_DIMENSION }) {
  if (body.model !== model) throw httpError(409, `This server's face engine is '${model}', so face descriptors from '${body.model}' cannot be used. Update the desktop app's face engine to match.`);
  if (body.dimension !== dimension) throw httpError(400, `Face descriptors must be ${dimension}-dimensional for '${model}'; the body says ${body.dimension}.`);
  const odd = body.faces.findIndex((face) => face.embedding.length !== dimension);
  if (odd !== -1) throw httpError(400, `Face ${odd + 1} carries ${body.faces[odd].embedding.length} values; every embedding must carry ${dimension}.`);
}

/** Boxes rounded the way the server rounds its own (`faces/processing.toFractions`), so a desktop box and a server box read alike. */
const roundBox = ({ x, y, w, h }) => { const round = (value) => Math.round(value * 10000) / 10000; return { x: round(x), y: round(y), w: round(w), h: round(h) }; };

module.exports = { MAX_FACES, MAX_THUMBNAIL_BASE64, imageSelectionIngestSchema, aiFeatureIngestSchema, assertCompatible, roundBox };
