import PublicClientOnboardingForm from "@/components/subscribe/PublicClientOnboardingForm";

export default async function PublicClientOnboardingPage({ params }) {
  const { token } = await params;
  return <PublicClientOnboardingForm token={token} />;
}
