import PublicQuotationPaymentPage from "@/components/sales/PublicQuotationPaymentPage";
import { clientShareMetadata } from "@/lib/shareMetadata.mjs";
import { requestOrigin } from "@/lib/requestOrigin";
import { serverStudioBranding } from "@/lib/serverStudioBranding";

// What WhatsApp and the like show when the link is shared: the studio's name and logo from Settings →
// Branding, read on the server so a crawler gets them in the first response, and the description,
// overriding the root layout's "HRM Foundation" - see `lib/shareMetadata.mjs`. Nothing about the
// quotation itself goes in, and it is still never indexed: the token in the URL is the whole of the
// secrecy here, and a link that reaches a crawler would otherwise be searchable by anybody.
export async function generateMetadata({ params }) {
  const { token } = await params;
  return clientShareMetadata({ page: "Payment Details", branding: await serverStudioBranding(), origin: await requestOrigin(), path: `/q/${encodeURIComponent(token)}/payment` });
}

/** Where to pay the quotation at `/q/<token>`, on the same sheet - opened from its **For Payment** link. */
export default async function QuotationPaymentRoute({ params }) {
  const { token } = await params;
  return <PublicQuotationPaymentPage token={token} />;
}
