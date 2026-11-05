import ClientProofExperience from "@/components/image-selection/album-proofing/client/ClientProofExperience";

// Never indexed. The token in the URL is the whole of the secrecy here, and a link that reaches
// a crawler - forwarded, pasted into a chat that previews it, opened in a browser that syncs
// history - would otherwise be searchable by anybody. The same line every other public
// token page in this tree carries.
export const metadata = { title: "Album Proof | DBS", robots: { index: false, follow: false } };

// The public album proof page: outside the (app) route group, so no shell and no login — the
// secure token in the URL names the proof and the PIN gate does the rest.
export default async function AlbumProofPage({ params }) {
  const { token } = await params;
  return <ClientProofExperience token={token} />;
}
