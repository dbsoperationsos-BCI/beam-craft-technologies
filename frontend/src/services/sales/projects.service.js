import { API_URL, apiRequest } from "@/services/api/client";
import { getAccessToken } from "@/lib/auth";

// `{ summary: true }`: shoots without their deliverables and services, for a screen that shows neither.
export function getSalesProjects({ summary = false } = {}) {
  return apiRequest(`/api/sales/projects${summary ? "?view=summary" : ""}`);
}

/** One project as the register shows it, by id or Event ID - instead of reading the whole register. */
export function getSalesProject(idOrEventId) {
  return apiRequest(`/api/sales/projects/${encodeURIComponent(idOrEventId)}`);
}

export function searchSalesEnquiries(search = "") {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  return apiRequest(`/api/sales/enquiries${params.toString() ? `?${params.toString()}` : ""}`);
}

// `withDrafts` lists an enquiry's drafts too - Create Project shows them, disabled, beside the rest.
export function getSalesQuotations({ enquiryId, withDrafts = false } = {}) {
  const params = new URLSearchParams();
  if (enquiryId) params.set("enquiryId", enquiryId);
  if (enquiryId && withDrafts) params.set("withDrafts", "1");
  return apiRequest(`/api/sales/quotations${params.toString() ? `?${params.toString()}` : ""}`);
}

/**
 * Who a quotation can be shared with: the working employees whose roles open Quotations. Nobody
 * else is listed - a share widens which quotations somebody sees and cannot put them on the
 * screen, so sharing with anybody else would reach nobody.
 */
export function getQuotationShareCandidates() {
  return apiRequest("/api/sales/quotations/share-candidates");
}

/**
 * Saves who a quotation is shared with, on its own - no version is raised. The share is of the whole
 * quotation, so the people named get every version of it.
 */
export function saveQuotationShares(id, sharedEmployeeIds) {
  return apiRequest(`/api/sales/quotations/${id}/shares`, {
    method: "PUT",
    body: JSON.stringify({ sharedEmployeeIds }),
  });
}

/** One quotation version in full, payload and all. */
export function getSalesQuotation(id) {
  return apiRequest(`/api/sales/quotations/${id}`);
}

export function createSalesQuotation(payload) {
  return apiRequest("/api/sales/quotations", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Editing a quotation raises the next version of its chain, so this creates rather than updates -
 * `id` is the version it was raised from, and the version already sent to a client is untouched.
 */
export function createSalesQuotationVersion(id, payload) {
  return apiRequest(`/api/sales/quotations/${id}/versions`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Preview: the client's copy of the generator's form as it stands, unsaved. Nothing is written -
 * no row, number or version; the answer is the quotation exactly as the client's page receives one.
 */
export function previewSalesQuotation(payload) {
  return apiRequest("/api/sales/quotations/preview", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Save Draft on a new quotation: numbered as version 01 of a new chain, kept as a draft with no
 * live link. Every later save of it goes through `updateSalesQuotationDraft`.
 */
export function createSalesQuotationDraft(payload) {
  return apiRequest("/api/sales/quotations/drafts", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Save Draft on a draft: the same row and number, rewritten. `payload.draftUpdatedAt` is the
 * draft's `updatedAt` as it was opened, so a save over somebody else's newer one is refused (409).
 */
export function updateSalesQuotationDraft(id, payload) {
  return apiRequest(`/api/sales/quotations/${id}/draft`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

/** Generate Quotation on a draft: it becomes a generated version in place, its link live for five days. */
export function generateSalesQuotationDraft(id, payload) {
  return apiRequest(`/api/sales/quotations/${id}/generate`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Re-enables one version's public link for another five days. Same URL, fresh clock. */
export function renewSalesQuotationLink(id) {
  return apiRequest(`/api/sales/quotations/${id}/link`, { method: "POST" });
}

/**
 * Finalizes one version: kept exactly as it is, its link never expires, and the chain raises no
 * version until it is unfinalized. `payload` is what the screen holds - the server refuses when it
 * differs from what is saved, so unsaved edits are never finalized by accident. Raises no version.
 */
export function finalizeSalesQuotation(id, payload) {
  return apiRequest(`/api/sales/quotations/${id}/finalize`, {
    method: "POST",
    body: JSON.stringify(payload ? { payload } : {}),
  });
}

/** Unfinalizes one version: the version stays as it was, its link back on a five-day clock. */
export function unfinalizeSalesQuotation(id) {
  return apiRequest(`/api/sales/quotations/${id}/unfinalize`, { method: "POST" });
}

/**
 * The studio's own copy of one version as a PDF.
 *
 * Not the client's link: that one now answers to the brand's Allow Client Download, and a brand
 * that hands its clients no copy must still hand one to the person selling. This route is behind
 * the login, and a bare `href` sends no token, so the file is fetched with one and saved from the
 * bytes. The object URL is released a minute after the click rather than in the same tick: Safari
 * and Firefox start the save asynchronously, and revoking the URL straight after `click()` could
 * cancel it - a download that hung or came out empty. Anything that is not a PDF (an error page, a
 * JSON body behind a proxy) is refused rather than saved as `quotation.pdf`.
 */
export async function downloadSalesQuotationPdf(id, fileName = "quotation.pdf") {
  const token = getAccessToken();
  const response = await fetch(`${API_URL}/api/sales/quotations/${id}/pdf`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || "Unable to download the quotation PDF.");
  }
  if (!String(response.headers.get("content-type") || "").includes("application/pdf")) {
    throw new Error("The quotation PDF could not be prepared. Try again in a moment.");
  }
  const url = URL.createObjectURL(new Blob([await response.arrayBuffer()], { type: "application/pdf" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function deleteSalesQuotation(id) {
  return apiRequest(`/api/sales/quotations/${id}`, { method: "DELETE" });
}

export function getSalesSourceBranches() {
  return apiRequest("/api/sales/source-branches");
}

export function createSalesProject(payload) {
  return apiRequest("/api/sales/projects", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// `draft`: Save Draft on a sent-back project - saved, and left under Bookings & Converted's Sent Back.
export function updateSalesProject(id, payload, { draft = false } = {}) {
  return apiRequest(`/api/sales/projects/${id}${draft ? "?draft=true" : ""}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

/** Send a project back from Projects to Bookings & Converted, to be corrected there. */
export function sendBackSalesProject(id) {
  return apiRequest(`/api/sales/projects/${id}/send-back`, { method: "POST" });
}

/** Update to Project with nothing changed: a sent-back project returned to Projects → Yet to Start. */
export function returnSalesProjectToProjects(id) {
  return apiRequest(`/api/sales/projects/${id}/return-to-projects`, { method: "POST" });
}

export function deleteSalesProject(id) {
  return apiRequest(`/api/sales/projects/${id}`, { method: "DELETE" });
}

export function saveProjectDraft(id, payload) {
  return apiRequest(`/api/sales/projects/${id}/start-project-draft`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function startProject(id, payload) {
  return apiRequest(`/api/sales/projects/${id}/start-project`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

/**
 * The advance a project is booked with.
 *
 * Its own endpoint rather than `POST /api/accounts/cash-entries`, because it answers to a different
 * question: not "may this person keep the studio's books" but "may this person book a project". It
 * writes the same cash entry, through the Accounts module's own recorder, under
 * `SALES / Sales Manager` - see `recordProjectAdvance` on the server for what keeps it narrow.
 */
export function recordProjectAdvance(projectId, payload) {
  return apiRequest(`/api/sales/projects/${encodeURIComponent(projectId)}/advance`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** The client login a mobile number already has - `{ username, active }` - or `null` (a new client). */
export function getClientLoginByNumber(number) {
  return apiRequest(`/api/sales/client-logins/by-number?number=${encodeURIComponent(number)}`);
}

/** A project's client login - `{ username, active, shared }`, or `null`. `shared`: the client's login from an earlier event. Never the password. */
export function getClientLogin(projectId) {
  return apiRequest(`/api/sales/projects/${encodeURIComponent(projectId)}/client-login`);
}

/** Makes a client login for a project booked without one: `{ username, temporaryPassword }`. */
export function createClientLogin(projectId, clientLogin) {
  return apiRequest(`/api/sales/projects/${encodeURIComponent(projectId)}/client-login`, {
    method: "POST",
    body: JSON.stringify({ clientLogin }),
  });
}

/**
 * Sends the client their login on WhatsApp, from the sender's own WhatsApp. Only the message is
 * sent: the server reads the number off the project, so this reaches that project's client alone.
 */
export function sendClientLoginWhatsApp(projectId, message) {
  return apiRequest(`/api/sales/projects/${encodeURIComponent(projectId)}/client-login/whatsapp`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

/**
 * Who the booking advance can be credited to, and which studio account it landed in.
 *
 * Its own endpoint rather than the Accounts one, which is behind `ACCOUNTS / Cash Management` - the
 * permission the person booking a project deliberately does not need. Narrower than that one too:
 * no projects and no shoots, because the advance is filed against the project being created.
 */
export function getProjectAdvanceOptions() {
  return apiRequest("/api/sales/projects/advance-options");
}

/** One Project Status on every ticked project (Projects → Update status); Delivered also finishes their shoots' production. */
export function bulkUpdateProjectStatus(ids, status) {
  return apiRequest("/api/sales/projects/bulk-status", { method: "POST", body: JSON.stringify({ ids, status }) });
}
