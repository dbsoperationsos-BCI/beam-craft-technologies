import { API_URL } from "@/services/api/client";
import { getAccessToken } from "@/lib/auth";

/**
 * Downloads a PDF the API prints, and saves it under `fileName`.
 *
 * Fetched with the session's token, since a plain link carries none, and saved through a blob link.
 * A refusal comes back as the server's own message (`fallback` where it gave none), and an answer
 * that is not a PDF is said so rather than saved as a broken file. `body`, when given, is sent as
 * JSON with a POST - for a PDF printed from what the reader typed.
 */
export async function downloadPdf(path, fileName, { fallback = "Unable to download the PDF.", body } = {}) {
  const token = getAccessToken();
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) };
  const response = await fetch(`${API_URL}${path}`, body !== undefined
    ? { method: "POST", headers, body: JSON.stringify(body) }
    : { headers });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || fallback);
  }
  if (!String(response.headers.get("content-type") || "").includes("application/pdf")) {
    throw new Error("The PDF could not be prepared. Try again in a moment.");
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
