const prisma = require("../../../config/db");
const { httpError } = require("../shared/http");
const activity = require("../shared/activity");
const { loadEvent } = require("../shared/eventAccess");
const { serializeGuest, serializeGroup } = require("../shared/serializers");
const storage = require("../shared/storage");

const normalizePhone = (value) => (value ? String(value).replace(/[\s()-]/g, "") : null);

async function list(eventId, query) {
  await loadEvent(eventId);
  const where = { eventId };
  if (query.search) where.OR = [{ name: { contains: query.search } }, { phone: { contains: normalizePhone(query.search) || query.search } }, { email: { contains: query.search } }];
  if (query.groupId) where.groupId = query.groupId === "none" ? null : query.groupId;
  if (query.rsvp !== "all") where.rsvp = query.rsvp;
  if (query.selfie !== "all") where.selfieStatus = query.selfie;
  const [total, rows] = await Promise.all([
    prisma.aiEventGuest.count({ where }),
    prisma.aiEventGuest.findMany({ where, orderBy: [{ name: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize, include: { group: { select: { id: true, name: true } } } }),
  ]);
  return { items: rows.map(serializeGuest), total, page: query.page, pageSize: query.pageSize };
}

async function groupIn(eventId, groupId) {
  if (!groupId) return null;
  const group = await prisma.aiEventGuestGroup.findFirst({ where: { id: groupId, eventId }, select: { id: true } });
  if (!group) throw httpError(404, "Guest group not found.");
  return group.id;
}

const fields = (body) => ({ name: body.name, phone: normalizePhone(body.phone), email: body.email ?? null, rsvp: body.rsvp, notes: body.notes ?? null });

async function create(eventId, body, user) {
  await loadEvent(eventId);
  const groupId = await groupIn(eventId, body.groupId);
  const row = await prisma.aiEventGuest.create({ data: { eventId, ...fields(body), groupId, source: "ADMIN", createdByUserId: user?.id ?? null }, include: { group: { select: { id: true, name: true } } } });
  await activity.record(eventId, activity.EVENTS.GUEST_ADDED, activity.staffActor(user), row.name);
  return serializeGuest(row);
}

/** Bulk import: a guest whose phone is already on the list is updated rather than doubled. */
async function importMany(eventId, body, user) {
  await loadEvent(eventId);
  const groupId = await groupIn(eventId, body.groupId);
  let created = 0; let updated = 0;
  for (const guest of body.guests) {
    const phone = normalizePhone(guest.phone);
    const existing = phone ? await prisma.aiEventGuest.findFirst({ where: { eventId, phone }, select: { id: true } }) : null;
    const data = { ...fields(guest), ...(guest.groupId !== undefined || groupId ? { groupId: guest.groupId === undefined ? groupId : await groupIn(eventId, guest.groupId) } : {}) };
    if (existing) { await prisma.aiEventGuest.update({ where: { id: existing.id }, data: Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined && value !== null)) }); updated += 1; }
    else { await prisma.aiEventGuest.create({ data: { eventId, ...data, source: "ADMIN", createdByUserId: user?.id ?? null } }); created += 1; }
  }
  await activity.record(eventId, activity.EVENTS.GUESTS_IMPORTED, activity.staffActor(user), `${created} added, ${updated} updated`);
  return { created, updated };
}

async function update(eventId, guestId, body, user) {
  await loadEvent(eventId);
  const existing = await prisma.aiEventGuest.findFirst({ where: { id: guestId, eventId } });
  if (!existing) throw httpError(404, "Guest not found.");
  const data = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.phone !== undefined) data.phone = normalizePhone(body.phone);
  if (body.email !== undefined) data.email = body.email;
  if (body.rsvp !== undefined) data.rsvp = body.rsvp;
  if (body.notes !== undefined) data.notes = body.notes;
  if (body.groupId !== undefined) data.groupId = await groupIn(eventId, body.groupId);
  const row = await prisma.aiEventGuest.update({ where: { id: existing.id }, data, include: { group: { select: { id: true, name: true } } } });
  await activity.record(eventId, activity.EVENTS.GUEST_UPDATED, activity.staffActor(user), row.name);
  return serializeGuest(row);
}

async function remove(eventId, guestId, user) {
  await loadEvent(eventId);
  const existing = await prisma.aiEventGuest.findFirst({ where: { id: guestId, eventId }, include: { faces: { select: { selfieKey: true, thumbnailKey: true } } } });
  if (!existing) throw httpError(404, "Guest not found.");
  await prisma.aiEventGuest.delete({ where: { id: existing.id } });
  await storage.deletePrivateKeys(existing.faces.flatMap((face) => [face.selfieKey, face.thumbnailKey]));
  await activity.record(eventId, activity.EVENTS.GUEST_REMOVED, activity.staffActor(user), existing.name);
  return { id: existing.id, deleted: true };
}

async function listGroups(eventId) {
  await loadEvent(eventId);
  const rows = await prisma.aiEventGuestGroup.findMany({ where: { eventId }, orderBy: { sortOrder: "asc" }, include: { _count: { select: { guests: true } } } });
  return rows.map(serializeGroup);
}

async function createGroup(eventId, body, user) {
  await loadEvent(eventId);
  const last = await prisma.aiEventGuestGroup.findFirst({ where: { eventId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  const row = await prisma.aiEventGuestGroup.create({ data: { eventId, name: body.name, subEventIds: body.subEventIds, sortOrder: (last?.sortOrder ?? -1) + 1 }, include: { _count: { select: { guests: true } } } });
  await activity.record(eventId, activity.EVENTS.GUEST_UPDATED, activity.staffActor(user), `group ${row.name} added`);
  return serializeGroup(row);
}

async function updateGroup(eventId, groupId, body, user) {
  await loadEvent(eventId); await groupIn(eventId, groupId);
  const row = await prisma.aiEventGuestGroup.update({ where: { id: groupId }, data: { ...(body.name !== undefined ? { name: body.name } : {}), ...(body.subEventIds !== undefined ? { subEventIds: body.subEventIds } : {}) }, include: { _count: { select: { guests: true } } } });
  await activity.record(eventId, activity.EVENTS.GUEST_UPDATED, activity.staffActor(user), `group ${row.name} edited`);
  return serializeGroup(row);
}

async function removeGroup(eventId, groupId, user) {
  await loadEvent(eventId); await groupIn(eventId, groupId);
  const row = await prisma.aiEventGuestGroup.delete({ where: { id: groupId } });
  await activity.record(eventId, activity.EVENTS.GUEST_UPDATED, activity.staffActor(user), `group ${row.name} removed`);
  return { id: groupId, deleted: true };
}

module.exports = { list, create, importMany, update, remove, listGroups, createGroup, updateGroup, removeGroup, normalizePhone };
