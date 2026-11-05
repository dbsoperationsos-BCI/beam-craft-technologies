import PublicInvoicePage from "@/components/accounts/PublicInvoicePage";
import { clientShareMetadata } from "@/lib/shareMetadata.mjs";
import { requestOrigin } from "@/lib/requestOrigin";
import { serverStudioBranding } from "@/lib/serverStudioBranding";

// What WhatsApp shows when the link is shared: the studio's name and logo, never the payment - and
// never indexed, since the token in the address is the whole of the secrecy (see `lib/shareMetadata.mjs`).
export async function generateMetadata({ params }) {
  const { token } = await params;
  // The address is the credential, so it is never sent on to the host the studio's logo is kept on.
  return clientShareMetadata({ page: "Invoice", description: "Your payment receipt and invoice.", branding: await serverStudioBranding(), origin: await requestOrigin(), path: `/i/${encodeURIComponent(token)}`, referrer: "no-referrer" });
}

// A person is sent straight to the PDF before this renders (`src/proxy.js`); this page is what a link
// preview reads, and what a dead link comes back to (`?unavailable=1`, from the PDF route).
export default async function InvoicePublicRoute({ params, searchParams }) {
  const { token } = await params;
  const { unavailable } = await searchParams;
  return <PublicInvoicePage token={token} unavailable={Boolean(unavailable)} />;
}
