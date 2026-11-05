import { PageLoader } from "@/components/shared/Loader";

/**
 * Shown inside the app shell while a route in this group is being loaded, so moving between modules
 * lands on the spinner rather than on the previous page frozen mid-navigation.
 */
export default function ApplicationLoading() {
  return <PageLoader />;
}
