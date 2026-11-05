import PublicGallery from "@/components/image-selection/PublicGallery";

export const metadata = { title: "Client Gallery | DBS", robots: { index: false, follow: false } };

// The short client URL — /g/A7K9 locally, gallery.dontblinkstudioz.com/A7K9 in production (Nginx
// rewrites the bare code onto this route). The code is just the public identifier: PublicGallery
// sends it where it used to send the long token, and the backend resolves either one through the
// same publish/PIN/expiry checks, so this page shares every screen and rule with /gallery/[token].
export default async function ShortCodeGalleryPage({ params }) {
  const { code } = await params;
  return <PublicGallery token={code} />;
}
