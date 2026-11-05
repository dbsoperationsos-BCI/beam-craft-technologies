const prisma = require("../../../config/db");
const vectors = require("../shared/vectors");

/**
 * Online clustering: each usable face is compared with the event's person centroids and joins the
 * nearest one above the cluster threshold, or starts a person of its own. Nothing here reads
 * another event's rows - every query names `eventId` - and the centroid is a running mean, so a
 * person's identity sharpens as photos arrive without a batch re-cluster.
 *
 * Two faces from one photo are two different people: a face never joins a person that already
 * holds a face from the same frame.
 */
async function loadCentroids(eventId) {
  const rows = await prisma.aiEventPerson.findMany({ where: { eventId, centroid: { not: null } }, select: { id: true, centroid: true, faceCount: true, guestId: true, hidden: true } });
  return rows.map((row) => ({ id: row.id, vector: vectors.decode(row.centroid), faceCount: row.faceCount, guestId: row.guestId, hidden: row.hidden }));
}

async function assignFaces(eventId, faces, ai) {
  const centroids = await loadCentroids(eventId);
  const takenThisFrame = new Set();
  const assigned = [];
  for (const face of faces) {
    const candidates = centroids.filter((person) => !takenThisFrame.has(person.id));
    const [best] = vectors.topMatches(face.vector, candidates, { k: 1, floor: ai.clusterThreshold });
    let personId;
    if (best) {
      const person = best.candidate;
      const centroid = vectors.updateCentroid(person.vector, person.faceCount, face.vector);
      await prisma.aiEventPerson.update({ where: { id: person.id }, data: { centroid: vectors.encode(centroid), faceCount: { increment: 1 } } });
      person.vector = centroid; person.faceCount += 1;
      personId = person.id;
    } else {
      const created = await prisma.aiEventPerson.create({ data: { eventId, centroid: vectors.encode(face.vector), faceCount: 1, coverFaceId: face.id }, select: { id: true } });
      centroids.push({ id: created.id, vector: vectors.normalize(face.vector), faceCount: 1, guestId: null, hidden: false });
      personId = created.id;
    }
    takenThisFrame.add(personId);
    await prisma.aiEventFace.update({ where: { id: face.id }, data: { personId } });
    assigned.push({ faceId: face.id, personId });
  }
  await recount(eventId, [...takenThisFrame]);
  return assigned;
}

/** Face and photo counts, centroid and cover from the faces a person actually holds. Removes a person left with none. */
async function recount(eventId, personIds) {
  for (const personId of personIds) {
    const faces = await prisma.aiEventFace.findMany({ where: { eventId, personId }, select: { id: true, mediaId: true, quality: true, embedding: { select: { vector: true } } } });
    if (!faces.length) { await prisma.aiEventPerson.deleteMany({ where: { id: personId, eventId } }); continue; }
    const mediaCount = new Set(faces.map((face) => face.mediaId)).size;
    const centroid = vectors.mean(faces.filter((face) => face.embedding).map((face) => vectors.decode(face.embedding.vector)));
    const cover = faces.reduce((best, face) => (!best || face.quality > best.quality ? face : best), null);
    await prisma.aiEventPerson.update({ where: { id: personId }, data: { faceCount: faces.length, mediaCount, centroid: centroid ? vectors.encode(centroid) : null, coverFaceId: cover?.id ?? null } });
  }
}

module.exports = { assignFaces, recount, loadCentroids };
