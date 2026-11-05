import { ALBUM_STATE_LABELS } from "./albumProofingStates.mjs";

/**
 * The Album Proofing dashboard's vocabulary, in one place: the ten cards over the figures
 * `GET /api/image-selection/album-proofs/dashboard` answers, the view each card narrows the
 * Recent Albums table to, the words a row prints, and where a row opens. Pure so it can be
 * unit-tested, and mirrored word for word by the desktop's `albumDashboardSpec.js`. Nothing here
 * decides a business state: the album's state, its corrections, its link and whether the revised
 * upload is unlocked are all the server's — the same answers the album workspace reads.
 */

export const PROJECTS_ROUTE = "/image-selection/album-proofing";
export const DASHBOARD_ROUTE = `${PROJECTS_ROUTE}/dashboard`;

/** The header's two sections, Dashboard first so the longer path is matched before the prefix. */
export const albumProofingSections = [
  { label: "Dashboard", value: DASHBOARD_ROUTE },
  { label: "Projects", value: PROJECTS_ROUTE },
];

/**
 * Where a Recent Albums row opens: the Projects page on that album's project, with the album
 * itself open — the pair the upload dock already sends plus `albumId`. `at` makes each click a
 * distinct URL so a repeat click still jumps.
 */
export function albumHref(row, at) {
  const params = new URLSearchParams({ projectId: String(row?.projectId ?? ""), albumId: String(row?.id ?? ""), at: String(at ?? Date.now()) });
  return `${PROJECTS_ROUTE}?${params.toString()}`;
}
/** New Project lives on the Projects page, which owns the form; the dashboard only sends people there. */
export const createProjectHref = () => `${PROJECTS_ROUTE}?new=1`;

export const CORRECTIONS_EMPTY = "No open corrections.";
export const CORRECTIONS_NOTE = "Albums in a correction round, most recently active first";

/**
 * The ten headline cards, in the order an album travels: nothing uploaded, QC, corrections, the
 * client, the link, done. Each is a *view* of the Recent Albums table — a set of workflow states,
 * or one of the row's own flags — and Total Albums is the table with no view at all. The labels
 * are the module's own state labels wherever a card is one state, so a card and a chip never
 * spell a state differently.
 */
export const ALBUM_SUMMARY_CARDS = [
  { key: "totalAlbums", label: "Total Albums", unit: "Album", view: null },
  { key: "draft", label: ALBUM_STATE_LABELS.DRAFT, unit: "Album", view: { status: ["DRAFT"] } },
  { key: "readyForQc", label: ALBUM_STATE_LABELS.READY_FOR_QC, unit: "Album", view: { status: ["READY_FOR_QC", "REVISION_READY_FOR_QC"] } },
  { key: "qcReview", label: ALBUM_STATE_LABELS.QC_REVIEW, unit: "Album", view: { status: ["QC_REVIEW"] } },
  { key: "correctionsOpen", label: "Corrections Open", unit: "Album", view: { attention: "correctionsOpen" } },
  { key: "readyForRevisedVersion", label: "Ready for Revised Version", unit: "Album", view: { attention: "readyForRevisedVersion" } },
  { key: "readyForClient", label: ALBUM_STATE_LABELS.READY_FOR_CLIENT, unit: "Album", view: { status: ["QC_APPROVED", "READY_FOR_CLIENT"] } },
  { key: "clientReview", label: ALBUM_STATE_LABELS.CLIENT_REVIEW, unit: "Album", view: { status: ["CLIENT_REVIEW"] } },
  { key: "linkExpiringSoon", label: "Link Expiring Soon", unit: "Album", view: { attention: "linkExpiringSoon" } },
  { key: "completed", label: ALBUM_STATE_LABELS.COMPLETED, unit: "Album", view: { status: ["COMPLETED"] } },
];

const ATTENTION_LABELS = { correctionsOpen: "Corrections Open", readyForRevisedVersion: "Ready for Revised Version", linkExpiringSoon: "Link Expiring Soon", linkExpired: "Expired Links" };

const sameStatuses = (first, second) => Array.isArray(first) && Array.isArray(second) && first.length === second.length && first.every((value, index) => value === second[index]);

/** Two views the same, `null` and `undefined` both meaning everything. */
export function sameView(first, second) {
  const a = first || null; const b = second || null;
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.attention || b.attention) return a.attention === b.attention && !a.status && !b.status;
  return sameStatuses(a.status, b.status);
}

/** The words for a view: the card that carries it, else the state or the flag, else "All albums". */
export function viewLabel(view) {
  if (!view) return "All albums";
  const card = ALBUM_SUMMARY_CARDS.find((candidate) => candidate.view && sameView(candidate.view, view));
  if (card) return card.label;
  if (view.status) return view.status.map((status) => ALBUM_STATE_LABELS[status] || status).join(" / ");
  return ATTENTION_LABELS[view.attention] || view.attention || "All albums";
}

/**
 * Whether one row of the API's album rows belongs to a view. A state view reads the workflow
 * state the album was counted under (an archived album keeps it); a flag view reads the row's
 * own `views`.
 */
export function rowMatchesView(row, view) {
  if (!view) return true;
  if (view.status) return view.status.includes(row?.workflowStatus ?? row?.status);
  if (view.attention) return Boolean(row?.views?.[view.attention]);
  return true;
}

/** The rows a view keeps, in the order they came. */
export const rowsForView = (rows, view) => (rows || []).filter((row) => rowMatchesView(row, view));

/** "V2", or the words for an album with no frozen version yet — the albums panel's own phrase. */
export const versionText = (row) => (row?.currentVersionNumber ? `V${row.currentVersionNumber}` : "No proof yet");

/** "3 open" — the unresolved corrections on the album, QC and client together. */
export const correctionsText = (row) => `${Number(row?.openCorrections || 0).toLocaleString("en-IN")} open`;

/** "2 / 5 resolved" — how far a correction round has come. */
export const resolvedText = (row) => `${Number(row?.correctionResolved || 0).toLocaleString("en-IN")} / ${Number(row?.correctionTotal || 0).toLocaleString("en-IN")} resolved`;

/** The client link, as the publication card reads it, plus the ten-day warning. */
export const LINK_LABELS = { active: "Active", expiringSoon: "Expiring soon", expired: "Expired", revoked: "Revoked" };
export const linkLabel = (link) => (link ? LINK_LABELS[link.state] || link.state : "Not sent");
export const LINK_TONES = { active: "text-emerald-700", expiringSoon: "text-amber-700", expired: "text-red-600", revoked: "text-slate-500" };
