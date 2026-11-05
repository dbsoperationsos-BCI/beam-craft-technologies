const { withUserNames } = require("../../../services/userNames");
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
const { LISTED_MEDIA } = require("../shared/mediaScope");
const watermarks = require("../watermarks/service");
const queue = require("../processing/queue");
const { assertCanRequireCodes } = require("../notifications/otp");
const { everyChunk } = require("../../../services/wordChunks");

// `media` is the All Photos count: exactly what the Media tab lists (`LISTED_MEDIA`) - live rows
// in a folder, plus a guest's uploads - never a deleted row or a staff row left in no folder.
const COUNTS = { _count: { select: { guests: true, media: { where: LISTED_MEDIA }, faces: true } } };

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
  // Word Chunk Search: every word typed, any order.
  const chunks = everyChunk(query.search, (chunk) => ({ OR: [{ name: { contains: chunk } }, { location: { contains: chunk } }, { eventType: { contains: chunk } }] }));
  if (chunks.length) where.AND = chunks;
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
  // Who created each event, by name (`services/userNames`).
  return { items: await withUserNames(page.map((row) => serializeEvent({ ...row, processing: processing[row.id] }))), total, page: query.page, pageSize: query.pageSize };
}

async function get(eventId) {
  const event = await loadEvent(eventId, { include: { ...COUNTS, subEvents: { orderBy: { sortOrder: "asc" } }, setting: true, share: true } });
  const processing = await processingSummary.forEvent(eventId);
  return serializeEvent({ ...event, status: statusFromDates(event), processing });
}

async function create(body, user) {
  const defaultsRow = await defaults.rawRow();
  const settings = snapshotForEvent(defaultsRow, body.settings);
  assertCanRequireCodes(body.settings?.guestAccess);
  // The preset is checked before anything is written; its copy needs the event's id, so it is
  // taken just after, and an event whose copy cannot be taken is not left behind half made.
  settings.gallery = { ...settings.gallery, watermarkSnapshot: null };
  await watermarks.assertPreset(settings.gallery.watermarkPresetId);
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
  if (settings.gallery.watermarkPresetId) {
    try {
      const watermarkSnapshot = await watermarks.snapshotFor(created.id, settings.gallery.watermarkPresetId);
      await prisma.aiEventSetting.update({ where: { eventId: created.id }, data: { gallery: { ...settings.gallery, watermarkSnapshot } } });
    } catch (error) {
      await storage.deleteEventObjects(created.id).catch(() => {});
      await prisma.aiEvent.delete({ where: { id: created.id } }).catch(() => {});
      throw error;
    }
  }
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
  out.gallery = { ...out.gallery, watermarkSnapshot: watermarks.serializeSnapshot(out.gallery.watermarkSnapshot) };
  return out;
}

async function saveSettings(eventId, patch, user) {
  const event = await loadEvent(eventId, { include: { setting: true } });
  const data = { updatedByUserId: user?.id ?? null };
  for (const group of EVENT_GROUPS) data[group] = mergeGroup(group, { ...mergeGroup(group, event.setting?.[group]), ...(patch[group] || {}) });
  // Only a save that turns it on is refused; one that leaves it on, or turns it off, is not.
  if (!mergeGroup("guestAccess", event.setting?.guestAccess).verifyPhone) assertCanRequireCodes(patch.guestAccess);
  // The watermark copy is the server's: retaken when another preset is chosen (or the same one is
  // asked for again with `watermarkRefresh`), dropped when none is, and otherwise left as it was.
  const before = mergeGroup("gallery", event.setting?.gallery);
  const presetChanged = (data.gallery.watermarkPresetId || null) !== (before.watermarkPresetId || null);
  let staleLogo = null;
  if (presetChanged || (patch.gallery?.watermarkRefresh && data.gallery.watermarkPresetId)) {
    staleLogo = before.watermarkSnapshot?.logoKey || null;
    data.gallery.watermarkSnapshot = data.gallery.watermarkPresetId ? await watermarks.snapshotFor(event.id, data.gallery.watermarkPresetId) : null;
  }
  try {
    await prisma.aiEventSetting.upsert({ where: { eventId: event.id }, create: { eventId: event.id, ...data }, update: data });
  } catch (error) {
    // A logo copied for a save that did not land is nobody's.
    const copied = data.gallery.watermarkSnapshot?.logoKey;
    if (copied && copied !== before.watermarkSnapshot?.logoKey) await storage.deletePublicKeys([copied]);
    throw error;
  }
  if (staleLogo && staleLogo !== data.gallery.watermarkSnapshot?.logoKey) await storage.deletePublicKeys([staleLogo]);
  // Guests are handed copies drawn with the new look as soon as the worker gets to them; the old
  // look's copies are discarded there.
  if (watermarks.watermarkRequired(data.gallery) !== watermarks.watermarkRequired(before) || presetChanged || patch.gallery?.watermarkRefresh) queue.enqueueWatermarks(event.id).catch((error) => console.error("[ai-feature] watermark enqueue failed:", error.message));
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
  // The copy gets its own copy of the watermark logo, so deleting either event leaves the other whole.
  const sourceGallery = mergeGroup("gallery", source.setting?.gallery);
  if (sourceGallery.watermarkSnapshot) {
    const watermarkSnapshot = await watermarks.copySnapshot(sourceGallery.watermarkSnapshot, created.id).catch(() => null);
    // A copy whose logo could not be taken does not claim a watermark it cannot draw: it is switched
    // off, where the event's Settings shows it, rather than left on with nothing behind it.
    await prisma.aiEventSetting.update({ where: { eventId: created.id }, data: { gallery: { ...sourceGallery, watermarkSnapshot, ...(watermarkSnapshot ? {} : { watermark: false }) } } });
  }
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
