import GuestEventExperience from "@/components/ai-feature/guest/GuestEventExperience";

export const metadata = { title: "Event Gallery | DBS", robots: { index: false, follow: false } };

// The guest's page for an AI event, outside the (app) group: no shell, no sign-in, the link's code
// names the event. Next 16: `params` is a Promise.
export default async function GuestEventRoute({ params }) {
  const { code } = await params;
  return <GuestEventExperience code={code} />;
}
