"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouteAccess } from "@/components/auth/PermissionsProvider";
import Button from "@/components/shared/Button";
import DashboardRangeBar from "@/components/shared/DashboardRangeBar";
import DashboardCard, { CardState, EmptyDashboard } from "@/components/shared/DashboardCard";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import StatTile from "@/components/ai-feature/shared/StatTile";
import SimpleTable from "@/components/data-table/SimpleTable";
import { formatMoney, PAYMENT_STATUS_LABELS } from "@/lib/photoSelling.mjs";
import { getPhotoSellingOverview } from "@/services/photo-selling/photo-selling.service";
import PhotoSellingNavigation, { PHOTO_SELLING_ROOT } from "../PhotoSellingNavigation";

/**
 * Photo Selling → Overview: what the stores have sold, from GET /api/photo-selling/overview and
 * nothing else. Gross and net are shown side by side and named for what they are; the conversion
 * rate appears only once there are enough store visits for it to mean something. Nothing here is
 * estimated or filled in.
 */
// The API's own ranges, named in the AI Feature dashboards' style so they fit the shared range box.
const RANGES = [{ value: "7d", label: "7 Days" }, { value: "30d", label: "30 Days" }, { value: "90d", label: "90 Days" }, { value: "all", label: "Lifetime" }];
const dateTime = (value) => (value ? new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");

export default function PhotoSellingOverviewPage() {
  const router = useRouter();
  const { canWrite } = useRouteAccess();
  const { notice, showError, clearNotice } = useNotice();
  const [range, setRange] = useState("30d");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const hasData = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getPhotoSellingOverview({ range });
      setData(response.data);
      hasData.current = true;
      setError("");
    } catch (caught) {
      if (hasData.current) showError(caught.message || "Unable to refresh the overview."); else setError(caught.message || "Unable to load the overview.");
    } finally {
      setLoading(false);
    }
  }, [range, showError]);

  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  const openOrder = (id) => router.push(`${PHOTO_SELLING_ROOT}/orders?order=${encodeURIComponent(id)}`);
  const currency = "INR";
  const empty = data && data.liveGalleries === 0 && data.paidOrders === 0 && data.recentOrders.length === 0;

  return <section className="flex min-h-0 flex-1 flex-col bg-white">
    <PhotoSellingNavigation actions={canWrite && <Button type="button" variant="primary" size="sm" onClick={() => router.push(`${PHOTO_SELLING_ROOT}/galleries?create=1`)}>+ New Gallery</Button>} />
    <FloatingNotice notice={notice} onClose={clearNotice} />
    <div className="dashboard-canvas min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
      {error && !data
        ? <CardState error={error} onRetry={load} />
        : <div className="flex flex-col gap-3">
          {empty && !loading
            ? <EmptyDashboard title="Nothing on sale yet" message={canWrite ? "Create a gallery, upload its photos, set a price and publish it - sales appear here as they come in." : "Sales appear here once a gallery is published."} action={canWrite && <Button type="button" variant="primary" size="sm" className="mt-4" onClick={() => router.push(`${PHOTO_SELLING_ROOT}/galleries?create=1`)}>+ New Gallery</Button>} />
            : <>
              <DashboardRangeBar caption="Sales figures cover the range you pick; galleries and photos are as they stand now." range={range} onRangeChange={setRange} options={RANGES} />
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-5">
                <StatTile label="Gross sales" value={loading && !data ? "…" : formatMoney(data?.grossPaise ?? 0, currency)} note="What buyers paid, tax included" raw />
                <StatTile label="Net sales" value={loading && !data ? "…" : formatMoney(data?.netPaise ?? 0, currency)} note="Gross less tax, before refunds" raw />
                <StatTile label="Paid orders" value={data?.paidOrders ?? "…"} />
                <StatTile label="Average order" value={loading && !data ? "…" : formatMoney(data?.averageOrderPaise ?? 0, currency)} raw />
                <StatTile label="Conversion" value={data?.conversion ? `${(data.conversion.rate * 100).toFixed(1)}%` : "—"} note={data?.conversion ? `${data.conversion.paidOrders} paid of ${data.conversion.visits} visits` : "Shown after 20 store visits"} raw />
                <StatTile label="Live galleries" value={data?.liveGalleries ?? "…"} />
                <StatTile label="Photos on sale" value={data?.publishedPhotos ?? "…"} />
                <StatTile label="Selfie searches" value={data?.searches ?? "…"} note={data ? `${data.completedSearches} found photos` : undefined} />
                <StatTile label="Failed payments" value={data?.failedPayments ?? "…"} tone={data?.failedPayments ? "text-red-700" : undefined} onClick={data?.failedPayments ? () => router.push(`${PHOTO_SELLING_ROOT}/orders?status=FAILED`) : undefined} />
                <StatTile label="Paid, can't download" value={data?.undeliverable ?? "…"} note="Bought photos whose original is missing" tone={data?.undeliverable ? "text-red-700" : undefined} onClick={data?.undeliverable ? () => router.push(`${PHOTO_SELLING_ROOT}/orders?status=PAID`) : undefined} />
              </div>
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <DashboardCard title="Recent paid orders" bodyClassName="p-0">
                  <SimpleTable
                    variant="plain"
                    ariaLabel="Recent paid orders"
                    loading={loading && !data}
                    rows={data?.recentOrders || []}
                    emptyMessage="No paid orders yet."
                    rowProps={(row) => ({ onClick: () => openOrder(row.id), className: "cursor-pointer hover:bg-slate-50" })}
                    columns={[
                      { key: "orderRef", label: "Order", render: (row) => <span className="font-medium text-slate-900">{row.orderRef}</span> },
                      { key: "buyerName", label: "Buyer" },
                      { key: "gallery", label: "Gallery", render: (row) => row.gallery?.title || "—", cellClassName: "hidden md:table-cell", headerClassName: "hidden md:table-cell" },
                      { key: "itemCount", label: "Photos", cellClassName: "hidden sm:table-cell", headerClassName: "hidden sm:table-cell" },
                      { key: "totalPaise", label: "Total", render: (row) => formatMoney(row.totalPaise, row.currency) },
                      { key: "paidAt", label: "Paid", render: (row) => dateTime(row.paidAt), cellClassName: "hidden sm:table-cell", headerClassName: "hidden sm:table-cell" },
                    ]}
                  />
                </DashboardCard>
                <DashboardCard title="Payments needing a look" bodyClassName="p-0">
                  <SimpleTable
                    variant="plain"
                    ariaLabel="Failed payments"
                    loading={loading && !data}
                    rows={data?.recentFailures || []}
                    rowKey={(row) => row.paymentId}
                    emptyMessage="No failed payments."
                    rowProps={(row) => ({ onClick: () => openOrder(row.order.id), className: "cursor-pointer hover:bg-slate-50" })}
                    columns={[
                      { key: "order", label: "Order", render: (row) => <span className="font-medium text-slate-900">{row.order.orderRef}</span> },
                      { key: "status", label: "Status", render: (row) => PAYMENT_STATUS_LABELS[row.status] || row.status },
                      { key: "when", label: "When", render: (row) => dateTime(row.createdAt) },
                    ]}
                  />
                </DashboardCard>
              </div>
            </>}
        </div>}
    </div>
  </section>;
}
