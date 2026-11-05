/*
 * Settings → User Settings → WhatsApp Activity Log: the words and the query the screen is built from.
 *
 * Pure helpers, so the panel holds no vocabulary of its own and the tests read them without a
 * browser. The statuses, modes and triggers are the backend's (`services/whatsappActivity.js`);
 * what each one is called here is the studio's wording for it. The trigger and module labels are
 * also served by `GET /options`; the copies here are the fallback when that call fails, so the
 * table never shows an internal key.
 */

import { PROGRESS_COLORS } from "./progressStatus.mjs";

export const ACTIVITY_STATUSES = Object.freeze({
  QUEUED: { label: "Queued", summary: "Waiting to be sent" },
  PROCESSING: { label: "Sending", summary: "Being sent now" },
  SENT: { label: "Sent", summary: "Accepted by WhatsApp; delivery not yet confirmed" },
  DELIVERED: { label: "Delivered", summary: "Reached the phone" },
  READ: { label: "Read", summary: "Opened by the recipient" },
  FAILED: { label: "Failed", summary: "Not sent" },
});

/**
 * The pill colour for each status - the progress palette's own, so waiting, on its way and arrived
 * read as three different things, plus the app's rose for a failure, which is an error and not a
 * part-done job. Every pill carries its word too; the colour is never the only signal.
 */
export const ACTIVITY_STATUS_COLORS = Object.freeze({
  QUEUED: PROGRESS_COLORS.notStarted,
  PROCESSING: PROGRESS_COLORS.notStarted,
  SENT: PROGRESS_COLORS.inProgress,
  DELIVERED: PROGRESS_COLORS.completed,
  READ: PROGRESS_COLORS.completed,
  FAILED: "#BE123C",
});

export const ACTIVITY_MODES = Object.freeze({
  MANUAL: "Manual",
  AUTOMATIC: "Automatic",
});

export const ACTIVITY_ATTEMPT_KINDS = Object.freeze({
  INITIAL: "First try",
  RETRY: "Tried again by the app",
  RESEND: "Resent from this log",
});

export const ACTIVITY_MODULE_LABELS = Object.freeze({
  SALES: "Sales",
  ACCOUNTS: "Accounts",
  HRM: "HRM",
  PROJECT: "Project Management",
  IMAGE_SELECTION: "Image Selection",
  SETTINGS: "Settings",
});

export const ACTIVITY_TRIGGER_LABELS = Object.freeze({
  CRM_LEAD_MESSAGE: "CRM lead message",
  CRM_LEAD_MEDIA: "CRM lead attachment",
  CRM_LEAD_REPLY: "CRM lead reply",
  CRM_LEAD_FORWARD: "CRM lead forward",
  CRM_LEAD_WELCOME: "New lead welcome",
  CLIENT_LOGIN_CREDENTIALS: "Client login credentials",
  CRD_DOCUMENT_LINK: "CRD document link",
  CASH_RECEIPT_INVOICE: "Payment receipt and invoice",
  SHOOT_CREW_ASSIGNED: "Shoot crew notice",
  SHOOT_CREW_REMOVED: "Shoot crew removed",
  VENDOR_SHOOT_CONFIRMED: "Vendor confirmed for a shoot",
  VENDOR_SHOOT_REMINDER: "Vendor shoot reminder",
  VENDOR_SHOOT_DATE_CHANGED: "Vendor shoot date changed",
  VENDOR_SHOOT_PLACE_CHANGED: "Vendor shoot place changed",
  VENDOR_SHOOT_SERVICE_CHANGED: "Vendor shoot service changed",
  VENDOR_SHOOT_REMOVED: "Vendor off a shoot",
  ONBOARDING_INVITE: "Onboarding invite",
  INTERVIEW_APPLICATION_INVITE: "Interview application invite",
  INTERVIEW_CANDIDATE_MESSAGE: "Interview candidate message",
  EMPLOYEE_LOGIN_CREDENTIALS: "Employee login credentials",
  OFFBOARDING_FORM: "Offboarding form",
  OFFBOARDING_REMINDER: "Offboarding reminder",
  OFFBOARDING_APPROVED: "Offboarding confirmed",
  OFFBOARDING_NOT_ACCEPTED: "Offboarding not accepted",
  FEEDBACK_THANK_YOU: "Feedback thank you",
  FEEDBACK_ISSUES: "Feedback issues",
  ATTENDANCE_REPORT: "Attendance daily report",
  WISH_BIRTHDAY: "Birthday wish",
  WISH_WEDDING_ANNIVERSARY: "Wedding anniversary wish",
  WISH_WORK_ANNIVERSARY: "Work anniversary wish",
  PRODUCTION_STARTED_FROM_STUDIO: "Production: started from studio",
  PRODUCTION_REACHED_SHOOT_PLACE: "Production: reached shoot place",
  PRODUCTION_SHOOT_COMPLETED: "Production: shoot completed",
  PAYMENT_DUE_REMINDER: "Payment due reminder",
  IMAGE_SELECTION_GROUP_INVITE: "Gallery invite to group",
  IMAGE_SELECTION_TEMPLATE: "Gallery invite (Meta template)",
  PHOTO_SELECTION_SUBMITTED: "Photo selection submitted",
  SIGNATURE_ALBUM_SHARE: "Signature album share",
});

export function activityStatusLabel(status) {
  return ACTIVITY_STATUSES[status]?.label || String(status || "").toLowerCase() || "Unknown";
}

/** An internal key read for a person: "PRODUCTION_SHOOT_COMPLETED" → "Production shoot completed". */
export function humaniseKey(key) {
  const text = String(key || "").trim().toLowerCase().replace(/_/g, " ");
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

export function activityTriggerLabel(trigger, served = {}) {
  return served[trigger] || ACTIVITY_TRIGGER_LABELS[trigger] || humaniseKey(trigger);
}

export function activityModuleLabel(module, served = {}) {
  return served[module] || ACTIVITY_MODULE_LABELS[module] || humaniseKey(module);
}

/** Who the message went to, as the table shows it: a name where there is one, the masked number or group beside it. */
export function activityRecipientLabel(row) {
  if (!row) return "";
  const name = String(row.recipientName || row.crmLead?.name || row.employee?.employeeName || "").trim();
  const masked = String(row.recipientMasked || "").trim();
  if (row.recipientKind === "GROUP") return name ? `${name} (group)` : "WhatsApp group";
  if (name && masked) return `${name} · ${masked}`;
  return name || masked;
}

/**
 * Where the message actually went on WhatsApp: a person's number (masked) or the group, named.
 * The raw number or group id never reaches the browser, so this is the masked copy and the name.
 */
export function activityDestinationLabel(row) {
  if (!row) return "";
  const name = String(row.recipientName || "").trim();
  if (row.recipientKind === "GROUP") return name ? `WhatsApp group · ${name}` : "WhatsApp group";
  const masked = String(row.recipientMasked || "").trim();
  if (!masked) return "—";
  return row.recipientKind === "LEAD" ? `${masked} (lead's WhatsApp)` : masked;
}

/** What the message is about - the project, lead or employee it was sent for. */
export function activitySubjectLabel(row) {
  if (!row) return "";
  if (row.salesProject) return [row.salesProject.whatsappGroupName, row.salesProject.eventId].filter(Boolean).join(" · ");
  if (row.imageSelectionProject?.projectName) return row.imageSelectionProject.projectName;
  if (row.crmLead) return row.crmLead.name || row.crmLead.enquiryId;
  if (row.employee?.employeeName) return row.employee.employeeName;
  return "";
}

/**
 * Who sent it: the staff member who pressed Send, or "System" for a scheduler or a business event.
 * A manual send with no login recorded against it - which the log never writes, but an older row
 * could hold - reads "Unknown" rather than a guess.
 */
export function activityActorLabel(row) {
  if (!row) return "";
  if (row.initiatedByUser?.name) return row.initiatedByUser.name;
  return row.mode === "AUTOMATIC" ? "System" : "Unknown";
}

/** Manual or Automatic, and nothing else - "Unknown" only for a row that recorded neither. */
export function activityModeLabel(row) {
  return ACTIVITY_MODES[row?.mode] || "Unknown";
}

/** Whose WhatsApp it left from: a person's paired phone, or the studio's Meta number. */
export function activitySenderLabel(row) {
  if (!row) return "";
  if (row.senderUser?.name) return `${row.senderUser.name}'s WhatsApp`;
  if (row.provider === "meta" || row.provider === "mock") return "Studio number (Meta)";
  return "Unknown";
}

/** The one line the table shows for a failed row. */
export function activityFailureLabel(row) {
  if (!row || row.status !== "FAILED") return "";
  return row.failureReason || "Could not send. Open the message to see why.";
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The filters as the API takes them. Empty values are left out; a day range is widened to the whole
 * local day on each side (`from` at 00:00, `to` at the last millisecond), so "17 Oct to 17 Oct" is
 * that day and not an empty instant. `page` is `{ offset, limit }`.
 */
export function buildActivityQuery(filters = {}, page = {}) {
  const query = {};
  const text = (value) => String(value || "").trim();
  if (text(filters.search)) query.search = text(filters.search);
  if (text(filters.mode)) query.mode = text(filters.mode);
  if (text(filters.status)) query.status = text(filters.status);
  if (text(filters.module)) query.module = text(filters.module);
  if (text(filters.trigger)) query.trigger = text(filters.trigger);
  if (text(filters.recipient)) query.recipient = text(filters.recipient);
  if (text(filters.sender)) query.sender = text(filters.sender);
  const from = dayStart(filters.from);
  const to = dayStart(filters.to);
  if (from) query.from = from.toISOString();
  if (to) query.to = new Date(to.getTime() + DAY_MS - 1).toISOString();
  // One day on the Sent At column: the whole of it, against when WhatsApp accepted the message.
  const sentOn = dayStart(filters.sentOn);
  if (sentOn) { query.sentFrom = sentOn.toISOString(); query.sentTo = new Date(sentOn.getTime() + DAY_MS - 1).toISOString(); }
  if (Number.isFinite(page.offset) && page.offset > 0) query.offset = String(page.offset);
  if (Number.isFinite(page.limit) && page.limit > 0) query.limit = String(page.limit);
  return query;
}

/** Midnight at the start of a `YYYY-MM-DD` day in the browser's own zone, or null for anything else. */
export function dayStart(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  if (!match) return null;
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(day.getTime()) ? null : day;
}

/**
 * The table's own filter boxes, as the API takes them: each column's box maps to one parameter.
 * The boxes report `{ columnId: value }` - a multi-select gives an array of the chosen values,
 * joined here with commas for the query; a date box gives a day.
 */
export function activityFiltersFromColumns(columnFilters = {}) {
  const text = (value) => (typeof value === "string" ? value.trim() : "");
  const list = (value) => (Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean).join(",") : text(value));
  return {
    trigger: list(columnFilters.trigger),
    module: list(columnFilters.module),
    recipient: list(columnFilters.recipient),
    mode: list(columnFilters.mode),
    sender: list(columnFilters.actor),
    status: list(columnFilters.status),
    sentOn: text(columnFilters.sentAt),
  };
}

/** Which table column asks the API for which list of values. */
export const ACTIVITY_FACET_FOR_COLUMN = Object.freeze({ trigger: "trigger", module: "module", recipient: "recipient", mode: "mode", actor: "sender", status: "status" });

/** Whether any filter narrows the log - what decides between "nothing yet" and "nothing matches". */
export function hasActivityFilters(filters = {}) {
  return ["search", "mode", "status", "module", "trigger", "recipient", "sender", "from", "to", "sentOn"].some((key) => String(filters[key] || "").trim());
}

/**
 * The three tiles the page shows, from the API's counts: how many in all, how many reached the
 * phone, and how many failed - a label and a number each, nothing under them. The API also counts
 * read, pending and accepted-not-yet-delivered messages; the Status box finds those, the tiles
 * leave them out.
 */
export function activitySummaryTiles(summary) {
  const counts = summary || {};
  const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
  return [
    { key: "total", label: "Total messages", value: number(counts.total), tone: "text-slate-950" },
    { key: "delivered", label: "Delivered", value: number(counts.delivered), tone: "text-emerald-700" },
    { key: "failed", label: "Failed", value: number(counts.failed), tone: "text-rose-700" },
  ];
}
