import { redirect } from "next/navigation";

// The module has no page at its root: the sidebar lands on the overview, and a bookmark of the bare
// prefix goes there too.
export default function AiFeatureRootRoute() {
  redirect("/visual-curation/ai/overview");
}
