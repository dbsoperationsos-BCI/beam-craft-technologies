"use client";

import GalleryAccessCard from "./GalleryAccessCard";
import GalleryBrand from "./GalleryBrand";
import GalleryHeader from "./GalleryHeader";
import GallerySteps from "./GallerySteps";
import ImageCountBadge from "./ImageCountBadge";
import { getGalleryDisplayName } from "@/lib/getGalleryDisplayName";

export default function ClientGalleryWelcome({ gallery, onVerify, onViewPhotos }) {
  return <main className="min-h-dvh bg-[#f4f7fb] px-4 py-12 sm:px-6 sm:py-16 lg:py-18"><div className="mx-auto w-full max-w-[1024px]"><GalleryHeader displayName={getGalleryDisplayName(gallery)} /><div className="mt-8 text-center"><ImageCountBadge count={gallery?.imageCount} /></div><div className="mx-auto max-w-[504px]"><GalleryAccessCard onVerify={onVerify} onViewPhotos={onViewPhotos} /></div><GallerySteps /><GalleryBrand studioName={gallery?.studioName} logoUrl={gallery?.galleryLogoUrl} /></div></main>;
}
