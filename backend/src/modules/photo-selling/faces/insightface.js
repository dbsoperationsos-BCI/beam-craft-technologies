const prisma = require("../../../config/db");
const engine = require("../../ai-feature/face-engine/engine");
const vectors = require("../../ai-feature/shared/vectors");

/**
 * The face engine (InsightFace SCRFD + ArcFace, run by this server - the AI Feature's own
 * `face-engine/`, the same process and model its selfie search uses).
 *
 * Indexing describes a photo's faces and keeps each usable face's unit vector in photo_sale_face.
 * A search describes the selfie, keeps its clearest face in memory only, and compares it with the
 * gallery's own faces - read in batches, so a large gallery is never loaded at once.
 */
const ENGINE = "insightface";
const MIN_INDEX_QUALITY = 0.3;
const MIN_SELFIE_QUALITY = 0.5;
const MIN_SELFIE_FACE_WIDTH = 0.12;
const BATCH = 2000;

const unavailable = () => Object.assign(new Error("Face engine unavailable"), { code: "FACE_ENGINE_UNAVAILABLE" });

async function indexPhoto(photo, previewBytes) {
  if (!(await engine.isReady())) throw unavailable();
  const described = await engine.describe(previewBytes);
  const faces = (described?.faces || []).filter((face) => Array.isArray(face.embedding) && face.embedding.length && face.quality >= MIN_INDEX_QUALITY);
  await prisma.$transaction([
    prisma.photoSaleFace.deleteMany({ where: { photoId: photo.id } }),
    ...faces.map((face) => prisma.photoSaleFace.create({ data: { galleryId: photo.galleryId, photoId: photo.id, engine: ENGINE, dimension: face.embedding.length, vector: vectors.encode(face.embedding), quality: face.quality } })),
  ]);
  return { faces: faces.length };
}

/**
 * The selfie's clearest face, checked: one face large and clear enough to be worth comparing.
 * Answers `{ query }`, or `{ problem }` in the guest's words.
 */
async function selfieFace(selfieBytes) {
  if (!(await engine.isReady())) throw unavailable();
  let described;
  try { described = await engine.describe(selfieBytes); } catch { return { problem: "We couldn't read that photo. Please try another selfie." }; }
  const faces = (described?.faces || []).filter((face) => Array.isArray(face.embedding) && face.embedding.length);
  if (!faces.length) return { problem: "We couldn't find a face. Take the selfie facing the camera, in good light, with nothing covering your face." };
  const best = faces.sort((a, b) => b.quality - a.quality)[0];
  if (best.quality < MIN_SELFIE_QUALITY) return { problem: "Your face isn't clear enough - try again in better light, holding the phone steady." };
  // The engine's box is [x1, y1, x2, y2] in pixels of a picture `width` wide.
  const faceWidth = Array.isArray(best.box) && described.width ? (Number(best.box[2]) - Number(best.box[0])) / Number(described.width) : null;
  if (faceWidth !== null && faceWidth < MIN_SELFIE_FACE_WIDTH) return { problem: "Your face is too small in the photo - hold the phone closer." };
  return { query: vectors.normalize(best.embedding) };
}

/** `[{ photoId, score }]` of this gallery's indexed faces at or above `threshold` - best face per photo. */
async function search(galleryId, selfieBytes, threshold) {
  const face = await selfieFace(selfieBytes);
  if (face.problem) return { problem: face.problem };
  const best = new Map();
  let cursor = null;
  for (;;) {
    const rows = await prisma.photoSaleFace.findMany({
      where: { galleryId, engine: ENGINE, photo: { available: true, removedAt: null, faceStatus: "DONE" } },
      select: { id: true, vector: true, dimension: true, photoId: true },
      orderBy: { id: "asc" }, take: BATCH, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const row of rows) {
      if (!row.vector || row.dimension !== face.query.length) continue;
      const score = vectors.similarity(face.query, vectors.decode(row.vector));
      if (score >= threshold && score > (best.get(row.photoId) || 0)) best.set(row.photoId, score);
    }
    if (rows.length < BATCH) break;
    cursor = rows[rows.length - 1].id;
  }
  // `face` is the selfie's unit vector - kept only for a guest who agreed (guests.rememberSelfie), never returned to a browser.
  return { matches: [...best.entries()].map(([photoId, score]) => ({ photoId, score: Math.round(score * 1000) / 1000 })), face: face.query };
}

module.exports = { ENGINE, MIN_INDEX_QUALITY, MIN_SELFIE_QUALITY, indexPhoto, search, selfieFace };
