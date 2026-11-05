import { API_URL, apiRequest } from "@/services/api/client";
import { getAccessToken } from "@/lib/auth";
import { downloadPdf } from "@/services/api/downloadPdf";

/**
 * The pre production board.
 *
 * `scope` is "mine" — the shoots this coordinator was named on — or "all" for the same board
 * unfiltered. The server decides who "mine" is from the signed-in account's linked employee record;
 * the browser never sends an employee id for it.
 */
export function getPreProductionRows({ scope = "mine" } = {}) {
  return apiRequest(`/api/project-management/pre-production/rows?scope=${encodeURIComponent(scope)}`);
}

/** The status list and the active employees who may be named Production Coordinator. */
export function getPreProductionOptions() {
  return apiRequest("/api/project-management/pre-production/options");
}

/** Save one row. `shootId` is the shoot's internal id, not its DBS-SID business code. */
export function savePreProductionRow(shootId, data) {
  return apiRequest(`/api/project-management/pre-production/${shootId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

/**
 * Add a follow-up to a project: `{ followupDate, remarks }`. Follow-ups are the project's — a
 * coordinator rings the couple about the wedding, not about each shoot — so this is keyed on the
 * project. Answers with the project's follow-ups as its board rows carry them.
 */
export function addPreProductionFollowup(projectId, data) {
  return apiRequest(`/api/project-management/pre-production/projects/${projectId}/followups`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/** Change a pending follow-up's date or remarks: `{ followupDate, remarks }`. Answers as adding one does. */
export function updatePreProductionFollowup(projectId, followupId, data) {
  return apiRequest(`/api/project-management/pre-production/projects/${projectId}/followups/${followupId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

/** Remove a pending follow-up. Answers as adding one does. */
export function deletePreProductionFollowup(projectId, followupId) {
  return apiRequest(`/api/project-management/pre-production/projects/${projectId}/followups/${followupId}`, {
    method: "DELETE",
  });
}

/** Mark one of a project's pending follow-ups done. Answers the same way as adding one. */
export function completePreProductionFollowup(projectId, followupId) {
  return apiRequest(`/api/project-management/pre-production/projects/${projectId}/followups/${followupId}/done`, {
    method: "PATCH",
  });
}

/*
 * The General panel. Its items save here, under PROJECT / Pre Production, rather than through
 * Projects, Client Gifts and Client Storage - whoever may write this screen may change what it shows.
 */

/** The project's General answers - only the fields that changed, and the reason for any switch. */
export function savePreProductionGeneral(projectId, data) {
  return apiRequest(`/api/project-management/pre-production/projects/${encodeURIComponent(projectId)}/general`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

/** Moves one of the project's gifts between Yet To Receive, Sent and Received by Client. */
export function savePreProductionGiftStatus(gift, projectId, status) {
  return apiRequest(`/api/project-management/pre-production/projects/${encodeURIComponent(projectId)}/gifts/${encodeURIComponent(gift)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

/*
 * The project's hard disk, read-only.
 *
 * Pre production does not run the Client Storage flow: it sets one status, and it sets it from the
 * shoot - a coordinator answering Hard Disk: Handed Over starts the record off. The moves from
 * there belong to Client Storage, so there is no status call here.
 */
export function getPreProductionStorageRecord(projectId, storageId) {
  return apiRequest(`/api/project-management/pre-production/projects/${encodeURIComponent(projectId)}/storage/${encodeURIComponent(storageId)}`);
}

/** The signed-in person's own WhatsApp groups, with the one named like the project suggested. */
export function getPreProductionWhatsappGroups(projectId) {
  return apiRequest(`/api/project-management/pre-production/projects/${encodeURIComponent(projectId)}/whatsapp-groups`);
}

/** Link one of those groups to the project; production messages are then sent from this person's WhatsApp. */
/** The WhatsApp group's invite link for the client (`""` removes it). */
export function savePreProductionWhatsappInviteLink(projectId, link) {
  return apiRequest(`/api/project-management/pre-production/projects/${encodeURIComponent(projectId)}/whatsapp-group/invite-link`, {
    method: "PATCH",
    body: JSON.stringify({ link }),
  });
}

export function linkPreProductionWhatsappGroup(projectId, jid) {
  return apiRequest(`/api/project-management/pre-production/projects/${encodeURIComponent(projectId)}/whatsapp-group`, {
    method: "PATCH",
    body: JSON.stringify({ jid }),
  });
}

/** Link the group named like the project from the caller's WhatsApp, when exactly one is; says why not otherwise. */
export function autoLinkPreProductionWhatsappGroup(projectId) {
  return apiRequest(`/api/project-management/pre-production/projects/${encodeURIComponent(projectId)}/whatsapp-group/auto`, { method: "POST" });
}

/**
 * Set a shoot's pre production status by hand - `{ status: "WCR" | "HOLD" | "REJECTED" | null, remarks,
 * followupDate }`; null goes back to automatic. WCR adds its follow-up to the project. Answers with the
 * shoot's row and, beside it, the project's follow-ups.
 */
export function setPreProductionShootStatus(shootId, data) {
  return apiRequest(`/api/project-management/pre-production/${shootId}/status`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

/**
 * The projects' overall Pre Production status, set by hand - `{ status, remarks }` with status
 * HOLD / REJECTED / PLANNED, or null for automatic. Never changes a shoot. Answers with how many
 * were updated, and how many were left alone (`refused`, `missing`).
 */
export function setPreProductionProjectStatus(projectIds, data) {
  return apiRequest("/api/project-management/pre-production/project-status", { method: "POST", body: JSON.stringify({ projectIds, ...data }) });
}

/** Everything done to the project from Pre Production, newest first - its Activity tab. */
export function getPreProductionProjectActivity(projectId) {
  return apiRequest(`/api/project-management/pre-production/projects/${encodeURIComponent(projectId)}/activity`);
}

/**
 * Asks the project's client to fill in this shoot's details in the Beam Craft app (a push and an item
 * in their app). `shootId` is the shoot's internal id. Sending again reminds them.
 */
export function sendPreProductionToClient(shootId) {
  return apiRequest(`/api/project-management/pre-production/${shootId}/send-to-client`, { method: "POST" });
}

/** What the client has filled in for the shoot: when it was sent, what is still owed, their photos. */
export function getPreProductionClientForm(shootId) {
  return apiRequest(`/api/project-management/pre-production/${shootId}/client-form`);
}

/** Downloads one file the client uploaded to a shoot (a photo, PDF, Word document...), under its own name. */
export async function downloadPreProductionClientFile(shootId, file) {
  const token = getAccessToken();
  const response = await fetch(`${API_URL}/api/project-management/pre-production/${shootId}/client-files/${file.id}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || "Unable to download this file.");
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name || "file";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Downloads the shoot's whole pre production form as a PDF (every section and answer). */
export async function downloadPreProductionFormPdf(shootId, fileName) {
  return downloadPdf(`/api/project-management/pre-production/${shootId}/form-pdf`, fileName, { fallback: "Unable to download the form." });
}
