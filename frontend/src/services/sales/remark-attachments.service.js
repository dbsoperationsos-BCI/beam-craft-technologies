import { API_URL, apiRequest } from "@/services/api/client";
import { getAccessToken } from "@/lib/auth";

/**
 * Files attached to a remark.
 *
 * They used to be read with `readAsDataURL` and carried as base64 inside the lead itself, so a
 * photo on a note travelled with that lead on every read - the table, the info panel, the popup,
 * and every backup besides. Now the file is uploaded once, filed in R2 under the client it
 * belongs to, and the remark keeps only a key.
 */

/**
 * Uploads one file and returns what the remark should hold.
 *
 * The lead id is optional: Add Lead can attach a file before the lead exists, and the server
 * files those separately rather than refusing them. Sent as multipart, so the browser sets the
 * boundary - naming a Content-Type here would break the upload.
 */
export function uploadRemarkAttachment(file, enquiryId = "") {
  const form = new FormData();
  form.append("file", file);
  if (enquiryId) form.append("enquiryId", enquiryId);
  return apiRequest("/api/sales/crm-leads/remark-attachments", { method: "POST", body: form });
}

/**
 * The bytes behind a stored key, as something an <img>, <audio> or <video> can use.
 *
 * The endpoint is behind the same login as everything else, and a bare `src` sends no token - so
 * the file is fetched with one and handed to the tag as a blob. That is also what keeps the
 * bucket private: there is no public URL to a client's attachment, only this request.
 */
export async function fetchRemarkAttachment(key) {
  const token = getAccessToken();
  const response = await fetch(
    `${API_URL}/api/sales/crm-leads/remark-attachments?key=${encodeURIComponent(key)}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
  if (!response.ok) throw new Error("This attachment is no longer stored.");
  return URL.createObjectURL(await response.blob());
}
