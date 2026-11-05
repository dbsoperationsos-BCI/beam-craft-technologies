import { Suspense } from "react";
import AiEventsPage from "@/components/ai-feature/events/AiEventsPage";

// useSearchParams inside the list makes it client-rendered, so the page keeps a Suspense boundary
// around it as Next.js requires.
export default function AiFeatureEventsRoute() {
  return <Suspense fallback={null}><AiEventsPage /></Suspense>;
}
