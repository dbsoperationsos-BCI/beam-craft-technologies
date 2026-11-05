"use client";

import { useRouter, useSearchParams } from "next/navigation";
import PhotoSellingNavigation, { PHOTO_SELLING_ROOT } from "../PhotoSellingNavigation";
import OrdersTable from "./OrdersTable";

/**
 * Photo Selling → Orders: every store's orders. `?status=` opens it filtered (the overview's
 * "Failed payments" lands here) and `?order=` opens one order's panel.
 */
const STATUSES = new Set(["PAID", "PENDING", "FAILED"]);

export default function OrdersPage() {
  const params = useSearchParams();
  const router = useRouter();
  const status = STATUSES.has(params.get("status")) ? params.get("status") : "";
  const orderId = params.get("order");
  return <section className="flex min-h-0 flex-1 flex-col bg-white">
    <PhotoSellingNavigation />
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
      <OrdersTable initialStatus={status} initialOrderId={orderId} onOrderClosed={() => { if (orderId) router.replace(`${PHOTO_SELLING_ROOT}/orders${status ? `?status=${status}` : ""}`); }} />
    </div>
  </section>;
}
