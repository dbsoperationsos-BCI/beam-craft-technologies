"use client";

import ContentCopyOutlined from "@mui/icons-material/ContentCopyOutlined";
import { useCallback, useEffect, useState } from "react";
import { useRouteAccess } from "@/components/auth/PermissionsProvider";
import ActionField from "@/components/shared/ActionField";
import Button from "@/components/shared/Button";
import { CardState } from "@/components/shared/DashboardCard";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import Loader from "@/components/shared/Loader";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import Dialog from "@/components/ui/Dialog";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import LazyImage from "@/components/ai-feature/shared/LazyImage";
import { copyToClipboard } from "@/lib/clipboard";
import { FULFILMENT_LABELS, KIND_LABELS, ORDER_STATUS_LABELS, ORDER_STATUS_TONES, PAYMENT_STATUS_LABELS, formatMoney } from "@/lib/photoSelling.mjs";
import { absoluteApiUrl, getSaleOrder, reissueSaleOrderLink, verifySaleOrder } from "@/services/photo-selling/photo-selling.service";
import SaleStatusChip from "../shared/SaleStatusChip";

/**
 * One order: who bought what, what they paid, every payment attempt and notification, and how often
 * each original has been downloaded. Reachable from a table row and from a deep link (`?order=`), so
 * it takes its write access itself rather than trusting the control that opened it.
 *
 * - Check payment asks Cashfree now, through the server - for an order stuck awaiting payment.
 * - Re-issue link gives the buyer a fresh order link; the old one stops opening it.
 *
 * The buyer downloads each original themselves once the payment is verified; there is nothing for
 * the studio to send. "Delivered" and a delivery note appear only on orders from before that.
 */
const dateTime = (value) => (value ? new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const FULFILMENT_TONES = { READY: "green", DELIVERED: "green", AWAITING_STUDIO: "blue", PENDING_PAYMENT: "amber", UNAVAILABLE: "red" };

export default function OrderDetailDialog({ orderId, onClose, onChanged }) {
  const { canWrite } = useRouteAccess();
  const { notice, showSuccess, showError, clearNotice } = useNotice();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [confirmReissue, setConfirmReissue] = useState(false);
  const { busy, run } = useSubmitOnce();

  const load = useCallback(async () => {
    try { const response = await getSaleOrder(orderId); setOrder(response.data); setError(""); }
    catch (caught) { setError(caught.message || "Unable to load this order."); }
  }, [orderId]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  const act = (work, message, after) => run(async () => {
    try {
      const response = await work();
      if (response?.data?.id) setOrder(response.data);
      after?.(response?.data);
      showSuccess(message);
      onChanged?.();
    } catch (caught) {
      showError(caught.message || "That did not work.");
    }
  });

  const blocked = order?.items.filter((item) => item.fulfilment === "UNAVAILABLE") || [];
  return <Dialog title={order ? `Order ${order.orderRef}` : "Order"} description={order ? `${order.buyerName} · ${order.buyerPhone}${order.buyerEmail ? ` · ${order.buyerEmail}` : ""}` : ""} onClose={onClose} size="xl"
    footer={<Button type="button" onClick={onClose}>Close</Button>}>
    <FloatingNotice notice={notice} onClose={clearNotice} />
    {error && !order
      ? <CardState error={error} onRetry={load} />
      : !order
        ? <Loader label="Loading order..." />
        : <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <SaleStatusChip tone={ORDER_STATUS_TONES[order.status]}>{ORDER_STATUS_LABELS[order.status] || order.status}</SaleStatusChip>
            <span className="text-sm text-slate-600">{order.gallery?.title}{order.gallery?.deleted ? " (deleted)" : ""} · placed {dateTime(order.createdAt)}{order.paidAt ? ` · paid ${dateTime(order.paidAt)}` : ""}</span>
            {canWrite && <span className="flex flex-wrap gap-2 sm:ml-auto">
              {order.status !== "PAID" && <Button type="button" size="sm" busy={busy} busyLabel="Checking..." onClick={() => act(() => verifySaleOrder(orderId), "Checked with Cashfree.")}>Check payment</Button>}
              {/* A deleted gallery's order page no longer opens, so a new link would lead nowhere. */}
              {!order.gallery?.deleted && <Button type="button" size="sm" onClick={() => setConfirmReissue(true)}>Re-issue buyer link</Button>}
            </span>}
          </div>
          {order.gallery?.deleted && <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">This order&apos;s gallery was deleted. The order and payment are kept for your records; its photos and their downloads are no longer available.</p>}
          {link && <ActionField label="New order link - send it to the buyer" value={link} link actions={[{ label: "Copy link", icon: <ContentCopyOutlined fontSize="small" />, onClick: async () => { if (await copyToClipboard(link)) showSuccess("Link copied."); } }]} />}

          <section aria-label="Photos bought">
            <h3 className="mb-2 text-sm font-semibold text-slate-800">Photos ({order.items.length}){blocked.length > 0 ? ` · ${blocked.length} can't be downloaded` : ""}</h3>
            <ul className="flex flex-col divide-y divide-slate-100 rounded-lg border border-slate-200">
              {order.items.map((item) => <li key={item.id} className="flex flex-col gap-2 p-2 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-slate-100">{item.thumbnailUrl && <LazyImage src={absoluteApiUrl(item.thumbnailUrl)} alt="" className="h-full w-full object-cover" />}</div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{item.fileName}</p>
                    <p className="truncate text-xs text-slate-500">{KIND_LABELS[item.kind]}{item.relativePath ? ` · ${item.relativePath}` : ""}</p>
                    {item.deliveryNote && <p className="text-xs text-slate-600">“{item.deliveryNote}”</p>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <SaleStatusChip tone={FULFILMENT_TONES[item.fulfilment]}>{FULFILMENT_LABELS[item.fulfilment] || item.fulfilment}</SaleStatusChip>
                  {item.fulfilment === "READY" && <span className="text-xs text-slate-500">{item.downloadCount ? `Downloaded ${item.downloadCount}×` : "Not downloaded yet"}{item.lastDownloadedAt ? ` · last ${dateTime(item.lastDownloadedAt)}` : ""}</span>}
                  {item.fulfilment === "UNAVAILABLE" && <span className="text-xs text-red-700">The original is missing - contact the buyer</span>}
                  <span className="text-sm tabular-nums text-slate-800">{formatMoney(item.chargedPaise, order.currency)}</span>
                </div>
              </li>)}
            </ul>
          </section>

          <dl className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-slate-500">Subtotal</dt><dd className="tabular-nums">{formatMoney(order.subtotalPaise, order.currency)}</dd></div>
            <div><dt className="text-xs text-slate-500">Package savings</dt><dd className="tabular-nums">{order.discountPaise ? `− ${formatMoney(order.discountPaise, order.currency)}` : "—"}</dd></div>
            <div><dt className="text-xs text-slate-500">Tax{order.taxRateBps ? ` (${order.taxRateBps / 100}%${order.pricesIncludeTax ? ", included" : ""})` : ""}</dt><dd className="tabular-nums">{formatMoney(order.taxPaise, order.currency)}</dd></div>
            <div><dt className="text-xs text-slate-500">Total paid</dt><dd className="font-semibold tabular-nums">{formatMoney(order.totalPaise, order.currency)}</dd></div>
          </dl>

          <section aria-label="Payments">
            <h3 className="mb-2 text-sm font-semibold text-slate-800">Payment attempts</h3>
            {order.payments.length === 0
              ? <p className="text-sm text-slate-500">No payment was started.</p>
              : <ul className="flex flex-col gap-1 text-sm">
                {order.payments.map((payment) => <li key={payment.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-slate-200 px-2 py-1.5">
                  <span className="font-medium">#{payment.attempt}</span>
                  <span>{PAYMENT_STATUS_LABELS[payment.status] || payment.status}</span>
                  {payment.environment === "SANDBOX" && <SaleStatusChip tone="amber">Sandbox</SaleStatusChip>}
                  {payment.paymentGroup && <span className="text-slate-500">{payment.paymentGroup}</span>}
                  {payment.cfPaymentId && <span className="font-mono text-xs text-slate-500">CF {payment.cfPaymentId}</span>}
                  {payment.failureReason && <span className="text-red-700">{payment.failureReason}</span>}
                  <span className="ml-auto text-xs text-slate-500">{dateTime(payment.createdAt)}</span>
                </li>)}
              </ul>}
          </section>

          <details className="rounded-lg border border-slate-200 p-2 text-sm">
            <summary className="cursor-pointer font-medium text-slate-700">Payment audit trail ({order.events.length})</summary>
            <ul className="mt-2 flex flex-col gap-1 text-xs text-slate-600">
              {order.events.map((event) => <li key={event.id} className="flex flex-wrap gap-x-3"><span className="font-mono">{dateTime(event.createdAt)}</span><span>{event.source}</span><span className="font-medium">{event.eventType}</span>{event.providerStatus && <span>{event.providerStatus}</span>}{event.source === "WEBHOOK" && <span>{event.signatureValid ? "signature verified" : "unsigned"}</span>}</li>)}
            </ul>
          </details>
        </div>}

    {confirmReissue && <ConfirmDialog layer="confirmOverDialog"
      title="Re-issue the buyer's order link?"
      message="A new link is made for you to send them, and the link they have now stops opening this order. Their downloads stay available through the new one."
      confirmLabel="Re-issue link" busyLabel="Making link..." loading={busy}
      onCancel={() => setConfirmReissue(false)}
      onConfirm={() => act(() => reissueSaleOrderLink(orderId), "New order link made. The old one no longer opens it.", (data) => { setLink(data?.url || ""); setConfirmReissue(false); })} />}
  </Dialog>;
}
