import { Suspense } from "react";
import GalleriesPage from "@/components/photo-selling/galleries/GalleriesPage";

// useSearchParams (`?create=1`) makes the list client-rendered, so it keeps a Suspense boundary.
export default function PhotoSellingGalleriesRoute() {
  return <Suspense fallback={null}><GalleriesPage /></Suspense>;
}
