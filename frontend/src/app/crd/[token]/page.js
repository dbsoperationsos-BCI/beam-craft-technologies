import PublicCrdDocumentForm from "@/components/sales/PublicCrdDocumentForm";

export const metadata = { title: "CRD Document | DBS", robots: { index: false, follow: false } };

export default async function CrdDocumentPublicRoute({ params }) {
  const { token } = await params;
  return <PublicCrdDocumentForm token={token} />;
}
