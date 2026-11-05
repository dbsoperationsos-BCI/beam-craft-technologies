import PublicOffboardingForm from "@/components/offboarding/PublicOffboardingForm";

// Never indexed. The code in the URL is the whole of the secrecy here, and a link that reaches a
// crawler - forwarded, pasted into a chat that previews it, opened in a browser that syncs history -
// would otherwise be searchable by anybody. The same line every other public token page carries.
export const metadata = { title: "Offboarding | DBS", robots: { index: false, follow: false } };

export default async function PublicOffboardingPage({ params }) {
  const { token } = await params;
  return <PublicOffboardingForm token={token} />;
}
