import PublicOnboardingForm from "@/components/onboarding/PublicOnboardingForm";

// Never indexed. The token in the URL is the whole of the secrecy here, and a link that reaches
// a crawler - forwarded, pasted into a chat that previews it, opened in a browser that syncs
// history - would otherwise be searchable by anybody. The same line every other public
// token page in this tree carries.
export const metadata = { title: "Onboarding | DBS", robots: { index: false, follow: false } };

export default async function PublicOnboardingPage({ params }) {
  const { token } = await params;
  return <PublicOnboardingForm token={token} />;
}
