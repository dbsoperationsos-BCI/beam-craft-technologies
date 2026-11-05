import { PROGRESS_COLORS } from "./progressStatus.mjs";
import { RANGE_OPTIONS, DEFAULT_RANGE, PERIOD_PHRASES, periodPhrase, PREVIOUS_PHRASES, previousPhrase, PREVIOUS_LABELS, previousLabel, trendOf, unitLabel, formatCompact, formatBytes, relativeTime } from "./dashboardRange.mjs";

/**
 * The Image Selection dashboard's vocabulary, in one place: the ranges it offers, the stages it
 * counts, the attention rows it lists, and how each of them opens the Projects page. Pure so it
 * can be unit-tested, and mirrored by `backend/src/modules/image-selection/dashboard/classify.js`
 * — the keys on both sides are the same strings, which is what lets a card link to a filter.
 */

export const DASHBOARD_ROUTE = "/image-selection/dashboard";
export const PROJECTS_ROUTE = "/image-selection/projects";

/*
 * The range picker, the phrases under the arrows and the formatters are the vocabulary every
 * module dashboard shares (`dashboardRange.mjs`); they are re-exported here so this module's
 * callers and tests keep one import.
 */
export { RANGE_OPTIONS, DEFAULT_RANGE, PERIOD_PHRASES, periodPhrase, PREVIOUS_PHRASES, previousPhrase, PREVIOUS_LABELS, previousLabel, trendOf, unitLabel, formatCompact, formatBytes, relativeTime };

// Archived is the studio closing a project, not a rung of the progress ladder, so it takes a
// neutral grey rather than borrowing a rung's colour.
export const ARCHIVED_COLOR = "#475569";

/**
 * The five workflow stages, each pinned to the sidebar rung (or the Archived toggle) it stands
 * for — so every stage opens the Projects page with a filter that page already had.
 */
export const DASHBOARD_STAGES = [
  { key: "uploaded", label: "Uploaded", progress: "notStarted", description: "Gallery not published yet", color: PROGRESS_COLORS.notStarted },
  { key: "linkSent", label: "Link Sent", progress: "inProgress", description: "Published, client yet to pick", color: PROGRESS_COLORS.inProgress },
  { key: "selecting", label: "Selecting", progress: "partiallyCompleted", description: "Client picking or items sent", color: PROGRESS_COLORS.partiallyCompleted },
  { key: "submitted", label: "Submitted", progress: "completed", description: "All items submitted", color: PROGRESS_COLORS.completed },
  { key: "completed", label: "Completed", progress: "archived", description: "Archived by the studio", color: ARCHIVED_COLOR },
];
export const STAGE_BY_KEY = Object.fromEntries(DASHBOARD_STAGES.map((stage) => [stage.key, stage]));
export const PROGRESS_FILTER_VALUES = DASHBOARD_STAGES.map((stage) => stage.progress).filter((progress) => progress !== "archived");

/**
 * The ten headline cards, in the order the studio reads a job: the ladder from nothing uploaded
 * to submitted, then the download side of it. Each is a *view* of the Recent Projects table — a
 * sidebar rung where one fits, otherwise one of the classifier's own flags — and Total Projects
 * is the table with no view at all.
 */
/*
 * The band Client Selection Progress lists, mirrored from
 * `backend/src/modules/image-selection/dashboard/classify.js` - the server decides which projects
 * are on the panel, and these are here only so the panel can say what it is showing.
 */
export const NEARLY_DONE_MIN = 85;
export const NEARLY_DONE_MAX = 99;
export const NEARLY_DONE_NOTE = `Clients ${NEARLY_DONE_MIN}% to ${NEARLY_DONE_MAX}% through their selection, closest to finishing first`;
export const NEARLY_DONE_EMPTY = `No client is between ${NEARLY_DONE_MIN}% and ${NEARLY_DONE_MAX}% through their selection.`;

export const SUMMARY_CARDS = [
  { key: "totalProjects", label: "Total Projects", unit: "Project", view: null },
  { key: "yetToUpload", label: "Yet to Upload", unit: "Project", view: { attention: "yetToUpload" } },
  { key: "notPublished", label: "Client Sending Not Done", unit: "Project", view: { attention: "notPublished" } },
  { key: "clientNotStarted", label: "Client Not Started", unit: "Project", view: { stage: "linkSent" } },
  { key: "clientInProgress", label: "Client In Progress", unit: "Project", view: { stage: "selecting" } },
  // Any item submitted, not every item: Retouches sent while Frames is still being picked counts.
  { key: "clientSubmitted", label: "Client Submitted", unit: "Project", view: { attention: "clientSubmitted" } },
  { key: "notYetDownloaded", label: "Yet to Download", unit: "Project", view: { attention: "readyToDownload" } },
  { key: "linkExpiringSoon", label: "Link Expiring Soon", unit: "Project", view: { attention: "expiringSoon" } },
  { key: "linkExpired", label: "Expired Projects", unit: "Project", view: { attention: "expired" } },
  { key: "downloaded", label: "Downloaded", unit: "Project", view: { attention: "downloaded" } },
];

/*
 * A view is what the Recent Projects table is narrowed to: `null` for everything, `{ stage }` for
 * a rung of the ladder (or the archive), `{ attention }` for one of the classifier's flags, and -
 * in Expand - `{ expand: "enabled" | "disabled" }` for the projects switched on or off there. The
 * cards, the workflow strip and the Needs Attention rows all press one; the table reads it.
 */

/**
 * Expand's two cards: how many projects are enabled and how many disabled, each a filter on its
 * table. Counted from the rows themselves (`expandCounts`), every project as it stands now - the
 * summary cards beside them count only the enabled ones, so these are what says how many are off.
 */
export const EXPAND_CARDS = [
  { key: "enabled", label: "Enabled", unit: "Project", view: { expand: "enabled" } },
  { key: "disabled", label: "Disabled", unit: "Project", view: { expand: "disabled" } },
];

/** `{ enabled, disabled }` over Expand's rows - a row is enabled unless it says otherwise. */
export function expandCounts(rows = []) {
  const disabled = (rows || []).filter((row) => row?.expandEnabled === false).length;
  return { enabled: (rows || []).length - disabled, disabled };
}

/**
 * Where Enabled and Disabled stood at the start of the range, and how far each has moved since - the
 * same `{ before, delta }` every other card carries, so they get the same arrow and "vs ...". Null
 * for Lifetime (no `comparedAt`), as for every card. A project counts at the start if it had been
 * created by then, and as disabled then if its switch was already off by then (`disabledAt`). Only
 * the last switch-off is stamped, so a project switched off and on again inside the range leaves no
 * trace, and counts as enabled at both ends.
 */
export function expandTrend(rows = [], comparedAt) {
  if (!comparedAt) return null;
  const from = new Date(comparedAt).getTime();
  const before = (stamp) => stamp != null && new Date(stamp).getTime() < from;
  const existed = (rows || []).filter((row) => before(row?.createdAt));
  const disabled = existed.filter((row) => row?.expandEnabled === false && before(row?.disabledAt)).length;
  const now = expandCounts(rows);
  const enabled = existed.length - disabled;
  return { enabled: { before: enabled, delta: now.enabled - enabled }, disabled: { before: disabled, delta: now.disabled - disabled } };
}

/** Two views the same, `null` and `undefined` both meaning everything. */
export function sameView(first, second) {
  const a = first || null; const b = second || null;
  if (a === b) return true;
  if (!a || !b) return false;
  return a.stage === b.stage && a.attention === b.attention && a.expand === b.expand;
}

/** The words for a view: the card that carries it, else the stage or the flag, else "All projects". */
export function viewLabel(view) {
  if (!view) return "All projects";
  const card = SUMMARY_CARDS.find((candidate) => sameView(candidate.view, view));
  if (card) return card.label;
  if (view.expand) return view.expand === "disabled" ? "Disabled projects" : "Enabled projects";
  if (view.stage) return STAGE_BY_KEY[view.stage]?.label || view.stage;
  return ATTENTION_BY_KEY[view.attention]?.label || view.attention || "All projects";
}

/** Whether one row of the API's recent projects belongs to a view. */
export function rowMatchesView(row, view) {
  if (!view) return true;
  if (view.stage) return row?.stage === view.stage;
  if (view.attention) return Boolean(row?.views?.[view.attention]);
  if (view.expand) return (row?.expandEnabled !== false) === (view.expand === "enabled");
  return true;
}

/** The rows a view keeps, in the order they came. */
export const rowsForView = (rows, view) => (rows || []).filter((row) => rowMatchesView(row, view));

/**
 * The classifier's views of a project, each a `?attention=` filter the Projects list accepts and
 * a name the table chip and the Projects sidebar can show. Some back a summary card; the others
 * are reachable only as a deep link.
 */
export const ATTENTION_ROWS = [
  { key: "overdue", label: "Overdue", description: "Selection deadline has passed" },
  { key: "notOpened", label: "Haven't opened", description: "Gallery link never opened" },
  { key: "inactive", label: "No activity", description: "Quiet for 7+ days" },
  { key: "newSubmissions", label: "New submissions", description: "Sent in the last 7 days" },
  { key: "clientSubmitted", label: "Client submitted", description: "At least one selection item sent" },
  { key: "readyToDownload", label: "Yet to download", description: "Submitted selections still to copy out" },
  { key: "yetToUpload", label: "Yet to upload", description: "No photos added yet" },
  { key: "notPublished", label: "Client sending not done", description: "Photos in, gallery not sent" },
  { key: "expiringSoon", label: "Link expiring soon", description: "Gallery link stops within 10 days" },
  { key: "expired", label: "Expired", description: "Gallery link has stopped working" },
  { key: "downloaded", label: "Downloaded", description: "Selected originals taken out" },
];
export const ATTENTION_KEYS = ATTENTION_ROWS.map((row) => row.key);
export const ATTENTION_BY_KEY = Object.fromEntries(ATTENTION_ROWS.map((row) => [row.key, row]));

/**
 * Where a dashboard control sends the reader. A stage is the sidebar's progress filter (or its
 * Archived toggle); an attention row is the list's `attention` filter; a project id opens that
 * project, with `at` making each click a distinct URL so a repeat click still jumps, and `folderId`
 * opening it on one folder - the same pair the upload dock sends; `create` opens the New Project form.
 */
export function projectsHref({ stage, attention, projectId, folderId, at, create } = {}) {
  const params = new URLSearchParams();
  if (stage && STAGE_BY_KEY[stage]) {
    const { progress } = STAGE_BY_KEY[stage];
    if (progress === "archived") params.set("archived", "true");
    else params.set("status", progress);
  }
  if (attention && ATTENTION_BY_KEY[attention]) params.set("attention", attention);
  if (projectId) {
    params.set("projectId", projectId);
    if (folderId) params.set("folderId", folderId);
    params.set("at", String(at ?? Date.now()));
  }
  if (create) params.set("new", "1");
  const query = params.toString();
  return query ? `${PROJECTS_ROUTE}?${query}` : PROJECTS_ROUTE;
}

/**
 * Where a Recent Projects row opens. Under Yet to Download it opens on the shoot folder that put
 * the project there - `readyToDownloadFolderId`, worked out by the server from the same rule the
 * card counts with - so Download Selected is on screen; under every other view, and where the
 * server found no folder for that shoot, it opens the project exactly as a click on it always has.
 */
export function openProjectHref(row, view, at) {
  const folderId = sameView(view, { attention: "readyToDownload" }) ? row?.readyToDownloadFolderId : null;
  return projectsHref({ projectId: row?.id, folderId, at });
}

/**
 * What the Projects page reads back out of its URL. `get` is `searchParams.get`, so this can be
 * tested with a plain function. Anything unrecognised reads as no filter at all.
 */
export function projectListFiltersFromParams(get) {
  const status = get("status");
  const attention = get("attention");
  return {
    progress: PROGRESS_FILTER_VALUES.includes(status) ? status : "all",
    archived: get("archived") === "true",
    attention: ATTENTION_KEYS.includes(attention) ? attention : null,
    create: get("new") === "1",
  };
}

/**
 * "187 / 250 selected" where a limit exists, "187 selected" where none does — never a percentage
 * against a limit the project has not got.
 */
export function selectionText({ selectedCount = 0, selectionLimit = null } = {}) {
  const selected = Number(selectedCount || 0).toLocaleString("en-IN");
  return selectionLimit ? `${selected} / ${Number(selectionLimit).toLocaleString("en-IN")} selected` : `${selected} selected`;
}

/** The stage chip for a project row: the label and the colour the strip uses for that stage. */
export function stageChip(stageKey) {
  const stage = STAGE_BY_KEY[stageKey] || DASHBOARD_STAGES[0];
  return { label: stage.label, color: stage.color };
}

