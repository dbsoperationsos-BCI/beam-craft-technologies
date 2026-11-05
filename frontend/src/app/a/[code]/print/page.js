import SignatureAlbumPrint from "@/components/image-selection/signature-album/client/SignatureAlbumPrint";

export const metadata = { title: "Signature Album", robots: { index: false, follow: false } };

// The album as Download Album's PDF prints it. Opened by the server's headless browser only, with
// a short-lived album session in the URL's fragment; without one it shows nothing of the album.
export default async function SignatureAlbumPrintPage({ params }) {
  const { code } = await params;
  return <SignatureAlbumPrint code={code} />;
}
