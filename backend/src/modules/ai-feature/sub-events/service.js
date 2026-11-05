const prisma = require("../../../config/db");
const { httpError } = require("../shared/http");
const activity = require("../shared/activity");
const { loadEvent } = require("../shared/eventAccess");
const { serializeSubEvent } = require("../shared/serializers");

const listRows = (eventId) => prisma.aiEventSubEvent.findMany({ where: { eventId }, orderBy: { sortOrder: "asc" } });
async function list(eventId) { await loadEvent(eventId); return (await listRows(eventId)).map(serializeSubEvent); }

const fields = (row) => ({ name: row.name, date: row.date ? new Date(row.date) : null, startTime: row.startTime ?? null, endTime: row.endTime ?? null, location: row.location ?? null, description: row.description ?? null });

async function create(eventId, body, user) {
  await loadEvent(eventId);
  const last = await prisma.aiEventSubEvent.findFirst({ where: { eventId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  const row = await prisma.aiEventSubEvent.create({ data: { eventId, ...fields(body), sortOrder: (last?.sortOrder ?? -1) + 1 } });
  await activity.record(eventId, activity.EVENTS.SUB_EVENTS_UPDATED, activity.staffActor(user), `added ${row.name}`);
  return serializeSubEvent(row);
}

async function update(eventId, subEventId, body, user) {
  await loadEvent(eventId);
  const existing = await prisma.aiEventSubEvent.findFirst({ where: { id: subEventId, eventId } });
  if (!existing) throw httpError(404, "Sub-event not found.");
  const row = await prisma.aiEventSubEvent.update({ where: { id: existing.id }, data: fields({ ...existing, ...body }) });
  await activity.record(eventId, activity.EVENTS.SUB_EVENTS_UPDATED, activity.staffActor(user), `edited ${row.name}`);
  return serializeSubEvent(row);
}

async function remove(eventId, subEventId, user) {
  await loadEvent(eventId);
  const existing = await prisma.aiEventSubEvent.findFirst({ where: { id: subEventId, eventId } });
  if (!existing) throw httpError(404, "Sub-event not found.");
  await prisma.aiEventSubEvent.delete({ where: { id: existing.id } });
  await activity.record(eventId, activity.EVENTS.SUB_EVENTS_UPDATED, activity.staffActor(user), `removed ${existing.name}`);
  return { id: existing.id, deleted: true };
}

/** `order` is every sub-event id in its new position; ids not named keep their relative order after them. */
async function reorder(eventId, order, user) {
  await loadEvent(eventId);
  const rows = await listRows(eventId);
  const known = new Set(rows.map((row) => row.id));
  const wanted = order.filter((id) => known.has(id));
  const rest = rows.map((row) => row.id).filter((id) => !wanted.includes(id));
  const final = [...wanted, ...rest];
  await prisma.$transaction(final.map((id, index) => prisma.aiEventSubEvent.update({ where: { id }, data: { sortOrder: index } })));
  await activity.record(eventId, activity.EVENTS.SUB_EVENTS_UPDATED, activity.staffActor(user), "reordered");
  return list(eventId);
}

/** Summary per sub-event for the event overview: media counted through the folders bound to it. */
async function summary(eventId) {
  const rows = await listRows(eventId);
  const folders = await prisma.aiEventMediaFolder.findMany({ where: { eventId }, select: { id: true, subEventId: true } });
  const counts = await prisma.aiEventMedia.groupBy({ by: ["folderId"], where: { eventId, deletedAt: null, kind: "PHOTO" }, _count: { _all: true } });
  const byFolder = new Map(counts.map((row) => [row.folderId, row._count._all]));
  return rows.map((row) => ({ ...serializeSubEvent(row), photoCount: folders.filter((folder) => folder.subEventId === row.id).reduce((sum, folder) => sum + (byFolder.get(folder.id) || 0), 0) }));
}

module.exports = { list, create, update, remove, reorder, summary };
