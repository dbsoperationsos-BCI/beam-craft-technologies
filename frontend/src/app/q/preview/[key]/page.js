import QuotationPreviewPage from "@/components/sales/QuotationPreviewPage";

// Never indexed and never shared: it is a studio member's own look at a quotation not yet sent.
export const metadata = { title: "Quotation Preview | DBS", robots: { index: false, follow: false } };

export default async function QuotationPreviewRoute({ params }) {
  const { key } = await params;
  return <QuotationPreviewPage previewKey={key} />;
}
