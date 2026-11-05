const prisma = require("../../../config/db");
const { httpError } = require("../../ai-feature/shared/http");
const vectors = require("../../ai-feature/shared/vectors");
const { normalizePhoneNumber } = require("../../../services/phoneNumber");
const { thresholdFor } = require("../faces/thresholds");
const notifyConfig = require("../notifications/config");
const storage = require("../shared/storage");
const cleanup = require("../shared/cleanup");

/**
 * A store's guests: the name and WhatsApp number every guest gives on the store's first screen, with
 * the PIN where there is one (public/service.openSession - the owner's decision, 2026-10-29, the AI
 * Feature's join card for Photo Selling), and their selfies - up to SELFIE_LIMIT, each kept as the
 * face engine's vector and a small private thumbnail (never the selfie itself), each searched with, so
 * a photo the studio uploads later is matched to them (owner-approved, 2026-10-29). Where the gallery
 * sends WhatsApp photo-match messages and the guest ticked for them, they are told
 * (notifications/service.js). One guest per gallery per store session (the device); the session names
 * them, never an id from the request.
 *
 * - No code proves the number (the owner's decision, 2026-10-29): the guest's own tick is the consent,
 *   and the number goes no further than the WhatsApp message they asked for.
 * - A selfie stays until the guest removes it, or the gallery is deleted; removing one deletes its face
 *   vector and thumbnail and the matches only it supported.
 * - A guest's matches - their own searches' (SELFIE) and later uploads' (NEW_PHOTO) - are photos their
 *   device may see and buy, as a search's matches are (search.matchedPhotoIds).
 */
const SOURCES = Object.freeze({ SELFIE: "SELFIE", NEW_PHOTO: "NEW_PHOTO" });
const SELFIE_LIMIT = 10;
const FULL = `You have ${SELFIE_LIMIT} selfies. Remove one to add another.`;

/**
 * `+<digits>` for a number a WhatsApp message can go to, or null. A ten-digit Indian mobile typed
 * without its code is read as +91, as checkout reads one; any other number needs its country code.
 */
function toE164(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  if (!String(value || "").trim().startsWith("+")) return null;
  const normalized = normalizePhoneNumber(value);
  return normalized ? `+${normalized.replace(/\D/g, "")}` : null;
}

/** "+91 ••••••3210": all a screen or a log row is given. */
function mask(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 6) return null;
  return `+${digits.slice(0, digits.length - 10 > 0 ? digits.length - 10 : 2)} ••••••${digits.slice(-4)}`;
}

/** The guest's number as Meta takes it, or the 400 that says what to type. */
function checkedPhone(phone) {
  const number = toE164(phone);
  if (!number) throw httpError(400, "Enter your WhatsApp number - a 10-digit mobile, or with its country code.");
  return number;
}

/** Whether this gallery offers WhatsApp photo-match messages now: the gallery's switch, the server's, and a template named. */
const offered = (gallery) => Boolean(gallery?.whatsappNotify && notifyConfig.enabled() && notifyConfig.templateName());

const view = (guest) => guest && ({ name: guest.name, phone: mask(guest.phone), whatsappOn: Boolean(guest.whatsappOptInAt), selfieCount: Math.min(guest.selfieCount ?? 0, SELFIE_LIMIT), selfieLimit: SELFIE_LIMIT });

const mine = (gallery, session) => prisma.photoSaleGuest.findUnique({ where: { galleryId_sessionHash: { galleryId: gallery.id, sessionHash: session.sessionHash } } });

/** The guest this device registered in this store, or null. */
async function current(gallery, session) {
  return view(await mine(gallery, session));
}

/**
 * Registers this device's guest, or updates it: name, number and the WhatsApp choice. The choice
 * counts only where the gallery offers messages; ticking it off withdraws consent at once. A number in
 * a country the studio does not message is refused only when the guest asks for messages. Consent given
 * now reports only what is found from now on: matches already recorded are counted as told
 * (`baseline`), never sent as a catch-up.
 */
async function register(gallery, session, { name, phone, whatsappConsent }, { env = process.env } = {}) {
  const number = checkedPhone(phone);
  whatsappConsent = Boolean(whatsappConsent) && offered(gallery);
  if (whatsappConsent && !notifyConfig.dialCodeAllowed(number, env)) throw httpError(400, "We can't send WhatsApp messages to this country's numbers. You can still search for your photos.");
  const now = new Date();
  const existing = await mine(gallery, session);
  // Consent belongs to the number: a different number is asked again, never carried over.
  const keep = existing?.whatsappOptInAt && existing.phone === number;
  const consent = whatsappConsent ? { whatsappOptInAt: keep ? existing.whatsappOptInAt : now, whatsappOptOutAt: null } : { whatsappOptInAt: null, whatsappOptOutAt: existing?.whatsappOptInAt ? now : existing?.whatsappOptOutAt ?? null };
  const data = { name: String(name).trim().slice(0, 191), phone: number, ...consent };
  const row = existing
    ? await prisma.photoSaleGuest.update({ where: { id: existing.id }, data })
    : await prisma.photoSaleGuest.create({ data: { galleryId: gallery.id, sessionHash: session.sessionHash, ...data } });
  if (whatsappConsent && !keep) await baseline(row);
  return view(row);
}

/** The guest's unreported later-upload matches, claimed by one SKIPPED row that is never sent. */
async function baseline(guest) {
  const ids = (await prisma.photoSaleGuestMatch.findMany({ where: { guestId: guest.id, source: SOURCES.NEW_PHOTO, notificationId: null }, select: { id: true } })).map((row) => row.id);
  if (!ids.length) return;
  const row = await prisma.photoSaleNotification.create({ data: { galleryId: guest.galleryId, guestId: guest.id, kind: "CONSENT_BASELINE", channel: "NONE", status: "SKIPPED", errorCode: "CONSENT_BASELINE", matchCount: ids.length } });
  await prisma.photoSaleGuestMatch.updateMany({ where: { id: { in: ids }, notificationId: null }, data: { notificationId: row.id } });
}

/** "Stop WhatsApp messages": consent withdrawn, now. The guest's selfies stay until they remove them. */
async function stop(gallery, session) {
  const existing = await mine(gallery, session);
  if (!existing) throw httpError(404, "Nothing to stop.");
  return view(await prisma.photoSaleGuest.update({ where: { id: existing.id }, data: { whatsappOptInAt: null, whatsappOptOutAt: new Date() } }));
}

/**
 * Takes one of the guest's selfie slots before the engine runs, or refuses when all ten are in use -
 * one conditional UPDATE, so requests sent at once cannot pass the limit together. Answers the guest,
 * or null for a session with no guest (a search that keeps nothing).
 */
async function reserveSelfie(gallery, session) {
  const guest = await mine(gallery, session);
  if (!guest) return null;
  const { count } = await prisma.photoSaleGuest.updateMany({ where: { id: guest.id, selfieCount: { lt: SELFIE_LIMIT } }, data: { selfieCount: { increment: 1 } } });
  if (!count) throw httpError(429, FULL);
  return guest;
}

/** Gives a slot back: a selfie that was never kept, or one removed. */
const releaseSelfie = (guestId) => prisma.photoSaleGuest.updateMany({ where: { id: guestId, selfieCount: { gt: 0 } }, data: { selfieCount: { decrement: 1 } } }).catch((error) => console.error("[photo-selling] selfie slot not given back:", error.message));

/**
 * After a selfie search, for the guest whose slot it took: the face is kept as one of their selfies
 * (with its thumbnail, when there is one), and the search's matches recorded as theirs (SELFIE - on
 * their screen already, so never messaged about). Adding a selfie never takes away what the others
 * found. `face` is the engine's unit vector; it never leaves the server. Answers the selfie's id.
 */
async function keepSelfie(gallery, guest, { engine, face, matches, searchId, thumbnail = null }) {
  if (!face?.length) return null;
  const thumbnailKey = thumbnail ? await storage.putSelfieThumbnail(gallery.id, thumbnail).catch((error) => { console.error("[photo-selling] selfie thumbnail not stored:", error.message); return null; }) : null;
  const row = await prisma.photoSaleGuestSelfie.create({ data: { galleryId: gallery.id, guestId: guest.id, searchId, engine, dimension: face.length, vector: vectors.encode(face), thumbnailKey } });
  if (matches.length) await prisma.photoSaleGuestMatch.createMany({ data: matches.map((match) => ({ galleryId: gallery.id, guestId: guest.id, photoId: match.photoId, score: match.score, source: SOURCES.SELFIE })), skipDuplicates: true });
  return row.id;
}

/** This device's guest's selfies, newest first: ids and dates - never a key or a face. */
async function listSelfies(gallery, session) {
  const guest = await mine(gallery, session);
  if (!guest) return { items: [], count: 0, limit: SELFIE_LIMIT };
  const rows = await prisma.photoSaleGuestSelfie.findMany({ where: { guestId: guest.id, galleryId: gallery.id }, orderBy: { createdAt: "desc" }, select: { id: true, createdAt: true, thumbnailKey: true } });
  return { items: rows.map((row) => ({ id: row.id, createdAt: row.createdAt, hasThumbnail: Boolean(row.thumbnailKey) })), count: rows.length, limit: SELFIE_LIMIT };
}

/** One of this device's guest's own selfie thumbnails, or a 404 - never another guest's. */
async function selfieThumbnail(gallery, session, selfieId) {
  const guest = await mine(gallery, session);
  const row = guest ? await prisma.photoSaleGuestSelfie.findFirst({ where: { id: String(selfieId), guestId: guest.id, galleryId: gallery.id }, select: { thumbnailKey: true } }) : null;
  const object = row?.thumbnailKey ? await storage.getSelfieThumbnail(row.thumbnailKey).catch(() => null) : null;
  if (!object) throw httpError(404, "Selfie not found.");
  return object;
}

/**
 * Removes one of this device's guest's own selfies: its vector goes now and is never searched with
 * again, its thumbnail is deleted through the durable clean-up (retried until gone), the search it was
 * taken in goes with it, and the matches only it supported go - a photo another of their selfies still
 * matches stays. Removing one already gone answers as done.
 */
async function removeSelfie(gallery, session, selfieId) {
  const guest = await mine(gallery, session);
  if (!guest) throw httpError(404, "Selfie not found.");
  const row = await prisma.photoSaleGuestSelfie.findFirst({ where: { id: String(selfieId), guestId: guest.id, galleryId: gallery.id } });
  if (row) {
    const removed = await prisma.$transaction(async (tx) => {
      const { count } = await tx.photoSaleGuestSelfie.deleteMany({ where: { id: row.id, guestId: guest.id } });
      if (count && row.thumbnailKey) await cleanup.record(cleanup.plan(gallery.id, { originals: [row.thumbnailKey] }), tx);
      if (count && row.searchId) await tx.photoSaleSelfieSearch.deleteMany({ where: { id: row.searchId, galleryId: gallery.id, sessionHash: guest.sessionHash } });
      return count;
    });
    if (removed) {
      await releaseSelfie(guest.id);
      await pruneMatches(gallery, guest.id);
      cleanup.drain({ galleryId: gallery.id }).catch(() => {});
    }
  }
  return { removed: true, guest: view(await prisma.photoSaleGuest.findUnique({ where: { id: guest.id } })) };
}

/**
 * The guest's matches their remaining selfies no longer support, gone: each photo's faces against
 * each remaining selfie at the gallery's strictness - the rule a search and a later upload use. With
 * no selfie left, every match goes. Answers how many went.
 */
async function pruneMatches(gallery, guestId) {
  const matches = await prisma.photoSaleGuestMatch.findMany({ where: { guestId, galleryId: gallery.id }, select: { id: true, photoId: true } });
  if (!matches.length) return 0;
  const selfies = await prisma.photoSaleGuestSelfie.findMany({ where: { guestId, galleryId: gallery.id }, select: { engine: true, dimension: true, vector: true } });
  const supported = new Set();
  if (selfies.length) {
    const faces = await prisma.photoSaleFace.findMany({ where: { photoId: { in: [...new Set(matches.map((row) => row.photoId))] } }, select: { photoId: true, engine: true, dimension: true, vector: true } });
    const queries = selfies.map((selfie) => ({ ...selfie, query: vectors.decode(selfie.vector) }));
    for (const face of faces) {
      if (supported.has(face.photoId) || !face.vector) continue;
      const vector = vectors.decode(face.vector);
      for (const selfie of queries) {
        if (selfie.engine !== face.engine || selfie.dimension !== face.dimension) continue;
        let threshold;
        try { threshold = thresholdFor(selfie.engine, gallery.matchStrictness || "STANDARD"); } catch { continue; }
        if (vectors.similarity(selfie.query, vector) >= threshold) { supported.add(face.photoId); break; }
      }
    }
  }
  const gone = matches.filter((row) => !supported.has(row.photoId)).map((row) => row.id);
  if (gone.length) await prisma.photoSaleGuestMatch.deleteMany({ where: { id: { in: gone }, guestId } });
  return gone.length;
}

/** The photos matched to this device's guest - their own search's and later uploads'. */
async function matchedPhotoIds(gallery, session) {
  if (!session) return [];
  const guest = await mine(gallery, session);
  if (!guest) return [];
  const rows = await prisma.photoSaleGuestMatch.findMany({ where: { guestId: guest.id, galleryId: gallery.id, photo: { available: true, removedAt: null, faceStatus: "DONE" } }, orderBy: [{ score: "desc" }], select: { photoId: true } });
  return rows.map((row) => row.photoId);
}

/**
 * A photo just indexed (faces/service.indexPhoto), matched to every guest's selfies at the gallery's
 * own strictness - the threshold a selfie search would use; a guest counts once whichever of their
 * selfies matched. A match already recorded is not recorded again (unique guest + photo), so indexing a
 * photo twice never makes a second one. Answers how many new matches were found; when any were, the
 * gallery's message run is scheduled (it tells only guests who asked).
 */
async function matchNewPhoto(photoId, { schedule = null } = {}) {
  const photo = await prisma.photoSalePhoto.findUnique({ where: { id: photoId }, select: { id: true, galleryId: true, available: true, removedAt: true, faceStatus: true } });
  if (!photo || !photo.available || photo.removedAt || photo.faceStatus !== "DONE") return 0;
  const gallery = await prisma.photoSaleGallery.findUnique({ where: { id: photo.galleryId }, select: { matchStrictness: true } });
  const selfies = await prisma.photoSaleGuestSelfie.findMany({ where: { galleryId: photo.galleryId }, select: { guestId: true, engine: true, dimension: true, vector: true } });
  if (!selfies.length) return 0;
  const faces = (await prisma.photoSaleFace.findMany({ where: { photoId: photo.id }, select: { engine: true, dimension: true, vector: true } })).filter((face) => face.vector).map((face) => ({ ...face, decoded: vectors.decode(face.vector) }));
  const best = new Map();
  for (const selfie of selfies) {
    let threshold;
    try { threshold = thresholdFor(selfie.engine, gallery?.matchStrictness || "STANDARD"); } catch { continue; }
    const query = vectors.decode(selfie.vector);
    for (const face of faces) {
      if (face.engine !== selfie.engine || face.dimension !== selfie.dimension) continue;
      const score = vectors.similarity(query, face.decoded);
      if (score >= threshold && score > (best.get(selfie.guestId) || 0)) best.set(selfie.guestId, score);
    }
  }
  const found = [...best.entries()].map(([guestId, score]) => ({ galleryId: photo.galleryId, guestId, photoId: photo.id, score: Math.round(score * 1000) / 1000, source: SOURCES.NEW_PHOTO }));
  if (!found.length) return 0;
  const { count } = await prisma.photoSaleGuestMatch.createMany({ data: found, skipDuplicates: true });
  if (count) await (schedule || require("../search/queue").enqueueNotify)(photo.galleryId).catch((error) => console.warn(`[photo-selling] photo-match message not scheduled yet (the sweep will): ${error.message}`));
  return count;
}

module.exports = { SOURCES, SELFIE_LIMIT, toE164, checkedPhone, mask, offered, current, register, stop, reserveSelfie, releaseSelfie, keepSelfie, listSelfies, selfieThumbnail, removeSelfie, pruneMatches, matchedPhotoIds, matchNewPhoto };
