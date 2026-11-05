import PublicGallery from "@/components/image-selection/PublicGallery";

export const metadata = { title: "Client Gallery | DBS", robots: { index: false, follow: false } };

export default async function PublishedGalleryPage({ params }) {
  const { token } = await params;
  return <PublicGallery token={token} />;
}
