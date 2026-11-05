import { API_URL } from "@/services/api/client";

// A guest has no account: the token in the link is what opens the invitation, so this is a plain
// `fetch` with no Authorization header (as the public quotation and CRD services do).
export async function getPublicInvitation(token, key = "") {
  const response = await fetch(`${API_URL}/api/public/invitations/${encodeURIComponent(token)}${key ? `?k=${encodeURIComponent(key)}` : ""}`, { cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.message || "This invitation could not be opened.");
    error.status = response.status;
    throw error;
  }
  return data?.data || null;
}
