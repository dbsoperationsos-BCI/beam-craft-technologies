import AiEventWorkspacePage from "@/components/ai-feature/event/AiEventWorkspacePage";

// Next 16: `params` is a Promise.
export default async function AiFeatureEventRoute({ params }) {
  const { eventId } = await params;
  return <AiEventWorkspacePage eventId={eventId} />;
}
