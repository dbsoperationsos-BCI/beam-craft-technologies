import { redirect } from "next/navigation";

// The module opens on its Dashboard, as Photo Selection does; Projects is one switch away.
export default function AiCullingRoute() {
  redirect("/image-selection/ai-culling/dashboard");
}
