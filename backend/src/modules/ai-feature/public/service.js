const prisma = require("../../../config/db");
const { httpError } = require("../shared/http");
const storage = require("../shared/storage");
const activity = require("../shared/activity");
const { serializeMedia, serializeSubEvent } = require("../shared/serializers");
const { mergeGroup } = require("../shared/settingsDefaults");
const shareService = require("../share/service");
const security = require("../share/security");
const derivatives = require("../media/derivatives");
const engine = require("../face-engine/engine");
const vectors = require("../shared/vectors");
const queue = require("../processing/queue");
const matching = require("../matches/matching");
const mediaService = require("../media/service");
const { normalizePhone } = require("../guests/service");

const MODEL = process.env.AI_FACE_MODEL_NAME || "buffalo_l";

const settingsOf = (event) => ({ guestAccess: mergeGroup("guestAccess", event.setting?.guestAccess), ai: mergeGroup("ai", event.setting?.ai), gallery: mergeGroup("gallery", event.setting?.gallery), privacy: mergeGroup("privacy", event.setting?.privacy), media: mergeGroup("media", event.setting?.media) });

/** What a guest sees before joining: the cover, the name, the schedule, and what the link asks of them. */
async function meta(code) {
  const share = await shareService.resolve(code);
  const { event } = share;
  const settings = settingsOf(event);
  await prisma.aiEventShare.update({ where: { id: share.id }, data: { accessCount: { increment: 1 }, lastAccessAt: new Date() } }).catch(() => {});
  return {
    event: { id: event.id, name: event.name, eventType: event.eventType, startDate: event.startDate, endDate: event.endDate, location: event.location, description: event.description, coverUrl: storage.publicUrl(event.coverKey) },
    schedule: event.subEvents.map(serializeSubEvent),
    requiresPin: Boolean(share.pinHash),
    guestAccess: settings.guestAccess, gallery: settings.gallery,
    features: { selfieSearch: settings.ai.faceRecognition && settings.ai.selfieSearch && settings.guestAccess.enableSelfie, guestUploads: settings.guestAccess.enableGuestUploads, rsvp: settings.guestAccess.enableRsvp },
  };
}

/** Joining: name and phone as the event asks, the PIN if the link carries one, and back comes the guest's session. */
async function join(code, body, address) {
  const share = await shareService.resolve(code);
  const { event } = share;
  const settings = settingsOf(event);
  if (share.pinHash) {
    security.registerPinAttempt(share.tokenHash, address);
    if (!body.pin || !(await security.comparePin(body.pin, share.pinHash))) throw httpError(403, "That PIN is not right.");
    security.clearPinAttempts(share.tokenHash, address);
  }
  if (settings.guestAccess.requireName && !body.name) throw httpError(400, "Please enter your name.");
  if (settings.guestAccess.requirePhone && !body.phone) throw httpError(400, "Please enter your phone number.");
  const phone = normalizePhone(body.phone);
  let guest = phone ? await prisma.aiEventGuest.findFirst({ where: { eventId: event.id, phone } }) : null;
  if (!guest && !settings.guestAccess.allowRegistration) throw httpError(403, "This event is for invited guests only. Ask the host to add you.");
  if (guest) guest = await prisma.aiEventGuest.update({ where: { id: guest.id }, data: { name: guest.name || body.name || "Guest", joinedAt: guest.joinedAt || new Date(), lastSeenAt: new Date(), ...(body.rsvp ? { rsvp: body.rsvp } : {}) } });
  else {
    guest = await prisma.aiEventGuest.create({ data: { eventId: event.id, name: body.name || "Guest", phone, source: "LINK", joinedAt: new Date(), lastSeenAt: new Date(), ...(body.rsvp ? { rsvp: body.rsvp } : {}) } });
    await activity.record(event.id, activity.EVENTS.GUEST_JOINED, activity.guestActor(guest), guest.name);
  }
  return { session: security.signGuestSession({ eventId: event.id, guestId: guest.id, shareId: share.id }), guest: guestView(guest) };
}

const guestView = (guest) => ({ id: guest.id, name: guest.name, rsvp: guest.rsvp, selfieStatus: guest.selfieStatus, matchedCount: guest.matchedCount });

/** The share, the event and the guest behind a session - or a 401. Every guest route starts here. */
async function context(code, authHeader) {
  const share = await shareService.resolve(code);
  const payload = security.verifyGuestSession(authHeader, { eventId: share.event.id, shareId: share.id });
  const guest = await prisma.aiEventGuest.findFirst({ where: { id: payload.guestId, eventId: share.event.id } });
  if (!guest) throw httpError(401, "Your guest record was removed. Please join again.");
  prisma.aiEventGuest.update({ where: { id: guest.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  return { share, event: share.event, guest, settings: settingsOf(share.event) };
}

async function me(code, authHeader) { const { guest } = await context(code, authHeader); return guestView(guest); }

async function rsvp(code, authHeader, value) {
  const { guest, settings } = await context(code, authHeader);
  if (!settings.guestAccess.enableRsvp) throw httpError(403, "RSVP is not open for this event.");
  return guestView(await prisma.aiEventGuest.update({ where: { id: guest.id }, data: { rsvp: value } }));
}

/** Which sub-events this guest's group allows; null means every one. */
async function allowedSubEventIds(event, guest) {
  if (!guest.groupId) return null;
  const group = await prisma.aiEventGuestGroup.findFirst({ where: { id: guest.groupId, eventId: event.id }, select: { subEventIds: true } });
  const ids = Array.isArray(group?.subEventIds) ? group.subEventIds : [];
  return ids.length ? ids : null;
}

async function folders(code, authHeader) {
  const { event, guest, settings } = await context(code, authHeader);
  if (!settings.gallery.showAllPhotos) return [];
  const allowed = await allowedSubEventIds(event, guest);
  const rows = await prisma.aiEventMediaFolder.findMany({ where: { eventId: event.id, ...(allowed ? { subEventId: { in: allowed } } : {}) }, orderBy: { sortOrder: "asc" }, include: { subEvent: { select: { id: true, name: true } }, _count: { select: { media: { where: { deletedAt: null } } } } } });
  return rows.map((row) => ({ id: row.id, name: row.name, subEvent: row.subEvent, mediaCount: row._count.media }));
}

async function gallery(code, authHeader, query) {
  const { event, guest, settings } = await context(code, authHeader);
  if (!settings.gallery.showAllPhotos) throw httpError(403, "The full gallery is not open for this event.");
  const allowed = await allowedSubEventIds(event, guest);
  const where = { eventId: event.id, deletedAt: null, ...(query.folderId ? { folderId: query.folderId } : {}), ...(allowed ? { folder: { subEventId: { in: allowed } } } : {}) };
  const [total, rows] = await Promise.all([prisma.aiEventMedia.count({ where }), prisma.aiEventMedia.findMany({ where, orderBy: [{ capturedAt: "asc" }, { createdAt: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize })]);
  return { items: rows.map(guestMedia(settings)), total, page: query.page, pageSize: query.pageSize };
}

/** Only what a guest needs: never a status, an error or who uploaded it. */
const guestMedia = (settings) => (row) => { const media = serializeMedia(row); return { id: media.id, kind: media.kind, width: media.width, height: media.height, capturedAt: media.capturedAt, previewUrl: media.previewUrl, thumbnailUrl: media.thumbnailUrl, downloadUrl: settings.gallery.allowDownloads ? (media.originalUrl || media.previewUrl) : null }; };

async function myPhotos(code, authHeader, query) {
  const { event, guest, settings } = await context(code, authHeader);
  if (!settings.gallery.showMyPhotos) throw httpError(403, "My Photos is not open for this event.");
  const where = { eventId: event.id, guestId: guest.id, status: { in: ["MATCHED", "CONFIRMED"] }, media: { deletedAt: null } };
  const [total, rows] = await Promise.all([prisma.aiEventFaceMatch.count({ where }), prisma.aiEventFaceMatch.findMany({ where, orderBy: [{ createdAt: "desc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize, include: { media: true } })]);
  return { items: rows.map((row) => ({ matchId: row.id, ...guestMedia(settings)(row.media) })), total, page: query.page, pageSize: query.pageSize, selfieStatus: guest.selfieStatus };
}

/** "This is not me." The match is rejected and stays rejected; nothing about the face is deleted. */
async function rejectMatch(code, authHeader, matchId) {
  const { event, guest } = await context(code, authHeader);
  const match = await prisma.aiEventFaceMatch.findFirst({ where: { id: matchId, eventId: event.id, guestId: guest.id } });
  if (!match) throw httpError(404, "Photo not found.");
  await prisma.aiEventFaceMatch.update({ where: { id: match.id }, data: { status: "REJECTED", rejectedByGuestAt: new Date() } });
  await matching.recountGuest(guest.id);
  await activity.record(event.id, activity.EVENTS.MATCH_REJECTED, activity.guestActor(guest), "not me");
  return { id: match.id, status: "REJECTED" };
}

/**
 * Find My Photos: the selfie is described by the face engine, its vector kept against the guest,
 * and matched against this event's faces only. The selfie itself goes to the private bucket.
 */
async function selfie(code, authHeader, file) {
  const { event, guest, settings } = await context(code, authHeader);
  if (!settings.ai.faceRecognition || !settings.ai.selfieSearch || !settings.guestAccess.enableSelfie) throw httpError(403, "Selfie search is not open for this event.");
  if (!file || !/^image\//.test(file.mimetype || "")) throw httpError(400, "Please send a photo of your face.");
  if (!(await engine.isReady())) throw httpError(503, "Face matching is not available right now. Please try again in a little while.");
  let described;
  try { described = await engine.describe(file.buffer); } catch (error) { throw httpError(422, `Your selfie could not be read: ${error.message}`); }
  const best = described.faces.filter((face) => face.quality >= Math.min(settings.ai.minFaceQuality, 0.3)).sort((a, b) => b.quality - a.quality)[0];
  if (!best) { await prisma.aiEventGuest.update({ where: { id: guest.id }, data: { selfieStatus: "FAILED" } }); throw httpError(422, "We could not find a clear face in that photo. Try again with your face closer to the camera and well lit."); }
  const [selfieKey, thumbnailKey] = await Promise.all([storage.putPrivate(event.id, "guestSelfies", "jpg", file.buffer, file.mimetype), derivatives.selfieThumbnail(file.buffer).then((buffer) => storage.putPrivate(event.id, "guestSelfies", "webp", buffer, "image/webp")).catch(() => null)]);
  const previous = await prisma.aiEventGuestFace.findMany({ where: { guestId: guest.id }, select: { id: true, selfieKey: true, thumbnailKey: true } });
  const row = await prisma.aiEventGuestFace.create({ data: { eventId: event.id, guestId: guest.id, selfieKey, thumbnailKey, model: MODEL, dimension: best.embedding.length, vector: vectors.encode(best.embedding), quality: best.quality } });
  if (previous.length) { await prisma.aiEventGuestFace.deleteMany({ where: { id: { in: previous.map((item) => item.id) } } }); await storage.deletePrivateKeys(previous.flatMap((item) => [item.selfieKey, item.thumbnailKey])); }
  await prisma.aiEventGuest.update({ where: { id: guest.id }, data: { selfieStatus: "UPLOADED" } });
  await activity.record(event.id, activity.EVENTS.GUEST_SELFIE_ADDED, activity.guestActor(guest), guest.name);
  // Match now, inline, so the guest gets an answer; the queue is only the safety net if this throws.
  let result;
  try { result = await matching.matchGuestAgainstEvent(event.id, guest.id, vectors.normalize(best.embedding), settings.ai); } catch (error) { console.error("[ai-feature] inline selfie match failed, queued:", error.message); await queue.enqueueSelfie(row.id).catch(() => {}); result = { matched: null }; }
  const updated = await prisma.aiEventGuest.findUnique({ where: { id: guest.id } });
  return { matched: result.matched, guest: guestView(updated) };
}

async function guestUpload(code, authHeader, file) {
  const { event, guest, settings } = await context(code, authHeader);
  if (!settings.guestAccess.enableGuestUploads) throw httpError(403, "Guest uploads are not open for this event.");
  const result = await mediaService.upload(event.id, file, { guestId: guest.id });
  await activity.record(event.id, activity.EVENTS.MEDIA_UPLOADED, activity.guestActor(guest), `${guest.name} uploaded a photo`);
  return { media: guestMedia(settings)(result.media) };
}

module.exports = { meta, join, me, rsvp, folders, gallery, myPhotos, rejectMatch, selfie, guestUpload };
