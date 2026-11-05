import { Suspense } from "react";
import OrdersPage from "@/components/photo-selling/orders/OrdersPage";

// useSearchParams (`?status=`, `?order=`) makes the list client-rendered, so it keeps a Suspense boundary.
export default function PhotoSellingOrdersRoute() {
  return <Suspense fallback={null}><OrdersPage /></Suspense>;
}
