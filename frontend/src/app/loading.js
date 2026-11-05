import { PageLoader } from "@/components/shared/Loader";

/** The fallback for routes outside the app shell — login, onboarding and the entry redirect. */
export default function RootLoading() {
  return <PageLoader />;
}
