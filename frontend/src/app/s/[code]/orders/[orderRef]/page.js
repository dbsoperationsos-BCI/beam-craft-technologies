import StoreOrderPage from "@/components/photo-selling/store/StoreOrderPage";

export const metadata = { title: "Your Order | DBS", robots: { index: false, follow: false } };

// Where Cashfree returns a buyer, and the page they keep for their downloads. Next 16: `params` is a Promise.
export default async function PhotoStoreOrderRoute({ params }) {
  const { code, orderRef } = await params;
  return <StoreOrderPage code={code} orderRef={orderRef} />;
}
