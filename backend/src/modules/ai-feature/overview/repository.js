const prisma = require("../../../config/db");
const { LISTED_MEDIA } = require("../shared/mediaScope");
const activity = require("../shared/activity");

/**
 * Every read the AI dashboard makes, grouped so the page costs a fixed handful of queries however
 * many events and photos the studio holds — no media row is ever loaded. "Live" means the event
 * is not deleted; media must also not be deleted itself.
 *
 * `mediaCount` on an event is the Media tab's own count (`LISTED_MEDIA`), so the table never
 * disagrees with the screen it opens; the processing figures count every live media row, as the
 * progress card inside the event does.
 */
const liveEvents = { deletedAt: null };
const liveMedia = { deletedAt: null, event: liveEvents };
/**
 * The detection & storage reads take an optional event id: without one they answer for every
 * live event (the AI dashboard), with one for that event alone (its Project Dashboard). One
 * definition of each figure, so the two panels can never count the same thing differently.
 */
const scoped = (where, eventId) => (eventId ? { ...where, eventId } : where);

function createRepository(client = prisma) {
  return {
    readEvents: () => client.aiEvent.findMany({ where: liveEvents, include: { _count: { select: { guests: true, media: { where: LISTED_MEDIA }, faces: true } } } }),
    mediaByEventAndStatus: () => client.aiEventMedia.groupBy({ by: ["eventId", "aiStatus"], where: liveMedia, _count: { _all: true } }),
    mediaByKind: (eventId) => client.aiEventMedia.groupBy({ by: ["kind"], where: scoped(liveMedia, eventId), _count: { _all: true } }),
    storageBytes: async (eventId) => (await client.aiEventMedia.aggregate({ where: scoped(liveMedia, eventId), _sum: { sizeBytes: true } }))._sum.sizeBytes || 0n,
    peopleByEvent: () => client.aiEventPerson.groupBy({ by: ["eventId"], where: { event: liveEvents, hidden: false }, _count: { _all: true } }),
    peopleCount: (eventId) => client.aiEventPerson.count({ where: scoped({ event: liveEvents, hidden: false }, eventId) }),
    faceCount: (eventId) => client.aiEventFace.count({ where: scoped({ event: liveEvents }, eventId) }),
    matchCount: (eventId) => client.aiEventFaceMatch.count({ where: scoped({ event: liveEvents, status: { in: ["MATCHED", "CONFIRMED"] } }, eventId) }),
    unmatchedFaceCount: (eventId) => client.aiEventFace.count({ where: scoped({ event: liveEvents, personId: null }, eventId) }),
    guestCount: (eventId) => client.aiEventGuest.count({ where: scoped({ event: liveEvents }, eventId) }),
    recentUploadCount: (since, eventId) => client.aiEventMedia.count({ where: scoped({ ...liveMedia, createdAt: { gte: since } }, eventId) }),
    latestActivityByEvent: () => client.aiEventActivity.groupBy({ by: ["eventId"], where: { aiEvent: liveEvents }, _max: { createdAt: true } }),
    recentActivity: () => activity.recent({ limit: 30 }),

    /** What happened inside the range: events set up, photos uploaded, photos the engine finished. */
    async periodCounts({ from, to }) {
      const inRange = { gte: from, lt: to };
      const [eventsCreated, photosUploaded, photosProcessed] = await Promise.all([
        client.aiEvent.count({ where: { ...liveEvents, createdAt: inRange } }),
        client.aiEventMedia.count({ where: { ...liveMedia, kind: "PHOTO", createdAt: inRange } }),
        client.aiEventMedia.count({ where: { ...liveMedia, aiStatus: "COMPLETED", aiCompletedAt: inRange } }),
      ]);
      return { eventsCreated, photosUploaded, photosProcessed };
    },

    /**
     * The photo and people figures as they stood at one instant, read from the stamps the rows
     * carry: a photo counted if it was uploaded before then and not yet deleted, a processed
     * photo if the engine had also finished it, a person if the cluster existed. A person hidden
     * since has no stamp for it and so still counts — honest to what the rows hold.
     */
    async asOfCounts(asOf) {
      const existed = { createdAt: { lt: asOf }, OR: [{ deletedAt: null }, { deletedAt: { gte: asOf } }] };
      const [photos, processed, people] = await Promise.all([
        client.aiEventMedia.count({ where: { event: liveEvents, kind: "PHOTO", ...existed } }),
        client.aiEventMedia.count({ where: { event: liveEvents, aiStatus: "COMPLETED", ...existed, AND: [{ OR: [{ aiCompletedAt: null }, { aiCompletedAt: { lt: asOf } }] }] } }),
        client.aiEventPerson.count({ where: { event: liveEvents, hidden: false, createdAt: { lt: asOf } } }),
      ]);
      return { photos, processed, people };
    },
  };
}

module.exports = { createRepository, repository: createRepository() };
