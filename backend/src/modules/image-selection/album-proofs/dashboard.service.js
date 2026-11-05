const { dashboardRepository } = require("./dashboard.repository");
const { clientLabel } = require("./service");
const { ROUND_SOURCE, UNRESOLVED_STATUSES, revisedUploadGate } = require("./revisionGate");
const { rangeBounds, DEFAULT_RANGE } = require("../../../services/dashboardRange");

/**
 * The Album Proofing dashboard, answered in one request, on the pattern of the Image Selection
 * dashboard: ten headline figures that are *positions* (every live album under a live, unarchived
 * project — the albums the Projects page can show — by the state it is in),
 * a `period` of what happened inside the range picked above them, and a `trend` for the two
 * figures whose past a row still carries a stamp for. An album's status is overwritten in place
 * as it moves, so "how many were in QC Review on the 1st" is not a question the rows can answer,
 * and the dashboard does not pretend otherwise.
 *
 * Nothing here decides a state. The counts read `status` as the services wrote it; "ready for the
 * revised upload" is `revisionGate.js`'s own rule, asked the same question the workspace asks;
 * the link's state is the publication card's own rule (`client.service.js`); and the one figure
 * this file adds — where an album stands on the workflow, for the Progress column — is a reading
 * of the state, written once below.
 */

// The same ten days the Image Selection dashboard gives a gallery link (`dashboard/classify.js`),
// so "expiring soon" means one thing across Visual Curation.
const EXPIRING_SOON_DAYS = 10;
const DAY_MS = 24 * 3600 * 1000;
const WORK_LIMIT = 5;

/** The states in which a correction round is being worked: the Corrections panel lists these. */
const FIXING_STATES = ["QC_CHANGES_REQUESTED", "QC_REVISION_IN_PROGRESS", "CLIENT_CHANGES_REQUESTED", "REVISION_IN_PROGRESS"];

/**
 * Where an album stands on the workflow, as a position on the Progress bar: nothing uploaded,
 * ready for QC, in QC, QC approved, with the client, client approved, complete. A revision that
 * goes back to QC reads as back in QC — the bar is honest to where the work is, not monotonic.
 */
const STAGE_PERCENT = {
  DRAFT: 0, PROCESSING: 0, PROCESSING_FAILED: 0,
  READY_FOR_QC: 20,
  QC_REVIEW: 40, QC_CHANGES_REQUESTED: 40, QC_REVISION_IN_PROGRESS: 40, REVISION_READY_FOR_QC: 40,
  QC_APPROVED: 60, READY_FOR_CLIENT: 60,
  CLIENT_REVIEW: 80, CLIENT_CHANGES_REQUESTED: 80, REVISION_IN_PROGRESS: 80,
  CLIENT_APPROVED: 90,
  COMPLETED: 100,
};
const stagePercentOf = (status) => STAGE_PERCENT[status] ?? 0;

/** The publication card's own reading of a link, with the ten-day warning the dashboard adds. */
function linkStateOf(publication, now) {
  if (!publication) return null;
  if (publication.revokedAt) return "revoked";
  if (!publication.expiresAt) return "active";
  const expiresAt = new Date(publication.expiresAt);
  if (expiresAt <= now) return "expired";
  if (expiresAt.getTime() - now.getTime() <= EXPIRING_SOON_DAYS * DAY_MS) return "expiringSoon";
  return "active";
}

const time = (value) => (value ? new Date(value).getTime() : 0);
const later = (first, second) => (time(second) > time(first) ? second : first);

function createAlbumDashboardService(repo = dashboardRepository, dependencies = {}) {
  const now = dependencies.now || (() => new Date());

  async function build(query = {}) {
    const at = now();
    const range = rangeBounds(query.range || DEFAULT_RANGE, at);
    const [albums, correctionRows, activityRows, period] = await Promise.all([
      repo.readAlbums(), repo.correctionCounts(), repo.latestActivityByAlbum(), repo.periodCounts(range),
    ]);
    const activityByAlbum = Object.fromEntries(activityRows.map((row) => [row.albumId, row._max.createdAt]));

    // One tally of corrections per album — by source for the gate, by state for the panel.
    const tallies = {};
    const corrections = { open: 0, inProgress: 0, reopened: 0, resolved: 0, total: 0 };
    for (const row of correctionRows) {
      const tally = tallies[row.albumId] || (tallies[row.albumId] = { total: 0, unresolved: 0, resolved: 0, bySource: { QC: { total: 0, unresolved: 0 }, CLIENT: { total: 0, unresolved: 0 } } });
      const count = row._count._all;
      const unresolved = UNRESOLVED_STATUSES.includes(row.status);
      tally.total += count;
      if (unresolved) tally.unresolved += count; else tally.resolved += count;
      const source = tally.bySource[row.source] || (tally.bySource[row.source] = { total: 0, unresolved: 0 });
      source.total += count;
      if (unresolved) source.unresolved += count;
      corrections.total += count;
      corrections[{ OPEN: "open", IN_PROGRESS: "inProgress", REOPENED: "reopened", RESOLVED: "resolved" }[row.status] || "resolved"] += count;
    }

    const rows = albums.map((album) => {
      const tally = tallies[album.id] || { total: 0, unresolved: 0, resolved: 0, bySource: {} };
      const round = tally.bySource[ROUND_SOURCE[album.status]] || { total: 0, unresolved: 0 };
      const gate = revisedUploadGate({ status: album.status, roundTotal: round.total, unresolved: round.unresolved });
      const publication = album.publications?.[0] || null;
      const linkState = linkStateOf(publication, at);
      return {
        id: album.id, projectId: album.projectId, name: album.name, albumType: album.albumType,
        projectName: album.project?.projectName ?? null, clientName: clientLabel(album.project),
        // The table reads an archived album as Archived, as the workspace's chip does; the counts keep the state it was archived in.
        status: album.archivedAt ? "ARCHIVED" : album.status, workflowStatus: album.status, archivedAt: album.archivedAt,
        currentVersionNumber: album.versions?.[0]?.versionNumber ?? null,
        revisionLimit: album.revisionLimit, revisionsUsed: album.revisionsUsed,
        openCorrections: tally.unresolved, correctionTotal: tally.total, correctionResolved: tally.resolved,
        correctionPercent: tally.total ? Math.round((tally.resolved / tally.total) * 100) : null,
        stagePercent: stagePercentOf(album.status),
        readyForRevisedVersion: gate.unlocked,
        link: publication ? { state: linkState, expiresAt: publication.expiresAt, revisionNumber: publication.revisionNumber, versionNumber: publication.version?.versionNumber ?? null, publishedAt: publication.publishedAt } : null,
        lastActivityAt: later(album.updatedAt, activityByAlbum[album.id] || null),
        createdAt: album.createdAt, completedAt: album.completedAt,
        views: { correctionsOpen: tally.unresolved > 0, readyForRevisedVersion: gate.unlocked, linkExpiringSoon: linkState === "expiringSoon", linkExpired: linkState === "expired" },
      };
    }).sort((first, second) => time(second.lastActivityAt) - time(first.lastActivityAt));

    const inState = (...states) => rows.filter((row) => states.includes(row.workflowStatus)).length;
    const summary = {
      totalAlbums: rows.length,
      draft: inState("DRAFT"),
      readyForQc: inState("READY_FOR_QC", "REVISION_READY_FOR_QC"),
      qcReview: inState("QC_REVIEW"),
      correctionsOpen: rows.filter((row) => row.views.correctionsOpen).length,
      readyForRevisedVersion: rows.filter((row) => row.readyForRevisedVersion).length,
      readyForClient: inState("QC_APPROVED", "READY_FOR_CLIENT"),
      clientReview: inState("CLIENT_REVIEW"),
      linkExpiringSoon: rows.filter((row) => row.views.linkExpiringSoon).length,
      completed: inState("COMPLETED"),
    };

    let trend = null;
    if (range.key !== "lifetime") {
      const totalBefore = albums.filter((album) => new Date(album.createdAt) < range.from).length;
      const completedBefore = albums.filter((album) => album.status === "COMPLETED" && album.completedAt && new Date(album.completedAt) < range.from).length;
      trend = { totalAlbums: { before: totalBefore, delta: summary.totalAlbums - totalBefore }, completed: { before: completedBefore, delta: summary.completed - completedBefore } };
    }

    const linkCount = (state) => rows.filter((row) => row.link?.state === state).length;
    return {
      range,
      period: { key: range.key, label: range.label, ...period },
      totalAlbumsAllTime: rows.length,
      summary,
      trend,
      comparedAt: trend ? range.from : null,
      albumRows: rows,
      correctionWork: rows.filter((row) => FIXING_STATES.includes(row.workflowStatus)).slice(0, WORK_LIMIT),
      corrections,
      links: {
        active: linkCount("active"), expiringSoon: linkCount("expiringSoon"), expired: linkCount("expired"), revoked: linkCount("revoked"),
        inClientReview: rows.filter((row) => row.workflowStatus === "CLIENT_REVIEW").map((row) => ({ albumId: row.id, name: row.name, versionNumber: row.link?.versionNumber ?? row.currentVersionNumber })),
      },
      processing: { processing: inState("PROCESSING"), failed: inState("PROCESSING_FAILED") },
      clientApproved: inState("CLIENT_APPROVED"),
      archived: rows.filter((row) => row.archivedAt).length,
      generatedAt: at,
    };
  }

  return { build };
}

module.exports = { createAlbumDashboardService, EXPIRING_SOON_DAYS, STAGE_PERCENT, FIXING_STATES, linkStateOf, stagePercentOf };
