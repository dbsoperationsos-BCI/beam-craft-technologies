const prisma = require("../../../config/db");
const { httpError } = require("../shared/http");
const activity = require("../shared/activity");
const { loadEvent } = require("../shared/eventAccess");
const { serializeMatch } = require("../shared/serializers");
const { recountGuest } = require("./matching");
const runs = require("../processing/runs");

async function list(eventId, { status = "REVIEW_REQUIRED", guestId, page = 1, pageSize = 60 } = {}) {
  await loadEvent(eventId);
  const where = { eventId, ...(status === "all" ? {} : { status }), ...(guestId ? { guestId } : {}), media: { deletedAt: null } };
  const [total, rows] = await Promise.all([
    prisma.aiEventFaceMatch.count({ where }),
    prisma.aiEventFaceMatch.findMany({ where, orderBy: [{ createdAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize, include: { media: true, guest: { select: { id: true, name: true } } } }),
  ]);
  return { items: rows.map(serializeMatch), total, page, pageSize };
}

async function decide(eventId, matchId, status, user) {
  await loadEvent(eventId);
  const match = await prisma.aiEventFaceMatch.findFirst({ where: { id: matchId, eventId } });
  if (!match) throw httpError(404, "Match not found.");
  const row = await prisma.aiEventFaceMatch.update({ where: { id: match.id }, data: { status, reviewedByUserId: user?.id ?? null }, include: { media: true, guest: { select: { id: true, name: true } } } });
  await recountGuest(match.guestId);
  // A confirmed match is news for the guest's photo summary: noted on the event's run (never throws).
  if (status === "CONFIRMED") runs.touch(eventId);
  await activity.record(eventId, status === "REJECTED" ? activity.EVENTS.MATCH_REJECTED : activity.EVENTS.MATCH_CONFIRMED, activity.staffActor(user), `${row.guest?.name || match.guestId} / ${row.media?.fileName || match.mediaId}`);
  return serializeMatch(row);
}

module.exports = { list, decide };
