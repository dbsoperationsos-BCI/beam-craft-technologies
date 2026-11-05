const test = require("node:test");
const assert = require("node:assert/strict");
const { createOverviewService } = require("../src/modules/ai-feature/overview/service");
const { getOverview } = require("../src/modules/ai-feature/overview/controller");

// 15 Sep 2026, 15:30 IST. This Month began at 2026-08-31T18:30:00Z — midnight on the 1st in the studio's day.
const NOW = new Date("2026-09-15T10:00:00.000Z");
const FROM = new Date("2026-08-31T18:30:00.000Z");
const at = (iso) => new Date(iso);

const EVENTS = [
  { id: "e1", name: "Upcoming wedding", eventType: "Wedding", startDate: at("2026-09-20T00:00:00.000Z"), endDate: null, archivedAt: null, createdAt: at("2026-08-10T05:00:00.000Z"), updatedAt: at("2026-08-10T05:00:00.000Z"), coverKey: null, _count: { guests: 2, media: 0, faces: 0 } },
  { id: "e2", name: "Active reception", eventType: "Reception", startDate: at("2026-09-14T00:00:00.000Z"), endDate: at("2026-09-16T00:00:00.000Z"), archivedAt: null, createdAt: at("2026-08-20T05:00:00.000Z"), updatedAt: at("2026-09-15T09:00:00.000Z"), coverKey: null, _count: { guests: 40, media: 6, faces: 10 } },
  // Created at the very first instant of the range: inside the period, not in the "before".
  { id: "e3", name: "Completed shoot", eventType: "Engagement", startDate: at("2026-09-01T00:00:00.000Z"), endDate: null, archivedAt: null, createdAt: FROM, updatedAt: at("2026-09-10T05:00:00.000Z"), coverKey: null, _count: { guests: 5, media: 3, faces: 4 } },
  // Archived on the 5th: archived now, but a completed event when the month began.
  { id: "e4", name: "Archived party", eventType: "Party", startDate: at("2026-08-05T00:00:00.000Z"), endDate: null, archivedAt: at("2026-09-05T05:00:00.000Z"), createdAt: at("2026-07-01T05:00:00.000Z"), updatedAt: at("2026-09-05T05:00:00.000Z"), coverKey: null, _count: { guests: 0, media: 1, faces: 0 } },
];

const MEDIA_BY_EVENT_STATUS = [
  { eventId: "e2", aiStatus: "COMPLETED", _count: { _all: 4 } },
  { eventId: "e2", aiStatus: "QUEUED", _count: { _all: 2 } },
  { eventId: "e3", aiStatus: "COMPLETED", _count: { _all: 2 } },
  { eventId: "e3", aiStatus: "FAILED", _count: { _all: 1 } },
  { eventId: "e4", aiStatus: "SKIPPED", _count: { _all: 1 } },
];

function fakeRepo(overrides = {}) {
  const calls = [];
  return {
    calls,
    readEvents: async () => EVENTS,
    mediaByEventAndStatus: async () => MEDIA_BY_EVENT_STATUS,
    mediaByKind: async () => [{ kind: "PHOTO", _count: { _all: 9 } }, { kind: "VIDEO", _count: { _all: 1 } }],
    storageBytes: async () => 123456789n,
    peopleByEvent: async () => [{ eventId: "e2", _count: { _all: 3 } }, { eventId: "e3", _count: { _all: 1 } }],
    matchCount: async () => 7,
    unmatchedFaceCount: async () => 5,
    guestCount: async () => 47,
    recentUploadCount: async (since) => { calls.push(["recentUploadCount", since]); return 11; },
    latestActivityByEvent: async () => [{ eventId: "e3", _max: { createdAt: at("2026-09-14T08:00:00.000Z") } }],
    recentActivity: async () => [{ id: "a1", eventId: "e3", actorType: "SYSTEM", actorLabel: "AI processing", event: "AI_PROCESSING_COMPLETED", detail: null, createdAt: at("2026-09-14T08:00:00.000Z"), aiEvent: { id: "e3", name: "Completed shoot" } }],
    periodCounts: async (bounds) => { calls.push(["periodCounts", bounds]); return { eventsCreated: 1, photosUploaded: 5, photosProcessed: 4 }; },
    asOfCounts: async (asOf) => { calls.push(["asOfCounts", asOf]); return { photos: 5, processed: 3, people: 2 }; },
    ...overrides,
  };
}

const build = (repo = fakeRepo(), query = { range: "month" }) => createOverviewService(repo, { now: () => NOW }).dashboard(query);

test("the summary counts every live event by its dated status and every live photo by its processing state", async () => {
  const data = await build();
  assert.deepEqual(data.summary, {
    totalEvents: 4, activeEvents: 1, upcomingEvents: 1, completedEvents: 1, archivedEvents: 1,
    processingPhotos: 2, totalPhotos: 9, processedPhotos: 6, failedPhotos: 1, peopleDetected: 4,
  });
  assert.equal(data.totalEventsAllTime, 4);
  // The keys the older overview answered keep their meaning.
  assert.deepEqual(data.events, { total: 4, active: 1, upcoming: 1, completed: 1, archived: 1 });
  assert.deepEqual(data.media, { total: 10, photos: 9, videos: 1, other: 1, processed: 6, processing: 2, failed: 1, percent: 80 });
  assert.deepEqual(data.faces, { detected: 14, people: 4, matches: 7, unmatched: 5 });
  assert.deepEqual(data.guests, { total: 47 });
  assert.deepEqual(data.storage, { bytes: 123456789, recentUploads: 11 });
});

test("the range and the period figures follow the key, and the trend is measured from the start of the range", async () => {
  const repo = fakeRepo();
  const data = await build(repo);
  assert.equal(data.range.key, "month");
  assert.equal(data.range.from.toISOString(), FROM.toISOString());
  assert.deepEqual(data.period, { key: "month", label: "This Month", eventsCreated: 1, photosUploaded: 5, photosProcessed: 4 });
  assert.equal(data.comparedAt.toISOString(), FROM.toISOString());
  const asOf = repo.calls.find(([name]) => name === "asOfCounts")[1];
  assert.equal(asOf.toISOString(), FROM.toISOString());
  const period = repo.calls.find(([name]) => name === "periodCounts")[1];
  assert.equal(period.from.toISOString(), FROM.toISOString());
});

test("an event created at the first instant of the range is not in the before, and a later archive is masked", async () => {
  const { trend } = await build();
  // e3 was created at exactly range.from, so three events stood at the start: e1 upcoming, e2 upcoming, e4 completed (not yet archived).
  assert.deepEqual(trend.totalEvents, { before: 3, delta: 1 });
  assert.deepEqual(trend.upcomingEvents, { before: 2, delta: -1 });
  assert.deepEqual(trend.activeEvents, { before: 0, delta: 1 });
  assert.deepEqual(trend.completedEvents, { before: 1, delta: 0 });
  assert.deepEqual(trend.archivedEvents, { before: 0, delta: 1 });
  assert.deepEqual(trend.totalPhotos, { before: 5, delta: 4 });
  assert.deepEqual(trend.processedPhotos, { before: 3, delta: 3 });
  assert.deepEqual(trend.peopleDetected, { before: 2, delta: 2 });
  // The queue and the failures are moments, not stamps: no past to read, so no arrow.
  assert.equal("processingPhotos" in trend, false);
  assert.equal("failedPhotos" in trend, false);
});

test("Lifetime compares with nothing", async () => {
  const repo = fakeRepo();
  const data = await build(repo, { range: "lifetime" });
  assert.equal(data.trend, null);
  assert.equal(data.comparedAt, null);
  assert.equal(repo.calls.some(([name]) => name === "asOfCounts"), false);
});

test("every live event is a table row, most recently active first, with its own processing figures", async () => {
  const { eventRows } = await build();
  assert.deepEqual(eventRows.map((row) => row.id), ["e2", "e3", "e4", "e1"]);
  const e2 = eventRows[0];
  assert.equal(e2.status, "ACTIVE");
  assert.equal(e2.mediaCount, 6);
  assert.equal(e2.processedCount, 4);
  assert.equal(e2.processingCount, 2);
  assert.equal(e2.failedCount, 0);
  assert.equal(e2.peopleCount, 3);
  assert.equal(e2.faceCount, 10);
  assert.equal(e2.guestCount, 40);
  assert.equal(e2.percent, 67);
  assert.equal(e2.lastActivityAt.toISOString(), "2026-09-15T09:00:00.000Z");
  // e3's latest activity row is newer than its updatedAt, so that is its last activity.
  const e3 = eventRows[1];
  assert.equal(e3.lastActivityAt.toISOString(), "2026-09-14T08:00:00.000Z");
  assert.equal(e3.failedCount, 1);
  assert.equal(e3.percent, 100);
  assert.equal(eventRows[2].status, "ARCHIVED");
  assert.equal(eventRows[3].peopleCount, 0);
});

test("the processing panel lists only the events with something queued or running", async () => {
  const { processingProgress } = await build();
  assert.deepEqual(processingProgress.map((row) => row.id), ["e2"]);
});

test("the older recent-events list is still the six most recently updated live, unarchived events", async () => {
  const { recentEvents, recentActivity } = await build();
  assert.deepEqual(recentEvents.map((row) => row.id), ["e2", "e3", "e1"]);
  assert.equal(recentEvents[0].processing.queued, 2);
  assert.equal(recentActivity[0].eventName, "Completed shoot");
});

test("the controller refuses a range the picker has no option for", async () => {
  let status = null; let body = null;
  const res = { status(code) { status = code; return this; }, json(payload) { body = payload; return this; } };
  await getOverview({ query: { range: "year" } }, res);
  assert.equal(status, 400);
  assert.equal(body.message, "Invalid dashboard request.");
});

// ── One event's Detection & Storage (its Project Dashboard) ───────────────────────────────────
const { createRepository } = require("../src/modules/ai-feature/overview/repository");

test("an event's detection & storage asks every read for that event alone and answers its figures", async () => {
  const asked = [];
  const scopedRepo = {
    mediaByKind: async (eventId) => { asked.push(["mediaByKind", eventId]); return [{ kind: "PHOTO", _count: { _all: 54 } }, { kind: "VIDEO", _count: { _all: 2 } }]; },
    storageBytes: async (eventId) => { asked.push(["storageBytes", eventId]); return 15400000n; },
    faceCount: async (eventId) => { asked.push(["faceCount", eventId]); return 14; },
    peopleCount: async (eventId) => { asked.push(["peopleCount", eventId]); return 2; },
    matchCount: async (eventId) => { asked.push(["matchCount", eventId]); return 1; },
    unmatchedFaceCount: async (eventId) => { asked.push(["unmatchedFaceCount", eventId]); return 3; },
    guestCount: async (eventId) => { asked.push(["guestCount", eventId]); return 6; },
    recentUploadCount: async (since, eventId) => { asked.push(["recentUploadCount", eventId]); assert.equal(since.getTime(), NOW.getTime() - 24 * 3600 * 1000); return 54; },
  };
  const loaded = [];
  const service = createOverviewService(scopedRepo, { now: () => NOW, loadEvent: async (id) => { loaded.push(id); return { id }; } });
  const data = await service.eventDetection("eA");
  assert.deepEqual(loaded, ["eA"], "the event is looked up first, so a gone one is a 404");
  assert.equal(asked.length, 8);
  assert.ok(asked.every(([, eventId]) => eventId === "eA"), "no read is left unscoped");
  assert.deepEqual(data, {
    eventId: "eA",
    media: { total: 56, photos: 54, other: 2 },
    faces: { detected: 14, people: 2, matches: 1, unmatched: 3 },
    guests: { total: 6 },
    storage: { bytes: 15400000, recentUploads: 54 },
    generatedAt: NOW,
  });
  assert.equal("archived" in data, false, "archived events are a studio figure, not an event's");
  assert.equal("videos" in data.media, false);
});

test("an unknown or deleted event is refused before any figure is read", async () => {
  let reads = 0;
  const repo = new Proxy({}, { get: () => async () => { reads += 1; return []; } });
  const service = createOverviewService(repo, { now: () => NOW, loadEvent: async () => { const e = new Error("Event not found."); e.status = 404; throw e; } });
  await assert.rejects(() => service.eventDetection("gone"), { status: 404 });
  assert.equal(reads, 0);
});

test("the repository narrows each detection read by the event id in the database query, and leaves the studio-wide reads unnarrowed", async () => {
  const wheres = [];
  const model = { count: async ({ where }) => { wheres.push(where); return 0; }, groupBy: async ({ where }) => { wheres.push(where); return []; }, aggregate: async ({ where }) => { wheres.push(where); return { _sum: { sizeBytes: null } }; } };
  const repo = createRepository({ aiEventMedia: model, aiEventPerson: model, aiEventFace: model, aiEventFaceMatch: model, aiEventGuest: model });
  const since = new Date(0);
  await Promise.all([repo.mediaByKind("eA"), repo.storageBytes("eA"), repo.peopleCount("eA"), repo.faceCount("eA"), repo.matchCount("eA"), repo.unmatchedFaceCount("eA"), repo.guestCount("eA"), repo.recentUploadCount(since, "eA")]);
  assert.equal(wheres.length, 8);
  for (const where of wheres) { assert.equal(where.eventId, "eA"); assert.deepEqual(where.event, { deletedAt: null }); }
  assert.deepEqual(wheres.find((where) => "personId" in where).personId, null);
  assert.equal(wheres.find((where) => "hidden" in where).hidden, false);
  wheres.length = 0;
  await Promise.all([repo.mediaByKind(), repo.storageBytes(), repo.matchCount(), repo.unmatchedFaceCount(), repo.guestCount(), repo.recentUploadCount(since)]);
  assert.ok(wheres.every((where) => !("eventId" in where)), "the dashboard's own reads still cover every event");
});

test("the event detection controller refuses an event id it cannot read before any lookup", async () => {
  const { getEventDetection } = require("../src/modules/ai-feature/overview/controller");
  let status = null;
  const res = { status(code) { status = code; return this; }, json() { return this; } };
  await getEventDetection({ params: { eventId: "" }, user: { id: 1 } }, res);
  assert.equal(status, 400);
});

test("the event detection route sits behind the router's protect and AI Feature guard, like every event route", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "modules", "ai-feature", "routes.js"), "utf8");
  const guard = source.indexOf("router.use(requireModule(MODULE, FEATURE));");
  const protect = source.indexOf("router.use(protect);");
  const route = source.indexOf('router.get("/events/:eventId/detection", overview.getEventDetection);');
  assert.ok(protect > -1 && guard > protect && route > guard, "declared after both router-level guards");
});
