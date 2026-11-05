const prisma = require("../../../config/db");
const { httpError } = require("../shared/http");
const storage = require("../shared/storage");
const activity = require("../shared/activity");
const { serializeMedia } = require("../shared/serializers");
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
const coverVeil = require("./coverVeil");
const watermarks = require("../watermarks/service");
const guestNotifications = require("../notifications/service");
const otp = require("../notifications/otp");
const { mask, canReceive, toE164, isVerified } = require("../notifications/phone");

const MODEL = process.env.AI_FACE_MODEL_NAME || "buffalo_l";
/** The most selfies one guest may have accepted for one event. */
const SELFIE_LIMIT = 10;

const settingsOf = (event) => ({ guestAccess: mergeGroup("guestAccess", event.setting?.guestAccess), ai: mergeGroup("ai", event.setting?.ai), gallery: mergeGroup("gallery", event.setting?.gallery), privacy: mergeGroup("privacy", event.setting?.privacy), media: mergeGroup("media", event.setting?.media), notifications: mergeGroup("notifications", event.setting?.notifications) });

/** What a guest sees before joining: the cover, the name, and what the link asks of them. */
async function meta(code) {
  const share = await shareService.resolve(code);
  const { event } = share;
  const settings = settingsOf(event);
  await prisma.aiEventShare.update({ where: { id: share.id }, data: { accessCount: { increment: 1 }, lastAccessAt: new Date() } }).catch(() => {});
  // How dark the join page's veil over the cover is; see coverVeil.js for why it is measured here.
  const veil = await coverVeil.veilFor(event.coverKey);
  return {
    event: { id: event.id, name: event.name, eventType: event.eventType, startDate: event.startDate, endDate: event.endDate, location: event.location, description: event.description, coverUrl: storage.publicUrl(event.coverKey), coverVeil: veil },
    requiresPin: Boolean(share.pinHash),
    // The watermark's preset and the event's copy of it are the studio's business; a guest is told only whether one is drawn.
    // `showAllPhotos` and `showPeople` are no longer settings: a guest sees only their own matches,
    // so the page is told false whatever an older event stored.
    guestAccess: settings.guestAccess, gallery: { ...(({ watermarkPresetId, watermarkSnapshot, ...shown }) => shown)(settings.gallery), showAllPhotos: false, showPeople: false },
    // What the page optimizes a guest's photo to before sending it: the event's presets and the
    // ceiling the server would refuse past. Nothing else of the media group is a guest's business.
    media: guestMediaRecipe(settings.media),
    features: {
      selfieSearch: selfieSearchOpen(settings),
      // The two ways into Find My Photos, each its own switch under Enable guest selfie. Not to
      // be confused with `guestUploads`, which is guests adding event photos.
      selfieTake: selfieSearchOpen(settings) && settings.guestAccess.allowTakeSelfie,
      selfieUpload: selfieSearchOpen(settings) && settings.guestAccess.allowUploadSelfie,
      guestUploads: settings.guestAccess.enableGuestUploads, rsvp: settings.guestAccess.enableRsvp,
      // The WhatsApp photo summary is offered only where the server and the event both allow it.
      whatsappSummary: guestNotifications.eventWants(event),
    },
  };
}

/**
 * The two presets and the ceiling a guest's page needs to optimize a photo before sending it.
 * `compressionEnabled` is always true - compression is no longer a setting - and stays in the
 * answer for a guest page loaded before that changed.
 */
function guestMediaRecipe(media) {
  const recipe = derivatives.recipeFrom(media);
  return { previewPreset: recipe.previewPreset, thumbnailPreset: recipe.thumbnailPreset, compressionEnabled: true, maxFileSizeMb: media.maxFileSizeMb };
}

/** Find My Photos is open when the engine, the event's selfie search and the guest selfie are all on. */
const selfieSearchOpen = (settings) => Boolean(settings.ai.faceRecognition && settings.ai.selfieSearch && settings.guestAccess.enableSelfie);

/**
 * Whether the way a selfie was obtained is one the event allows. `source` is what the page says it
 * did - "camera" or "upload" - and a caller that says nothing is allowed through as long as at
 * least one way is open, so the shared endpoint is never refused while a valid way remains.
 */
function selfieSourceAllowed(guestAccess, source) {
  const ways = { camera: guestAccess.allowTakeSelfie !== false, upload: guestAccess.allowUploadSelfie !== false };
  if (source === "camera" || source === "upload") return ways[source];
  return ways.camera || ways.upload;
}

/**
 * Joining: name and phone as the event asks, the PIN if the link carries one, and back comes the
 * guest's session - or, where the phone must be proved first, a code step.
 *
 * A code is asked for (sent to the number already stored on that guest, never one typed now) when:
 * - the phone finds a **protected** guest (a selfie on file, a visible match, or a verified phone)
 *   and the request does not carry that guest's own valid session; or
 * - the event's Confirm phone numbers by SMS (`guestAccess.verifyPhone`) is on - for every phone
 *   join, a new guest's included (their row is made first, unjoined, and the code goes to it).
 *
 * Joining an existing guest without that guest's own session, with no code due, still raises their
 * `sessionVersion`: whoever joined before on another device is signed out. So a stranger who joins
 * as a guest before the guest has anything to protect is ended the moment the guest joins - and
 * once the guest has a selfie or a match, the stranger needs a code they cannot get.
 *
 * Where a code is due and cannot be sent, nobody is let in unverified: no gateway is a 503, and a
 * number the studio does not send to (`SMS_GUEST_ALLOWED_DIAL_CODES`) is refused for any existing
 * guest. The one exception the switch allows is a number that can never get a code and finds no
 * guest at all: that person joins as a new, unverified guest, exactly as they could before.
 */
async function join(code, body, address, authHeader = null) {
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
  const confirmAll = settings.guestAccess.verifyPhone === true;
  let guest = phone ? await prisma.aiEventGuest.findFirst({ where: { eventId: event.id, phone } }) : null;
  if (!guest && !settings.guestAccess.allowRegistration) throw httpError(403, "This event is for invited guests only. Ask the host to add you.");

  if (guest) {
    if (!holdsSession(authHeader, share, guest) && (confirmAll || (await isProtected(guest)))) {
      const can = otp.sendability(guest.phone);
      if (can === "UNAVAILABLE") throw httpError(503, "We can't send a verification code right now, so we can't open this guest's photos. Please try again later.");
      if (can !== "OK") throw httpError(403, "This guest's photos are protected, and we can't send a code to this number. Please ask the host for help.");
      return challengeFor(share, guest);
    }
  } else if (confirmAll && phone) {
    const can = otp.sendability(phone);
    if (can === "UNAVAILABLE") throw httpError(503, "We can't send a verification code right now. Please try again later.");
    if (can === "OK") {
      // Made now so the code has a stored number to go to; it joins (and is announced) once proved.
      // If no code goes - a limit reached - the row goes too, so nothing is left for nobody; one that
      // is never proved is swept after half an hour (purgeAbandonedJoins).
      const pending = await prisma.aiEventGuest.create({ data: { eventId: event.id, name: body.name || "Guest", phone, source: "LINK" } });
      try {
        const sent = await otp.requestCode(pending, { purpose: otp.PURPOSES.LOGIN });
        return { verificationRequired: true, challenge: security.signJoinChallenge({ eventId: event.id, guestId: pending.id, shareId: share.id }), ...sent };
      } catch (error) {
        await prisma.aiEventGuest.delete({ where: { id: pending.id } }).catch(() => {});
        throw error;
      }
    }
    // A number that can never be sent a code, finding no guest: a new, unverified guest, as before.
  }

  if (guest) guest = await prisma.aiEventGuest.update({ where: { id: guest.id }, data: { name: guest.name || body.name || "Guest", joinedAt: guest.joinedAt || new Date(), lastSeenAt: new Date(), ...(body.rsvp ? { rsvp: body.rsvp } : {}), ...(holdsSession(authHeader, share, guest) ? {} : { sessionVersion: { increment: 1 } }) } });
  else {
    guest = await prisma.aiEventGuest.create({ data: { eventId: event.id, name: body.name || "Guest", phone, source: "LINK", joinedAt: new Date(), lastSeenAt: new Date(), ...(body.rsvp ? { rsvp: body.rsvp } : {}) } });
    await activity.record(event.id, activity.EVENTS.GUEST_JOINED, activity.guestActor(guest), guest.name);
  }
  return { session: sessionFor(share, guest), guest: guestView(guest) };
}

const sessionFor = (share, guest) => security.signGuestSession({ eventId: share.event.id, guestId: guest.id, shareId: share.id, version: guest.sessionVersion ?? 0 });

/** Whether the request carries this very guest's session, still current - a guest coming back on their own device. */
function holdsSession(authHeader, share, guest) {
  if (!authHeader) return false;
  try {
    const payload = security.verifyGuestSession(authHeader, { eventId: share.event.id, shareId: share.id });
    return payload.guestId === guest.id && (payload.v ?? 0) === (guest.sessionVersion ?? 0);
  } catch { return false; }
}

/** Something a stranger with the phone number must not reach: a verified phone, a selfie on file, or a photo shown as theirs. */
async function isProtected(guest) {
  if (guest.verifiedPhone) return true;
  const [faces, matches] = await Promise.all([
    prisma.aiEventGuestFace.count({ where: { guestId: guest.id } }),
    prisma.aiEventFaceMatch.count({ where: { guestId: guest.id, status: { in: ["MATCHED", "CONFIRMED"] }, media: { deletedAt: null } } }),
  ]);
  return faces > 0 || matches > 0;
}

/**
 * The code step: a code to the guest's stored phone, and a short-lived challenge naming that guest.
 * A code asked for again too soon (a double tap) is not an error here - the one already sent stands.
 */
async function challengeFor(share, guest) {
  const challenge = security.signJoinChallenge({ eventId: share.event.id, guestId: guest.id, shareId: share.id });
  try {
    const sent = await otp.requestCode(guest, { purpose: otp.PURPOSES.LOGIN });
    return { verificationRequired: true, challenge, ...sent };
  } catch (error) {
    if (error?.status !== 429) throw error;
    return { verificationRequired: true, challenge, sentTo: mask(toE164(guest.phone)), notice: error.message };
  }
}

/** The code step's answer: the guest's session, every other session for them ended. */
async function joinVerify(code, { challenge, code: value, rsvp }) {
  const share = await shareService.resolve(code);
  const payload = security.verifyJoinChallenge(challenge, { eventId: share.event.id, shareId: share.id });
  const guest = await prisma.aiEventGuest.findFirst({ where: { id: payload.guestId, eventId: share.event.id } });
  if (!guest) throw httpError(400, "That code has expired. Please join again.");
  let verified = await otp.verifyCode(guest, value, { purpose: otp.PURPOSES.LOGIN });
  if (rsvp && settingsOf(share.event).guestAccess.enableRsvp) verified = await prisma.aiEventGuest.update({ where: { id: guest.id }, data: { rsvp } });
  if (!guest.joinedAt) await activity.record(share.event.id, activity.EVENTS.GUEST_JOINED, activity.guestActor(verified), verified.name);
  return { session: sessionFor(share, verified), guest: guestView(verified) };
}

/**
 * Guests made for a code step (Confirm phone numbers by SMS) and never proved: no join, nothing
 * attached, older than half an hour. Swept by the media worker; they are never listed meanwhile.
 */
async function purgeAbandonedJoins({ db = prisma, now = Date.now() } = {}) {
  const { count } = await db.aiEventGuest.deleteMany({ where: { source: "LINK", joinedAt: null, createdAt: { lt: new Date(now - 30 * 60 * 1000) }, faces: { none: {} }, matches: { none: {} }, uploads: { none: {} } } });
  return count;
}

/** Another code for the same step, under the same limits. */
async function joinResend(code, { challenge }) {
  const share = await shareService.resolve(code);
  const payload = security.verifyJoinChallenge(challenge, { eventId: share.event.id, shareId: share.id });
  const guest = await prisma.aiEventGuest.findFirst({ where: { id: payload.guestId, eventId: share.event.id } });
  if (!guest) throw httpError(400, "That code has expired. Please join again.");
  return otp.requestCode(guest, { purpose: otp.PURPOSES.LOGIN });
}

const guestView = (guest) => ({ id: guest.id, name: guest.name, rsvp: guest.rsvp, selfieStatus: guest.selfieStatus, matchedCount: guest.matchedCount, selfieUploads: guest.selfieUploads ?? 0, selfieLimit: SELFIE_LIMIT, phoneVerified: isVerified(guest), whatsappSummary: { on: canReceive(guest), phone: canReceive(guest) ? mask(toE164(guest.phone)) : null, joinedPhone: mask(toE164(guest.phone)) } });

/** The share, the event and the guest behind a session - or a 401. Every guest route starts here. */
async function context(code, authHeader) {
  const share = await shareService.resolve(code);
  const payload = security.verifyGuestSession(authHeader, { eventId: share.event.id, shareId: share.id });
  const guest = await prisma.aiEventGuest.findFirst({ where: { id: payload.guestId, eventId: share.event.id } });
  if (!guest) throw httpError(401, "Your guest record was removed. Please join again.");
  // A session from before the guest last proved their phone elsewhere is over (otp.verifyCode, LOGIN).
  if ((payload.v ?? 0) !== (guest.sessionVersion ?? 0)) throw httpError(401, "You were signed out because this guest signed in on another device. Please join again.");
  prisma.aiEventGuest.update({ where: { id: guest.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  return { share, event: share.event, guest, settings: settingsOf(share.event) };
}

async function me(code, authHeader) { const { guest } = await context(code, authHeader); return guestView(guest); }

async function rsvp(code, authHeader, value) {
  const { guest, settings } = await context(code, authHeader);
  if (!settings.guestAccess.enableRsvp) throw httpError(403, "RSVP is not open for this event.");
  return guestView(await prisma.aiEventGuest.update({ where: { id: guest.id }, data: { rsvp: value } }));
}

/**
 * A guest never browses the event: the only photos a guest is shown are the ones their own selfie
 * matched (`myPhotos`). The folder list and the whole gallery stay as routes for a page loaded
 * before All Photos went, and answer nothing - whatever `showAllPhotos` an older event stored.
 */
async function folders(code, authHeader) {
  await context(code, authHeader);
  return [];
}

async function gallery(code, authHeader) {
  await context(code, authHeader);
  throw httpError(403, "The full gallery is not open to guests. Your photos are under My Photos.");
}

/**
 * Only what a guest needs: never a status, an error or who uploaded it. `watermarked` is
 * `watermarks.guestCopies`: null when the event draws no watermark; otherwise its `view` and
 * `download` say where the watermarked frame stands in for the photo's own - the preview and
 * thumbnail a guest looks at, and the file a guest saves. Each follows its own switch: a download
 * with its switch off is the photo as the event always offered it (its original if kept, else its
 * preview), whatever the gallery shows. A photo not drawn yet gets the server's signed address that
 * draws it when the browser asks (a path, which the page puts in front of its API address); with no
 * look to draw it gets no address at all. Never the photo clean where its switch is on.
 */
const guestMedia = (settings, watermarked = null) => (row) => {
  const media = serializeMedia(row);
  const base = { id: media.id, kind: media.kind, width: media.width, height: media.height, capturedAt: media.capturedAt };
  if (watermarked && media.kind !== "VIDEO") {
    const copy = watermarked.copies.get(media.id);
    const address = (variant) => (copy ? storage.publicUrl(variant === "thumbnail" ? (copy.thumbnailKey || copy.previewKey) : copy.previewKey) : watermarked.hash ? watermarks.copyPath(media.id, watermarked.hash, variant) : null);
    const clean = media.originalUrl || media.previewUrl;
    return {
      ...base,
      previewUrl: watermarked.view ? address("preview") : media.previewUrl,
      thumbnailUrl: watermarked.view ? address("thumbnail") : media.thumbnailUrl,
      downloadUrl: settings.gallery.allowDownloads ? (watermarked.download ? address("preview") : clean) : null,
    };
  }
  return { ...base, previewUrl: media.previewUrl, thumbnailUrl: media.thumbnailUrl, downloadUrl: settings.gallery.allowDownloads ? (media.originalUrl || media.previewUrl) : null };
};

/**
 * The guest's gallery: only the photos this guest's selfie matched - their own session's guest id,
 * this event, a match that stands (MATCHED or CONFIRMED; never one waiting for review or rejected)
 * and a photo not deleted. Nothing is shown while matching is pending or found nothing, and a
 * photo's download address goes out only here, only with Allow downloads on.
 */
async function myPhotos(code, authHeader, query) {
  const { event, guest, settings } = await context(code, authHeader);
  if (!settings.gallery.showMyPhotos) throw httpError(403, "My Photos is not open for this event.");
  const where = { eventId: event.id, guestId: guest.id, status: { in: ["MATCHED", "CONFIRMED"] }, media: { eventId: event.id, deletedAt: null } };
  const [total, rows] = await Promise.all([prisma.aiEventFaceMatch.count({ where }), prisma.aiEventFaceMatch.findMany({ where, orderBy: [{ createdAt: "desc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize, include: { media: true } })]);
  const copies = await watermarks.guestCopies(settings.gallery, rows.map((row) => row.media));
  return { items: rows.map((row) => ({ matchId: row.id, ...guestMedia(settings, copies)(row.media) })), total, page: query.page, pageSize: query.pageSize, selfieStatus: guest.selfieStatus };
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

const FULL = `You have ${SELFIE_LIMIT} selfies. Remove one to add another.`;

/**
 * Takes one of the guest's selfie slots, or refuses when all are used. `selfieUploads` counts the
 * guest's active selfies plus any being added right now, so the check and the take are one conditional
 * UPDATE and two requests at once cannot both slip under the limit. A count from before selfies could
 * be removed counted every selfie ever accepted while keeping only the last one: a guest with one
 * selfie or none and a higher count is brought down to what is kept, by a compare-and-set on the
 * value read. `selfie` checks again after storing, so the limit holds whatever happens.
 */
async function reserveSelfie(db, guestId) {
  const take = () => db.aiEventGuest.updateMany({ where: { id: guestId, selfieUploads: { lt: SELFIE_LIMIT } }, data: { selfieUploads: { increment: 1 } } });
  if ((await take()).count) return;
  const [guest, kept] = await Promise.all([db.aiEventGuest.findUnique({ where: { id: guestId }, select: { selfieUploads: true } }), db.aiEventGuestFace.count({ where: { guestId } })]);
  if (guest && kept <= 1 && guest.selfieUploads > kept) {
    await db.aiEventGuest.updateMany({ where: { id: guestId, selfieUploads: guest.selfieUploads }, data: { selfieUploads: kept } });
    if ((await take()).count) return;
  }
  throw httpError(429, FULL);
}

/** Gives a slot back when the selfie it was taken for was never stored. */
const releaseSelfie = (db, guestId) => db.aiEventGuest.updateMany({ where: { id: guestId, selfieUploads: { gt: 0 } }, data: { selfieUploads: { decrement: 1 } } }).catch((error) => console.error("[ai-feature] selfie slot not given back:", error.message));

/**
 * Find My Photos: the selfie is described by the face engine, its vector kept against the guest - one
 * of up to SELFIE_LIMIT active selfies, each searched with - and matched against this event's faces
 * only. Adding a selfie never takes away what the others found. The selfie itself goes to the private
 * bucket.
 */
async function selfie(code, authHeader, file, source) {
  const { event, guest, settings } = await context(code, authHeader);
  if (!selfieSearchOpen(settings)) throw httpError(403, "Selfie search is not open for this event.");
  if (!selfieSourceAllowed(settings.guestAccess, source)) throw httpError(403, source === "upload" ? "Uploading a selfie is not open for this event. Please take one with your camera." : source === "camera" ? "Taking a selfie is not open for this event. Please upload one instead." : "Selfie search is not open for this event.");
  if (!file || !/^image\//.test(file.mimetype || "")) throw httpError(400, "Please send a photo of your face.");
  if (!(await engine.isReady())) throw httpError(503, "Face matching is not available right now. Please try again in a little while.");
  // A slot is taken before the work and given back if no selfie is stored, so a failed upload does
  // not count and a stored one always does.
  await reserveSelfie(prisma, guest.id);
  let stored = false;
  try {
    let described;
    try { described = await engine.describe(file.buffer); } catch (error) { throw httpError(422, `Your selfie could not be read: ${error.message}`); }
    const best = described.faces.filter((face) => face.quality >= Math.min(settings.ai.minFaceQuality, 0.3)).sort((a, b) => b.quality - a.quality)[0];
    if (!best) { await prisma.aiEventGuest.update({ where: { id: guest.id }, data: { selfieStatus: "FAILED" } }); throw httpError(422, "We could not find a clear face in that photo. Try again with your face closer to the camera and well lit."); }
    const [selfieKey, thumbnailKey] = await Promise.all([storage.putPrivate(event.id, "guestSelfies", "jpg", file.buffer, file.mimetype), derivatives.selfieThumbnail(file.buffer).then((buffer) => storage.putPrivate(event.id, "guestSelfies", "webp", buffer, "image/webp")).catch(() => null)]);
    const row = await prisma.aiEventGuestFace.create({ data: { eventId: event.id, guestId: guest.id, selfieKey, thumbnailKey, model: MODEL, dimension: best.embedding.length, vector: vectors.encode(best.embedding), quality: best.quality } });
    // The limit, checked again with this selfie in place: whatever raced past the reservation is undone here.
    if ((await prisma.aiEventGuestFace.count({ where: { guestId: guest.id } })) > SELFIE_LIMIT) {
      await prisma.aiEventGuestFace.delete({ where: { id: row.id } }).catch(() => {});
      await storage.deletePrivateKeys([selfieKey, thumbnailKey]).catch(() => {});
      throw httpError(429, FULL);
    }
    stored = true;
    await prisma.aiEventGuest.update({ where: { id: guest.id }, data: { selfieStatus: "UPLOADED" } });
    await activity.record(event.id, activity.EVENTS.GUEST_SELFIE_ADDED, activity.guestActor(guest), guest.name);
    // Match now, inline, so the guest gets an answer; the queue is only the safety net if this throws.
    let result;
    try { result = await matching.matchGuestAgainstEvent(event.id, guest.id, vectors.normalize(best.embedding), settings.ai); } catch (error) { console.error("[ai-feature] inline selfie match failed, queued:", error.message); await queue.enqueueSelfie(row.id).catch(() => {}); result = { matched: null }; }
    const updated = await prisma.aiEventGuest.findUnique({ where: { id: guest.id } });
    return { matched: result.matched, guest: guestView(updated) };
  } catch (error) {
    if (!stored) await releaseSelfie(prisma, guest.id);
    throw error;
  }
}

/** The guest's active selfies, newest first: ids and when each was added - never a key or a face vector. */
async function selfies(code, authHeader) {
  const { guest } = await context(code, authHeader);
  const rows = await prisma.aiEventGuestFace.findMany({ where: { guestId: guest.id }, orderBy: { createdAt: "desc" }, select: { id: true, createdAt: true, thumbnailKey: true } });
  return { items: rows.map((row) => ({ id: row.id, createdAt: row.createdAt, hasThumbnail: Boolean(row.thumbnailKey) })), count: rows.length, limit: SELFIE_LIMIT };
}

/** One of the guest's own selfies, as its small private thumbnail - only to the session that owns it. */
async function selfieThumbnail(code, authHeader, selfieId) {
  const { guest } = await context(code, authHeader);
  const row = await prisma.aiEventGuestFace.findFirst({ where: { id: selfieId, guestId: guest.id }, select: { thumbnailKey: true } });
  const object = row?.thumbnailKey ? await storage.getPrivateObject(row.thumbnailKey) : null;
  if (!object) throw httpError(404, "Selfie not found.");
  return object;
}

/**
 * Removes one of the guest's own selfies: its face vector and files go now, it is never searched with
 * again, and the matches only it supported go with it - a photo another of their selfies still matches
 * stays (matching.pruneGuestMatches). Removing one already gone answers as done.
 */
async function removeSelfie(code, authHeader, selfieId) {
  const { event, guest, settings } = await context(code, authHeader);
  const row = await prisma.aiEventGuestFace.findFirst({ where: { id: selfieId, guestId: guest.id, eventId: event.id }, select: { id: true, selfieKey: true, thumbnailKey: true } });
  if (row) {
    const { count } = await prisma.aiEventGuestFace.deleteMany({ where: { id: row.id, guestId: guest.id } });
    if (count) {
      await releaseSelfie(prisma, guest.id);
      await storage.deletePrivateKeys([row.selfieKey, row.thumbnailKey].filter(Boolean)).catch((error) => console.error("[ai-feature] selfie files not removed:", error.message));
      await matching.pruneGuestMatches(event.id, guest.id, settings.ai);
      if (!(await prisma.aiEventGuestFace.count({ where: { guestId: guest.id } }))) await prisma.aiEventGuest.update({ where: { id: guest.id }, data: { selfieStatus: "NONE" } });
    }
  }
  const updated = await prisma.aiEventGuest.findUnique({ where: { id: guest.id } });
  return { removed: true, guest: guestView(updated) };
}

/**
 * A guest's photo. The event page optimizes it on the phone to the event's own recipe first, so
 * `thumbnail` and the optimized claim arrive as they do from a staff client; an older page that
 * sends the file alone is derived here as it always was. Never a folder, never a deferred face
 * pass - and never an identity on trust: a guest is anonymous, so the photo's `contentHash` is
 * always the digest of the bytes that arrived, never a fingerprint the guest typed (which could
 * name another photo's row, or pre-empt one the photographer has not uploaded yet), and its size
 * is the size that arrived. What a guest may say is the file's name and when it was taken.
 */
async function guestUpload(code, authHeader, file, { source = null, thumbnail = null } = {}) {
  const { event, guest, settings } = await context(code, authHeader);
  if (!settings.guestAccess.enableGuestUploads) throw httpError(403, "Guest uploads are not open for this event.");
  if (!file) throw httpError(400, "Please choose a photo to upload.");
  const guestSource = source ? { fingerprint: null, sizeBytes: null, fileName: source.fileName, relativePath: null, optimized: source.optimized === true, capturedAt: source.capturedAt } : null;
  const result = await mediaService.upload(event.id, file, { guestId: guest.id, source: guestSource, thumbnail });
  await activity.record(event.id, activity.EVENTS.MEDIA_UPLOADED, activity.guestActor(guest), `${guest.name} uploaded a photo`);
  // No download address: a guest downloads only photos their selfie matched (`myPhotos`).
  return { media: guestMedia({ ...settings, gallery: { ...settings.gallery, allowDownloads: false } })(result.media) };
}

/**
 * The guest's WhatsApp photo summary. Turning it on sends a code by SMS to the guest's own number
 * (notifications/otp.js); only a correct code records consent. Turning it off is immediate. Each is
 * refused where the event does not offer the summary, so a page loaded before the studio switched
 * it off cannot start one.
 */
async function whatsappCode(code, authHeader) {
  const { event, guest } = await context(code, authHeader);
  if (!guestNotifications.eventWants(event)) throw httpError(403, "WhatsApp photo summaries are not offered for this event.");
  return otp.requestCode(guest);
}

async function whatsappVerify(code, authHeader, value) {
  const { event, guest } = await context(code, authHeader);
  if (!guestNotifications.eventWants(event)) throw httpError(403, "WhatsApp photo summaries are not offered for this event.");
  return guestView(await otp.verifyCode(guest, value));
}

/** Consent from the guest for the number they joined with - no code (notifications/otp.optIn). */
async function whatsappConsent(code, authHeader) {
  const { event, guest } = await context(code, authHeader);
  if (!guestNotifications.eventWants(event)) throw httpError(403, "WhatsApp photo summaries are not offered for this event.");
  return guestView(await otp.optIn(guest));
}

/** Withdrawal is always allowed, offered or not: a guest can always say stop. */
async function whatsappStop(code, authHeader) {
  const { guest } = await context(code, authHeader);
  return guestView(await otp.optOut(guest));
}

module.exports = { SELFIE_LIMIT, selfies, selfieThumbnail, removeSelfie, joinVerify, joinResend, isProtected, purgeAbandonedJoins, whatsappCode, whatsappVerify, whatsappConsent, whatsappStop, reserveSelfie, releaseSelfie, selfieSourceAllowed, meta, join, me, rsvp, folders, gallery, myPhotos, rejectMatch, selfie, guestUpload };
