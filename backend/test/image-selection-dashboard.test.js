const test = require("node:test");
const assert = require("node:assert/strict");
const classify = require("../src/modules/image-selection/dashboard/classify");
const { createDashboardService, rangeBounds, limitOf, RANGE_KEYS, RANGE_LABELS, DEFAULT_RANGE } = require("../src/modules/image-selection/dashboard/service");
const { dashboardQuerySchema } = require("../src/modules/image-selection/dashboard/validation");
const { createImageSelectionProjectService } = require("../src/modules/image-selection/projects/service");
const { listProjectsSchema } = require("../src/modules/image-selection/projects/validation");

// 8 Sep 2026, 15:30 IST — the studio's afternoon, so "today" is Sep 8 in Asia/Kolkata.
const NOW = new Date("2026-09-08T10:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days) => new Date(NOW.getTime() - days * DAY);

// ── Ranges ─────────────────────────────────────────────────────────────────────────────────────

test("the picker offers exactly Lifetime, This Month, This Week, 3 Months and 6 Months", () => {
  assert.deepEqual(RANGE_KEYS, ["lifetime", "month", "week", "3m", "6m"]);
  assert.deepEqual(RANGE_KEYS.map((key) => RANGE_LABELS[key]), ["Lifetime", "This Month", "This Week", "3 Months", "6 Months"]);
  assert.equal(DEFAULT_RANGE, "month");
});

test("ranges are studio days: the week starts Monday, the month on the 1st, lifetime has no floor", () => {
  // NOW is a Tuesday afternoon in Asia/Kolkata, so this week began on Monday 7 September.
  const week = rangeBounds("week", NOW);
  assert.equal(week.from.toISOString(), "2026-09-06T18:30:00.000Z");
  assert.equal(week.to.toISOString(), "2026-09-08T18:30:00.000Z", "ends after today, so today counts");
  assert.equal(rangeBounds("month", NOW).from.toISOString(), "2026-08-31T18:30:00.000Z");
  assert.equal(rangeBounds("3m", NOW).from.toISOString(), "2026-06-08T18:30:00.000Z");
  assert.equal(rangeBounds("6m", NOW).from.toISOString(), "2026-03-08T18:30:00.000Z");
  // Lifetime is every row there has ever been.
  assert.equal(rangeBounds("lifetime", NOW).from.getTime(), 0);
  assert.equal(rangeBounds("lifetime", NOW).to.toISOString(), "2026-09-08T18:30:00.000Z");
});

test("a week that began in the previous month still starts on its Monday", () => {
  // Thursday 1 October 2026: the week began on Monday 28 September.
  const thursday = new Date("2026-10-01T10:00:00.000Z");
  assert.equal(rangeBounds("week", thursday).from.toISOString(), "2026-09-27T18:30:00.000Z");
  // And on a Monday the range is that day alone.
  const monday = new Date("2026-09-07T10:00:00.000Z");
  assert.equal(rangeBounds("week", monday).from.toISOString(), "2026-09-06T18:30:00.000Z");
});

test("an unknown range key falls back to this month rather than to everything", () => {
  const bounds = rangeBounds("year", NOW);
  assert.equal(bounds.key, "month");
  assert.equal(bounds.label, "This Month");
  assert.equal(bounds.from.toISOString(), rangeBounds("month", NOW).from.toISOString());
});

// ── Classification ─────────────────────────────────────────────────────────────────────────────

test("the rung is the sidebar's: unpublished, published, picking, everything submitted", () => {
  const configs = [{ id: "a", selectionSubmittedAt: null }, { id: "b", selectionSubmittedAt: null }];
  assert.equal(classify.selectionProgressOf(false, configs, new Set()), "notStarted");
  assert.equal(classify.selectionProgressOf(true, configs, new Set()), "inProgress");
  assert.equal(classify.selectionProgressOf(true, configs, new Set(["a"])), "partiallyCompleted");
  assert.equal(classify.selectionProgressOf(true, [{ id: "a", selectionSubmittedAt: NOW }, { id: "b", selectionSubmittedAt: null }], new Set()), "partiallyCompleted");
  assert.equal(classify.selectionProgressOf(true, [{ id: "a", selectionSubmittedAt: NOW }], new Set()), "completed");
  // No items: a published gallery can only ever be in progress.
  assert.equal(classify.selectionProgressOf(true, [], new Set()), "inProgress");
});

test("every stage is an existing rung or the archive — no new status is minted", () => {
  assert.deepEqual(classify.DASHBOARD_STAGES.map((stage) => stage.key), ["uploaded", "linkSent", "selecting", "submitted", "completed"]);
  assert.equal(classify.stageOf({ archivedAt: null, selectionProgress: "notStarted" }), "uploaded");
  assert.equal(classify.stageOf({ archivedAt: null, selectionProgress: "inProgress" }), "linkSent");
  assert.equal(classify.stageOf({ archivedAt: null, selectionProgress: "partiallyCompleted" }), "selecting");
  assert.equal(classify.stageOf({ archivedAt: null, selectionProgress: "completed" }), "submitted");
  // Archived wins whatever the rung says: the studio closed it.
  assert.equal(classify.stageOf({ archivedAt: NOW, selectionProgress: "inProgress" }), "completed");
});

const published = (overrides = {}) => ({ status: "PUBLISHED", publishedAt: daysAgo(20), expiresAt: daysAgo(-160), selectionSubmittedAt: null, galleryFirstOpenedAt: null, galleryLastOpenedAt: null, lastClientActivityAt: null, ...overrides });

test("attention rows: overdue, unopened, quiet, newly submitted, ready to download", () => {
  const none = Object.fromEntries(classify.ATTENTION_KINDS.map((kind) => [kind, false]));
  // Every case below carries photos, so the first-rung views stay quiet and the rows under test stand alone.
  const photos = { photoCount: 10 };
  // Expired and still open: overdue, and the link itself has expired. Also quiet for 20 days and never opened.
  assert.deepEqual(classify.attentionFlagsOf({ ...photos, archivedAt: null, selectionProgress: "inProgress", publication: published({ expiresAt: daysAgo(1) }), configs: [{ id: "a", selectionSubmittedAt: null, selectionLimit: 50, selectedCount: 0 }] }, NOW), { ...none, overdue: true, expired: true, notOpened: true, inactive: true });
  // Opened yesterday, nothing picked: not unopened, not quiet.
  assert.deepEqual(classify.attentionFlagsOf({ ...photos, archivedAt: null, selectionProgress: "inProgress", publication: published({ galleryFirstOpenedAt: daysAgo(1), galleryLastOpenedAt: daysAgo(1) }), configs: [{ id: "a", selectionSubmittedAt: null, selectionLimit: 50, selectedCount: 0 }] }, NOW), none);
  // Picks exist but no stamps (a gallery from before the stamps): a pick proves an open.
  assert.deepEqual(classify.attentionFlagsOf({ ...photos, archivedAt: null, selectionProgress: "partiallyCompleted", publication: published(), configs: [{ id: "a", selectionSubmittedAt: null, selectionLimit: 50, selectedCount: 3 }] }, NOW), { ...none, inactive: true });
  // Submitted two days ago with photos: new submission and ready to download; a submitted project is never overdue.
  assert.deepEqual(classify.attentionFlagsOf({ ...photos, archivedAt: null, selectionProgress: "completed", publication: published({ expiresAt: daysAgo(1), selectionSubmittedAt: daysAgo(2) }), configs: [{ id: "a", selectionSubmittedAt: daysAgo(2), selectionLimit: 50, selectedCount: 12 }] }, NOW), { ...none, newSubmissions: true, readyToDownload: true });
  // Submitted a month ago: ready to download, but no longer new.
  assert.deepEqual(classify.attentionFlagsOf({ ...photos, archivedAt: null, selectionProgress: "completed", publication: published({ selectionSubmittedAt: daysAgo(30) }), configs: [{ id: "a", selectionSubmittedAt: daysAgo(30), selectionLimit: 50, selectedCount: 12 }] }, NOW), { ...none, readyToDownload: true });
  // Legacy gallery with no items: the whole-gallery flag and count stand in.
  assert.deepEqual(classify.attentionFlagsOf({ ...photos, archivedAt: null, selectionProgress: "inProgress", publication: published({ selectionSubmittedAt: daysAgo(1), galleryFirstOpenedAt: daysAgo(3), galleryLastOpenedAt: daysAgo(3) }), configs: [], legacySelectedCount: 8 }, NOW), { ...none, newSubmissions: true, readyToDownload: true });
  // Archived: on no row at all. Unpublished with photos: only "client sending not done".
  assert.deepEqual(classify.attentionFlagsOf({ ...photos, archivedAt: NOW, selectionProgress: "inProgress", publication: published({ expiresAt: daysAgo(1) }), configs: [] }, NOW), none);
  assert.deepEqual(classify.attentionFlagsOf({ ...photos, archivedAt: null, selectionProgress: "notStarted", publication: null, configs: [] }, NOW), { ...none, notPublished: true });
});

test("the first rung splits into nothing uploaded and uploaded but not sent", () => {
  const none = Object.fromEntries(classify.ATTENTION_KINDS.map((kind) => [kind, false]));
  assert.deepEqual(classify.attentionFlagsOf({ archivedAt: null, selectionProgress: "notStarted", publication: null, configs: [], photoCount: 0 }, NOW), { ...none, yetToUpload: true });
  assert.deepEqual(classify.attentionFlagsOf({ archivedAt: null, selectionProgress: "notStarted", publication: null, configs: [], photoCount: 250 }, NOW), { ...none, notPublished: true });
  // Once sent, neither: the gallery is with the client.
  assert.deepEqual(classify.attentionFlagsOf({ archivedAt: null, selectionProgress: "inProgress", publication: published({ galleryFirstOpenedAt: daysAgo(1), galleryLastOpenedAt: daysAgo(1) }), configs: [], photoCount: 250 }, NOW), none);
});

test("a link is expiring soon within ten days, expired once it has passed, and neither once submitted", () => {
  const none = Object.fromEntries(classify.ATTENTION_KINDS.map((kind) => [kind, false]));
  const opened = { galleryFirstOpenedAt: daysAgo(1), galleryLastOpenedAt: daysAgo(1) };
  const soon = { ...none, expiringSoon: true };
  assert.deepEqual(classify.attentionFlagsOf({ archivedAt: null, selectionProgress: "inProgress", publication: published({ ...opened, expiresAt: daysAgo(-6) }), configs: [], photoCount: 10 }, NOW), soon);
  // The window is ten days: nine days out is on the card, eleven is not yet.
  assert.deepEqual(classify.attentionFlagsOf({ archivedAt: null, selectionProgress: "inProgress", publication: published({ ...opened, expiresAt: daysAgo(-9) }), configs: [], photoCount: 10 }, NOW), soon, "nine days out is soon");
  assert.deepEqual(classify.attentionFlagsOf({ archivedAt: null, selectionProgress: "inProgress", publication: published({ ...opened, expiresAt: daysAgo(-11) }), configs: [], photoCount: 10 }, NOW), none, "eleven days out is not yet soon");
  // The day it passes, the project moves from one card to the other rather than sitting on both.
  const gone = classify.attentionFlagsOf({ archivedAt: null, selectionProgress: "inProgress", publication: published({ ...opened, expiresAt: daysAgo(1) }), configs: [], photoCount: 10 }, NOW);
  assert.equal(gone.expiringSoon, false, "already expired is no longer expiring");
  assert.equal(gone.expired, true);
  const finished = classify.attentionFlagsOf({ archivedAt: null, selectionProgress: "completed", publication: published({ ...opened, expiresAt: daysAgo(-2), selectionSubmittedAt: daysAgo(3) }), configs: [{ id: "a", selectionSubmittedAt: daysAgo(3), selectionLimit: 50, selectedCount: 5 }], photoCount: 10 }, NOW);
  assert.equal(finished.expiringSoon, false, "a finished job has nothing left to expire");
  // A link that stops after the client has finished is not something anybody is waiting on, so it
  // never joins the count — otherwise every old project would land there in the end.
  assert.equal(classify.attentionFlagsOf({ archivedAt: null, selectionProgress: "completed", publication: published({ ...opened, expiresAt: daysAgo(1), selectionSubmittedAt: daysAgo(3) }), configs: [{ id: "a", selectionSubmittedAt: daysAgo(3), selectionLimit: 50, selectedCount: 5 }], photoCount: 10 }, NOW).expired, false);
  // Revoked rather than published: the studio pulled the link, so it is overdue but not expired.
  const revoked = classify.attentionFlagsOf({ archivedAt: null, selectionProgress: "inProgress", publication: published({ ...opened, status: "REVOKED", expiresAt: daysAgo(1) }), configs: [], photoCount: 10 }, NOW);
  assert.equal(revoked.overdue, true);
  assert.equal(revoked.expired, false);
});

test("downloaded is judged against the latest submission", () => {
  const submitted = (at) => ({ archivedAt: null, selectionProgress: "completed", publication: published({ selectionSubmittedAt: at }), configs: [{ id: "a", selectionSubmittedAt: at, selectionLimit: 50, selectedCount: 12 }], photoCount: 300 });
  // Never downloaded: still to be copied out.
  let flags = classify.attentionFlagsOf({ ...submitted(daysAgo(10)) }, NOW);
  assert.equal(flags.readyToDownload, true); assert.equal(flags.downloaded, false);
  // Downloaded after the submission: done.
  flags = classify.attentionFlagsOf({ ...submitted(daysAgo(10)), selectedDownloadedAt: daysAgo(9) }, NOW);
  assert.equal(flags.readyToDownload, false); assert.equal(flags.downloaded, true);
  // The client sent another item after the download: back to not yet downloaded.
  flags = classify.attentionFlagsOf({ ...submitted(daysAgo(2)), selectedDownloadedAt: daysAgo(9) }, NOW);
  assert.equal(flags.readyToDownload, true); assert.equal(flags.downloaded, false);
  // Downloaded but nothing submitted at all (an older whole-gallery download): counted as downloaded, not as waiting.
  flags = classify.attentionFlagsOf({ archivedAt: null, selectionProgress: "inProgress", publication: published({ galleryFirstOpenedAt: daysAgo(1), galleryLastOpenedAt: daysAgo(1) }), configs: [], photoCount: 300, selectedDownloadedAt: daysAgo(1) }, NOW);
  assert.equal(flags.downloaded, true); assert.equal(flags.readyToDownload, false);
});

test("selected and limit sum over the live items; no items means no limit and no percentage", () => {
  assert.deepEqual(classify.selectionTotals({ configs: [{ selectionLimit: 200, selectedCount: 150 }, { selectionLimit: 50, selectedCount: 37 }] }), { selectedCount: 187, selectionLimit: 250, percent: 75 });
  assert.deepEqual(classify.selectionTotals({ configs: [], legacySelectedCount: 187 }), { selectedCount: 187, selectionLimit: null, percent: null });
  assert.equal(classify.selectionTotals({ configs: [{ selectionLimit: 10, selectedCount: 14 }] }).percent, 100);
});

test("a selection item's limit follows the deliverable service's own rule", () => {
  assert.equal(limitOf({ projectShootDeliverableId: "d1", shootDeliverable: { selectionLimit: 300, numberOfPhotos: 120, quantity: 1 } }, 50), 300);
  assert.equal(limitOf({ projectShootDeliverableId: "d1", shootDeliverable: { selectionLimit: null, numberOfPhotos: 120, quantity: 1 } }, 50), 120);
  assert.equal(limitOf({ projectShootDeliverableId: "d1", shootDeliverable: { selectionLimit: null, numberOfPhotos: null, quantity: 3 } }, 50), 3);
  assert.equal(limitOf({ projectShootDeliverableId: null, projectPostProductionAllocationId: null, selectionLimitOverride: 25 }, 50), 25);
  assert.equal(limitOf({ projectShootDeliverableId: null, projectPostProductionAllocationId: null, selectionLimitOverride: null }, 50), 50);
});

// ── The service ────────────────────────────────────────────────────────────────────────────────

const project = (overrides = {}) => ({ id: "p1", projectCode: "DBS-VCIS-000001", projectName: "Arun & Priya Wedding", sourceType: "Manual", salesProjectId: null, clientName: "Priya", archivedAt: null, createdAt: daysAgo(5), updatedAt: daysAgo(5), lastOpenedAt: null, totalPhotoSize: BigInt(0), salesProject: null, ...overrides });

function fakeRepository() {
  const state = {
    projects: [
      project(),
      project({ id: "p2", projectCode: "DBS-VCIS-000002", projectName: "Corporate Launch", clientName: "Acme", createdAt: daysAgo(3), updatedAt: daysAgo(3) }),
      project({ id: "p3", projectCode: "DBS-VCIS-000003", projectName: "Old Shoot", clientName: "Ravi", archivedAt: daysAgo(1), createdAt: daysAgo(10), updatedAt: daysAgo(1) }),
      project({ id: "p4", projectCode: "DBS-VCIS-000004", projectName: "Empty", clientName: null, createdAt: daysAgo(2), updatedAt: daysAgo(2) }),
    ],
    publications: [
      published({ projectId: "p1", publishedAt: daysAgo(4), lastClientActivityAt: daysAgo(0.01), galleryFirstOpenedAt: daysAgo(4), galleryLastOpenedAt: daysAgo(0.01) }),
      published({ projectId: "p2", publishedAt: daysAgo(2) }),
    ],
    configs: [
      { id: "c1", imageSelectionProjectId: "p1", selectionSubmittedAt: null, selectionLimitOverride: 250, projectShootDeliverableId: null, projectPostProductionAllocationId: null, shootDeliverable: null },
      { id: "c2", imageSelectionProjectId: "p2", selectionSubmittedAt: null, selectionLimitOverride: null, projectShootDeliverableId: "d2", projectPostProductionAllocationId: null, shootDeliverable: { selectionLimit: 40, numberOfPhotos: null, quantity: 1 } },
    ],
    selectionCounts: [{ imageSelectionDeliverableConfigId: "c1", count: 187 }],
    photoCounts: [{ projectId: "p1", count: 1200 }, { projectId: "p2", count: 300 }, { projectId: "p3", count: 40 }],
    calls: [],
  };
  return {
    state,
    listProjects: async () => { state.calls.push(["listProjects"]); return state.projects; },
    countAllProjects: async () => state.projects.length,
    periodCounts: async (range) => { state.calls.push(["periodCounts", range.key]); return { projectsCreated: 2, photosAdded: 300, selectionsMade: 187, itemsSubmitted: 0 }; },
    clientNames: async () => new Map(),
    snapshotData: async (ids) => { state.calls.push(["snapshotData", ids.length]); return { publications: state.publications, configs: state.configs, photoCounts: state.photoCounts, legacySelected: [], selectionCounts: state.selectionCounts }; },
    storageStats: async (range) => { state.lastStorageRange = range; return { totalPhotos: 1540, readyPhotos: 1540, processingPhotos: 0, failedPhotos: 0, originalBytes: 1024, registeredOriginals: 1540, serverOriginals: 0, r2Objects: 1540, r2PreviewBytes: 512, activeBatches: 0, added: { photos: 300, originalBytes: 256, registeredOriginals: 300, r2Objects: 300, r2PreviewBytes: 128 } }; },
    queueCounts: async () => { throw new Error("Redis is down"); },
  };
}
const settings = { read: async () => ({ defaultSelectionLimit: 50 }) };
const closedBatches = [];
const closeAbandonedBatches = async () => { closedBatches.push(NOW); return { count: 0 }; };
const service = (repo) => createDashboardService(repo, { settings, now: () => NOW, closeAbandonedBatches });

test("the dashboard is one response: counts, stages, attention, progress, storage and recent rows", async () => {
  const repo = fakeRepository();
  const data = await service(repo).build({ range: "month" });
  assert.equal(data.range.key, "month");
  assert.equal(data.range.label, "This Month");
  // The cards are a position; the range only says what it added.
  assert.deepEqual(data.period, { key: "month", label: "This Month", projectsCreated: 2, photosAdded: 300, selectionsMade: 187, itemsSubmitted: 0 });
  assert.equal(data.totalProjectsAllTime, 4);
  // p4 has nothing uploaded; p1 is being picked; p2 is sent and untouched; p3 is archived.
  assert.deepEqual(data.summary, { totalProjects: 4, yetToUpload: 1, notPublished: 0, clientNotStarted: 1, clientInProgress: 1, clientSubmitted: 0, notYetDownloaded: 0, linkExpiringSoon: 0, linkExpired: 0, downloaded: 0, totalPhotos: 1540 });
  // The workflow strip and the Needs Attention panel are gone; the cards carry those numbers.
  assert.equal("workflow" in data, false); assert.equal("attention" in data, false);
  // Nobody is nearly done: p1 is at 75%, p2 has picked none of its 40, and p4 has no limit and so
  // no percentage at all. The panel is empty rather than falling back to whatever moved last.
  assert.deepEqual(data.selectionProgress.map((row) => row.id), []);
  assert.equal(repo.state.lastStorageRange.from.toISOString(), "2026-08-31T18:30:00.000Z", "storage is asked what the range added");
  assert.equal(data.storage.added.photos, 300);
  const arun = data.recentProjects.find((row) => row.id === "p1");
  assert.equal(arun.selectedCount, 187); assert.equal(arun.selectionLimit, 250); assert.equal(arun.percent, 75); assert.equal(arun.stage, "selecting"); assert.equal(arun.clientName, "Priya");
  assert.equal(data.recentProjects.find((row) => row.id === "p2").selectionLimit, 40);
  // Recent projects: everything in the range, most recently active first, the archived one included.
  assert.deepEqual(data.recentProjects.map((row) => row.id), ["p1", "p3", "p2", "p4"]);
  assert.equal(data.recentProjects[1].stage, "completed");
  // Each row says which views it is on, so the cards can narrow the table without another read.
  assert.deepEqual(Object.keys(data.recentProjects[0].views).sort(), [...classify.ATTENTION_KINDS].sort());
  assert.equal(data.recentProjects.find((row) => row.id === "p4").views.yetToUpload, true);
  assert.equal(data.recentProjects.find((row) => row.id === "p2").views.notOpened, true);
  assert.equal("attention" in data.recentProjects[0], false);
  assert.equal(data.storage.totalPhotos, 1540); assert.deepEqual(data.storage.queue, { available: false });
  // One list read, one period read, one batched snapshot read, and one more batched snapshot read
  // for where things stood at the start of the range — never one per project.
  assert.deepEqual(repo.state.calls, [["listProjects"], ["periodCounts", "month"], ["snapshotData", 4], ["snapshotData", 1]]);
});

test("every card says which way it has moved since the start of the range", async () => {
  const repo = fakeRepository();
  // This month began on 1 September; of the four projects only the archived one (created ten
  // days ago) existed then, and it was not yet archived, published or picked in.
  const data = await service(repo).build({ range: "month" });
  assert.equal(data.comparedAt.toISOString(), "2026-08-31T18:30:00.000Z");
  assert.deepEqual(data.trend.totalProjects, { before: 1, delta: 3 });
  // Then: photos in, gallery not sent. Now: archived — so "client sending not done" went down.
  assert.deepEqual(data.trend.notPublished, { before: 1, delta: -1 });
  assert.deepEqual(data.trend.clientInProgress, { before: 0, delta: 1 });
  assert.deepEqual(data.trend.clientNotStarted, { before: 0, delta: 1 });
  assert.deepEqual(data.trend.downloaded, { before: 0, delta: 0 });
  assert.deepEqual(Object.keys(data.trend).sort(), Object.keys(data.summary).sort());
  // The rows the page shows are still today's.
  assert.equal(data.recentProjects.find((row) => row.id === "p3").stage, "completed");
});

test("Lifetime has no earlier point to compare with, so it has no trend", async () => {
  const data = await service(fakeRepository()).build({ range: "lifetime" });
  assert.equal(data.trend, null);
  assert.equal(data.comparedAt, null);
});

test("as of an instant, later stamps are set aside: a publish, a submission, an archive, a download", async () => {
  const repo = fakeRepository();
  // p1: published four days ago, submitted yesterday, downloaded today.
  repo.state.configs[0].selectionSubmittedAt = daysAgo(1);
  repo.state.projects[0].selectedDownloadedAt = daysAgo(0.2);
  const week = await service(repo).build({ range: "week" });
  // The week began on Monday 7 September (about 1.6 days ago): the submission and the download
  // are after it, the publish before it - so at the start of the week p1 was still being picked.
  const p1Now = week.recentProjects.find((row) => row.id === "p1");
  assert.equal(p1Now.stage, "submitted"); assert.equal(p1Now.views.downloaded, true);
  assert.deepEqual(week.trend.clientSubmitted, { before: 0, delta: 1 });
  assert.deepEqual(week.trend.clientInProgress, { before: 1, delta: -1 }, "p1 was being picked then and is submitted now");
  assert.deepEqual(week.trend.downloaded, { before: 0, delta: 1 });
  // p3 was archived yesterday: then it was open, now it is closed.
  assert.equal(week.trend.totalProjects.delta, 0);
  // A selection item created after the instant did not exist then.
  repo.state.configs.push({ id: "c9", imageSelectionProjectId: "p2", createdAt: daysAgo(0.5), selectionSubmittedAt: daysAgo(0.4), selectionLimitOverride: 10, projectShootDeliverableId: null, projectPostProductionAllocationId: null, shootDeliverable: null });
  const again = await service(repo).build({ range: "week" });
  assert.equal(again.trend.clientSubmitted.before, 0);
});

test("the progress list holds only the clients between 85% and 99% through their selection", async () => {
  const repo = fakeRepository();
  // p1 is 187 of 250, which is 75%: real picking still to come, so not on the panel. p2 has
  // picked none of its 40, and p4 has no selection limit at all and so no percentage.
  const before = await service(repo).build({ range: "month" });
  assert.deepEqual(before.selectionProgress.map((row) => row.id), []);

  // 225 of 250 is 90%: now the studio has somebody to chase.
  repo.state.selectionCounts[0].count = 225;
  const soon = await service(repo).build({ range: "month" });
  assert.deepEqual(soon.selectionProgress.map((row) => [row.id, row.percent]), [["p1", 90]]);

  // The range does not reach this panel: a client who stopped months ago is exactly who it is for.
  const week = await service(repo).build({ range: "week" });
  assert.deepEqual(week.selectionProgress.map((row) => row.id), ["p1"], "the range does not scope the panel");

  // Both ends are outside it: 84% is not nearly done, and 100% has nothing left to pick.
  repo.state.selectionCounts[0].count = 210;
  assert.deepEqual((await service(repo).build({ range: "month" })).selectionProgress.map((row) => row.id), [], "84% is not yet nearly done");
  repo.state.selectionCounts[0].count = 250;
  assert.deepEqual((await service(repo).build({ range: "month" })).selectionProgress.map((row) => row.id), [], "a full selection is not nearly done");

  // Closest to finishing first, whatever moved last.
  repo.state.selectionCounts[0].count = 220;
  repo.state.selectionCounts.push({ imageSelectionDeliverableConfigId: "c2", count: 39 });
  const ordered = await service(repo).build({ range: "month" });
  assert.deepEqual(ordered.selectionProgress.map((row) => [row.id, row.percent]), [["p2", 98], ["p1", 88]]);
});

test("a storage failure is an empty card, not a failed page", async () => {
  const repo = fakeRepository();
  repo.storageStats = async () => { throw new Error("no"); };
  const data = await service(repo).build({});
  assert.equal(data.storage, null);
  assert.equal(data.summary.totalProjects, 4);
});

test("no projects at all is a clean empty dashboard", async () => {
  const repo = fakeRepository();
  repo.state.projects = [];
  const data = await service(repo).build({});
  assert.equal(data.totalProjectsAllTime, 0);
  assert.deepEqual(data.summary, { totalProjects: 0, yetToUpload: 0, notPublished: 0, clientNotStarted: 0, clientInProgress: 0, clientSubmitted: 0, notYetDownloaded: 0, linkExpiringSoon: 0, linkExpired: 0, downloaded: 0, totalPhotos: 0 });
  assert.deepEqual(data.selectionProgress, []); assert.deepEqual(data.recentProjects, []);
});

test("the recent list is every project — the cards filter it in the browser, so nothing is left out", async () => {
  const repo = fakeRepository();
  for (let index = 0; index < 60; index += 1) repo.state.projects.push(project({ id: `extra-${index}`, projectName: `Extra ${index}`, createdAt: daysAgo(30 + index), updatedAt: daysAgo(30 + index) }));
  const data = await service(repo).build({});
  assert.equal(data.recentProjects.length, 64);
  assert.equal(data.summary.totalProjects, 64);
  // Still most recently active first.
  assert.equal(data.recentProjects[0].id, "p1");
});

test("an attention row narrows to exactly the projects it counted", async () => {
  const repo = fakeRepository();
  const ids = await service(repo).attentionProjectIds(repo.state.projects, "notOpened");
  assert.deepEqual([...ids], ["p2"]);
  // An unknown row narrows nothing rather than everything.
  assert.equal((await service(repo).attentionProjectIds(repo.state.projects, "nonsense")).size, 4);
});

// ── The Projects list reads the same classifier ────────────────────────────────────────────────

test("the Projects list accepts the dashboard's attention filter and asks the dashboard to apply it", async () => {
  const rows = [{ id: "p1", projectName: "One", salesProjectId: null, createdAt: NOW, totalPhotoSize: BigInt(0) }, { id: "p2", projectName: "Two", salesProjectId: null, createdAt: NOW, totalPhotoSize: BigInt(0) }];
  const repo = { listProjects: async () => rows, listSalesProjectsAwaitingImageProject: async () => [], selectionProgressData: async () => ({ publishedProjectIds: [], configs: [], selectedConfigIds: [] }) };
  const asked = [];
  const attention = { attentionProjectIds: async (projects, kind) => { asked.push([projects.map((row) => row.id), kind]); return new Set(["p2"]); } };
  const listed = await createImageSelectionProjectService(repo, { attention }).list({ sort: "dateAdded", order: "desc", archived: false, attention: "overdue" });
  assert.deepEqual(listed.map((row) => row.id), ["p2"]);
  assert.deepEqual(asked, [[["p1", "p2"], "overdue"]]);
  // Without the filter the dashboard is never consulted.
  asked.length = 0;
  assert.equal((await createImageSelectionProjectService(repo, { attention }).list({ sort: "dateAdded", order: "desc", archived: false })).length, 2);
  assert.deepEqual(asked, []);
});

test("query validation: only the ranges and windows the page offers", () => {
  assert.deepEqual(dashboardQuerySchema.parse({}), { range: "month" });
  assert.equal(dashboardQuerySchema.parse({ range: "lifetime" }).range, "lifetime");
  // A range the picker no longer offers is refused rather than quietly answered.
  assert.equal(dashboardQuerySchema.safeParse({ range: "5d" }).success, false);
  assert.equal(dashboardQuerySchema.safeParse({ range: "year" }).success, false);
  assert.equal(listProjectsSchema.parse({ attention: "readyToDownload" }).attention, "readyToDownload");
  // Every card's view is a filter the list takes, and nothing else is.
  for (const kind of classify.ATTENTION_KINDS) assert.equal(listProjectsSchema.parse({ attention: kind }).attention, kind);
  assert.equal(listProjectsSchema.safeParse({ attention: "everything" }).success, false);
});

/*
 * A batch nothing is coming back for.
 *
 * The studio saw this as "0 Processing" on the Storage card with "3 active upload batches"
 * underneath it: a batch is opened with the total the browser says it is about to send and only
 * finishes when the counters reach that total, so a closed tab or a dropped connection leaves one
 * calling itself active for ever. These pin the two halves of the rule that closes it, because
 * the second half is what keeps the sweep from ever touching a batch that is merely slow.
 */
test("the storage card closes abandoned batches before it counts them", async () => {
  const repo = fakeRepository();
  const order = [];
  repo.storageStats = async () => { order.push("count"); return { totalPhotos: 0, readyPhotos: 0, processingPhotos: 0, failedPhotos: 0, originalBytes: 0, registeredOriginals: 0, serverOriginals: 0, r2Objects: 0, r2PreviewBytes: 0, activeBatches: 0, added: null }; };
  await createDashboardService(repo, { settings, now: () => NOW, closeAbandonedBatches: async () => { order.push("close"); return { count: 3 }; } }).build({ range: "lifetime" });
  assert.deepEqual(order, ["close", "count"], "counting first would report the batches it is about to close");
});

test("a sweep that cannot run leaves the card standing", async () => {
  const repo = fakeRepository();
  const data = await createDashboardService(repo, { settings, now: () => NOW, closeAbandonedBatches: async () => { throw new Error("database is down"); } }).build({ range: "lifetime" });
  assert.equal(data.storage.totalPhotos, 1540, "the numbers are still read and shown");
});

test("the sweep only closes a batch that is both quiet and owed nothing", () => {
  const { closeAbandonedBatches, ACTIVE_BATCH_STATUSES, OUTSTANDING_UPLOAD_STATUSES, ABANDONED_AFTER_MS } = require("../src/modules/image-selection/uploads/batchRepository");
  assert.deepEqual(ACTIVE_BATCH_STATUSES, ["UPLOADING", "QUEUED", "PROCESSING"]);
  assert.deepEqual(OUTSTANDING_UPLOAD_STATUSES, ["PENDING", "UPLOADING", "PROCESSING"]);

  // The card's Processing number is read from the same list the sweep calls outstanding, so the
  // two can never disagree about whether a photograph is still being worked on.
  const { PROCESSING_STATUSES } = require("../src/modules/image-selection/dashboard/repository");
  assert.equal(PROCESSING_STATUSES, OUTSTANDING_UPLOAD_STATUSES);

  const source = closeAbandonedBatches.toString();
  assert.match(source, /status: \{ in: ACTIVE_BATCH_STATUSES \}/, "only a batch that still calls itself active");
  assert.match(source, /updatedAt: \{ lt: new Date\(now\.getTime\(\) - ABANDONED_AFTER_MS\) \}/, "and only one nothing has moved for");
  // The half that makes it safe: a batch whose work is queued behind a backlog still owns rows
  // waiting to be worked, so it can never be closed however long that backlog takes.
  assert.match(source, /uploads: \{ none: \{ status: \{ in: OUTSTANDING_UPLOAD_STATUSES \} \} \}/, "and only one with no upload still pending or processing");
  assert.match(source, /data: \{ status: "ABANDONED", completedAt: now \}/);
  assert.equal(ABANDONED_AFTER_MS, 15 * 60 * 1000);
});

// A closed batch has stopped, so anything watching it has to stop too - a progress bar and an ETA
// left running against work that will never land is the same wrong number in another place.
test("an abandoned batch reads as finished, not as frozen part-way", () => {
  const { serializeBatch } = require("../src/modules/image-selection/uploads/progress");
  const batch = { totalFiles: 10, uploadedFiles: 4, compressedFiles: 4, failedFiles: 0, startedAt: new Date(NOW.getTime() - 60000), status: "ABANDONED" };
  const done = serializeBatch(batch);
  assert.equal(done.overallProgress, 100);
  assert.equal(done.etaSeconds, 0);
  assert.equal(serializeBatch({ ...batch, status: "UPLOADING" }).overallProgress, 40, "one still running is unchanged");
});
