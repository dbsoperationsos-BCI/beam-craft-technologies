import StoreExperience from "@/components/photo-selling/store/StoreExperience";

export const metadata = { title: "Photo Gallery | DBS", robots: { index: false, follow: false } };

// A Photo Selling store, outside the (app) group: no shell, no sign-in, the link's code names the
// gallery. Next 16: `params` is a Promise.
export default async function PhotoStoreRoute({ params }) {
  const { code } = await params;
  return <StoreExperience code={code} />;
}
