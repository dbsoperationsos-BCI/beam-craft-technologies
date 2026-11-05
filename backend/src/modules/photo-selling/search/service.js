const sharp = require("sharp");
const prisma = require("../../../config/db");
const { httpError } = require("../../ai-feature/shared/http");
const config = require("../shared/config");
const faces = require("../faces/service");
const { thresholdFor } = require("../faces/thresholds");
const guests = require("../guests/service");

/**
 * How a guest finds their photos - the only way they can: a selfie, compared with the faces found
 * in this gallery's own photos (faces/service.js), by the same face engine the AI Feature runs. The
 * store never shows a gallery whole. What a guest may see, add to a cart or buy is exactly the photos
 * their own searches matched (`matchedPhotoIds`) - checked by every public route that names a photo.
 *
 * - Only a confident match counts: a face at or above the gallery's threshold (faces/thresholds.js).
 *   A low-confidence likeness is left out, never shown "just in case".
 * - A group photo counts when any face in it matches; a photo is listed once however many of its
 *   faces match.
 * - No match is an answer of its own ("No matching photos found"); the guest can still browse.
 * - A match is a likeness, not proof of who somebody is - the store says so.
 *
 * Privacy, as the store promises it:
 * - Nothing runs without the guest's explicit consent, recorded on the search.
 * - The selfie exists only while the request is open: matched, then dropped - never stored, logged or
 *   returned. For a registered guest (every guest who entered by the store's first screen) the face
 *   vector made from it and a small private thumbnail are kept as one of their up to ten selfies, until
 *   they remove it (guests/service.js); a session with no guest keeps nothing.
 * - Where the gallery sends WhatsApp photo-match messages, a guest leaves their name and number
 *   before searching (guests.register).
 * - A search keeps only which photos it matched, answers its own device only, and is gone after
 *   RESULT_TTL or when the guest deletes it.
 * - The selfie is re-encoded before any engine sees it, so its EXIF (location, device) never leaves.
 *
 * Against running up the engine's bill: a device has PER_SESSION_PER_DAY searches and a gallery
 * PER_GALLERY_PER_HOUR, each counted with the search reserved before the engine runs (so parallel
 * requests cannot all slip under the limit), and at most MAX_IN_FLIGHT searches run at once.
 * - Guests' selfies are never used to train anything.
 */
const STATUS = Object.freeze({ PENDING: "PENDING", COMPLETED: "COMPLETED", NO_MATCH: "NO_MATCH", FAILED: "FAILED" });
const RESULT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RESULTS = 1000;
const PER_SESSION_PER_DAY = 20;
const PER_GALLERY_PER_HOUR = 600;
const MAX_IN_FLIGHT = 4;
const PURGE_EVERY_MS = 10 * 60 * 1000;
let inFlight = 0;
let lastPurge = 0;
const MAX_SELFIE_PIXELS = 40_000_000;

/** JPEG, PNG, WebP or HEIC by the file's own first bytes, not by what the browser said it was. */
function looksLikeImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true;
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return true;
  return buffer.subarray(4, 8).toString("ascii") === "ftyp";
}

/**
 * Whether a guest can search this gallery now, and how far its photos are indexed - so a guest is
 * told when photos are still being prepared rather than shown a short list as if it were complete.
 */
async function availability(gallery) {
  if (gallery.selfieSearchEnabled === false) return { available: false, preparing: false, reason: "Photo search isn't open for this gallery." };
  if (!config.faceMatching({ start: false }).available) return { available: false, preparing: false, reason: "Photo search isn't available right now. Please check back soon." };
  const status = await faces.indexStatus(gallery.id);
  if (!status.done) return { available: false, preparing: status.pending > 0, reason: status.pending > 0 ? "Your photos are still being prepared. Please check back in a little while." : "There are no photos to search yet." };
  return { available: true, preparing: status.pending > 0, reason: null };
}

/**
 * One search: the selfie checked, matched against this gallery only, and the matched photo ids kept
 * for this device. Answers `{ id, status, matchCount, preparing }`.
 */
async function create(gallery, session, file, consent) {
  if (consent !== true) throw httpError(400, "Please agree to the face search before uploading a selfie.");
  if (!file || !/^image\//.test(file.mimetype || "") || !looksLikeImage(file.buffer)) throw httpError(400, "Please send a photo of your face.");
  let meta;
  try { meta = await sharp(file.buffer, { limitInputPixels: MAX_SELFIE_PIXELS }).metadata(); } catch { throw httpError(422, "We couldn't read that photo. Please try another selfie."); }
  if (!meta?.width || !meta?.height || meta.width * meta.height > MAX_SELFIE_PIXELS) throw httpError(422, "That photo is too large to search with. Please use a normal selfie.");
  if (Math.min(meta.width, meta.height) < 240) throw httpError(422, "That photo is too small - please use a clearer selfie.");
  const open = await availability(gallery);
  if (!open.available) throw httpError(503, open.reason);
  if (guests.offered(gallery) && !(await guests.current(gallery, session))) throw httpError(409, "Enter your name and WhatsApp number first.");
  if (Date.now() - lastPurge > PURGE_EVERY_MS) { lastPurge = Date.now(); purgeExpired().catch((error) => console.error("[photo-selling] search purge failed:", error.message)); }
  let selfie;
  try { selfie = await sharp(file.buffer, { limitInputPixels: MAX_SELFIE_PIXELS }).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer(); }
  catch { throw httpError(422, "We couldn't read that photo. Please try another selfie."); }

  const tooMany = await quotaReached(gallery, session);
  if (tooMany) throw httpError(429, tooMany);
  if (inFlight >= MAX_IN_FLIGHT) throw httpError(503, "Photo search is busy right now. Please try again in a moment.");
  // A registered guest's selfie slot, taken before the engine runs (ten at most), given back if nothing is kept.
  const owner = await guests.reserveSelfie(gallery, session);
  let kept = false;
  // Reserved before the engine runs, then counted again: parallel requests cannot all slip under a limit.
  const now = Date.now();
  try {
  const row = await prisma.photoSaleSelfieSearch.create({ data: { galleryId: gallery.id, sessionHash: session.sessionHash, status: STATUS.PENDING, consentAt: new Date(now), engine: faces.current().name, threshold: 0, matchCount: 0, expiresAt: new Date(now + RESULT_TTL_MS) } });
  const over = await quotaReached(gallery, session, 0);
  if (over) { await prisma.photoSaleSelfieSearch.delete({ where: { id: row.id } }).catch(() => {}); throw httpError(429, over); }

  inFlight += 1;
  let result;
  try { result = await faces.searchSelfie(gallery, selfie); }
  catch (error) {
    await prisma.photoSaleSelfieSearch.update({ where: { id: row.id }, data: { status: STATUS.FAILED } }).catch(() => {});
    if (error?.code === "FACE_ENGINE_UNAVAILABLE") throw httpError(503, "Photo search is busy right now. Please try again in a moment.");
    console.error("[photo-selling] selfie search failed:", error?.message);
    throw httpError(502, "Your search couldn't be completed. Please try again.");
  } finally {
    inFlight -= 1;
  }
  // The selfie's bytes go no further than this point: nothing below holds or stores them.
  if (result.problem) {
    await prisma.photoSaleSelfieSearch.update({ where: { id: row.id }, data: { status: STATUS.FAILED } }).catch(() => {});
    throw httpError(422, result.problem);
  }
  const matches = result.matches.slice(0, MAX_RESULTS);
  const saved = await prisma.photoSaleSelfieSearch.update({
    where: { id: row.id },
    data: { status: matches.length ? STATUS.COMPLETED : STATUS.NO_MATCH, engine: result.engine, threshold: result.threshold, matchCount: matches.length, matches, completedAt: new Date() },
  });
  // A registered guest: this selfie kept as one of theirs (its face and thumbnail), these matches theirs.
  let selfieId = null;
  if (owner) {
    const thumbnail = await sharp(selfie).resize({ width: 240, height: 240, fit: "cover" }).webp({ quality: 70 }).toBuffer().catch(() => null);
    selfieId = await guests.keepSelfie(gallery, owner, { engine: result.engine, face: result.face, matches, searchId: saved.id, thumbnail }).catch((error) => { console.error("[photo-selling] guest selfie not kept:", error?.message); return null; });
    kept = Boolean(selfieId);
  }
  return { id: saved.id, status: saved.status, matchCount: saved.matchCount, preparing: open.preparing, selfieId, notifyLater: Boolean(kept && owner?.whatsappOptInAt) };
  } finally {
    if (owner && !kept) await guests.releaseSelfie(owner.id);
  }
}

/** Why this search may not run now, in the guest's words - or null. `slack` 1 counts a search not yet reserved. */
async function quotaReached(gallery, session, slack = 1) {
  const now = Date.now();
  const [mine, gallerys] = await Promise.all([
    prisma.photoSaleSelfieSearch.count({ where: { galleryId: gallery.id, sessionHash: session.sessionHash, createdAt: { gte: new Date(now - 24 * 60 * 60 * 1000) } } }),
    prisma.photoSaleSelfieSearch.count({ where: { galleryId: gallery.id, createdAt: { gte: new Date(now - 60 * 60 * 1000) } } }),
  ]);
  if (mine + slack > PER_SESSION_PER_DAY) return `You've searched ${PER_SESSION_PER_DAY} times today. Please try again tomorrow.`;
  if (gallerys + slack > PER_GALLERY_PER_HOUR) return "A lot of guests are searching this gallery right now. Please try again in a few minutes.";
  return null;
}

async function own(gallery, session, searchId) {
  const row = await prisma.photoSaleSelfieSearch.findFirst({ where: { id: String(searchId), galleryId: gallery.id, sessionHash: session.sessionHash, expiresAt: { gt: new Date() } } });
  if (!row) throw httpError(404, "This search has expired. Please search again.");
  return row;
}

/**
 * The photos this device's matching searches of this gallery found, while they last - the whole of
 * what the device may see or buy in this store. A Set of photo ids; empty until a search matches.
 */
async function matchedPhotoIds(gallery, session) {
  if (!session) return new Set();
  const rows = await prisma.photoSaleSelfieSearch.findMany({ where: { galleryId: gallery.id, sessionHash: session.sessionHash, status: STATUS.COMPLETED, expiresAt: { gt: new Date() } }, select: { matches: true } });
  // And this device's registered guest's matches, later uploads' included.
  const kept = await guests.matchedPhotoIds(gallery, session);
  return new Set([...rows.flatMap((row) => (Array.isArray(row.matches) ? row.matches.map((match) => match.photoId) : [])), ...kept]);
}

/** A search's result: its matched photos still on sale, best first, each once. */
async function get(gallery, session, searchId, serializePhotos) {
  const row = await own(gallery, session, searchId);
  const base = { id: row.id, status: row.status, matchCount: row.matchCount, expiresAt: row.expiresAt };
  if (row.status !== STATUS.COMPLETED) return { ...base, photos: [] };
  const scores = new Map((row.matches || []).map((match) => [match.photoId, match.score]));
  // A score at the engine's stricter level reads as a close match; the rest as a good one.
  let strong = Infinity;
  try { strong = thresholdFor(row.engine, "STRICTER"); } catch { /* an engine no longer known: every match reads as a good one */ }
  const photos = await serializePhotos([...scores.keys()]);
  return { ...base, photos: photos.map((photo) => ({ ...photo, match: scores.get(photo.photoId) >= strong ? "STRONG" : "GOOD" })) };
}

/** This device's searches of this gallery, newest first - so the guest's results survive a reload. */
async function latest(gallery, session) {
  return prisma.photoSaleSelfieSearch.findFirst({ where: { galleryId: gallery.id, sessionHash: session.sessionHash, status: { in: [STATUS.COMPLETED, STATUS.NO_MATCH] }, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, matchCount: true } });
}

/** The guest's own "delete my search": it and its matches are gone now. */
async function remove(gallery, session, searchId) {
  const row = await own(gallery, session, searchId);
  await prisma.photoSaleSelfieSearch.delete({ where: { id: row.id } });
  return { deleted: true };
}

/** Retention: a search, and with it what it matched, goes RESULT_TTL after it was made. */
async function purgeExpired() {
  const removed = await prisma.photoSaleSelfieSearch.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  return { removed: removed.count };
}

module.exports = { STATUS, RESULT_TTL_MS, PER_SESSION_PER_DAY, PER_GALLERY_PER_HOUR, looksLikeImage, availability, create, matchedPhotoIds, get, latest, remove, purgeExpired };
