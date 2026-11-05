import PublicQuotationTermsPage from "@/components/sales/PublicQuotationTermsPage";

/** The Terms & Conditions the quotation at `/q/<token>` links to, on the same sheet. */
export default async function QuotationTermsRoute({ params }) {
  const { token } = await params;
  return <PublicQuotationTermsPage token={token} />;
}
