const prisma = require("../../../config/db");
const { httpError } = require("../shared/http");
const activity = require("../shared/activity");
const { loadEvent } = require("../shared/eventAccess");
const { serializePerson, serializeMedia } = require("../shared/serializers");
const clustering = require("./clustering");
const matching = require("../matches/matching");
const { mergeGroup } = require("../shared/settingsDefaults");

async function personIn(eventId, personId) {
  const person = await prisma.aiEventPerson.findFirst({ where: { id: personId, eventId }, include: { guest: { select: { id: true, name: true } } } });
  if (!person) throw httpError(404, "Person not found.");
  return person;
}

async function list(eventId, { includeHidden = false, page = 1, pageSize = 60 } = {}) {
  await loadEvent(eventId);
  const where = { eventId, ...(includeHidden ? {} : { hidden: false }) };
  const [total, rows] = await Promise.all([
    prisma.aiEventPerson.count({ where }),
    prisma.aiEventPerson.findMany({ where, orderBy: [{ mediaCount: "desc" }, { createdAt: "asc" }], skip: (page - 1) * pageSize, take: pageSize, include: { guest: { select: { id: true, name: true } } } }),
  ]);
  return { items: rows.map(serializePerson), total, page, pageSize };
}

async function get(eventId, personId, { page = 1, pageSize = 60 } = {}) {
  await loadEvent(eventId);
  const person = await personIn(eventId, personId);
  const faces = await prisma.aiEventFace.findMany({ where: { eventId, personId }, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { media: true } });
  const seen = new Set();
  const media = [];
  for (const face of faces) if (face.media && !face.media.deletedAt && !seen.has(face.mediaId)) { seen.add(face.mediaId); media.push({ ...serializeMedia(face.media), faceId: face.id, box: face.box }); }
  return { person: serializePerson(person), media, page, pageSize, faceCount: person.faceCount };
}

async function rename(eventId, personId, label, user) {
  await loadEvent(eventId); await personIn(eventId, personId);
  const row = await prisma.aiEventPerson.update({ where: { id: personId }, data: { label: label || null }, include: { guest: { select: { id: true, name: true } } } });
  await activity.record(eventId, activity.EVENTS.PERSON_RENAMED, activity.staffActor(user), label);
  return serializePerson(row);
}

async function hide(eventId, personId, hidden, user) {
  await loadEvent(eventId); await personIn(eventId, personId);
  const row = await prisma.aiEventPerson.update({ where: { id: personId }, data: { hidden }, include: { guest: { select: { id: true, name: true } } } });
  await activity.record(eventId, activity.EVENTS.PERSON_HIDDEN, activity.staffActor(user), `${row.label || personId}: ${hidden ? "hidden" : "shown"}`);
  return serializePerson(row);
}

/** Every face of `sourceIds` moves to `targetId`; the sources go. Matches follow the faces. */
async function merge(eventId, targetId, sourceIds, user) {
  await loadEvent(eventId);
  const target = await personIn(eventId, targetId);
  const sources = sourceIds.filter((id) => id !== targetId);
  const count = await prisma.aiEventPerson.count({ where: { eventId, id: { in: sources } } });
  if (count !== sources.length) throw httpError(404, "One of the people to merge was not found.");
  await prisma.$transaction([
    prisma.aiEventFace.updateMany({ where: { eventId, personId: { in: sources } }, data: { personId: targetId } }),
    prisma.aiEventFaceMatch.updateMany({ where: { eventId, personId: { in: sources } }, data: { personId: targetId } }),
    prisma.aiEventPerson.deleteMany({ where: { eventId, id: { in: sources } } }),
  ]);
  await clustering.recount(eventId, [targetId]);
  if (target.guestId) await matching.relinkPersonToGuest(eventId, targetId, target.guestId, await aiFor(eventId));
  await activity.record(eventId, activity.EVENTS.PERSON_MERGED, activity.staffActor(user), `${sources.length} into ${target.label || targetId}`);
  return get(eventId, targetId);
}

/** The named faces leave this person for a new one. */
async function split(eventId, personId, faceIds, user) {
  await loadEvent(eventId); await personIn(eventId, personId);
  const faces = await prisma.aiEventFace.findMany({ where: { eventId, personId, id: { in: faceIds } }, select: { id: true } });
  if (!faces.length) throw httpError(400, "None of those faces belong to this person.");
  const created = await prisma.aiEventPerson.create({ data: { eventId, faceCount: 0 }, select: { id: true } });
  await prisma.$transaction([
    prisma.aiEventFace.updateMany({ where: { eventId, id: { in: faces.map((face) => face.id) } }, data: { personId: created.id } }),
    prisma.aiEventFaceMatch.updateMany({ where: { eventId, faceId: { in: faces.map((face) => face.id) } }, data: { status: "REJECTED", personId: null } }),
  ]);
  await clustering.recount(eventId, [personId, created.id]);
  await activity.record(eventId, activity.EVENTS.PERSON_SPLIT, activity.staffActor(user), `${faces.length} faces`);
  return { person: await get(eventId, personId), created: await get(eventId, created.id) };
}

/** Naming a person as a guest: their photos become that guest's photos, at CONFIRMED. */
async function linkGuest(eventId, personId, guestId, user) {
  await loadEvent(eventId); const person = await personIn(eventId, personId);
  if (guestId) {
    const guest = await prisma.aiEventGuest.findFirst({ where: { id: guestId, eventId }, select: { id: true, name: true } });
    if (!guest) throw httpError(404, "Guest not found.");
    await prisma.aiEventPerson.update({ where: { id: personId }, data: { guestId, label: person.label || guest.name } });
    await matching.relinkPersonToGuest(eventId, personId, guestId, await aiFor(eventId));
    await activity.record(eventId, activity.EVENTS.PERSON_LINKED, activity.staffActor(user), `${person.label || personId} → ${guest.name}`);
  } else {
    await prisma.aiEventPerson.update({ where: { id: personId }, data: { guestId: null } });
  }
  return get(eventId, personId);
}

const aiFor = async (eventId) => mergeGroup("ai", (await prisma.aiEventSetting.findUnique({ where: { eventId } }))?.ai);

module.exports = { list, get, rename, hide, merge, split, linkGuest };
