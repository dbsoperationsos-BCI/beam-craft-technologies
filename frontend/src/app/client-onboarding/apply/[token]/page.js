import PublicClientOnboardingForm from "@/components/subscribe/PublicClientOnboardingForm";

// Never indexed: the code in the link is the whole of its secrecy, as on every public token page.
export const metadata = { title: "Client Onboarding | Beam Craft", robots: { index: false, follow: false } };

export default async function PublicClientOnboardingPage({ params }) {
  const { token } = await params;
  return <PublicClientOnboardingForm token={token} />;
}
