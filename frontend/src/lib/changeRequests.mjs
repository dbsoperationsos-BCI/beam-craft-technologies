/*
 * Client Requests -> Raised Requests: the words and rules the screens share - the request types, the
 * correction categories (the server holds the same list and refuses any other), each status as it is
 * shown, and the arithmetic of a review. Pure, so the tests read it directly.
 */

export const REQUEST_TYPES = [
  { value: "SHOOT", label: "Shoot" },
  { value: "SERVICE", label: "Services" },
  { value: "DELIVERABLE", label: "Deliverables" },
  { value: "OTHER", label: "Other" },
];
export const REQUEST_TYPE_LABELS = Object.fromEntries(REQUEST_TYPES.map((type) => [type.value, type.label]));
/** What each type asks for, said under the choice. */
export const REQUEST_TYPE_HINTS = {
  SHOOT: "A new shoot for the project, with its services and deliverables.",
  SERVICE: "Services to add to one of the project's shoots.",
  DELIVERABLE: "Deliverables to add to one of the project's shoots.",
  OTHER: "A correction - album, photos, video, client or project details.",
};

export const CORRECTION_CATEGORIES = ["Album correction", "Photo correction", "Video correction", "Client information correction", "Project detail correction", "Other correction"];

export const STATUS_LABELS = { WAITING: "Waiting", IN_PROGRESS: "In progress", ACCEPTED: "Accepted", PARTIALLY_ACCEPTED: "Partially accepted", DECLINED: "Declined" };
export const STATUS_DOTS = { Waiting: "bg-amber-500", "In progress": "bg-blue-500", Accepted: "bg-emerald-500", "Partially accepted": "bg-teal-500", Declined: "bg-red-500" };
export const FINAL_STATUSES = ["ACCEPTED", "PARTIALLY_ACCEPTED", "DECLINED"];
export const isDecided = (request) => FINAL_STATUSES.includes(request?.status);

/** The list's tabs, and which statuses each holds. */
export const RAISED_TABS = ["All", "Waiting", "In progress", "Accepted", "Partially accepted", "Declined"];
export const TAB_STATUSES = { Waiting: ["WAITING"], "In progress": ["IN_PROGRESS"], Accepted: ["ACCEPTED"], "Partially accepted": ["PARTIALLY_ACCEPTED"], Declined: ["DECLINED"] };
export const inRaisedTab = (request, tab) => tab === "All" || (TAB_STATUSES[tab] || []).includes(request.status);

/** One deliverable line's identity on a shoot: the deliverable and its variant - the server's `deliverableLineKey`. */
export function deliverableLineKey(definitionId, variant) {
  const norm = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  const parts = [variant?.brandName, variant?.size, variant?.frameInches, variant?.videoLength].map(norm);
  return [String(definitionId || ""), ...(parts.some(Boolean) ? parts : [])].join("::");
}

/**
 * The first thing a request asks for that the shoot already has - its name - or "". `shoot` carries
 * `heldServices` / `heldDeliverables`; `services` / `deliverables` are the lines as sent (`servicePayload`
 * / `deliverablePayload`), names from `nameOf(line)`.
 */
export function alreadyOnShoot(shoot, services, deliverables, nameOf = () => "") {
  const heldServices = new Set((shoot?.heldServices || []).map((row) => row.id));
  const heldDeliverables = new Set((shoot?.heldDeliverables || []).map((row) => deliverableLineKey(row.id, row)));
  const service = services.find((line) => heldServices.has(line.serviceDefinitionId));
  if (service) return nameOf(service);
  const deliverable = deliverables.find((line) => heldDeliverables.has(deliverableLineKey(line.deliverableDefinitionId, line.variant)));
  return deliverable ? nameOf(deliverable) : "";
}

export const ITEM_TYPE_LABELS = { SHOOT: "Shoot", SERVICE: "Service", DELIVERABLE: "Deliverable", CORRECTION: "Correction" };

export const rupees = (amount) => `₹${Number(amount || 0).toLocaleString("en-IN")}`;

/** A review's form row from a saved item: the boxes start at what was saved. */
export function reviewRow(item) {
  return {
    id: item.id,
    decision: item.decision || "",
    approvedAmount: item.approvedAmount === null || item.approvedAmount === undefined ? "" : String(item.approvedAmount),
    approvedQuantity: item.approvedQuantity === null || item.approvedQuantity === undefined ? "" : String(item.approvedQuantity),
    managerRemarks: item.managerRemarks || "",
    rejectionReason: item.rejectionReason || "",
  };
}

/** What the review form sends: blanks as nothing, a rejected item without amount or quantity. */
export function reviewPayload(rows) {
  return rows.map((row) => ({
    id: row.id,
    decision: row.decision || null,
    approvedAmount: row.decision === "APPROVED" && row.approvedAmount !== "" ? Number(row.approvedAmount) : null,
    approvedQuantity: row.decision === "APPROVED" && row.approvedQuantity !== "" ? Number(row.approvedQuantity) : null,
    managerRemarks: row.managerRemarks.trim() || null,
    rejectionReason: row.decision === "REJECTED" ? row.rejectionReason.trim() || null : null,
  }));
}

/** The total of what is approved on the form, as it is typed. */
export const approvedTotal = (rows) => rows.reduce((sum, row) => sum + (row.decision === "APPROVED" && Number.isFinite(Number(row.approvedAmount)) ? Number(row.approvedAmount) : 0), 0);

/**
 * What stops the final decision, item by item - the same rules the server holds (`finalProblem`), so
 * each box says what it needs before anything is sent. `items` are the request's, `rows` the form's.
 */
export function reviewProblems(items, rows) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const problems = {};
  for (const item of items) {
    const row = byId.get(item.id) || {};
    if (!row.decision) problems[item.id] = { decision: "Approve or reject this item." };
    else if (row.decision === "APPROVED" && (row.approvedAmount === "" || !Number.isFinite(Number(row.approvedAmount)) || Number(row.approvedAmount) < 0)) problems[item.id] = { approvedAmount: "Enter the amount (₹0 if complimentary)." };
    else if (row.decision === "REJECTED" && !row.rejectionReason.trim()) problems[item.id] = { rejectionReason: "Give the reason." };
  }
  const shoot = items.find((item) => item.itemType === "SHOOT");
  if (shoot && byId.get(shoot.id)?.decision === "REJECTED") {
    for (const item of items) {
      if (item.itemType !== "SHOOT" && byId.get(item.id)?.decision === "APPROVED") problems[item.id] = { decision: "The shoot is rejected - reject this too, or approve the shoot." };
    }
  }
  return problems;
}

/** The status the decisions on the form would give the request. */
export function outcomeOf(rows) {
  if (!rows.length || rows.some((row) => !row.decision)) return "";
  if (rows.every((row) => row.decision === "APPROVED")) return "ACCEPTED";
  if (rows.every((row) => row.decision === "REJECTED")) return "DECLINED";
  return "PARTIALLY_ACCEPTED";
}
