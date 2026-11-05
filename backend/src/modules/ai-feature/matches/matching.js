const prisma = require("../../../config/db");
const vectors = require("../shared/vectors");
const activity = require("../shared/activity");

/**
 * Matching: a face in a photo against the guests who have registered a selfie, and a new selfie
 * against every face the event already holds. Both directions write `ai_event_face_match` rows,
 * one per guest per photo, and both are scoped to one event by the queries they run.
 *
 * A rejected match stays rejected: re-running never revives it, and the face vectors behind it are
 * never deleted because of it.
 */
function statusFor(band, ai) {
  if (band === "HIGH") return "MATCHED";
  if (band === "MEDIUM") return ai.mediumConfidenceHandling === "AUTO" ? "MATCHED" : ai.mediumConfidenceHandling === "HIDE" ? null : "REVIEW_REQUIRED";
  return ai.lowConfidenceHandling === "REVIEW" ? "REVIEW_REQUIRED" : ai.lowConfidenceHandling === "AUTO" ? "MATCHED" : null;
}

async function loadGuestVectors(eventId) {
  const rows = await prisma.aiEventGuestFace.findMany({ where: { eventId }, select: { guestId: true, vector: true } });
  return rows.map((row) => ({ id: row.guestId, vector: vectors.decode(row.vector) }));
}

async function upsertMatch(eventId, { guestId, mediaId, faceId, personId, similarity, band, status, source }) {
  const existing = await prisma.aiEventFaceMatch.findUnique({ where: { guestId_mediaId: { guestId, mediaId } } });
  if (existing) {
    if (existing.status === "REJECTED" || existing.status === "CONFIRMED") return existing;
    if (similarity <= existing.similarity && existing.status === status) return existing;
    return prisma.aiEventFaceMatch.update({ where: { id: existing.id }, data: { faceId, personId, similarity, band, status } });
  }
  const created = await prisma.aiEventFaceMatch.create({ data: { eventId, guestId, mediaId, faceId, personId, similarity, band, status, source } });
  await recountGuest(guestId);
  return created;
}

async function recountGuest(guestId) {
  const matchedCount = await prisma.aiEventFaceMatch.count({ where: { guestId, status: { in: ["MATCHED", "CONFIRMED"] } } });
  await prisma.aiEventGuest.update({ where: { id: guestId }, data: { matchedCount } }).catch(() => {});
}

/** Faces just found in one photo, against the event's registered guests. */
async function matchFacesToGuests(eventId, mediaId, faces, ai) {
  const guests = await loadGuestVectors(eventId);
  if (!guests.length) return [];
  const floor = Math.min(ai.similarityMedium, ai.similarityHigh);
  const written = [];
  for (const face of faces) {
    const personId = (await prisma.aiEventFace.findUnique({ where: { id: face.id }, select: { personId: true } }))?.personId ?? null;
    for (const hit of vectors.topMatches(face.vector, guests, { k: 3, floor: ai.lowConfidenceHandling === "HIDE" ? floor : 0.3 })) {
      const band = vectors.bandFor(hit.score, { high: ai.similarityHigh, medium: ai.similarityMedium });
      const status = statusFor(band, ai);
      if (!status) continue;
      const row = await upsertMatch(eventId, { guestId: hit.id, mediaId, faceId: face.id, personId, similarity: hit.score, band, status, source: "AUTO" });
      written.push(row);
      if (row.status === "MATCHED" && row.createdAt.getTime() > Date.now() - 5000) await activity.record(eventId, activity.EVENTS.MATCH_CREATED, activity.systemActor(), `guest ${hit.id} in photo ${mediaId}`);
    }
  }
  return written;
}

/** A guest's selfie against every face the event holds. Returns how many photos matched. */
async function matchGuestAgainstEvent(eventId, guestId, selfieVector, ai) {
  const faces = await prisma.aiEventFaceEmbedding.findMany({ where: { eventId, face: { quality: { gte: ai.minFaceQuality }, media: { deletedAt: null } } }, select: { faceId: true, vector: true, face: { select: { mediaId: true, personId: true } } } });
  const floor = ai.lowConfidenceHandling === "HIDE" ? Math.min(ai.similarityMedium, ai.similarityHigh) : 0.3;
  let matched = 0;
  const bestPerMedia = new Map();
  for (const row of faces) {
    const score = vectors.similarity(selfieVector, vectors.decode(row.vector));
    if (score < floor) continue;
    const current = bestPerMedia.get(row.face.mediaId);
    if (!current || score > current.score) bestPerMedia.set(row.face.mediaId, { score, faceId: row.faceId, personId: row.face.personId });
  }
  for (const [mediaId, hit] of bestPerMedia) {
    const band = vectors.bandFor(hit.score, { high: ai.similarityHigh, medium: ai.similarityMedium });
    const status = statusFor(band, ai);
    if (!status) continue;
    const row = await upsertMatch(eventId, { guestId, mediaId, faceId: hit.faceId, personId: hit.personId, similarity: hit.score, band, status, source: "SELFIE_SEARCH" });
    if (row.status === "MATCHED" || row.status === "CONFIRMED") matched += 1;
  }
  await recountGuest(guestId);
  return { matched, considered: bestPerMedia.size };
}

/** Staff named a person as a guest: every photo of that person is that guest's, CONFIRMED. */
async function relinkPersonToGuest(eventId, personId, guestId) {
  const faces = await prisma.aiEventFace.findMany({ where: { eventId, personId }, select: { id: true, mediaId: true } });
  for (const face of faces) {
    const existing = await prisma.aiEventFaceMatch.findUnique({ where: { guestId_mediaId: { guestId, mediaId: face.mediaId } } });
    if (existing) { if (existing.status !== "REJECTED") await prisma.aiEventFaceMatch.update({ where: { id: existing.id }, data: { status: "CONFIRMED", personId, faceId: face.id } }); continue; }
    await prisma.aiEventFaceMatch.create({ data: { eventId, guestId, mediaId: face.mediaId, faceId: face.id, personId, similarity: 1, band: "HIGH", status: "CONFIRMED", source: "PERSON_LINK" } });
  }
  await recountGuest(guestId);
}

module.exports = { matchFacesToGuests, matchGuestAgainstEvent, relinkPersonToGuest, recountGuest, statusFor };
