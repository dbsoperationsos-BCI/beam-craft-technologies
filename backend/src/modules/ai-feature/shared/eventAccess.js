const prisma = require("../../../config/db");
const { httpError } = require("./http");

/**
 * The one way a request reaches an event: by id, live, and in the same query - so a URL naming an
 * event that is deleted, or that does not exist, is a 404 before any child is touched. Every
 * feature under `/events/:eventId` starts here, and every child query then names `eventId` again
 * so nothing can be read across events by guessing a child id.
 */
async function loadEvent(eventId, { include, includeArchived = true } = {}) {
  const event = await prisma.aiEvent.findFirst({ where: { id: String(eventId), deletedAt: null, ...(includeArchived ? {} : { archivedAt: null }) }, ...(include ? { include } : {}) });
  if (!event) throw httpError(404, "Event not found.");
  return event;
}

module.exports = { loadEvent };
