import { API_URL, apiRequest } from "@/services/api/client";
import { getAccessToken } from "@/lib/auth";

export function getSalesProjects() {
  return apiRequest("/api/sales/projects");
}

export function searchSalesEnquiries(search = "") {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  return apiRequest(`/api/sales/enquiries${params.toString() ? `?${params.toString()}` : ""}`);
}

export function getSalesQuotations({ enquiryId } = {}) {
  const params = new URLSearchParams();
  if (enquiryId) params.set("enquiryId", enquiryId);
  return apiRequest(`/api/sales/quotations${params.toString() ? `?${params.toString()}` : ""}`);
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
 * Copies one version onto another enquiry, as that enquiry's next version. The version copied from
 * is untouched, and the copy gets a link and a five-day clock of its own.
 */
export function duplicateSalesQuotation(id, enquiryId) {
  return apiRequest(`/api/sales/quotations/${id}/duplicate`, {
    method: "POST",
    body: JSON.stringify({ enquiryId }),
  });
}

/** Re-enables one version's public link for another five days. Same URL, fresh clock. */
export function renewSalesQuotationLink(id) {
  return apiRequest(`/api/sales/quotations/${id}/link`, { method: "POST" });
}

/**
 * The studio's own copy of one version as a PDF.
 *
 * Not the client's link: that one now answers to the brand's Allow Client Download, and a brand
 * that hands its clients no copy must still hand one to the person selling. This route is behind
 * the login, and a bare `href` sends no token, so the file is fetched with one and saved from the
 * bytes. The object URL is released as soon as the click has been made - the browser has the file
 * by then, and holding it keeps the whole PDF in memory for the life of the tab.
 */
export async function downloadSalesQuotationPdf(id, fileName = "quotation.pdf") {
  const token = getAccessToken();
  const response = await fetch(`${API_URL}/api/sales/quotations/${id}/pdf`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || "Unable to download the quotation PDF.");
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
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

export function updateSalesProject(id, payload) {
  return apiRequest(`/api/sales/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
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
