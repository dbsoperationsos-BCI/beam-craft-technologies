import { redirect } from "next/navigation";

// Settings is no longer a page of its own: it opens over Galleries, from the ⋮ beside New Gallery.
// An old link or bookmark lands there with the dialog open.
export default function PhotoSellingSettingsRoute() {
  redirect("/visual-curation/ai/photo-selling/galleries?photoSettings=1");
}
