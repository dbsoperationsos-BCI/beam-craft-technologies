const prisma = require("../../../config/db");
const { compressImage } = require("../../../services/imageCompression");
const { httpError } = require("../shared/http");
const storage = require("../shared/storage");
const keys = require("../shared/storageKeys");
const activity = require("../shared/activity");
const { snapshotForEvent, mergeGroup, EVENT_GROUPS } = require("../shared/settingsDefaults");
const defaults = require("../default-settings/service");
const { loadEvent } = require("../shared/eventAccess");
const { serializeEvent } = require("../shared/serializers");
const processingSummary = require("../processing/summary");

const COUNTS = { _count: { select: { guests: true, media: true, faces: true } } };

/**
 * The status an event reads as, from its dates: UPCOMING before the start, ACTIVE between the
 * start and the end (the start day alone when there is no end), COMPLETED after. An archived
 * event keeps ARCHIVED. Recomputed on every read so a gallery moves along without a cron.
 */
function statusFromDates(event, now = new Date()) {
  if (event.archivedAt) return "ARCHIVED";
  const start = new Date(event.startDate);
  const end = event.endDate ? new Date(event.endDate) : new Date(start);
  end.setHours(23, 59, 59, 999);
  if (now < new Date(start.getFullYear(), start.getMonth(), start.getDate())) return "UPCOMING";
  if (now > end) return "COMPLETED";
  return "ACTIVE";
}

async function storeCover(eventId, source, previousKey) {
  if (source === undefined) return undefined;
  if (source === null) { if (previousKey) await storage.deletePublicKeys([previousKey]); return null; }
  if (/^https?:\/\//i.test(source)) return previousKey; // already ours; nothing to do
  const compressed = await compressImage(source, { maxBytes: 600 * 1024, maxDimension: 2000 });
  const key = await storage.putPublic(eventId, "cover", compressed.extension, compressed.buffer, compressed.mimeType);
  if (previousKey) await storage.deletePublicKeys([previousKey]);
  return key;
}

const sanitizeSubEvents = (rows) => rows.map((row, index) => ({ name: row.name, date: row.date ? new Date(row.date) : null, startTime: row.startTime ?? null, endTime: row.endTime ?? null, location: row.location ?? null, description: row.description ?? null, sortOrder: index }));

async function list(query, userId) {
  const where = { deletedAt: null };
  if (query.search) where.OR = [{ name: { contains: query.search } }, { location: { contains: query.search } }, { eventType: { contains: query.search } }];
  if (query.status === "archived") where.archivedAt = { not: null };
  else where.archivedAt = null;
  const orderBy = { newest: { createdAt: "desc" }, oldest: { createdAt: "asc" }, eventDate: { startDate: "desc" }, name: { name: "asc" } }[query.sort];
  const rows = await prisma.aiEvent.findMany({ where, orderBy, include: { ...COUNTS, share: true } });
  const now = new Date();
  let filtered = rows.map((row) => ({ ...row, status: statusFromDates(row, now) }));
  if (["active", "upcoming", "completed"].includes(query.status)) filtered = filtered.filter((row) => row.status === query.status.toUpperCase());
  const total = filtered.length;
  const page = filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
  const processing = await processingSummary.forEvents(page.map((row) => row.id));
  return { items: page.map((row) => serializeEvent({ ...row, processing: processing[row.id] })), total, page: query.page, pageSize: query.pageSize };
}

async function get(eventId) {
  const event = await loadEvent(eventId, { include: { ...COUNTS, subEvents: { orderBy: { sortOrder: "asc" } }, setting: true, share: true } });
  const processing = await processingSummary.forEvent(eventId);
  return serializeEvent({ ...event, status: statusFromDates(event), processing });
}

async function create(body, user) {
  const defaultsRow = await defaults.rawRow();
  const settings = snapshotForEvent(defaultsRow, body.settings);
  const created = await prisma.$transaction(async (tx) => {
    const event = await tx.aiEvent.create({ data: {
      name: body.name, eventType: body.eventType, startDate: new Date(body.startDate), endDate: body.endDate ? new Date(body.endDate) : null,
      timezone: body.timezone || mergeGroup("general", defaultsRow?.general).defaultTimezone, location: body.location ?? null, description: body.description ?? null,
      branch: body.branch ?? null, branchId: body.branchId ?? null, createdByUserId: user?.id ?? null,
      setting: { create: { ...settings, updatedByUserId: user?.id ?? null } },
      subEvents: { create: sanitizeSubEvents(body.subEvents || []) },
    } });
    return event;
  });
  if (body.coverImage) {
    const coverKey = await storeCover(created.id, body.coverImage, null);
    if (coverKey) await prisma.aiEvent.update({ where: { id: created.id }, data: { coverKey } });
  }
  await activity.record(created.id, activity.EVENTS.EVENT_CREATED, activity.staffActor(user), created.name);
  return get(created.id);
}

async function update(eventId, body, user) {
  const event = await loadEvent(eventId);
  if (body.endDate !== undefined || body.startDate !== undefined) {
    const start = Date.parse(body.startDate ?? event.startDate);
    const end = body.endDate === undefined ? (event.endDate ? event.endDate.getTime() : null) : (body.endDate ? Date.parse(body.endDate) : null);
    if (end !== null && end < start) throw httpError(400, "The end date is before the start date.");
  }
  const coverKey = await storeCover(event.id, body.coverImage, event.coverKey);
  const data = {};
  for (const key of ["name", "eventType", "timezone", "location", "description", "branch", "branchId"]) if (body[key] !== undefined) data[key] = body[key];
  if (body.startDate !== undefined) data.startDate = new Date(body.startDate);
  if (body.endDate !== undefined) data.endDate = body.endDate ? new Date(body.endDate) : null;
  if (coverKey !== undefined) data.coverKey = coverKey;
  await prisma.aiEvent.update({ where: { id: event.id }, data });
  await activity.record(event.id, activity.EVENTS.EVENT_UPDATED, activity.staffActor(user), Object.keys(data).join(", "));
  return get(event.id);
}

async function readSettings(eventId) {
  const event = await loadEvent(eventId, { include: { setting: true } });
  const out = {};
  for (const group of EVENT_GROUPS) out[group] = mergeGroup(group, event.setting?.[group]);
  return out;
}

async function saveSettings(eventId, patch, user) {
  const event = await loadEvent(eventId, { include: { setting: true } });
  const data = { updatedByUserId: user?.id ?? null };
  for (const group of EVENT_GROUPS) data[group] = mergeGroup(group, { ...mergeGroup(group, event.setting?.[group]), ...(patch[group] || {}) });
  await prisma.aiEventSetting.upsert({ where: { eventId: event.id }, create: { eventId: event.id, ...data }, update: data });
  await activity.record(event.id, activity.EVENTS.SETTINGS_UPDATED, activity.staffActor(user), Object.keys(patch).join(", "));
  return readSettings(event.id);
}

/** A copy of the event's shape - details, sub-events, settings, guest groups - and none of its media, guests or faces. */
async function duplicate(eventId, body, user) {
  const source = await loadEvent(eventId, { include: { setting: true, subEvents: { orderBy: { sortOrder: "asc" } }, guestGroups: { orderBy: { sortOrder: "asc" } } } });
  const created = await prisma.aiEvent.create({ data: {
    name: body.name || `${source.name} (copy)`, eventType: source.eventType, startDate: source.startDate, endDate: source.endDate, timezone: source.timezone, location: source.location, description: source.description,
    branch: source.branch, branchId: source.branchId, createdByUserId: user?.id ?? null,
    setting: source.setting ? { create: { guestAccess: source.setting.guestAccess, ai: source.setting.ai, media: source.setting.media, gallery: source.setting.gallery, privacy: source.setting.privacy, notifications: source.setting.notifications, updatedByUserId: user?.id ?? null } } : undefined,
    subEvents: { create: source.subEvents.map((row) => ({ name: row.name, date: row.date, startTime: row.startTime, endTime: row.endTime, location: row.location, description: row.description, sortOrder: row.sortOrder })) },
    guestGroups: { create: source.guestGroups.map((row) => ({ name: row.name, subEventIds: [], sortOrder: row.sortOrder })) },
  } });
  await activity.record(created.id, activity.EVENTS.EVENT_DUPLICATED, activity.staffActor(user), `from ${source.name}`);
  return get(created.id);
}

async function archive(eventId, user) {
  const event = await loadEvent(eventId);
  await prisma.aiEvent.update({ where: { id: event.id }, data: { archivedAt: new Date(), status: "ARCHIVED" } });
  await activity.record(event.id, activity.EVENTS.EVENT_ARCHIVED, activity.staffActor(user));
  return get(event.id);
}

async function restore(eventId, user) {
  const event = await loadEvent(eventId);
  await prisma.aiEvent.update({ where: { id: event.id }, data: { archivedAt: null, status: statusFromDates({ ...event, archivedAt: null }) } });
  await activity.record(event.id, activity.EVENTS.EVENT_RESTORED, activity.staffActor(user));
  return get(event.id);
}

/**
 * Soft-deletes the row, then takes the objects out of R2 and the child rows out of the database in
 * the background. The row is what the studio sees go; the rest follows within seconds.
 */
async function remove(eventId, user) {
  const event = await loadEvent(eventId);
  await prisma.aiEvent.update({ where: { id: event.id }, data: { deletedAt: new Date() } });
  await activity.record(event.id, activity.EVENTS.EVENT_DELETED, activity.staffActor(user), event.name);
  setImmediate(async () => {
    try {
      await storage.deleteEventObjects(event.id);
      await prisma.aiEvent.delete({ where: { id: event.id } });
    } catch (error) {
      console.error("[ai-feature] Deferred event purge failed:", error.message);
    }
  });
  return { id: event.id, deleted: true };
}

module.exports = { list, get, create, update, duplicate, archive, restore, remove, readSettings, saveSettings, statusFromDates, sanitizeSubEvents, keys };
