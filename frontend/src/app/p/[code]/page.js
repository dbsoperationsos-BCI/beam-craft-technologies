import ClientProofExperience from "@/components/image-selection/album-proofing/client/ClientProofExperience";

export const metadata = { title: "Album Proof | DBS", robots: { index: false, follow: false } };

// The short album proof URL — /p/AB7KX2. The code is only the public identifier: the backend
// resolves it through exactly the same publication, PIN and expiry checks as the long token, so
// this page shares every screen and every rule with /album-proof/[token], which stays because
// links already with a client were shared in that spelling.
export default async function ShortCodeAlbumProofPage({ params }) {
  const { code } = await params;
  return <ClientProofExperience token={code} />;
}
