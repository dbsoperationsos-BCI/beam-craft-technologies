import MarketingHomePage from "@/components/marketing/MarketingHomePage";

export const metadata = {
  title: "BeamCraft — Crafting Intelligence into Software",
  description: "BeamCraft builds customized next-gen applications for CEOs and Operations Directors. Usage-based pricing, free trial, and enterprise demos.",
};

/**
 * The public home page. It used to redirect straight to `/employees`; now visitors land here and
 * reach the application through Sign in, which opens `/login`. A signed-in visitor who clicks Sign in
 * is sent on to their default screen by the login form itself.
 */
export default function Home() {
  return <MarketingHomePage />;
}
