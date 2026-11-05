const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createAlbumDashboardService, EXPIRING_SOON_DAYS, linkStateOf, stagePercentOf } = require("../src/modules/image-selection/album-proofs/dashboard.service");

// 15 Sep 2026, 15:30 IST. This Month began at 2026-08-31T18:30:00Z.
const NOW = new Date("2026-09-15T10:00:00.000Z");
const FROM = new Date("2026-08-31T18:30:00.000Z");
const DAY = 24 * 3600 * 1000;
const at = (iso) => new Date(iso);
const days = (count) => new Date(NOW.getTime() + count * DAY);

const project = (name, client) => ({ id: `p-${name}`, projectName: name, clientName: client, salesProject: null });
const album = (id, status, extra = {}) => ({
  id, projectId: `p-${id}`, name: `Album ${id}`, albumType: "Wedding", status, archivedAt: null, completedAt: null,
  createdAt: at("2026-08-01T05:00:00.000Z"), updatedAt: at("2026-09-01T05:00:00.000Z"), revisionLimit: 3, revisionsUsed: 0,
  project: project(id, `Client ${id}`), versions: [], publications: [], ...extra,
});

const ALBUMS = [
  album("draft", "DRAFT", { createdAt: FROM }),                                // created at the first instant of the range
  album("failed", "PROCESSING_FAILED"),
  album("ready", "READY_FOR_QC", { versions: [] }),
  album("qc", "QC_REVIEW", { versions: [{ versionNumber: 1 }], updatedAt: at("2026-09-14T05:00:00.000Z") }),
  // A QC fix round with one correction still open: corrections open, not ready for the revised upload.
  album("fixing", "QC_REVISION_IN_PROGRESS", { versions: [{ versionNumber: 1 }], updatedAt: at("2026-09-13T05:00:00.000Z") }),
  // A client revision with every client correction resolved: the gate is open.
  album("revising", "REVISION_IN_PROGRESS", { versions: [{ versionNumber: 1 }], updatedAt: at("2026-09-12T05:00:00.000Z") }),
  album("review", "CLIENT_REVIEW", { versions: [{ versionNumber: 2 }], publications: [{ id: "pub-1", revisionNumber: 2, expiresAt: days(3), revokedAt: null, publishedAt: at("2026-09-10T05:00:00.000Z"), version: { versionNumber: 2 } }] }),
  album("revoked", "CLIENT_REVIEW", { versions: [{ versionNumber: 1 }], publications: [{ id: "pub-2", revisionNumber: 1, expiresAt: days(90), revokedAt: at("2026-09-11T05:00:00.000Z"), publishedAt: at("2026-09-09T05:00:00.000Z"), version: { versionNumber: 1 } }] }),
  album("done", "COMPLETED", { completedAt: at("2026-08-20T05:00:00.000Z"), versions: [{ versionNumber: 3 }], publications: [{ id: "pub-3", revisionNumber: 3, expiresAt: days(-2), revokedAt: null, publishedAt: at("2026-08-01T05:00:00.000Z"), version: { versionNumber: 3 } }] }),
];

const CORRECTIONS = [
  { albumId: "fixing", source: "QC", status: "RESOLVED", _count: { _all: 1 } },
  { albumId: "fixing", source: "QC", status: "OPEN", _count: { _all: 1 } },
  { albumId: "revising", source: "CLIENT", status: "RESOLVED", _count: { _all: 2 } },
  { albumId: "qc", source: "QC", status: "REOPENED", _count: { _all: 1 } },
];

function fakeRepo(overrides = {}) {
  const calls = [];
  return {
    calls,
    readAlbums: async () => ALBUMS,
    correctionCounts: async () => CORRECTIONS,
    latestActivityByAlbum: async () => [{ albumId: "ready", _max: { createdAt: at("2026-09-15T08:00:00.000Z") } }],
    periodCounts: async (bounds) => { calls.push(["periodCounts", bounds]); return { albumsCreated: 1, sentToQc: 4, sentToClient: 2, completed: 1 }; },
    ...overrides,
  };
}

const build = (repo = fakeRepo(), query = { range: "month" }) => createAlbumDashboardService(repo, { now: () => NOW }).build(query);

test("the ten figures count every live album by the state it is in", async () => {
  const { summary, totalAlbumsAllTime } = await build();
  assert.deepEqual(summary, {
    totalAlbums: 9, draft: 1, readyForQc: 1, qcReview: 1, correctionsOpen: 2, readyForRevisedVersion: 1,
    readyForClient: 0, clientReview: 2, linkExpiringSoon: 1, completed: 1,
  });
  assert.equal(totalAlbumsAllTime, 9);
});

test("a link is read from the latest publication: none, revoked, expired, expiring soon or active", () => {
  assert.equal(linkStateOf(null, NOW), null);
  assert.equal(linkStateOf({ revokedAt: at("2026-09-11T05:00:00.000Z"), expiresAt: days(90) }, NOW), "revoked");
  assert.equal(linkStateOf({ revokedAt: null, expiresAt: days(-1) }, NOW), "expired");
  assert.equal(linkStateOf({ revokedAt: null, expiresAt: days(EXPIRING_SOON_DAYS) }, NOW), "expiringSoon");
  assert.equal(linkStateOf({ revokedAt: null, expiresAt: days(EXPIRING_SOON_DAYS + 1) }, NOW), "active");
  // A link with no expiry never expires.
  assert.equal(linkStateOf({ revokedAt: null, expiresAt: null }, NOW), "active");
  assert.equal(EXPIRING_SOON_DAYS, 10);
});

test("progress is the album's position on the workflow, from its state", () => {
  assert.equal(stagePercentOf("DRAFT"), 0);
  assert.equal(stagePercentOf("PROCESSING_FAILED"), 0);
  assert.equal(stagePercentOf("READY_FOR_QC"), 20);
  assert.equal(stagePercentOf("QC_REVISION_IN_PROGRESS"), 40);
  assert.equal(stagePercentOf("REVISION_READY_FOR_QC"), 40);
  assert.equal(stagePercentOf("READY_FOR_CLIENT"), 60);
  assert.equal(stagePercentOf("REVISION_IN_PROGRESS"), 80);
  assert.equal(stagePercentOf("CLIENT_APPROVED"), 90);
  assert.equal(stagePercentOf("COMPLETED"), 100);
});

test("every live album is a table row, most recently active first, carrying its version, corrections, link and gate", async () => {
  const { albumRows } = await build();
  assert.equal(albumRows.length, 9);
  // The album whose latest activity row is newest comes first, ahead of the one most recently updated.
  assert.deepEqual(albumRows.slice(0, 2).map((row) => row.id), ["ready", "qc"]);
  const rows = Object.fromEntries(albumRows.map((row) => [row.id, row]));
  assert.equal(rows.ready.currentVersionNumber, null);
  assert.equal(rows.qc.currentVersionNumber, 1);
  assert.equal(rows.qc.clientName, "Client qc");
  assert.equal(rows.qc.projectName, "qc");
  assert.deepEqual([rows.fixing.openCorrections, rows.fixing.correctionTotal, rows.fixing.correctionResolved, rows.fixing.correctionPercent], [1, 2, 1, 50]);
  assert.equal(rows.fixing.readyForRevisedVersion, false);
  assert.equal(rows.revising.readyForRevisedVersion, true);
  assert.equal(rows.revising.correctionPercent, 100);
  assert.equal(rows.draft.correctionPercent, null);
  assert.equal(rows.review.link.state, "expiringSoon");
  assert.equal(rows.review.link.revisionNumber, 2);
  assert.equal(rows.revoked.link.state, "revoked");
  assert.equal(rows.done.link.state, "expired");
  assert.equal(rows.draft.link, null);
  assert.equal(rows.done.stagePercent, 100);
  assert.deepEqual(rows.fixing.views, { correctionsOpen: true, readyForRevisedVersion: false, linkExpiringSoon: false, linkExpired: false });
  assert.deepEqual(rows.done.views, { correctionsOpen: false, readyForRevisedVersion: false, linkExpiringSoon: false, linkExpired: true });
  assert.equal(rows.ready.lastActivityAt.toISOString(), "2026-09-15T08:00:00.000Z");
});

test("the panels: correction work, corrections by state, links, processing and the rest", async () => {
  const data = await build();
  assert.deepEqual(data.correctionWork.map((row) => row.id), ["fixing", "revising"]);
  assert.deepEqual(data.corrections, { open: 1, inProgress: 0, reopened: 1, resolved: 3, total: 5 });
  assert.deepEqual(data.links, {
    active: 0, expiringSoon: 1, expired: 1, revoked: 1,
    inClientReview: [{ albumId: "review", name: "Album review", versionNumber: 2 }, { albumId: "revoked", name: "Album revoked", versionNumber: 1 }],
  });
  assert.deepEqual(data.processing, { processing: 0, failed: 1 });
  assert.equal(data.clientApproved, 0);
  assert.equal(data.archived, 0);
});

test("the range scopes the period figures and the two stamped trends; Lifetime has neither", async () => {
  const repo = fakeRepo();
  const data = await build(repo);
  assert.deepEqual(data.period, { key: "month", label: "This Month", albumsCreated: 1, sentToQc: 4, sentToClient: 2, completed: 1 });
  assert.equal(repo.calls[0][1].from.toISOString(), FROM.toISOString());
  // Eight albums stood when the month began (the draft was created at its first instant); one was already complete.
  assert.deepEqual(data.trend, { totalAlbums: { before: 8, delta: 1 }, completed: { before: 1, delta: 0 } });
  assert.equal(data.comparedAt.toISOString(), FROM.toISOString());
  const lifetime = await build(fakeRepo(), { range: "lifetime" });
  assert.equal(lifetime.trend, null);
  assert.equal(lifetime.comparedAt, null);
});

test("an archived album keeps its state for the count but reads as Archived on the table", async () => {
  const archived = { ...album("old", "COMPLETED"), archivedAt: at("2026-09-02T05:00:00.000Z"), completedAt: at("2026-08-15T05:00:00.000Z") };
  const data = await build(fakeRepo({ readAlbums: async () => [...ALBUMS, archived] }));
  assert.equal(data.summary.totalAlbums, 10);
  assert.equal(data.summary.completed, 2);
  assert.equal(data.archived, 1);
  assert.equal(data.albumRows.find((row) => row.id === "old").status, "ARCHIVED");
});

test("the dashboard counts only albums the Projects page can show: live, under a live unarchived project", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/modules/image-selection/album-proofs/dashboard.repository.js"), "utf8");
  assert.match(source, /const liveAlbums = \{ deletedAt: null, project: \{ deletedAt: null, archivedAt: null \} \};/);
});

test("the dashboard route is declared before the album-id route, so 'dashboard' is never read as an id", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/modules/image-selection/album-proofs/routes.js"), "utf8");
  const dashboard = source.indexOf('router.get("/dashboard", READ_ANY');
  const byId = source.indexOf('router.get("/:albumId"');
  assert.ok(dashboard > -1, "the dashboard route exists and reads with READ_ANY");
  assert.ok(dashboard < byId);
});

test("the controller refuses a range the picker has no option for", async () => {
  const { dashboard } = require("../src/modules/image-selection/album-proofs/controller");
  let status = null; let body = null;
  const res = { status(code) { status = code; return this; }, json(payload) { body = payload; return this; } };
  await dashboard({ query: { range: "year" } }, res);
  assert.equal(status, 400);
  assert.equal(body.message, "Invalid dashboard request.");
});
