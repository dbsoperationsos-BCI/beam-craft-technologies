import { Suspense } from "react";
import GalleryWorkspacePage from "@/components/photo-selling/gallery/GalleryWorkspacePage";

// Next 16: `params` is a Promise. useSearchParams (`?step=`) in the workspace keeps a Suspense boundary.
export default async function PhotoSellingGalleryRoute({ params }) {
  const { galleryId } = await params;
  return <Suspense fallback={null}><GalleryWorkspacePage galleryId={galleryId} /></Suspense>;
}
