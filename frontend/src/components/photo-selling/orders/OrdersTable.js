"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import Tabs from "@/components/ui/Tabs";
import { CardState } from "@/components/shared/DashboardCard";
import DataTable from "@/components/data-table/DataTable";
import DataTableShell from "@/components/data-table/DataTableShell";
import TableFooter from "@/components/data-table/TableFooter";
import { formatMoney, ORDER_STATUS_LABELS, ORDER_STATUS_TONES } from "@/lib/photoSelling.mjs";
import { listSaleOrders } from "@/services/photo-selling/photo-selling.service";
import SaleStatusChip from "../shared/SaleStatusChip";
import OrderDetailDialog from "./OrderDetailDialog";

/**
 * The orders list, for every store (Orders) or one (a gallery's Orders tab), on the application's
 * own table (`DataTable`, as Projects and the Image Selection dashboard): its header, filter row under
 * the headings, sorting, Table Options (columns, compact view, CSV) and loading and empty states. A
 * row opens the order. Read-only by itself - what the panel lets somebody do is the panel's, gated by
 * its own `canWrite`.
 *
 * The server still decides which orders there are: the status tabs - each with its count for the range
 * picked - and the range of when they were placed (rolling: the last 7 or 30 days, 3 or 6 months, or
 * all) ask it, and it answers fifty at a time - the footer's Previous / Next
 * and "Page x of y" are its pages, so no count is made up here. The table's own filter row and sorting
 * work on the page that is showing.
 */
const STATUSES = [
  { id: "", label: "All orders" },
  { id: "PAID", label: "Paid" },
  { id: "PENDING", label: "Awaiting payment" },
  { id: "FAILED", label: "Payment failed" },
];
const RANGES = [
  { value: "all", label: "Lifetime" },
  { value: "7d", label: "This week" },
  { value: "30d", label: "This month" },
  { value: "3m", label: "3 months" },
  { value: "6m", label: "6 months" },
];
const dateTime = (value) => (value ? new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const statusLabel = (row) => ORDER_STATUS_LABELS[row.status] || row.status;

export default function OrdersTable({ galleryId, compact = false, initialStatus = "", initialOrderId = null, onOrderClosed }) {
  const [status, setStatus] = useState(initialStatus);
  const [range, setRange] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState(initialOrderId);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await listSaleOrders({ galleryId, status: status || undefined, page, ...(range !== "all" ? { range } : {}) });
      setData(response.data);
      setError("");
    } catch (caught) {
      setError(caught.message || "Unable to load orders.");
    } finally {
      setLoading(false);
    }
  }, [galleryId, status, page, range]);

  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const close = () => { setOpenId(null); onOrderClosed?.(); };

  const columns = useMemo(() => [
    { id: "order", header: "Order", accessorFn: (row) => row.orderRef, width: 170, cell: ({ row }) => <span className="font-medium text-slate-900">{row.original.orderRef}</span> },
    { id: "buyer", header: "Buyer", accessorFn: (row) => `${row.buyerName || ""} ${row.buyerPhone || ""}`, width: 190, cell: ({ row }) => <span className="flex min-w-0 flex-col"><span className="truncate">{row.original.buyerName}</span><span className="truncate text-xs text-slate-500">{row.original.buyerPhone}</span></span> },
    // A gallery's own Orders tab is that gallery's, so it has no Gallery column.
    ...(compact ? [] : [{ id: "gallery", header: "Gallery", accessorFn: (row) => row.gallery?.title || "", width: 180, cell: ({ row }) => row.original.gallery ? `${row.original.gallery.title}${row.original.gallery.deleted ? " (deleted)" : ""}` : "—" }]),
    { id: "status", header: "Status", accessorFn: statusLabel, width: 140, cell: ({ row }) => <SaleStatusChip tone={ORDER_STATUS_TONES[row.original.status]}>{statusLabel(row.original)}</SaleStatusChip> },
    { id: "photos", header: "Photos", accessorFn: (row) => row.itemCount ?? 0, width: 90, cell: ({ row }) => <span className="tabular-nums">{row.original.itemCount}</span> },
    { id: "total", header: "Total", accessorFn: (row) => row.totalPaise ?? 0, width: 110, cell: ({ row }) => <span className="tabular-nums">{formatMoney(row.original.totalPaise, row.original.currency)}</span> },
    { id: "placed", header: "Placed", accessorFn: (row) => row.createdAt || "", width: 170, cell: ({ row }) => dateTime(row.original.createdAt) },
  ], [compact]);

  const total = data?.total ?? 0;
  const footer = <TableFooter spread>
    <span className="text-xs">{loading && !data ? "Loading orders..." : `${total} order${total === 1 ? "" : "s"}${pages > 1 ? ` · page ${page} of ${pages}` : ""}`}</span>
    {pages > 1 && <span className="flex items-center gap-2">
      <Button type="button" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>Previous</Button>
      <Button type="button" size="sm" disabled={page >= pages || loading} onClick={() => setPage((value) => value + 1)}>Next</Button>
    </span>}
  </TableFooter>;

  return <div className="flex min-h-0 flex-col gap-3">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <Tabs tabs={STATUSES.map((tab) => ({ ...tab, label: data?.counts ? `${tab.label} (${data.counts[tab.id || "ALL"] ?? 0})` : tab.label }))} value={status} onChange={(value) => { setStatus(value); setPage(1); }} ariaLabel="Order status" size="sm" />
      <Dropdown ariaLabel="When placed" options={RANGES} value={range} onChange={(value) => { setRange(value || "all"); setPage(1); }} sorted={false} searchable={false} className="w-full sm:w-40" />
    </div>
    <DataTableShell className="shadow-sm" footer={footer}>
      {error && !data
        ? <div className="p-3"><CardState error={error} onRetry={load} /></div>
        : <DataTable
          columns={columns}
          data={data?.items || []}
          loading={loading && !data}
          loadingMessage="Loading orders..."
          emptyMessage={status || range !== "all" ? "No orders match." : "No orders yet."}
          noMatchMessage="No orders on this page match those filters."
          getRowId={(row) => row.id}
          selectedRowId={openId || undefined}
          onRowClick={(row) => setOpenId(row.id)}
          ariaLabel="Orders"
          tableId={compact ? "photo-selling-gallery-orders" : "photo-selling-orders"}
          features={{ filtering: true, sorting: true }}
        />}
    </DataTableShell>
    {openId && <OrderDetailDialog orderId={openId} onClose={close} onChanged={load} />}
  </div>;
}
