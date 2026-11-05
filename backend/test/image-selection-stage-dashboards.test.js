const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createStageDashboardService } = require("../src/modules/image-selection/stage-dashboards/service");

// 15 Sep 2026, 15:30 IST. This Month began at 2026-08-31T18:30:00Z.
const NOW = new Date("2026-09-15T10:00:00.000Z");
const DAY = 24 * 3600 * 1000;
const at = (iso) => new Date(iso);
const days = (count) => new Date(NOW.getTime() + count * DAY);
const project = (id, extra = {}) => ({ id, projectCode: `IS-${id}`, projectName: `Project ${id}`, clientName: null, salesProject: { whatsappGroupName: `Group ${id}` }, ...extra });
const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");

const session = (id, projectId, folderId, status, extra = {}) => ({
  id, projectId, folderId, status, mode: "BALANCED", totalImages: 100, processedImages: 100, keepCount: 40, maybeCount: 10, rejectCount: 50,
  progressPercent: 100, error: null, createdAt: at("2026-09-01T05:00:00.000Z"), updatedAt: at("2026-09-02T05:00:00.000Z"),
  completedAt: null, finalizedAt: null, project: project(projectId), folder: folderId ? { name: `Shoot ${folderId}` } : null, ...extra,
});

test("AI Culling counts the latest run of each shoot once, and every run in the period", async () => {
  // Newest first, as the repository orders them: the re-run of p1's whole project replaces the failed one.
  const sessions = [
    session("s3", "p1", null, "REVIEW_READY", { createdAt: at("2026-09-10T05:00:00.000Z"), updatedAt: at("2026-09-12T05:00:00.000Z") }),
    session("s2", "p1", "f1", "ANALYZING", { processedImages: 30, keepCount: 0, maybeCount: 0, rejectCount: 0, progressPercent: 30 }),
    session("s1", "p1", null, "FAILED", { error: "Engine offline", createdAt: at("2026-08-20T05:00:00.000Z") }),
    session("s0", "p2", null, "FINALIZED", { finalizedAt: at("2026-09-03T05:00:00.000Z"), updatedAt: at("2026-09-03T05:00:00.000Z") }),
  ];
  const service = createStageDashboardService({ listCullingSessions: async () => sessions }, { now: () => NOW });
  const data = await service.culling({ range: "month" });
  assert.deepEqual(data.rows.map((row) => row.id), ["s3", "s0", "s2"]);
  assert.equal(data.summary.totalRuns, 3);
  assert.equal(data.summary.processing, 1);
  assert.equal(data.summary.reviewReady, 1);
  assert.equal(data.summary.finalized, 1);
  assert.equal(data.summary.failed, 0, "a failed run replaced by a later one is not current");
  assert.equal(data.summary.imagesAnalysed, 230);
  // A run still analysing has no verdicts yet, so its zeros are not counted as rejects.
  assert.equal(data.summary.keeps, 80);
  assert.equal(data.rows.find((row) => row.id === "s2").keepCount, null);
  assert.equal(data.period.runsStarted, 3);
  assert.equal(data.period.runsFinalized, 1);
  assert.equal(data.totals.allRuns, 4);
  assert.equal(data.rows[0].clientName, "Group p1");
  assert.equal(data.rows.find((row) => row.id === "s2").shootName, "Shoot f1");
});

test("AI Editing counts the bay by state per project, held photos as awaiting", async () => {
  const repo = {
    editCounts: async () => ({
      byStatus: [
        { projectId: "p1", status: "DRAFT", _count: { _all: 2 } },
        { projectId: "p1", status: "RENDERED", _count: { _all: 5 } },
        { projectId: "p1", status: "FAILED", _count: { _all: 1 } },
        { projectId: "p2", status: "WAITING_FOR_DESKTOP", _count: { _all: 3 } },
      ],
      held: [{ projectId: "p2", _count: { _all: 4 } }],
      sentToPhotos: [{ projectId: "p1", _count: { _all: 2 } }],
      sentToAlbum: [{ projectId: "p1", _count: { _all: 3 } }],
      albumSyncFailed: [{ projectId: "p1", _count: { _all: 1 } }],
      lastActivity: [{ projectId: "p1", _max: { updatedAt: at("2026-09-10T05:00:00.000Z") } }, { projectId: "p2", _max: { updatedAt: at("2026-09-12T05:00:00.000Z") } }],
    }),
    listProjects: async (ids) => ids.map((id) => project(id)),
    editPeriodCounts: async () => ({ editsCreated: 6, photosRendered: 5 }),
  };
  const data = await createStageDashboardService(repo, { now: () => NOW }).editing({ range: "month" });
  assert.deepEqual(data.rows.map((row) => row.projectId), ["p2", "p1"]);
  const p1 = data.rows.find((row) => row.projectId === "p1");
  assert.equal(p1.totalPhotos, 8);
  assert.equal(p1.percentEdited, 63);
  assert.equal(data.summary.totalPhotos, 15);
  assert.equal(data.summary.awaitingEdit, 6);
  assert.equal(data.summary.waitingForDesktop, 3);
  assert.equal(data.summary.edited, 5);
  assert.equal(data.summary.sentToAlbum, 3);
  assert.equal(data.summary.albumSyncFailed, 1);
  assert.equal(data.period.photosRendered, 5);
});

test("Signature Album reads each album's status by the tab's own rule", async () => {
  const album = (id, extra = {}) => ({
    id, projectId: `p-${id}`, title: `Album ${id}`, status: "DRAFT", publishedAt: null, expiresAt: null, coverImageId: null, coverAlbumPhotoId: "c",
    requirePin: true, allowDownload: true, createdAt: at("2026-09-01T05:00:00.000Z"), updatedAt: at("2026-09-01T05:00:00.000Z"), project: project(`p-${id}`), ...extra,
  });
  const repo = {
    listAlbums: async () => ({
      albums: [
        album("empty"),
        album("ready"),
        album("live", { status: "PUBLISHED", publishedAt: at("2026-09-05T05:00:00.000Z"), expiresAt: days(60) }),
        album("soon", { status: "PUBLISHED", expiresAt: days(4), allowDownload: false }),
        album("gone", { status: "PUBLISHED", expiresAt: days(-1) }),
      ],
      items: [{ albumId: "ready", _count: { _all: 12 } }, { albumId: "live", _count: { _all: 30 } }, { albumId: "soon", _count: { _all: 5 } }, { albumId: "gone", _count: { _all: 2 } }],
      chapters: [{ albumId: "ready", _count: { _all: 2 } }, { albumId: "live", _count: { _all: 3 } }, { albumId: "soon", _count: { _all: 1 } }, { albumId: "gone", _count: { _all: 1 } }],
    }),
    albumPeriodCounts: async () => ({ albumsCreated: 5, albumsPublished: 1 }),
  };
  const data = await createStageDashboardService(repo, { now: () => NOW }).signatureAlbum({ range: "month" });
  const statusOf = Object.fromEntries(data.rows.map((row) => [row.id, row.status]));
  assert.deepEqual(statusOf, { empty: "DRAFT", ready: "READY", live: "PUBLISHED", soon: "PUBLISHED", gone: "EXPIRED" });
  assert.equal(data.rows.find((row) => row.id === "empty").blocker, "Upload at least one photo.");
  assert.deepEqual(
    { total: data.summary.totalAlbums, draft: data.summary.draft, ready: data.summary.ready, published: data.summary.published, soon: data.summary.expiringSoon, expired: data.summary.expired, photos: data.summary.totalPhotos },
    { total: 5, draft: 1, ready: 1, published: 2, soon: 1, expired: 1, photos: 49 },
  );
  assert.equal(data.totals.downloadsAllowed, 1);
});

test("each stage dashboard answers to its own permission, and AI Culling's ships in a migration granted to Super Admin alone", () => {
  const routes = read("src", "modules", "image-selection", "stage-dashboards", "routes.js");
  assert.match(routes, /router\.use\(protect\);/);
  assert.match(routes, /router\.get\("\/ai-culling", requireModule\("IMAGE_SELECTION", "AI Culling"\), culling\);/);
  assert.match(routes, /router\.get\("\/ai-editing", requireModule\("IMAGE_SELECTION", "AI Editing"\), editing\);/);
  assert.match(routes, /router\.get\("\/signature-album", requireModule\("IMAGE_SELECTION", "Signature Album"\), signatureAlbum\);/);
  assert.match(read("src", "server.js"), /app\.use\("\/api\/image-selection\/stage-dashboards", imageSelectionStageDashboardRoutes\);/);
  assert.match(read("prisma", "seeds", "permission-catalogue.js"), /feature: "AI Culling",\s+level: "ISAI_CULLING"/);
  const sql = read("prisma", "migrations", "20261103120000_ai_culling_dashboard_permission", "migration.sql");
  assert.match(sql, /'IMAGE_SELECTION', 'AI Culling', 'ISAI_CULLING'/);
  assert.match(sql, /WHERE `role`\.`name` = 'SUPER_ADMIN'/);
  assert.doesNotMatch(sql, /BRANCH_ADMIN|ADMINISTRATOR/);
});
