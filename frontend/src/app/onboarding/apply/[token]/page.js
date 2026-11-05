import PublicOnboardingForm from "@/components/onboarding/PublicOnboardingForm";

export default async function PublicOnboardingPage({ params }) {
  const { token } = await params;
  return <PublicOnboardingForm token={token} />;
}
