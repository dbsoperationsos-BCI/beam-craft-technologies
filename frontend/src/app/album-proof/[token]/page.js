import ClientProofExperience from "@/components/image-selection/album-proofing/client/ClientProofExperience";

// The public album proof page: outside the (app) route group, so no shell and no login — the
// secure token in the URL names the proof and the PIN gate does the rest.
export default async function AlbumProofPage({ params }) {
  const { token } = await params;
  return <ClientProofExperience token={token} />;
}
