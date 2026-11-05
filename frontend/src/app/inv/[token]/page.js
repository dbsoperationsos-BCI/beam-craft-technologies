import InvitationExperience from "@/components/invitations/InvitationExperience";
import { serverStudioBranding, studioAppName } from "@/lib/serverStudioBranding";
import { invitationFontVariables } from "../invitationFonts";

// The same address `services/api/client.js` reads, without importing the browser's request helper.
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001";

/** The invitation, read on the server for the link preview a chat app draws. Null when it cannot be read. */
async function readInvitation(token, key = "") {
  try {
    const response = await fetch(`${API_URL}/api/public/invitations/${encodeURIComponent(token)}${key ? `?k=${encodeURIComponent(key)}` : ""}`, { cache: "no-store", signal: AbortSignal.timeout(2500) });
    if (!response.ok) return null;
    return (await response.json())?.data || null;
  } catch {
    return null;
  }
}

export const viewport = { width: "device-width", initialScale: 1, themeColor: "#1b1410" };

// What WhatsApp shows when the link is shared: the names, the occasion and the design's picture.
// Next 16: `params` is a Promise.
export async function generateMetadata({ params }) {
  const { token } = await params;
  const invitation = await readInvitation(token);
  const names = invitation?.content?.names || invitation?.names || "You're invited";
  const title = invitation ? `${names} · ${invitation.shootName} invitation` : "Invitation";
  const description = invitation?.content?.heading || "Tap to open the invitation.";
  const image = invitation?.photoUrl || invitation?.coverUrl;
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, type: "website", ...(image ? { images: [{ url: image }] } : {}) },
  };
}

// A client's invitation as their guests open it: outside the (app) group - no shell, no sign-in; the
// token in the link names it.
// `?still=1` is the invitation's front, nothing moving: what the Download picture is photographed from.
export default async function InvitationRoute({ params, searchParams }) {
  const { token } = await params;
  const query = await searchParams;
  const still = query?.still === "1";
  // `?record=1`: played for the Download video - the recorder, not a timer, says when the doors are open.
  const recording = query?.record === "1";
  // A preview key: the client's own Preview (and the server's drawing for Download) of an invitation
  // not yet paid for - see `previewKeyFor` on the server.
  const key = typeof query?.k === "string" ? query.k.slice(0, 80) : "";
  const [invitation, branding] = await Promise.all([readInvitation(token, key), serverStudioBranding()]);
  return <div className={invitationFontVariables}>
    <InvitationExperience token={token} previewKey={key} initial={invitation} studioName={studioAppName(branding) || ""} still={still} recording={recording} />
  </div>;
}
