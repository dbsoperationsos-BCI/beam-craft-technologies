const prisma = require("../../../config/db");
const engine = require("./engine");

/**
 * Online clustering, one photo at a time: each usable face is compared with the project's people
 * (their running centroids) and joins the nearest one above the threshold, or starts a person of
 * its own. Nothing here reads another project's rows - every query names `projectId` - and the
 * centroid is a running mean, so a person's identity sharpens as photos arrive without a batch
 * re-cluster. A photo added months later is compared with the people already found, which is
 * what keeps "only process the new photos" from splitting the couple into two more strangers.
 *
 * Two faces in one photo are two different people: a face never joins a person that already
 * holds a face from the same frame.
 */

/**
 * The decision alone, with no database: which person each face joins. `people` is mutated -
 * centroids and counts move, and a new person is appended with `id: null` - so the caller can
 * persist exactly what was decided. Faces are taken best-quality first so the clearest face in
 * a frame claims the person it most resembles before a blurrier one can take it.
 */
function decide(faces, people, { threshold }) {
  const vectors = engine.getVectors();
  const ordered = [...faces].sort((a, b) => b.quality - a.quality);
  const taken = new Set();
  const decisions = [];
  for (const face of ordered) {
    const candidates = people.filter((person) => !taken.has(person));
    const [best] = vectors.topMatches(face.vector, candidates, { k: 1, floor: threshold });
    let person;
    let score;
    if (best) {
      person = best.candidate;
      person.vector = vectors.updateCentroid(person.vector, person.faceCount, face.vector);
      person.faceCount += 1;
      score = best.score;
    } else {
      person = { id: null, vector: vectors.normalize(face.vector), faceCount: 1, coverQuality: 0 };
      people.push(person);
      score = 1;
    }
    taken.add(person);
    decisions.push({ face, person, score, isNew: !best });
  }
  return decisions;
}

/** Runs `decide` against the project's stored people and writes the outcome: people, then mappings. */
async function assignAndPersist(projectId, imageId, faces, { threshold }) {
  if (!faces.length) return [];
  const vectors = engine.getVectors();
  const rows = await prisma.imageSelectionFacePerson.findMany({ where: { projectId }, select: { id: true, centroid: true, faceCount: true, coverQuality: true }, orderBy: { createdAt: "asc" } });
  const people = rows.map((row) => ({ id: row.id, vector: vectors.decode(row.centroid), faceCount: row.faceCount, coverQuality: row.coverQuality }));
  const decisions = decide(faces, people, { threshold });
  for (const { face, person, score, isNew } of decisions) {
    // A clearer face than the one on show becomes the person's face in the People row.
    const cover = face.quality > person.coverQuality ? { coverImageId: imageId, coverBox: face.box, coverQuality: face.quality } : {};
    if (isNew) {
      const created = await prisma.imageSelectionFacePerson.create({ data: { projectId, centroid: vectors.encode(person.vector), faceCount: 1, ...cover }, select: { id: true } });
      person.id = created.id;
    } else {
      await prisma.imageSelectionFacePerson.update({ where: { id: person.id }, data: { centroid: vectors.encode(person.vector), faceCount: person.faceCount, ...cover } });
    }
    if (cover.coverQuality !== undefined) person.coverQuality = cover.coverQuality;
    await prisma.imageSelectionFaceMapping.upsert({
      where: { personId_imageId: { personId: person.id, imageId } },
      create: { projectId, personId: person.id, imageId, confidence: score, box: face.box, quality: face.quality },
      update: { confidence: score, box: face.box, quality: face.quality },
    });
  }
  return decisions.map(({ person, score, isNew }) => ({ personId: person.id, score, isNew }));
}

/**
 * Face counts and covers from the mappings a person actually holds, after a photo's mappings were
 * cleared or its row deleted. A person left with no photo is removed - the People row would
 * otherwise offer a circle that filters to nothing. The centroid is left as it stands: no per-face
 * vector is kept in Phase 1, and a mean over one fewer face is not worth a second engine run.
 */
async function recount(projectId, personIds) {
  for (const personId of new Set(personIds.filter(Boolean))) {
    const mappings = await prisma.imageSelectionFaceMapping.findMany({ where: { projectId, personId }, select: { imageId: true, box: true, quality: true } });
    if (!mappings.length) { await prisma.imageSelectionFacePerson.deleteMany({ where: { id: personId, projectId } }); continue; }
    const person = await prisma.imageSelectionFacePerson.findFirst({ where: { id: personId, projectId }, select: { coverImageId: true } });
    if (!person) continue;
    const coverStands = person.coverImageId && mappings.some((mapping) => mapping.imageId === person.coverImageId);
    const best = mappings.reduce((top, mapping) => (!top || mapping.quality > top.quality ? mapping : top), null);
    await prisma.imageSelectionFacePerson.update({ where: { id: personId }, data: { faceCount: mappings.length, ...(coverStands ? {} : { coverImageId: best.imageId, coverBox: best.box, coverQuality: best.quality }) } });
  }
}

/** People whose photos have all been deleted since - the database cascades their mappings away, and this takes the person. */
const sweepEmptyPeople = (projectId) => prisma.imageSelectionFacePerson.deleteMany({ where: { projectId, mappings: { none: {} } } });

module.exports = { decide, assignAndPersist, recount, sweepEmptyPeople };
