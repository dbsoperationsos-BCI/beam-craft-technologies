import { API_URL, apiRequest } from "@/services/api/client";
import { getAccessToken } from "@/lib/auth";

/*
 * The production board. `shootId` is always the shoot's internal id, not its DBS-SID code. Who may
 * change a shoot is the server's to decide (by being named on it); these only carry the request.
 */
const BASE = "/api/project-management/production";
const shootPath = (shootId) => `${BASE}/shoots/${encodeURIComponent(shootId)}`;

/** The board: one row per production record the viewer may see. */
/**
 * The board's shoots. `window` - the Production Schedule's - narrows them on the server: `{ from, to }`
 * (YYYY-MM-DD; `to` may be left out) or `{ undated: true }`. Without it, every shoot, as the table reads them.
 */
export function getProductionShoots(window = null) {
  const params = new URLSearchParams();
  if (window?.undated) params.set("undated", "1");
  else {
    if (window?.from) params.set("from", window.from);
    if (window?.to) params.set("to", window.to);
  }
  const query = params.toString();
  return apiRequest(`${BASE}/shoots${query ? `?${query}` : ""}`);
}

/** One shoot in full, with `canEditPlan` and `canRunSteps` for the viewer. */
export function getProductionShoot(shootId) {
  return apiRequest(shootPath(shootId));
}

/** Employees, travel modes, cameras, vendors and - for a shoot - its services. */
export function getProductionOptions() {
  return apiRequest(`${BASE}/options`);
}

/** The shoot's log, oldest first. */
export function getProductionActivity(shootId) {
  return apiRequest(`${shootPath(shootId)}/activity`);
}

/** Save the plan; `submit: true` submits it. Answers with the shoot. */
export function saveProductionPlan(shootId, data) {
  return apiRequest(`${shootPath(shootId)}/plan`, { method: "PATCH", body: JSON.stringify(data) });
}

/** One service's own person - `{ serviceDefinitionId, employeeId, vendorId }`, neither to clear it. Answers with the shoot. */
export function saveProductionSeat(shootId, seat) {
  return apiRequest(`${shootPath(shootId)}/seat`, { method: "PATCH", body: JSON.stringify(seat) });
}

/**
 * "Use the same team as above": every service `shootId` shares with `fromShootId` (a shoot of the same
 * project) takes that shoot's person; its other services stay as they are. Answers the shoot as saved.
 */
export function copyProductionTeam(shootId, fromShootId) {
  return apiRequest(`${shootPath(shootId)}/copy-team`, { method: "POST", body: JSON.stringify({ fromShootId }) });
}

/**
 * Two services' people swapped - `from` and `to` each `{ shootId, serviceDefinitionId }`. A 409 carries
 * `details`: the shoot, project and service the person is already on at that time.
 */
export function swapProductionSeats(from, to) {
  return apiRequest(`${BASE}/seat-swap`, { method: "POST", body: JSON.stringify({ from, to }) });
}

/**
 * Add tickets (`TICKET`) or photos (`STARTED_FROM_STUDIO`, `REACHED_SHOOT_PLACE`, `PINEAPPLE_GROUP`, `SHOOT_STARTED`, `HAPPENING_NOW`, `HAPPY_CLIENTS`): `files` is `[{ name, data }]`.
 * `travelMode` is only for a ticket upload - the mode being picked on the form, so the server can
 * set it on the plan itself rather than asking the plan to be saved first.
 */
export function addProductionFiles(shootId, kind, files, travelMode) {
  return apiRequest(`${shootPath(shootId)}/files`, { method: "POST", body: JSON.stringify({ kind, files, ...(travelMode ? { travelMode } : {}) }) });
}

export function removeProductionFile(shootId, fileId) {
  return apiRequest(`${shootPath(shootId)}/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
}

/**
 * File in saved as it stands, the step left where it is. Answers `{ data: shoot, saved, pending }`:
 * how many services were kept, and how many of the shoot's are still to be filled in.
 */
export function saveProductionFootage(shootId, footage) {
  return apiRequest(`${shootPath(shootId)}/footage`, { method: "PATCH", body: JSON.stringify({ footage }) });
}

/**
 * Pause the shoot where it stands, or start it again: `{ paused, remarks }`, the remarks being why,
 * which is asked for both ways round. Not a step - the shoot stays where it is.
 */
export function pauseProductionShoot(shootId, data) {
  return apiRequest(`${shootPath(shootId)}/pause`, { method: "PATCH", body: JSON.stringify(data) });
}

/** Complete the current step. Answers `{ data: shoot, message }`, `message` being the WhatsApp result. */
export function completeProductionStep(shootId, step, data = {}) {
  return apiRequest(`${shootPath(shootId)}/steps/${encodeURIComponent(step)}`, { method: "POST", body: JSON.stringify(data) });
}

/** Send a failed step message once more. */
export function retryProductionMessage(shootId, step) {
  return apiRequest(`${shootPath(shootId)}/messages/${encodeURIComponent(step)}/retry`, { method: "POST" });
}

/**
 * One of a shoot's files, as a Blob to save. Read through the API rather than from the bucket's
 * link, because the browser opens a link to another site instead of saving it.
 */
export async function downloadProductionFile(shootId, fileId) {
  const headers = new Headers();
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_URL}${shootPath(shootId)}/files/${encodeURIComponent(fileId)}/download`, { headers });
  if (!response.ok) {
    const message = await response.json().then((body) => body?.message).catch(() => null);
    throw new Error(message || "Unable to download the file.");
  }
  return response.blob();
}

/** The plan's own status: `{ status: "HOLD" | "REJECTED" | null, remarks }` - null goes back to automatic. */
export function setProductionPlanStatus(shootId, data) {
  return apiRequest(`${shootPath(shootId)}/plan-status`, { method: "PATCH", body: JSON.stringify(data) });
}

/**
 * The projects' overall Production status, set by hand - `{ status, remarks }` with status HOLD /
 * REJECTED / COMPLETED, or null for automatic. Never changes a shoot.
 */
export function setProductionProjectStatus(projectIds, data) {
  return apiRequest("/api/project-management/production/project-status", { method: "POST", body: JSON.stringify({ projectIds, ...data }) });
}
