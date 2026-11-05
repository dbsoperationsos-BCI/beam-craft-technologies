/**
 * Pure helpers the AI Feature screens share: how a count, a size, a date and a status read.
 * `.mjs` so `node --test` can import them without the bundler.
 */
export const EVENT_STATUS_LABELS = { UPCOMING: "Upcoming", ACTIVE: "Active", COMPLETED: "Completed", ARCHIVED: "Archived", DRAFT: "Draft" };
export const EVENT_STATUS_TONES = {
  UPCOMING: "bg-amber-50 text-amber-700 border-amber-200",
  ACTIVE: "bg-green-50 text-green-700 border-green-200",
  COMPLETED: "bg-slate-100 text-slate-600 border-slate-200",
  ARCHIVED: "bg-slate-100 text-slate-500 border-slate-200",
  DRAFT: "bg-slate-50 text-slate-500 border-slate-200",
};
export const AI_STATUS_LABELS = { QUEUED: "Queued", PROCESSING: "Processing", COMPLETED: "Processed", FAILED: "Failed", SKIPPED: "Skipped" };
export const MATCH_STATUS_LABELS = { MATCHED: "Matched", CONFIRMED: "Confirmed", REJECTED: "Rejected", REVIEW_REQUIRED: "Needs review" };

const numberFormat = new Intl.NumberFormat("en-IN");
export const formatCount = (value) => numberFormat.format(Number(value) || 0);

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let scaled = value / 1024; let index = 0;
  while (scaled >= 1024 && index < units.length - 1) { scaled /= 1024; index += 1; }
  return `${scaled >= 100 ? Math.round(scaled) : scaled.toFixed(1)} ${units[index]}`;
}

export function formatEventDate(value, { withYear = true } = {}) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
}

/** "22 Sep 2026" or "22 – 23 Sep 2026" or "28 Sep – 2 Oct 2026". */
export function formatEventRange(start, end) {
  if (!start) return "";
  if (!end || formatEventDate(start) === formatEventDate(end)) return formatEventDate(start);
  const a = new Date(start); const b = new Date(end);
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) return `${a.getDate()} – ${formatEventDate(end)}`;
  if (a.getFullYear() === b.getFullYear()) return `${formatEventDate(start, { withYear: false })} – ${formatEventDate(end)}`;
  return `${formatEventDate(start)} – ${formatEventDate(end)}`;
}

export function formatTime(value) {
  if (!value) return "";
  const [hours, minutes] = String(value).split(":").map(Number);
  if (Number.isNaN(hours)) return value;
  const suffix = hours >= 12 ? "PM" : "AM";
  return `${((hours + 11) % 12) + 1}:${String(minutes || 0).padStart(2, "0")} ${suffix}`;
}

/** The date input's value from an ISO string, so the wizard edits "2026-09-22" not a timestamp. */
export const toDateInput = (value) => (value ? String(value).slice(0, 10) : "");

/** The percent a processing summary reads as. */
export const processingPercent = (processing) => (processing && processing.total ? Math.round(((processing.completed + processing.failed + processing.skipped) / processing.total) * 100) : 0);

/** One line for the timeline: "250 photos uploaded", "Guest Arun matched". */
export function describeActivity(row) {
  const detail = row.detail ? ` — ${row.detail}` : "";
  const labels = {
    EVENT_CREATED: "Event created", EVENT_UPDATED: "Event details updated", EVENT_DUPLICATED: "Event duplicated", EVENT_ARCHIVED: "Event archived", EVENT_RESTORED: "Event restored", EVENT_DELETED: "Event deleted",
    SETTINGS_UPDATED: "Settings updated", SUB_EVENTS_UPDATED: "Sub-events updated",
    GUEST_ADDED: "Guest added", GUESTS_IMPORTED: "Guests imported", GUEST_UPDATED: "Guest updated", GUEST_REMOVED: "Guest removed", GUEST_JOINED: "Guest joined from the link", GUEST_SELFIE_ADDED: "Guest selfie added",
    MEDIA_UPLOADED: "Media uploaded", MEDIA_DELETED: "Media deleted",
    AI_PROCESSING_STARTED: "AI processing started", AI_PROCESSING_COMPLETED: "AI processing completed", AI_PROCESSING_FAILED: "AI processing failed", AI_PROCESSING_RETRIED: "Failed photos retried",
    FACES_DETECTED: "Faces detected", MATCH_CREATED: "Match created", MATCH_CONFIRMED: "Match confirmed", MATCH_REJECTED: "Match rejected",
    PERSON_RENAMED: "Person renamed", PERSON_MERGED: "People merged", PERSON_SPLIT: "Person split", PERSON_HIDDEN: "Person visibility changed", PERSON_LINKED: "Person linked to guest",
    EVENT_SHARED: "Event link created", SHARE_REVOKED: "Event link revoked",
  };
  return `${labels[row.event] || row.event}${detail}`;
}

/** Which of the list filters an event row satisfies. */
export const EVENT_FILTERS = [["all", "All"], ["active", "Active"], ["upcoming", "Upcoming"], ["completed", "Completed"], ["archived", "Archived"]];
export const EVENT_SORTS = [["newest", "Newest"], ["oldest", "Oldest"], ["eventDate", "Event date"], ["name", "Name"]];

/** The wizard's steps, in order. */
export const WIZARD_STEPS = [["details", "Event Details"], ["subEvents", "Sub Events"], ["settings", "Event Settings"], ["guests", "Guest Configuration"], ["ai", "Media / AI Settings"], ["review", "Review"]];

/** Which required fields of step one are still empty. */
export function detailsProblems(details) {
  const problems = {};
  if (!String(details.name || "").trim()) problems.name = "Give the event a name.";
  if (!String(details.eventType || "").trim()) problems.eventType = "Choose an event type.";
  if (!details.startDate) problems.startDate = "Choose the start date.";
  if (details.endDate && details.startDate && details.endDate < details.startDate) problems.endDate = "The end date is before the start date.";
  return problems;
}
