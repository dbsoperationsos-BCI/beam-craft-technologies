/**
 * Speak-up's fixed shape, shared between the submit dialog and both detail views (the double-click
 * panel on "My Speak-ups" and the side panel on "Speak-up Review") — a field added here appears in
 * all three without any of them learning about the module, the same contract `RecordDetails` states
 * for every other module's sections.
 */

export const TYPE_OPTIONS = ["Team / Manager Issue", "HR / People", "Work Environment", "Suggestion", "App / System Issue", "Other"]
  .map((value) => ({ label: value, value }));

/** Kept in step with the backend's `ALLOWED_TYPES` (backend/src/modules/hrm/speak-up/controller.js)
 * so a file the server would refuse is never offered to pick in the first place. */
export const ACCEPTED_ATTACHMENT_TYPES = ".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.txt";

/*
 * Where a speak-up has got to. PENDING until Speak-up Review decides it; the server's `DECISIONS`
 * (backend/src/modules/hrm/speak-up/controller.js) names the other three. The employee who raised
 * it sees only this - never who decided it, why, or whom it went to.
 */
export const SPEAK_UP_STATUS_LABELS = {
  PENDING: "Pending",
  APPROVED: "Approved",
  ASSIGNED: "Approved & Assigned",
  REJECTED: "Rejected",
};

/** The dot beside each label, keyed by the label the table shows. */
export const speakUpStatusStyles = {
  Pending: "bg-amber-500",
  Approved: "bg-emerald-500",
  "Approved & Assigned": "bg-blue-500",
  Rejected: "bg-red-500",
};

/** A row with its status as words, which is what the table filters, sorts and exports. */
export const withStatusLabel = (row) => ({ ...row, statusLabel: SPEAK_UP_STATUS_LABELS[row.status] || SPEAK_UP_STATUS_LABELS.PENDING });

/** `[accessorKey, header, type?, size?, minSize?]` — the shape `buildTableColumns` reads. */
export const speakUpTableFields = [
  ["speakUpId", "Speak-up ID", "text", 150],
  ["type", "Type", "text", 170],
  ["title", "Subject", "text", 220],
  ["createdAt", "Date", "date", 130],
  ["statusLabel", "Status", "status", 170],
];

/** The same three columns, with who wrote it named first — Speak-up Review is not anonymous. */
export const speakUpReviewTableFields = [
  ["employeeName", "Employee", "text", 170],
  ...speakUpTableFields,
];

/** `[key, label, type?]` — the shape `RecordDetails`/`DataTableInfoPanel`/`RecordViewPanel` share. */
export const speakUpDetailSections = [
  { title: "Speak-up", fields: [["speakUpId", "Speak-up ID"], ["statusLabel", "Status"], ["type", "Type"], ["title", "Subject"], ["createdAt", "Date", "date"]] },
  { title: "What happened", fields: [["description", "Description", "longtext"]] },
  { title: "Attachment", fields: [["attachmentFileName", "File", "attachment"]] },
];

export const SPEAK_UP_REASSURANCE = "Your complaint will not be exposed to anyone. This is kept personal — say anything you want to tell.";

/** Speak-up Review's own double-click view - the same plain read view every other table's
 * double-click already opens (`RecordViewPanel`), with who added it and when named first, since
 * this one is deliberately not anonymous. */
export const speakUpReviewDetailSections = [
  { title: "Speak-up", fields: [["speakUpId", "Speak-up ID"], ["employeeName", "Added By"], ["createdAt", "Added Time", "datetime"], ["statusLabel", "Status"], ["type", "Type"], ["title", "Subject"]] },
  { title: "What happened", fields: [["description", "Description", "longtext"]] },
  { title: "Attachment", fields: [["attachmentFileName", "File", "attachment"]] },
  // Empty, and so hidden, until it is decided.
  { title: "Review", fields: [["reviewedByName", "Reviewed By"], ["reviewedAt", "Reviewed Time", "datetime"], ["reviewRemark", "Remark", "longtext"], ["taskCode", "Task"]] },
];

/** The three decisions, as the ⋮ offers them and the dialog words them. `tone` is the Button's. */
export const SPEAK_UP_DECISIONS = {
  APPROVE: { label: "Approve", title: "Approve this Speak-up?", action: "Approve", tone: "primary", said: "Speak-up approved." },
  ASSIGN: { label: "Approve & Assign", title: "Approve & Assign as a task", action: "Approve & Assign", tone: "primary", said: "Speak-up approved and assigned as a task." },
  REJECT: { label: "Reject", title: "Reject this Speak-up?", action: "Reject", tone: "danger", said: "Speak-up rejected." },
};

export const speakUpFormInitialValues = { type: "", otherType: "", title: "", description: "", attachment: [] };

/** What the server actually stores for `description` - the custom type folded in first, since
 * `type` itself must stay one of the six fixed values the backend validates against. */
export function speakUpDescriptionFor(values) {
  const description = values.description.trim();
  if (values.type !== "Other" || !values.otherType?.trim()) return description;
  return `Issue type: ${values.otherType.trim()}\n\n${description}`;
}
