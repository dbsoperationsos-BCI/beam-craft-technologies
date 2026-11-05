import PublicCrdDocumentResponse from "@/components/sales/PublicCrdDocumentResponse";

export const metadata = { title: "CRD Response | DBS", robots: { index: false, follow: false } };

export default async function CrdDocumentResponsePublicRoute({ params }) {
  const { token } = await params;
  return <PublicCrdDocumentResponse token={token} />;
}
