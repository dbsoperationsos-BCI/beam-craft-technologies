const prisma = require("../../../config/db");

/** Queued / processing / completed / failed counts, as the progress card draws them. */
function shape(rows) {
  const out = { queued: 0, processing: 0, completed: 0, failed: 0, skipped: 0, total: 0 };
  for (const row of rows) {
    const key = { QUEUED: "queued", PROCESSING: "processing", COMPLETED: "completed", FAILED: "failed", SKIPPED: "skipped" }[row.aiStatus];
    if (key) out[key] += row._count._all;
    out.total += row._count._all;
  }
  const done = out.completed + out.failed + out.skipped;
  out.percent = out.total ? Math.round((done / out.total) * 100) : 0;
  return out;
}

async function forEvent(eventId) {
  const rows = await prisma.aiEventMedia.groupBy({ by: ["aiStatus"], where: { eventId, deletedAt: null }, _count: { _all: true } });
  return shape(rows);
}

async function forEvents(eventIds) {
  if (!eventIds.length) return {};
  const rows = await prisma.aiEventMedia.groupBy({ by: ["eventId", "aiStatus"], where: { eventId: { in: eventIds }, deletedAt: null }, _count: { _all: true } });
  const out = {};
  for (const id of eventIds) out[id] = shape(rows.filter((row) => row.eventId === id));
  return out;
}

module.exports = { forEvent, forEvents, shape };
