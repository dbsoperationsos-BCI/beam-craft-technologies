const repository = require("./repository");
const { SESSION_STATUSES } = require("../ai-culling/constants");
const { EXPIRING_SOON_DAYS } = require("../dashboard/classify");
const { publishProblems, deriveStatus } = require("../signature-album/signatureAlbum.helpers");
const { clientNameOf } = require("../../../services/projectClientNames");
const { rangeBounds } = require("../../../services/dashboardRange");

/**
 * The dashboards of the three stages that live inside an Image Selection project - AI Culling, AI
 * Editing and Signature Album - each answered in one request, on the pattern of the Photo
 * Selection and Album Proofing dashboards: headline figures that are *positions* (the work as it
 * stands now), a `period` of what happened inside the range picked above them, and the rows the
 * figures were counted from.
 *
 * Nothing here decides a state. A run's status is the one the culling worker wrote, an edit's the
 * one the editing worker wrote, and an album's is `deriveStatus` - the very rule the Signature
 * Album tab reads. There is no `trend`: a run, an edit and an album overwrite their status in place,
 * so where one stood on the 1st is not something the rows can answer, and the cards do not pretend.
 */

const DAY_MS = 24 * 3600 * 1000;
const time = (value) => (value ? new Date(value).getTime() : 0);
const inRange = (value, { from, to }) => Boolean(value) && new Date(value) >= from && new Date(value) < to;
const projectFields = (project) => ({
  projectId: project.id, projectCode: project.projectCode || null, projectName: project.projectName,
  clientName: project.clientName || clientNameOf(project.salesProject),
});
const rangeOf = (range) => ({ key: range.key, label: range.label, from: range.from, to: range.to });

// A run's status, as the cards group it: the worker's four moving states read as one.
const CULLING_GROUP = {
  [SESSION_STATUSES.QUEUED]: "queued",
  [SESSION_STATUSES.ANALYZING]: "processing",
  [SESSION_STATUSES.GROUPING]: "processing",
  [SESSION_STATUSES.RANKING]: "processing",
  [SESSION_STATUSES.REVIEW_READY]: "reviewReady",
  [SESSION_STATUSES.FINALIZED]: "finalized",
  [SESSION_STATUSES.FAILED]: "failed",
  [SESSION_STATUSES.CANCELLED]: "cancelled",
};
// Keeps, maybes and rejects only mean something once a run has reached review.
const HAS_VERDICTS = new Set(["reviewReady", "finalized"]);

// An edit's status, as the cards group it. A photo held for editing with no edit row yet is
// "awaiting", like a DRAFT edit: in the bay, nothing applied.
const EDIT_GROUP = { DRAFT: "awaitingEdit", QUEUED: "queued", WAITING_FOR_DESKTOP: "waitingForDesktop", RENDERING: "rendering", RENDERED: "edited", FAILED: "failed" };
const EDIT_KEYS = ["totalPhotos", "awaitingEdit", "queued", "waitingForDesktop", "rendering", "edited", "failed", "sentToPhotoSelection", "sentToAlbum", "albumSyncFailed"];

function createStageDashboardService(repo = repository, dependencies = {}) {
  const now = dependencies.now || (() => new Date());
  /**
   * Each row as its own module knows it: a project made in this module carries its own ID and name
   * (`visual_curation_module_project`), so the dashboard names the AI Culling project, not the
   * photo workspace under it. A project from Project Management has no record and keeps its own.
   */
  async function asModuleRows(module, rows) {
    if (!repo.moduleRecords || !rows.length) return rows;
    const records = await repo.moduleRecords(module, [...new Set(rows.map((row) => row.projectId))]);
    const byWorkspace = new Map(records.map((record) => [record.imageSelectionProjectId, record]));
    return rows.map((row) => { const record = byWorkspace.get(row.projectId); return record ? { ...row, projectCode: record.projectCode, projectName: record.projectName } : row; });
  }

  /**
   * AI Culling: one row per *current* run - the latest run of each shoot (or of the whole project)
   * - because a re-run replaces the one before it in the tab, and counting both would show a shoot
   * twice. Every run ever made still feeds the period figures.
   */
  async function culling(input = {}) {
    const at = now();
    const range = rangeBounds(input.range, at);
    const sessions = await repo.listCullingSessions();
    const latest = new Map();
    for (const session of sessions) {
      const scope = `${session.projectId}:${session.folderId || ""}`;
      if (!latest.has(scope)) latest.set(scope, session);
    }
    const rows = [...latest.values()].map((session) => {
      const group = CULLING_GROUP[session.status] || "queued";
      const verdicts = HAS_VERDICTS.has(group);
      return {
        id: session.id, ...projectFields(session.project),
        shootName: session.folder?.name || null,
        status: session.status, group, mode: session.mode,
        totalImages: session.totalImages, processedImages: session.processedImages, progressPercent: session.progressPercent,
        keepCount: verdicts ? session.keepCount : null, maybeCount: verdicts ? session.maybeCount : null, rejectCount: verdicts ? session.rejectCount : null,
        error: group === "failed" ? session.error || null : null,
        startedAt: session.createdAt, lastActivityAt: session.updatedAt,
      };
    }).sort((first, second) => time(second.lastActivityAt) - time(first.lastActivityAt));
    const named = await asModuleRows("culling", rows);

    const count = (group) => rows.filter((row) => row.group === group).length;
    const sum = (key) => rows.reduce((total, row) => total + (row[key] || 0), 0);
    return {
      range: rangeOf(range),
      period: {
        key: range.key, label: range.label,
        runsStarted: sessions.filter((session) => inRange(session.createdAt, range)).length,
        runsFinalized: sessions.filter((session) => inRange(session.finalizedAt, range)).length,
      },
      summary: {
        totalRuns: rows.length, queued: count("queued"), processing: count("processing"), reviewReady: count("reviewReady"),
        finalized: count("finalized"), failed: count("failed"),
        imagesAnalysed: sum("processedImages"), keeps: sum("keepCount"), maybes: sum("maybeCount"), rejects: sum("rejectCount"),
      },
      totals: { allRuns: sessions.length, cancelled: count("cancelled"), projects: new Set(rows.map((row) => row.projectId)).size },
      rows: named,
      generatedAt: at,
    };
  }

  /** AI Editing: one row per project with anything in its editing bay, counted by state. */
  async function editing(input = {}) {
    const at = now();
    const range = rangeBounds(input.range, at);
    const [counts, period] = await Promise.all([repo.editCounts(), repo.editPeriodCounts(range)]);
    const byProject = new Map();
    const rowOf = (projectId) => {
      if (!byProject.has(projectId)) byProject.set(projectId, { counts: Object.fromEntries(EDIT_KEYS.map((key) => [key, 0])), lastActivityAt: null });
      return byProject.get(projectId);
    };
    for (const row of counts.byStatus) {
      const entry = rowOf(row.projectId);
      const group = EDIT_GROUP[row.status];
      entry.counts.totalPhotos += row._count._all;
      if (group) entry.counts[group] += row._count._all;
    }
    for (const row of counts.held) { const entry = rowOf(row.projectId); entry.counts.totalPhotos += row._count._all; entry.counts.awaitingEdit += row._count._all; }
    for (const row of counts.sentToPhotos) rowOf(row.projectId).counts.sentToPhotoSelection += row._count._all;
    for (const row of counts.sentToAlbum) rowOf(row.projectId).counts.sentToAlbum += row._count._all;
    for (const row of counts.albumSyncFailed) rowOf(row.projectId).counts.albumSyncFailed += row._count._all;
    for (const row of counts.lastActivity) rowOf(row.projectId).lastActivityAt = row._max.updatedAt;

    const projects = await repo.listProjects([...byProject.keys()]);
    const rows = projects.map((project) => {
      const entry = byProject.get(project.id);
      const percentEdited = entry.counts.totalPhotos ? Math.round((entry.counts.edited / entry.counts.totalPhotos) * 100) : 0;
      return { id: project.id, ...projectFields(project), ...entry.counts, percentEdited, lastActivityAt: entry.lastActivityAt };
    }).sort((first, second) => time(second.lastActivityAt) - time(first.lastActivityAt));

    return {
      range: rangeOf(range),
      period: { key: range.key, label: range.label, ...period },
      summary: Object.fromEntries(EDIT_KEYS.map((key) => [key, rows.reduce((total, row) => total + row[key], 0)])),
      totals: { projects: rows.length },
      rows: await asModuleRows("editing", rows),
      generatedAt: at,
    };
  }

  /** Signature Album: one row per album, its status read by the tab's own rule. */
  async function signatureAlbum(input = {}) {
    const at = now();
    const range = rangeBounds(input.range, at);
    const [{ albums, items, chapters }, period] = await Promise.all([repo.listAlbums(), repo.albumPeriodCounts(range)]);
    const photosOf = new Map(items.map((row) => [row.albumId, row._count._all]));
    const chaptersOf = new Map(chapters.map((row) => [row.albumId, row._count._all]));
    const expiringBy = at.getTime() + EXPIRING_SOON_DAYS * DAY_MS;
    const rows = albums.map((album) => {
      const photoCount = photosOf.get(album.id) || 0;
      const chapterCount = chaptersOf.get(album.id) || 0;
      const problems = publishProblems(album, { chapterCount, photoCount, now: at });
      const status = deriveStatus(album, problems, at);
      const expiringSoon = status === "PUBLISHED" && Boolean(album.expiresAt) && time(album.expiresAt) <= expiringBy;
      return {
        id: album.id, ...projectFields(album.project), title: album.title, status, expiringSoon,
        photoCount, chapterCount, publishedAt: album.publishedAt, expiresAt: album.expiresAt,
        requirePin: album.requirePin, allowDownload: album.allowDownload,
        // What still stands between a draft and publishing, in the tab's own words.
        blocker: status === "DRAFT" ? problems[0]?.message || null : null,
        lastActivityAt: album.updatedAt,
      };
    });
    const count = (predicate) => rows.filter(predicate).length;
    return {
      range: rangeOf(range),
      period: { key: range.key, label: range.label, ...period },
      summary: {
        totalAlbums: rows.length, draft: count((row) => row.status === "DRAFT"), ready: count((row) => row.status === "READY"),
        published: count((row) => row.status === "PUBLISHED"), expiringSoon: count((row) => row.expiringSoon), expired: count((row) => row.status === "EXPIRED"),
        totalPhotos: rows.reduce((total, row) => total + row.photoCount, 0), totalChapters: rows.reduce((total, row) => total + row.chapterCount, 0),
      },
      totals: { pinProtected: count((row) => row.status === "PUBLISHED" && row.requirePin), downloadsAllowed: count((row) => row.status === "PUBLISHED" && row.allowDownload) },
      rows: await asModuleRows("album", rows),
      generatedAt: at,
    };
  }

  return { culling, editing, signatureAlbum };
}

module.exports = { createStageDashboardService, CULLING_GROUP, EDIT_GROUP, EDIT_KEYS };
