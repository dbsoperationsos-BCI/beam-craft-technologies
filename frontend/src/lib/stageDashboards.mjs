import { CULLING_STATUS_LABELS } from "./imageSelectionCulling.mjs";
import { number, periodPhrase, formatCompact } from "./dashboardRange.mjs";
import { PROGRESS_COLORS } from "./progressStatus.mjs";

/**
 * The AI Culling, AI Editing and Signature Album modules' vocabulary, in one place: their routes,
 * the cards over the figures `GET /api/image-selection/stage-dashboards/<stage>` answers, the view
 * each card narrows the table to, the words the page prints, and the status a project wears in the
 * module's own project list. Pure so it can be unit-tested, and mirrored by the desktop's
 * `stageDashboardSpec.js`.
 *
 * Each is a Visual Curation module of its own, built the way Photo Selection is - a Dashboard and a
 * Projects page - over the same Image Selection projects: a project opens on that module's own
 * workspace, and the work is done there. Nothing here decides a state: every status is the server's.
 *
 * Every card is a position - the work as it stands now - so none carries an arrow; the range picked
 * above them scopes only the period line.
 */

/** Each module's two pages, as Photo Selection's are: `<base>/dashboard` and `<base>/projects`. */
const routesOf = (base) => Object.freeze({ base, dashboard: `${base}/dashboard`, projects: `${base}/projects` });
export const STAGE_ROUTES = Object.freeze({
  culling: routesOf("/image-selection/ai-culling"),
  editing: routesOf("/image-selection/ai-editing"),
  album: routesOf("/image-selection/signature-album"),
  // Photo Selection's own pair, so a workspace can send a photo on to it by the same helper.
  photos: Object.freeze({ base: "/image-selection", dashboard: "/image-selection/dashboard", projects: "/image-selection/projects" }),
});

/** The header's Dashboard | Projects switch, Dashboard first so the longer path is matched first. */
export const stageSections = (stage) => [
  { label: "Dashboard", value: STAGE_ROUTES[stage].dashboard },
  { label: "Projects", value: STAGE_ROUTES[stage].projects },
];

/**
 * Where a project opens in a module: its Projects page with that project open - the pair the upload
 * dock already sends - and `folderId` to stand on one folder. `at` makes each click a distinct URL
 * so a repeat click still jumps.
 */
export function stageProjectsHref(stage, { projectId, folderId, at } = {}) {
  const params = new URLSearchParams();
  if (projectId) {
    params.set("projectId", String(projectId));
    if (folderId) params.set("folderId", String(folderId));
    params.set("at", String(at ?? Date.now()));
  }
  const query = params.toString();
  return query ? `${STAGE_ROUTES[stage].projects}?${query}` : STAGE_ROUTES[stage].projects;
}

/** Where a dashboard row opens: its project, in this module. */
export const stageRowHref = (stage, row, at) => stageProjectsHref(stage, { projectId: row?.projectId, at });

/**
 * The four Visual Curation modules over an Image Selection project, as the backend names them
 * (`backend/src/modules/image-selection/projects/modules.js`), with the project-form tick each is
 * stored as and the permission that links or unlinks it.
 */
export const PROJECT_MODULES = Object.freeze({
  photos: { label: "Photo Selection", tab: "photoSelection", feature: "Project Management" },
  culling: { label: "AI Culling", tab: "photoCulling", feature: "AI Culling" },
  editing: { label: "AI Editing", tab: "aiEditing", feature: "AI Editing" },
  album: { label: "Signature Album", tab: "signatureAlbum", feature: "Signature Album" },
});
export const PROJECT_MODULE_ORDER = ["culling", "editing", "photos", "album"];

/**
 * The Linked Modules a Create Project form offers: every other module the viewer may open and
 * create projects in - Read / Write on its own permission, the level that creates, edits and
 * deletes - and never the module the form belongs to, which is always included. Asked of
 * `hasPermission(module, feature, level)`; the server asks the same question again on submit.
 */
export function linkedModuleOptions(currentModule, hasPermission) {
  return PROJECT_MODULE_ORDER.filter((module) => module !== currentModule && hasPermission("IMAGE_SELECTION", PROJECT_MODULES[module].feature, "READ_WRITE"));
}

/*
 * Edit Project's Linked Modules - the server's `projects/moduleLinks.js`. Two of a project's modules
 * are linked unless their pair was unticked (`unlinkedPairs`, "a:b" in alphabetical order on every
 * list row); a project from Project Management is always linked. Unlinking only stops sends between
 * the two: both projects, and every photo and result, stay where they are.
 */
export const LINKED_MODULES_NOTE = "Projects created or linked in other modules. Images can be transferred only to active linked projects.";
export const modulePairKey = (first, second) => [first, second].sort().join(":");
export const modulesLinked = (project, first, second) => !(project?.unlinkedPairs || []).includes(modulePairKey(first, second));

/** A row's Linked Modules in the order every form lists them (`moduleLinks`, from the server). */
export const linkEntriesOf = (project) => PROJECT_MODULE_ORDER.map((module) => (project?.moduleLinks || []).find((entry) => entry.module === module)).filter(Boolean);

/**
 * What an Edit Project save sends: a tick per box the viewer may change whose answer differs from
 * the project's link now. A box left alone - or one they may only read - is not sent, and the
 * server leaves it as it is.
 */
export function linkChanges(entries = [], ticked = {}) {
  const changes = {};
  for (const entry of entries) if (entry.canChange && Boolean(ticked[entry.module]) !== Boolean(entry.linked)) changes[entry.module] = Boolean(ticked[entry.module]);
  return changes;
}

/** What a save that changed links says: "Linked AI Editing DBS-VCAE-000005. Unlinked Photo Selection - its project is kept." */
export function linkChangesText(result) {
  if (!result) return "";
  const created = new Map((result.created || []).map((record) => [record.module, record.projectCode]));
  const linked = (result.linked || []).map((module) => `${PROJECT_MODULES[module].label}${created.has(module) ? ` ${created.get(module)} (new project)` : ""}`);
  const unlinked = (result.unlinked || []).map((module) => PROJECT_MODULES[module].label);
  return [
    linked.length ? `Linked ${linked.join(", ")}.` : "",
    unlinked.length ? `Unlinked ${unlinked.join(", ")} - ${unlinked.length === 1 ? "its project is" : "their projects are"} kept.` : "",
  ].filter(Boolean).join(" ");
}

/**
 * What a Create Project says once every project is made: each module's own project and its ID -
 * "Created AI Culling DBS-VCAC-000004, AI Editing DBS-VCAE-000004".
 */
export function createdProjectsText(projects = []) {
  const parts = PROJECT_MODULE_ORDER.flatMap((module) => projects.filter((entry) => entry.module === module).map((entry) => `${PROJECT_MODULES[module].label} ${entry.projectCode || ""}`.trim()));
  return parts.length ? `Created ${parts.join(", ")}.` : "Project created.";
}

/**
 * The modules a manual project is linked to, from its own ticks; null for a project linked to
 * Project Management, whose modules come from its allocation and are never linked by hand.
 */
export function manualProjectModules(project) {
  if (!project || project.salesProjectId) return null;
  return PROJECT_MODULE_ORDER.filter((module) => projectHasStage(module, project));
}

/**
 * Whether a project from the Image Selection list belongs on a module's Projects page. A manual
 * project carries the modules it was created with (null is a project from before the form asked:
 * culling and editing on, the album off); a linked project earns its modules from its allocation,
 * which the list does not carry, so every linked project is listed and its workspace says when the
 * module is not allocated - as Photo Selection's list always has.
 */
export function projectHasStage(stage, project) {
  if (project?.salesProjectId) return true;
  if (stage === "culling") return project?.photoCullingTab !== false;
  if (stage === "editing") return project?.aiEditingTab !== false;
  if (stage === "album") return project?.signatureAlbumTab === true;
  return project?.photoSelectionTab !== false;
}

/**
 * The four rungs every Visual Curation project list sorts by - Photo Selection's own ladder, in its
 * order and colours - so the sidebar's Sort says the same four things in every module.
 */
export const LADDER_FILTERS = [
  ["notStarted", "Yet to Start", PROGRESS_COLORS.notStarted],
  ["inProgress", "In Progress", PROGRESS_COLORS.inProgress],
  ["partiallyCompleted", "Partially Completed", PROGRESS_COLORS.partiallyCompleted],
  ["completed", "Completed", PROGRESS_COLORS.completed],
];

/**
 * The status a project wears in a module's project list, read from that module's own dashboard rows
 * - the same answers its dashboard counts; a project the rows do not name has not started there.
 * Each module's own words (the dot's tooltip) and the rung of the ladder each sits on (its colour
 * and the Sort it is found under).
 */
export const STAGE_STATUS_LABELS = {
  culling: { notStarted: "No run yet", processing: "Processing", reviewReady: "Ready for review", failed: "Failed", finalized: "Finalized" },
  editing: { notStarted: "Nothing to edit yet", inProgress: "Editing", partial: "Some photos edited", failed: "Render failed", edited: "Every photo edited" },
  album: { notStarted: "No album yet", DRAFT: "Draft", READY: "Ready to publish", EXPIRED: "Expired", PUBLISHED: "Published" },
};
const STAGE_LADDER = {
  culling: { notStarted: "notStarted", processing: "inProgress", reviewReady: "partiallyCompleted", failed: "partiallyCompleted", finalized: "completed" },
  editing: { notStarted: "notStarted", inProgress: "inProgress", partial: "partiallyCompleted", failed: "partiallyCompleted", edited: "completed" },
  album: { notStarted: "notStarted", DRAFT: "inProgress", READY: "partiallyCompleted", EXPIRED: "partiallyCompleted", PUBLISHED: "completed" },
};
/** The rung one of a module's own statuses sits on. */
export const stageLadderOf = (stage, status) => STAGE_LADDER[stage]?.[status] || "notStarted";

/**
 * A module's statuses as the project sidebar reads them (`ProjectSidebar`'s `statuses`): the four
 * rungs to sort by, the rung a project sits on, and the module's own word for it on hover.
 */
export function stageSidebarStatuses(stage, statusByProject = {}) {
  const statusOf = (project) => statusByProject[project.id] || "notStarted";
  return {
    filters: LADDER_FILTERS,
    of: (project) => stageLadderOf(stage, statusOf(project)),
    titleOf: (project) => STAGE_STATUS_LABELS[stage]?.[statusOf(project)] || "",
  };
}

function cullingStatusOf(runs) {
  const groups = new Set(runs.map((run) => run.group));
  if (groups.has("failed")) return "failed";
  if (groups.has("queued") || groups.has("processing")) return "processing";
  if (groups.has("reviewReady")) return "reviewReady";
  return groups.has("finalized") ? "finalized" : "notStarted";
}
function editingStatusOf(row) {
  if (!row || !row.totalPhotos) return "notStarted";
  if (row.failed) return "failed";
  if (row.edited >= row.totalPhotos) return "edited";
  return row.edited > 0 ? "partial" : "inProgress";
}

/** `{ [projectId]: statusKey }` from one module's dashboard rows. */
export function stageStatusByProject(stage, rows = []) {
  const byProject = new Map();
  for (const row of rows) {
    if (!byProject.has(row.projectId)) byProject.set(row.projectId, []);
    byProject.get(row.projectId).push(row);
  }
  return Object.fromEntries([...byProject].map(([projectId, projectRows]) => [projectId,
    stage === "culling" ? cullingStatusOf(projectRows)
    : stage === "editing" ? editingStatusOf(projectRows[0])
    : projectRows[0]?.status || "notStarted",
  ]));
}

// The culling run's own words, the ones its tab prints, with the dashboard's shorter heading for review.
export const CULLING_GROUP_TONES = {
  queued: "text-slate-600", processing: "text-blue-700", reviewReady: "text-amber-700", finalized: "text-emerald-700", failed: "text-rose-700", cancelled: "text-slate-400",
};
export const cullingStatusLabel = (status) => CULLING_STATUS_LABELS[status] || status || "—";

export const SIGNATURE_ALBUM_STATUS_LABELS = { DRAFT: "Draft", READY: "Ready to publish", PUBLISHED: "Published", EXPIRED: "Expired" };
export const SIGNATURE_ALBUM_STATUS_TONES = { DRAFT: "text-slate-600", READY: "text-amber-700", PUBLISHED: "text-emerald-700", EXPIRED: "text-rose-700" };

const STAGES = {
  culling: {
    title: "AI Culling",
    noun: "runs",
    tableTitle: "Culling Runs",
    note: "The latest run of each shoot, most recently active first",
    emptyTitle: "No culling runs yet",
    emptyMessage: "Open a project from AI Culling → Projects and start a run — the dashboard fills in from there.",
    cards: [
      { key: "totalRuns", label: "Culling Runs", unit: "Run", view: null },
      { key: "queued", label: "Waiting to Start", unit: "Run", view: "queued" },
      { key: "processing", label: "Processing", unit: "Run", view: "processing" },
      { key: "reviewReady", label: "Ready for Review", unit: "Run", view: "reviewReady" },
      { key: "finalized", label: "Finalized", unit: "Run", view: "finalized" },
      { key: "failed", label: "Failed", unit: "Run", view: "failed" },
      { key: "imagesAnalysed", label: "Photos Analysed", unit: "Photo", view: null, static: true, compact: true },
      { key: "keeps", label: "Kept", unit: "Photo", view: null, static: true, compact: true },
      { key: "maybes", label: "Maybe", unit: "Photo", view: null, static: true, compact: true },
      { key: "rejects", label: "Rejected", unit: "Photo", view: null, static: true, compact: true },
    ],
    matches: (row, view) => row.group === view,
    caption: (period) => `${periodPhrase(period.key)}: ${number(period.runsStarted)} runs started, ${number(period.runsFinalized)} finalized`,
    figures: (data) => [
      ["Projects with a run", number(data.totals?.projects)],
      ["Runs ever started", number(data.totals?.allRuns), "re-runs included"],
      ["Cancelled", number(data.totals?.cancelled), "latest run of a shoot"],
      ["Failed", number(data.summary?.failed), data.summary?.failed ? "open the project to retry" : null, data.summary?.failed ? "text-rose-700" : ""],
    ],
    figuresTitle: "Runs",
  },
  editing: {
    title: "AI Editing",
    noun: "projects",
    tableTitle: "Projects in Editing",
    note: "Every project with photos in its editing bay, most recently active first",
    emptyTitle: "Nothing in AI Editing yet",
    emptyMessage: "Send kept photos on from AI Culling, or open a project from AI Editing → Projects — the dashboard fills in from there.",
    cards: [
      { key: "totalPhotos", label: "Photos in Editing", unit: "Photo", view: null, compact: true },
      { key: "awaitingEdit", label: "Awaiting Edit", unit: "Photo", view: "awaitingEdit", compact: true },
      { key: "queued", label: "Queued", unit: "Photo", view: "queued", compact: true },
      { key: "waitingForDesktop", label: "Waiting for Workstation", unit: "Photo", view: "waitingForDesktop", compact: true },
      { key: "rendering", label: "Rendering", unit: "Photo", view: "rendering", compact: true },
      { key: "edited", label: "Edited", unit: "Photo", view: "edited", compact: true },
      { key: "failed", label: "Render Failed", unit: "Photo", view: "failed", compact: true },
      { key: "sentToPhotoSelection", label: "Sent to Photo Selection", unit: "Photo", view: "sentToPhotoSelection", compact: true },
      { key: "sentToAlbum", label: "Sent to Signature Album", unit: "Photo", view: "sentToAlbum", compact: true },
      { key: "albumSyncFailed", label: "Album Sync Failed", unit: "Photo", view: "albumSyncFailed", compact: true },
    ],
    // A card counts photos; it narrows the table to the projects holding any.
    matches: (row, view) => (row[view] || 0) > 0,
    caption: (period) => `${periodPhrase(period.key)}: ${number(period.editsCreated)} photos started editing, ${number(period.photosRendered)} rendered`,
    figures: (data) => [
      ["Projects in editing", number(data.totals?.projects)],
      ["Edited", `${formatCompact(data.summary?.edited)} of ${formatCompact(data.summary?.totalPhotos)}`],
      ["Waiting for workstation", number(data.summary?.waitingForDesktop), "the desktop app holding the original renders these"],
      ["Album sync failed", number(data.summary?.albumSyncFailed), data.summary?.albumSyncFailed ? "retry from the project's AI Editing tab" : null, data.summary?.albumSyncFailed ? "text-rose-700" : ""],
    ],
    figuresTitle: "Editing Bay",
  },
  album: {
    title: "Signature Album",
    noun: "albums",
    tableTitle: "Albums",
    note: "Every album, most recently changed first",
    emptyTitle: "No albums yet",
    emptyMessage: "Open a project from Signature Album → Projects and start its album — the dashboard fills in from there.",
    cards: [
      { key: "totalAlbums", label: "Total Albums", unit: "Album", view: null },
      { key: "draft", label: "Draft", unit: "Album", view: "DRAFT" },
      { key: "ready", label: "Ready to Publish", unit: "Album", view: "READY" },
      { key: "published", label: "Published", unit: "Album", view: "PUBLISHED" },
      { key: "expiringSoon", label: "Link Expiring Soon", unit: "Album", view: "expiringSoon" },
      { key: "expired", label: "Expired", unit: "Album", view: "EXPIRED" },
      { key: "totalPhotos", label: "Photos in Albums", unit: "Photo", view: null, static: true, compact: true },
      { key: "totalChapters", label: "Chapters", unit: "Chapter", view: null, static: true },
    ],
    matches: (row, view) => (view === "expiringSoon" ? row.expiringSoon : row.status === view),
    caption: (period) => `${periodPhrase(period.key)}: +${number(period.albumsCreated)} albums, ${number(period.albumsPublished)} published`,
    figures: (data) => [
      ["Published with a PIN", number(data.totals?.pinProtected)],
      ["Published with downloads on", number(data.totals?.downloadsAllowed)],
      ["Link expiring soon", number(data.summary?.expiringSoon), "within ten days — extend it from the album's Share panel", data.summary?.expiringSoon ? "text-amber-700" : ""],
      ["Expired", number(data.summary?.expired), data.summary?.expired ? "the client can no longer open these" : null, data.summary?.expired ? "text-rose-700" : ""],
    ],
    figuresTitle: "Client Links",
  },
};

export const stageDashboard = (stage) => STAGES[stage];

/** The rows one card stands for; `null` is every row. */
export function rowsForView(stage, rows = [], view = null) {
  if (!view) return rows;
  return rows.filter((row) => STAGES[stage].matches(row, view));
}

/** What the table heading says a pressed card is showing. */
export const viewLabel = (stage, view) => STAGES[stage].cards.find((card) => card.view === view)?.label || null;
