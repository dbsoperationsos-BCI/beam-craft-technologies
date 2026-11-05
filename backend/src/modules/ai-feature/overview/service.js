const prisma = require("../../../config/db");
const activity = require("../shared/activity");
const { statusFromDates } = require("../events/service");
const { serializeEvent, serializeActivity, toNumber } = require("../shared/serializers");
const summary = require("../processing/summary");

/** The whole workspace on one screen: counts across every live event, the recent ones, and what just happened. */
async function dashboard() {
  const liveEvents = { deletedAt: null };
  const [events, mediaByStatus, mediaByKind, storage, faces, people, matched, unmatched, guests, recentUploads, recentEvents, recent] = await Promise.all([
    prisma.aiEvent.findMany({ where: liveEvents, select: { id: true, startDate: true, endDate: true, archivedAt: true } }),
    prisma.aiEventMedia.groupBy({ by: ["aiStatus"], where: { deletedAt: null, event: liveEvents }, _count: { _all: true } }),
    prisma.aiEventMedia.groupBy({ by: ["kind"], where: { deletedAt: null, event: liveEvents }, _count: { _all: true } }),
    prisma.aiEventMedia.aggregate({ where: { deletedAt: null, event: liveEvents }, _sum: { sizeBytes: true } }),
    prisma.aiEventFace.count({ where: { event: liveEvents } }),
    prisma.aiEventPerson.count({ where: { event: liveEvents, hidden: false } }),
    prisma.aiEventFaceMatch.count({ where: { event: liveEvents, status: { in: ["MATCHED", "CONFIRMED"] } } }),
    prisma.aiEventFace.count({ where: { event: liveEvents, personId: null } }),
    prisma.aiEventGuest.count({ where: { event: liveEvents } }),
    prisma.aiEventMedia.count({ where: { deletedAt: null, event: liveEvents, createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } } }),
    prisma.aiEvent.findMany({ where: { ...liveEvents, archivedAt: null }, orderBy: { updatedAt: "desc" }, take: 6, include: { _count: { select: { guests: true, media: true, faces: true } } } }),
    activity.recent({ limit: 30 }),
  ]);
  const now = new Date();
  const statuses = events.map((event) => statusFromDates(event, now));
  const count = (status) => statuses.filter((value) => value === status).length;
  const media = summary.shape(mediaByStatus);
  const kinds = Object.fromEntries(mediaByKind.map((row) => [row.kind, row._count._all]));
  const processing = await summary.forEvents(recentEvents.map((row) => row.id));
  return {
    events: { total: events.length, active: count("ACTIVE"), upcoming: count("UPCOMING"), completed: count("COMPLETED"), archived: count("ARCHIVED") },
    media: { total: media.total, photos: kinds.PHOTO || 0, videos: kinds.VIDEO || 0, processed: media.completed, processing: media.processing + media.queued, failed: media.failed, percent: media.percent },
    faces: { detected: faces, people, matches: matched, unmatched },
    guests: { total: guests },
    storage: { bytes: toNumber(storage._sum.sizeBytes || 0n), recentUploads },
    recentEvents: recentEvents.map((row) => serializeEvent({ ...row, status: statusFromDates(row, now), processing: processing[row.id] })),
    recentActivity: recent.map(serializeActivity),
  };
}

module.exports = { dashboard };
