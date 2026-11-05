/**
 * The one mapping from what the database holds about an Image Selection project to the words the
 * dashboard and the Projects sidebar use for it.
 *
 * Pure on purpose: nothing here touches Prisma, so every rule can be checked without a database,
 * and every screen that names a stage — the summary cards, the workflow strip, the Needs Attention
 * rows, the recent-projects table and the Projects sidebar filter — reads it from here rather than
 * carrying its own copy of the strings.
 */

/**
 * Where one project stands on the product-wide progress ladder — the sidebar dot's answer.
 *
 * Unpublished is "notStarted", a published gallery the client has not touched is "inProgress", any
 * photo picked (or any item submitted) is "partiallyCompleted", and every live selection item
 * submitted is "completed". A published project with no selection items can only ever be in
 * progress — there is nothing to complete. It lived in projects/service.js before the dashboard
 * needed the same rung; the sidebar still reads it from there through this export.
 */
function selectionProgressOf(published, configs, selectedConfigIds) {
  if (!published) return "notStarted";
  if (configs.length && configs.every((config) => config.selectionSubmittedAt)) return "completed";
  if (configs.some((config) => config.selectionSubmittedAt || selectedConfigIds.has(config.id))) return "partiallyCompleted";
  return "inProgress";
}

/**
 * The five workflow stages, in order, each pinned to the rung (or the archive) it stands for.
 *
 * No new status is minted: four stages are the four rungs the sidebar already filters by, and
 * "Completed" is the studio's own closing gesture — archiving — so every card on the dashboard
 * opens the Projects page with a filter that page already had. `progress` is what the Projects
 * link carries; `archived` is the sidebar's Archived toggle rather than a rung.
 */
const DASHBOARD_STAGES = [
  { key: "uploaded", label: "Uploaded", progress: "notStarted", description: "Gallery not published yet" },
  { key: "linkSent", label: "Link Sent", progress: "inProgress", description: "Published, client yet to pick" },
  { key: "selecting", label: "Selecting", progress: "partiallyCompleted", description: "Client picking or items sent" },
  { key: "submitted", label: "Submitted", progress: "completed", description: "All items submitted" },
  { key: "completed", label: "Completed", progress: "archived", description: "Archived by the studio" },
];
const STAGE_BY_PROGRESS = Object.fromEntries(DASHBOARD_STAGES.map((stage) => [stage.progress, stage.key]));

/** The dashboard stage of one project: archived first, then its rung. */
function stageOf({ archivedAt, selectionProgress }) {
  if (archivedAt) return "completed";
  return STAGE_BY_PROGRESS[selectionProgress] || "uploaded";
}

/**
 * The dashboard's views of a project, each a filter the Projects list accepts under `?attention=`:
 * the five Needs Attention rows, and the four summary cards that are not a stage of the ladder.
 */
const ATTENTION_KINDS = ["overdue", "notOpened", "inactive", "newSubmissions", "readyToDownload", "yetToUpload", "notPublished", "expiringSoon", "expired", "downloaded"];
const ATTENTION_LABELS = {
  overdue: "Selection deadline overdue",
  notOpened: "Client hasn't opened the gallery",
  inactive: "No client activity for 7+ days",
  newSubmissions: "New client submissions",
  readyToDownload: "Selections yet to download",
  yetToUpload: "No photos uploaded yet",
  notPublished: "Photos in, gallery not sent",
  expiringSoon: "Gallery link expiring within 10 days",
  expired: "Gallery link has expired",
  downloaded: "Selected originals downloaded",
};
/*
 * The band Client Selection Progress watches: a client far enough through their selection to be
 * worth chasing, and not yet finished.
 *
 * 100 is not "nearly": a client who has picked their whole allowance has nothing left to do, and
 * the studio is waiting on the submission rather than on the picking. Below 85 there is still real
 * choosing to come, and a nudge is early.
 */
const NEARLY_DONE_MIN = 85;
const NEARLY_DONE_MAX = 99;

/** Whether a selection sits in that band. A project with no limit has no percentage and never does. */
const isNearlyDone = (percent) => Number.isFinite(percent) && percent >= NEARLY_DONE_MIN && percent <= NEARLY_DONE_MAX;

const INACTIVE_AFTER_DAYS = 7;
const NEW_SUBMISSION_DAYS = 7;
// Ten days, not the seven the other two windows use: this is the one that asks the studio to act
// before a link stops, and a week is not long enough to reach a client, wait for them to pick and
// extend the gallery if they cannot.
const EXPIRING_SOON_DAYS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

const latestOf = (...values) => values.filter(Boolean).map((value) => new Date(value)).reduce((latest, value) => (!latest || value > latest ? value : latest), null);

/**
 * The most recent thing the client is known to have done. Falls back to the publish date for a
 * gallery published before opening and activity were recorded, so an old gallery reads as quiet
 * since it went out rather than as never published.
 */
function lastClientTouch(publication) {
  if (!publication) return null;
  return latestOf(publication.lastClientActivityAt, publication.galleryLastOpenedAt, publication.publishedAt);
}

/**
 * Which attention rows one project belongs on.
 *
 * `snapshot` is the shape the dashboard service assembles from batched reads:
 *   { archivedAt, selectionProgress, publication, configs, legacySelectedCount, photoCount,
 *     selectedDownloadedAt }
 * where `publication.expiresAt` is already resolved (the stored date or the six-month default) and
 * each config carries its own `selectedCount`. Archived projects belong on no row at all — the
 * studio has closed them.
 *
 * "Downloaded" is judged against the latest submission, not just by the stamp being there: a
 * selection item the client sends after the studio last copied the originals out puts the project
 * back on the not-yet-downloaded side, which is the one the studio needs to see.
 */
function attentionFlagsOf(snapshot, now = new Date()) {
  const { archivedAt, selectionProgress, publication, configs = [], legacySelectedCount = 0, photoCount = 0, selectedDownloadedAt = null } = snapshot;
  const none = Object.fromEntries(ATTENTION_KINDS.map((kind) => [kind, false]));
  if (archivedAt) return none;
  const live = publication && ["PUBLISHED", "REVOKED"].includes(publication.status);
  const open = selectionProgress !== "completed";
  const published = publication?.status === "PUBLISHED";
  const recent = new Date(now.getTime() - NEW_SUBMISSION_DAYS * DAY_MS);
  const quietSince = new Date(now.getTime() - INACTIVE_AFTER_DAYS * DAY_MS);
  const expiringBy = new Date(now.getTime() + EXPIRING_SOON_DAYS * DAY_MS);
  const touch = lastClientTouch(publication);
  const submittedRecently = configs.length
    ? configs.some((config) => config.selectionSubmittedAt && new Date(config.selectionSubmittedAt) >= recent)
    : Boolean(publication?.selectionSubmittedAt && new Date(publication.selectionSubmittedAt) >= recent);
  const hasSubmittedPicks = configs.length
    ? configs.some((config) => config.selectionSubmittedAt && (config.selectedCount || 0) > 0)
    : Boolean(publication?.selectionSubmittedAt && legacySelectedCount > 0);
  const latestSubmission = latestOf(...configs.map((config) => config.selectionSubmittedAt), publication?.selectionSubmittedAt);
  const downloadedUpToDate = Boolean(selectedDownloadedAt && (!latestSubmission || new Date(selectedDownloadedAt) >= latestSubmission));
  const expiry = publication?.expiresAt ? new Date(publication.expiresAt) : null;
  return {
    overdue: Boolean(live && open && expiry && expiry < now),
    // Only a gallery nothing has been picked in: a pick proves an open, whatever a publication
    // from before the stamps existed has recorded.
    notOpened: Boolean(published && selectionProgress === "inProgress" && !publication.galleryFirstOpenedAt),
    inactive: Boolean(published && ["inProgress", "partiallyCompleted"].includes(selectionProgress) && touch && touch < quietSince),
    newSubmissions: submittedRecently,
    readyToDownload: hasSubmittedPicks && !downloadedUpToDate,
    // The two halves of the ladder's first rung: nothing added yet, and photos in but the gallery
    // not yet sent to the client.
    yetToUpload: photoCount === 0,
    notPublished: photoCount > 0 && selectionProgress === "notStarted",
    // The two ends of one link's life, and a project is on at most one of them: still working but
    // running out, and no longer working at all. Both ask the same two questions first — the
    // gallery is published, and the client has not finished — so a job nobody is waiting on drops
    // off rather than piling up as every old link eventually expires.
    //
    // Not the same as `overdue`, which is the wider signal: it counts a revoked gallery too, and is
    // about the deadline having passed rather than about the link the client holds.
    expiringSoon: Boolean(published && open && expiry && expiry >= now && expiry < expiringBy),
    expired: Boolean(published && open && expiry && expiry < now),
    downloaded: downloadedUpToDate,
  };
}

/**
 * What the client has picked against what they may pick, for one project.
 *
 * Both sides sum over the live selection items — a photo picked for Retouches and for Frames is
 * two picks against two limits, which is how the gallery itself counts. A project with no items
 * only has the older whole-gallery flag to count, and no limit at all: the percentage is then
 * null rather than a number made up against nothing.
 */
function selectionTotals({ configs = [], legacySelectedCount = 0 }) {
  if (!configs.length) return { selectedCount: legacySelectedCount, selectionLimit: null, percent: null };
  const selectedCount = configs.reduce((sum, config) => sum + (config.selectedCount || 0), 0);
  const selectionLimit = configs.reduce((sum, config) => sum + (Number(config.selectionLimit) > 0 ? Number(config.selectionLimit) : 0), 0);
  return { selectedCount, selectionLimit: selectionLimit || null, percent: selectionLimit ? Math.min(100, Math.round((selectedCount / selectionLimit) * 100)) : null };
}

module.exports = { selectionProgressOf, DASHBOARD_STAGES, stageOf, ATTENTION_KINDS, ATTENTION_LABELS, INACTIVE_AFTER_DAYS, NEW_SUBMISSION_DAYS, EXPIRING_SOON_DAYS, NEARLY_DONE_MIN, NEARLY_DONE_MAX, isNearlyDone, attentionFlagsOf, lastClientTouch, latestOf, selectionTotals };
