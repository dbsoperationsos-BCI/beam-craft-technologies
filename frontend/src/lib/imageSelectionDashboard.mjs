import { PROGRESS_COLORS } from "./progressStatus.mjs";

/**
 * The Image Selection dashboard's vocabulary, in one place: the ranges it offers, the stages it
 * counts, the attention rows it lists, and how each of them opens the Projects page. Pure so it
 * can be unit-tested, and mirrored by `backend/src/modules/image-selection/dashboard/classify.js`
 * — the keys on both sides are the same strings, which is what lets a card link to a filter.
 */

export const DASHBOARD_ROUTE = "/image-selection/dashboard";
export const PROJECTS_ROUTE = "/image-selection/projects";

/**
 * The range picker above the cards: the keys the API accepts, in the order the menu lists them.
 * It scopes the period figures only — the line under each card — never the counts themselves,
 * which are always every Image Selection project as it stands.
 */
export const RANGE_OPTIONS = [
  { value: "lifetime", label: "Lifetime" },
  { value: "month", label: "This Month" },
  { value: "week", label: "This Week" },
  { value: "3m", label: "3 Months" },
  { value: "6m", label: "6 Months" },
];
export const DEFAULT_RANGE = "month";

/**
 * How each range reads at the end of a sentence: "+2 created **this month**", "624 photos picked
 * **in total**". The label alone would not do it — "created Lifetime" is not a sentence — so the
 * picker's name and the words under a card are kept apart on purpose.
 */
export const PERIOD_PHRASES = {
  lifetime: "in total",
  month: "this month",
  week: "this week",
  "3m": "in the last 3 months",
  "6m": "in the last 6 months",
};
export const periodPhrase = (key) => PERIOD_PHRASES[key] || "in this range";

/**
 * What each card's arrow is measured against: where the number stood at the start of the range.
 * Lifetime has no start, so it has no phrase and the card shows no arrow.
 */
export const PREVIOUS_PHRASES = {
  month: "vs last month",
  week: "vs last week",
  "3m": "vs 3 months ago",
  "6m": "vs 6 months ago",
};
export const previousPhrase = (key) => PREVIOUS_PHRASES[key] || null;

/**
 * The same comparison as a name rather than as a phrase: what a card prints under its own "vs".
 *
 * Title case and no "vs" of its own, because the card supplies that word on the line above it.
 * Lifetime has nothing behind it to compare with and so has no name here, exactly as it has no
 * phrase above.
 */
export const PREVIOUS_LABELS = {
  month: "Last Month",
  week: "Last Week",
  "3m": "3 Months Ago",
  "6m": "6 Months Ago",
};
export const previousLabel = (key) => PREVIOUS_LABELS[key] || null;

/** The arrow for a change: which way it points, and the signed number beside it. */
export function trendOf(delta) {
  const change = Number(delta || 0);
  const direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
  return { direction, text: change > 0 ? `+${change.toLocaleString("en-IN")}` : change.toLocaleString("en-IN") };
}

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
  { key: "clientSubmitted", label: "Client Submitted", unit: "Project", view: { stage: "submitted" } },
  { key: "notYetDownloaded", label: "Yet to Download", unit: "Project", view: { attention: "readyToDownload" } },
  { key: "linkExpiringSoon", label: "Link Expiring Soon", unit: "Project", view: { attention: "expiringSoon" } },
  { key: "linkExpired", label: "Expired Projects", unit: "Project", view: { attention: "expired" } },
  { key: "downloaded", label: "Downloaded", unit: "Project", view: { attention: "downloaded" } },
];

/**
 * The noun that follows a headline figure, matched to it: "1 Project", "4 Projects".
 *
 * `unit` is written singular in the table above and pluralised here by appending an "s", which is
 * all the nouns this dashboard counts need. A word that does not pluralise that way has to be
 * given as a pair rather than run through this.
 */
export function unitLabel(value, unit) {
  if (!unit) return "";
  return Math.abs(Number(value) || 0) === 1 ? unit : `${unit}s`;
}

/*
 * A view is what the Recent Projects table is narrowed to: `null` for everything, `{ stage }` for
 * a rung of the ladder (or the archive), `{ attention }` for one of the classifier's flags. The
 * cards, the workflow strip and the Needs Attention rows all press one; the table reads it.
 */

/** Two views the same, `null` and `undefined` both meaning everything. */
export function sameView(first, second) {
  const a = first || null; const b = second || null;
  if (a === b) return true;
  if (!a || !b) return false;
  return a.stage === b.stage && a.attention === b.attention;
}

/** The words for a view: the card that carries it, else the stage or the flag, else "All projects". */
export function viewLabel(view) {
  if (!view) return "All projects";
  const card = SUMMARY_CARDS.find((candidate) => sameView(candidate.view, view));
  if (card) return card.label;
  if (view.stage) return STAGE_BY_KEY[view.stage]?.label || view.stage;
  return ATTENTION_BY_KEY[view.attention]?.label || view.attention || "All projects";
}

/** Whether one row of the API's recent projects belongs to a view. */
export function rowMatchesView(row, view) {
  if (!view) return true;
  if (view.stage) return row?.stage === view.stage;
  if (view.attention) return Boolean(row?.views?.[view.attention]);
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
 * project, with `at` making each click a distinct URL so a repeat click still jumps; `create`
 * opens the New Project form.
 */
export function projectsHref({ stage, attention, projectId, at, create } = {}) {
  const params = new URLSearchParams();
  if (stage && STAGE_BY_KEY[stage]) {
    const { progress } = STAGE_BY_KEY[stage];
    if (progress === "archived") params.set("archived", "true");
    else params.set("status", progress);
  }
  if (attention && ATTENTION_BY_KEY[attention]) params.set("attention", attention);
  if (projectId) { params.set("projectId", projectId); params.set("at", String(at ?? Date.now())); }
  if (create) params.set("new", "1");
  const query = params.toString();
  return query ? `${PROJECTS_ROUTE}?${query}` : PROJECTS_ROUTE;
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

/** "184", "12.5K", "248K", "1.2M" — a headline number that fits a card. */
export function formatCompact(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";
  const abs = Math.abs(number);
  if (abs < 1000) return number.toLocaleString("en-IN");
  if (abs < 10000) return `${(number / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  if (abs < 1000000) return `${Math.round(number / 1000)}K`;
  return `${(number / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** A byte count as the unit a person reads it in. */
export function formatBytes(bytes) {
  const number = Number(bytes || 0);
  if (!Number.isFinite(number) || number <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const power = Math.min(units.length - 1, Math.floor(Math.log(number) / Math.log(1024)));
  const scaled = number / 1024 ** power;
  const text = scaled >= 100 || power === 0 ? String(Math.round(scaled)) : scaled.toFixed(1).replace(/\.0$/, "");
  return `${text} ${units[power]}`;
}

/** "just now", "12 mins ago", "3 days ago" — or a dash for a time nobody recorded. */
export function relativeTime(value, now = new Date()) {
  if (!value) return "—";
  const stamp = new Date(value);
  if (Number.isNaN(stamp.getTime())) return "—";
  const seconds = Math.max(0, Math.round((now.getTime() - stamp.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const units = [["min", 60], ["hour", 3600], ["day", 86400], ["week", 604800], ["month", 2629800], ["year", 31557600]];
  for (let index = units.length - 1; index >= 0; index -= 1) {
    const [unit, size] = units[index];
    if (seconds >= size) { const count = Math.floor(seconds / size); return `${count} ${unit}${count === 1 ? "" : "s"} ago`; }
  }
  return "just now";
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

