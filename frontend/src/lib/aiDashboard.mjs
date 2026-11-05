import { EVENT_STATUS_LABELS } from "./aiFeature.mjs";

/**
 * The AI Feature dashboard's vocabulary, in one place: the ten cards over the figures
 * `GET /api/ai-feature/overview` answers, the view each card narrows the Recent Events table to,
 * and where a row opens. Pure so it can be unit-tested, and mirrored word for word by the
 * desktop's `aiDashboardSpec.js` — the two clients read one response and must say the same
 * things about it. Nothing here decides a business state: an event's status and every count are
 * the server's.
 */

export const DASHBOARD_ROUTE = "/visual-curation/ai/overview";
export const EVENTS_ROUTE = "/visual-curation/ai/events";
export const eventHref = (id) => `${EVENTS_ROUTE}/${encodeURIComponent(id)}`;
/** Create Event lives on the Events page, which owns the wizard; the dashboard only sends people there. */
export const createEventHref = () => `${EVENTS_ROUTE}?create=1`;

export const PROCESSING_EMPTY = "No AI processing currently running.";
export const PROCESSING_NOTE = "Events with photos queued or being processed, most recently active first";

/**
 * The ten headline cards, in the order the studio reads an event's life: the events by where they
 * stand, then the photos by what the engine has done with them. Each is a *view* of the Recent
 * Events table — a status, or one of the row's own flags — and Total Events is the table with no
 * view at all. The photo totals and People are counted across every event, so pressing one of
 * them narrows nothing: they are figures to read, not filters.
 */
export const AI_SUMMARY_CARDS = [
  { key: "totalEvents", label: "Total Events", unit: "Event", view: null },
  { key: "activeEvents", label: "Active Events", unit: "Event", view: { status: "ACTIVE" } },
  { key: "upcomingEvents", label: "Upcoming Events", unit: "Event", view: { status: "UPCOMING" } },
  { key: "completedEvents", label: "Completed Events", unit: "Event", view: { status: "COMPLETED" } },
  { key: "processingPhotos", label: "Processing", unit: "Photo", view: { attention: "processing" } },
  { key: "totalPhotos", label: "Total Photos", unit: "Photo", view: null, compact: true, static: true },
  { key: "processedPhotos", label: "Processed Photos", unit: "Photo", view: null, compact: true, static: true },
  { key: "failedPhotos", label: "Failed", unit: "Photo", view: { attention: "failed" } },
  { key: "peopleDetected", label: "People Detected", unit: ["Person", "People"], view: null, static: true },
  { key: "archivedEvents", label: "Archived Events", unit: "Event", view: { status: "ARCHIVED" } },
];

/**
 * The row's own flags a card can narrow to: events with work in the queue, events with failures.
 * The Processing and Failed cards count photos, but pressing one narrows a table of *events*, so
 * the chip over that table says so rather than repeating the card's photo count under an event noun.
 */
const ATTENTION_LABELS = { processing: "Events with photos processing", failed: "Events with failed photos" };
const attentionMatches = { processing: (row) => Number(row?.processingCount) > 0, failed: (row) => Number(row?.failedCount) > 0 };

/** Two views the same, `null` and `undefined` both meaning everything. */
export function sameView(first, second) {
  const a = first || null; const b = second || null;
  if (a === b) return true;
  if (!a || !b) return false;
  return a.status === b.status && a.attention === b.attention;
}

/** The words for a view: a flag's own phrase, else the card that carries it, else the status, else "All events". */
export function viewLabel(view) {
  if (!view) return "All events";
  if (view.attention) return ATTENTION_LABELS[view.attention] || view.attention;
  const card = AI_SUMMARY_CARDS.find((candidate) => candidate.view && sameView(candidate.view, view));
  if (card) return card.label;
  return EVENT_STATUS_LABELS[view.status] || view.status || "All events";
}

/** Whether one row of the API's event rows belongs to a view. */
export function rowMatchesView(row, view) {
  if (!view) return true;
  if (view.status) return row?.status === view.status;
  if (view.attention) return Boolean(attentionMatches[view.attention]?.(row));
  return true;
}

/** The rows a view keeps, in the order they came. */
export const rowsForView = (rows, view) => (rows || []).filter((row) => rowMatchesView(row, view));

/** "4 / 6 processed" — what the engine has done with an event's photos. */
export const processedText = (row) => `${Number(row?.processedCount || 0).toLocaleString("en-IN")} / ${Number(row?.mediaCount || 0).toLocaleString("en-IN")} processed`;

/**
 * The Detection & Storage panel's rows, for the studio's dashboard (`scope: "studio"`, over
 * `GET /overview`) or one event's Project Dashboard (`scope: "event"`, over
 * `GET /events/:id/detection`) - the two answers carry the same keys, counted by the same reads.
 * Photos only: no Videos row. A media row that is not a photo (the AI Feature took video once) is
 * named as an "other file" on the storage line rather than counted as a photo. Archived events is
 * the studio's figure alone; an event has no share of it.
 * Each row is `[label, value, hint, valueClassName?]`, as DashboardFigureList draws it.
 */
export function detectionRows(data, { scope = "studio", rangeKey, formatBytes, number, periodPhrase } = {}) {
  if (!data) return [];
  const faces = data.faces; const media = data.media; const storage = data.storage; const period = data.period;
  const photos = media?.photos ?? media?.total; const other = media?.other || 0;
  const studio = scope !== "event";
  const rows = [
    ["Storage used", formatBytes(storage?.bytes), `${number(photos)} ${photos === 1 ? "photo" : "photos"}${other ? ` · ${number(other)} other ${other === 1 ? "file" : "files"}` : ""} in the store`],
    ["Faces detected", number(faces?.detected), faces?.detected ? `${number(faces?.unmatched)} not yet in a person` : "none found yet"],
    ["People", number(faces?.people), "faces the engine grouped into one person"],
    ["Face matches", number(faces?.matches), "guests matched to their photos"],
    ["Unmatched faces", number(faces?.unmatched), faces?.unmatched ? (studio ? "review inside the event's People tab" : "review them in the People tab") : "as of now · none", faces?.unmatched ? "text-amber-700" : ""],
    ["Guests", number(data.guests?.total), studio ? "across every event" : "in this event"],
    ["Recent uploads", number(storage?.recentUploads), studio && period ? `last 24 hours · ${number(period.photosUploaded)} photos ${periodPhrase(rangeKey)}` : "last 24 hours"],
  ];
  if (studio) rows.push(["Archived events", number(data.events?.archived), "kept, out of the way"]);
  return rows;
}
