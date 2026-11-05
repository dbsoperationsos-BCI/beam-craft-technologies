import PublicQuotationPage from "@/components/sales/PublicQuotationPage";

export default async function QuotationPublicRoute({ params }) {
  const { token } = await params;
  return <PublicQuotationPage token={token} />;
}
