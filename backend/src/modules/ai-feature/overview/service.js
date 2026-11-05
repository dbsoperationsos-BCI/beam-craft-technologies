const { withUserNames } = require("../../../services/userNames");
const { repository } = require("./repository");
const { statusFromDates } = require("../events/service");
const { serializeEvent, serializeActivity, toNumber } = require("../shared/serializers");
const storage = require("../shared/storage");
const summary = require("../processing/summary");
const { loadEvent } = require("../shared/eventAccess");
const { rangeBounds, DEFAULT_RANGE } = require("../../../services/dashboardRange");

/**
 * The AI Feature dashboard, answered in one request, on the pattern of the Image Selection
 * dashboard: ten headline figures that are *positions* (every live event and photo as it stands),
 * a `period` of what happened inside the range picked above them, and a `trend` per figure
 * measured from the first instant of that range — reconstructed from the stamps the rows carry,
 * exactly as Image Selection does, so an event created on the 1st is in the period and not in
 * the "before". A figure with no stamp to read its past from (the queue, the failures) gets no
 * trend rather than an invented one.
 *
 * Status is `statusFromDates`, the same rule every event screen reads, asked at `now` for the
 * counts and at the range's start for the trend, with an archive that happened later set aside.
 * The keys the first overview answered (`events`, `media`, `faces`, `guests`, `storage`,
 * `recentEvents`, `recentActivity`) keep their shape, since a desktop build in the field may
 * still read them.
 */
const PROGRESS_LIMIT = 5;
const RECENT_LIMIT = 6;
const DAY_MS = 24 * 3600 * 1000;
const time = (value) => (value ? new Date(value).getTime() : 0);
const later = (first, second) => (time(second) > time(first) ? second : first);

/** The dated status an event had at an instant, with an archive that had not yet happened masked. */
function statusAt(event, at) {
  const archivedAt = event.archivedAt && new Date(event.archivedAt) < at ? event.archivedAt : null;
  return statusFromDates({ ...event, archivedAt }, at);
}

function countStatuses(statuses) {
  const count = (status) => statuses.filter((value) => value === status).length;
  return { total: statuses.length, active: count("ACTIVE"), upcoming: count("UPCOMING"), completed: count("COMPLETED"), archived: count("ARCHIVED") };
}

function createOverviewService(repo = repository, dependencies = {}) {
  const now = dependencies.now || (() => new Date());
  const findEvent = dependencies.loadEvent || loadEvent;

  async function dashboard(query = {}) {
    const at = now();
    const range = rangeBounds(query.range || DEFAULT_RANGE, at);
    const [events, mediaRows, mediaByKind, bytes, peopleRows, matches, unmatched, guests, recentUploads, activityRows, recent, period, asOf] = await Promise.all([
      repo.readEvents(),
      repo.mediaByEventAndStatus(),
      repo.mediaByKind(),
      repo.storageBytes(),
      repo.peopleByEvent(),
      repo.matchCount(),
      repo.unmatchedFaceCount(),
      repo.guestCount(),
      repo.recentUploadCount(new Date(at.getTime() - DAY_MS)),
      repo.latestActivityByEvent(),
      repo.recentActivity(),
      repo.periodCounts(range),
      range.key === "lifetime" ? null : repo.asOfCounts(range.from),
    ]);

    const processingByEvent = Object.fromEntries(events.map((event) => [event.id, summary.shape(mediaRows.filter((row) => row.eventId === event.id))]));
    const peopleByEvent = Object.fromEntries(peopleRows.map((row) => [row.eventId, row._count._all]));
    const activityByEvent = Object.fromEntries(activityRows.map((row) => [row.eventId, row._max.createdAt]));

    const rows = events.map((event) => {
      const processing = processingByEvent[event.id];
      const counts = event._count || {};
      return {
        id: event.id, name: event.name, eventType: event.eventType, startDate: event.startDate, endDate: event.endDate,
        status: statusFromDates(event, at), archivedAt: event.archivedAt, coverUrl: storage.publicUrl(event.coverKey),
        guestCount: counts.guests ?? 0, mediaCount: counts.media ?? 0, faceCount: counts.faces ?? 0,
        processedCount: processing.completed, failedCount: processing.failed, processingCount: processing.queued + processing.processing,
        peopleCount: peopleByEvent[event.id] || 0, percent: processing.percent,
        lastActivityAt: later(event.updatedAt, activityByEvent[event.id] || null),
      };
    }).sort((first, second) => time(second.lastActivityAt) - time(first.lastActivityAt));

    const eventCounts = countStatuses(rows.map((row) => row.status));
    const media = summary.shape(mediaRows);
    const kinds = Object.fromEntries(mediaByKind.map((row) => [row.kind, row._count._all]));
    const people = rows.reduce((sum, row) => sum + row.peopleCount, 0);
    const faces = rows.reduce((sum, row) => sum + row.faceCount, 0);
    const current = {
      totalEvents: eventCounts.total, activeEvents: eventCounts.active, upcomingEvents: eventCounts.upcoming, completedEvents: eventCounts.completed, archivedEvents: eventCounts.archived,
      processingPhotos: media.processing + media.queued, totalPhotos: kinds.PHOTO || 0, processedPhotos: media.completed, failedPhotos: media.failed, peopleDetected: people,
    };

    let trend = null;
    if (asOf) {
      const stood = events.filter((event) => new Date(event.createdAt) < range.from);
      const before = countStatuses(stood.map((event) => statusAt(event, range.from)));
      const previous = {
        totalEvents: before.total, activeEvents: before.active, upcomingEvents: before.upcoming, completedEvents: before.completed, archivedEvents: before.archived,
        totalPhotos: asOf.photos, processedPhotos: asOf.processed, peopleDetected: asOf.people,
      };
      trend = Object.fromEntries(Object.entries(previous).map(([key, value]) => [key, { before: value, delta: current[key] - value }]));
    }

    // The six most recently worked-on live, unarchived events, as the first overview listed them.
    const recentEvents = events.filter((event) => !event.archivedAt).sort((first, second) => time(second.updatedAt) - time(first.updatedAt)).slice(0, RECENT_LIMIT)
      .map((event) => serializeEvent({ ...event, status: statusFromDates(event, at), processing: processingByEvent[event.id] }));
    // Who created each, by name (`services/userNames`).
    const recentNamed = await (dependencies.withUserNames || withUserNames)(recentEvents);

    return {
      range,
      period: { key: range.key, label: range.label, ...period },
      totalEventsAllTime: events.length,
      summary: current,
      trend,
      comparedAt: trend ? range.from : null,
      eventRows: rows,
      processingProgress: rows.filter((row) => row.processingCount > 0).slice(0, PROGRESS_LIMIT),
      events: eventCounts,
      // `videos` stays in the answer for a desktop build in the field; no screen shows it any more.
      // `other` is every live row that is not a photo (the AI Feature took video once), so the
      // storage line can name it rather than call it a photo.
      media: { total: media.total, photos: kinds.PHOTO || 0, videos: kinds.VIDEO || 0, other: media.total - (kinds.PHOTO || 0), processed: media.completed, processing: media.processing + media.queued, failed: media.failed, percent: media.percent },
      faces: { detected: faces, people, matches, unmatched },
      guests: { total: guests },
      storage: { bytes: toNumber(bytes), recentUploads },
      recentEvents: recentNamed,
      recentActivity: recent.map(serializeActivity),
      generatedAt: at,
    };
  }

  /**
   * One event's detection & storage, for its Project Dashboard: the same reads the dashboard's
   * panel makes, each narrowed to this event by the database, never filtered from the studio's
   * totals. A deleted or unknown event is a 404 (`loadEvent`); an archived one still answers, as
   * its own screens still open. Figures the event has no share of - archived events - are not here.
   */
  async function eventDetection(eventId) {
    await findEvent(eventId);
    const at = now();
    const [mediaByKind, bytes, detected, people, matches, unmatched, guests, recentUploads] = await Promise.all([
      repo.mediaByKind(eventId), repo.storageBytes(eventId), repo.faceCount(eventId), repo.peopleCount(eventId),
      repo.matchCount(eventId), repo.unmatchedFaceCount(eventId), repo.guestCount(eventId), repo.recentUploadCount(new Date(at.getTime() - DAY_MS), eventId),
    ]);
    const kinds = Object.fromEntries(mediaByKind.map((row) => [row.kind, row._count._all]));
    const total = Object.values(kinds).reduce((sum, count) => sum + count, 0);
    return {
      eventId,
      media: { total, photos: kinds.PHOTO || 0, other: total - (kinds.PHOTO || 0) },
      faces: { detected, people, matches, unmatched },
      guests: { total: guests },
      storage: { bytes: toNumber(bytes), recentUploads },
      generatedAt: at,
    };
  }

  return { dashboard, eventDetection };
}

const defaultService = createOverviewService();

module.exports = { createOverviewService, dashboard: defaultService.dashboard, eventDetection: defaultService.eventDetection, statusAt };
