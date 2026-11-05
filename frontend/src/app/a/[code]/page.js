import ClientSignatureAlbum from "@/components/image-selection/signature-album/client/ClientSignatureAlbum";

export const metadata = { title: "Signature Album", robots: { index: false, follow: false } };

// The client's Signature Album - /a/X7K9P2 locally, the album host in production, where Nginx
// rewrites the bare code onto this route the way the selection gallery's /g does. Outside the app
// shell: no login, the PIN opens it.
export default async function SignatureAlbumPage({ params }) {
  const { code } = await params;
  return <ClientSignatureAlbum code={code} />;
}
