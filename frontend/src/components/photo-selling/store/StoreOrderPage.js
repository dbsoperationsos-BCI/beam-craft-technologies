"use client";

import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded";
import ContentCopyOutlined from "@mui/icons-material/ContentCopyOutlined";
import DownloadRounded from "@mui/icons-material/DownloadRounded";
import ErrorOutlineRounded from "@mui/icons-material/ErrorOutlineRounded";
import HourglassTopRounded from "@mui/icons-material/HourglassTopRounded";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import IconButton from "@/components/shared/IconButton";
import Loader from "@/components/shared/Loader";
import LazyImage from "@/components/ai-feature/shared/LazyImage";
import GuestStatusScreen from "@/components/ai-feature/guest/GuestStatusScreen";
import { copyToClipboard } from "@/lib/clipboard";
import { openCashfreeCheckout } from "@/lib/cashfreeCheckout";
import { FULFILMENT_LABELS, KIND_LABELS, cartKey, formatMoney, loadCart, loadOrderKeys, loadStoreSession, orderKeyFromHash, saveCart, saveOrderKey } from "@/lib/photoSelling.mjs";
import { getDownloadLink, getStoreOrder, payStoreOrder } from "@/services/photo-selling/photo-store-public.service";
import StoreButton from "./StoreButton";

/**
 * The buyer's order at /s/[code]/orders/[ref] - where Cashfree sends them back, and the page they
 * keep. It never takes the return from checkout as proof: it asks the server (which asks Cashfree)
 * and keeps asking for a while if the bank is still confirming.
 *
 * Opened by this device's store session, or by the order key - from this browser's storage, or from
 * a link the studio re-issued (`#k=` in the fragment, which never reaches a server log).
 *
 * Each photo bought is its original file. Downloads open only once the server has verified the
 * payment, and each is a fresh address made on request that works once and for ten minutes, so a
 * link copied out of the page is no use to anybody; pressing Download again makes a new one. Each
 * photo shows how many downloads it has left under the gallery's repeat-download policy.
 */
const POLL_MS = 3000;
// About three minutes of asking before the page stops and offers "Check again".
const MAX_POLLS = 60;

export default function StoreOrderPage({ code, orderRef }) {
  const { notice, showSuccess, showError, clearNotice } = useNotice();
  const [credentials, setCredentials] = useState(null);
  const [data, setData] = useState(null);
  const [failure, setFailure] = useState(null);
  const [paying, setPaying] = useState(false);
  const [downloading, setDownloading] = useState(null);
  const [polls, setPolls] = useState(0);

  // Read from the browser once it is there - deferred a tick, this codebase's convention for a first load.
  useEffect(() => {
    const timer = setTimeout(() => {
      const fromHash = orderKeyFromHash(window.location.hash);
      if (fromHash) { saveOrderKey(code, orderRef, fromHash); window.history.replaceState(window.history.state, "", window.location.pathname); }
      setCredentials({ session: loadStoreSession(code), orderKey: fromHash || loadOrderKeys(code)[String(orderRef).toUpperCase()] || null });
    }, 0);
    return () => clearTimeout(timer);
  }, [code, orderRef]);

  const load = useCallback(async () => {
    if (!credentials) return;
    try { const response = await getStoreOrder(code, orderRef, credentials); setData(response.data); setFailure(null); }
    catch (caught) { setFailure(caught); }
  }, [code, orderRef, credentials]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  const order = data?.order;
  // What this order bought leaves the device's cart once it is paid - and only then.
  useEffect(() => {
    if (order?.status !== "PAID") return;
    const bought = new Set(order.items.map((item) => cartKey(item)));
    const cart = loadCart(code);
    if (cart.some((line) => bought.has(cartKey(line)))) saveCart(code, cart.filter((line) => !bought.has(cartKey(line))));
  }, [order, code]);
  const confirming = order && order.status === "PENDING" && (!order.payment || ["CREATED", "PENDING"].includes(order.payment.status));
  const stillPolling = confirming && polls < MAX_POLLS;
  useEffect(() => {
    if (!stillPolling) return undefined;
    const timer = setTimeout(() => { setPolls((count) => count + 1); void load(); }, POLL_MS);
    return () => clearTimeout(timer);
  }, [stillPolling, load, data]);

  async function retryPayment() {
    setPaying(true);
    try {
      const response = await payStoreOrder(code, orderRef, credentials);
      if (response.data.paid) { await load(); setPaying(false); return; }
      await openCashfreeCheckout(response.data);
    } catch (caught) {
      showError(caught.message || "We couldn't start the payment. Please try again.");
      setPaying(false);
    }
  }

  async function download(item) {
    setDownloading(item.id);
    try {
      const response = await getDownloadLink(code, orderRef, item.id, credentials);
      const anchor = document.createElement("a");
      anchor.href = response.data.url;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (caught) {
      showError(caught.message || "That download didn't start. Please try again.");
    } finally {
      setDownloading(null);
    }
  }
  async function downloadAll() {
    for (const item of order.items.filter((entry) => entry.canDownload)) {
      await download(item);
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  }
  async function copyLink() {
    const key = credentials?.orderKey;
    const url = `${window.location.origin}/s/${encodeURIComponent(code)}/orders/${orderRef}${key ? `#k=${key}` : ""}`;
    if (await copyToClipboard(url)) showSuccess("Order link copied. Keep it to come back to your photos on any device.");
  }

  if (failure) return <GuestStatusScreen status={failure.status} message={failure.status === 404 ? "" : failure.message} failure={failure} onRetry={load} subject="order" />;
  if (!order) return <GuestStatusScreen loading loadingLabel="Opening your order..." />;

  const accent = data.gallery.accentColor;
  const ready = order.items.filter((item) => item.canDownload);
  const paid = order.status === "PAID";
  const failed = order.status === "FAILED" || (order.status === "PENDING" && !stillPolling && order.payment && !["CREATED", "PENDING"].includes(order.payment.status));

  return <div className="min-h-dvh bg-[#f6f5f2] text-neutral-900">
    <FloatingNotice notice={notice} onClose={clearNotice} />
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6 sm:py-10">
      <Link href={`/s/${encodeURIComponent(code)}`} className="text-sm font-medium text-neutral-600 hover:text-neutral-900">← {data.gallery.title}</Link>

      <section className="rounded-2xl bg-white p-5 shadow-sm sm:p-7" aria-live="polite">
        {paid
          ? <div className="flex items-start gap-3"><CheckCircleRounded className="text-green-600" style={{ fontSize: 32 }} aria-hidden="true" /><div><h1 className="text-xl font-semibold tracking-tight">Payment confirmed - thank you!</h1><p className="mt-1 text-sm text-neutral-600">Order {order.orderRef}. {ready.length ? `Your original photos are ready to download below. Each press of Download uses one of a photo's downloads${ready[0].downloadUntil ? `, until ${new Date(ready[0].downloadUntil).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}` : ""}.` : "There is nothing left to download on this order. If that's not right, please contact the studio."}</p></div></div>
          : confirming
            ? <div className="flex items-start gap-3"><HourglassTopRounded className="text-amber-600" style={{ fontSize: 32 }} aria-hidden="true" /><div><h1 className="text-xl font-semibold tracking-tight">Confirming your payment...</h1><p className="mt-1 text-sm text-neutral-600">{stillPolling ? "This can take a few seconds. Please keep this page open." : "Your bank hasn't confirmed it yet. If money left your account it will be confirmed automatically - check back soon."}</p>{stillPolling ? <Loader size="sm" label="Checking with the bank..." className="mt-3 justify-start" /> : <StoreButton size="md" className="mt-3" onClick={() => { setPolls(0); void load(); }}>Check again</StoreButton>}</div></div>
            : failed
              ? <div className="flex items-start gap-3"><ErrorOutlineRounded className="text-red-600" style={{ fontSize: 32 }} aria-hidden="true" /><div><h1 className="text-xl font-semibold tracking-tight">Your payment didn&apos;t go through</h1><p className="mt-1 text-sm text-neutral-600">{order.payment?.failureReason ? `${order.payment.failureReason}. ` : ""}This order isn&apos;t paid. If money left your account anyway, it is confirmed or returned automatically by your bank. You can try again.</p></div></div>
              : <div className="flex items-start gap-3"><HourglassTopRounded className="text-neutral-500" style={{ fontSize: 32 }} aria-hidden="true" /><div><h1 className="text-xl font-semibold tracking-tight">Awaiting payment</h1><p className="mt-1 text-sm text-neutral-600">This order hasn&apos;t been paid yet.</p></div></div>}
        {!paid && order.canRetryPayment && !confirming && <StoreButton variant="primary" accent={accent} className="mt-5 w-full sm:w-auto" busy={paying} busyLabel="Opening payment..." onClick={retryPayment}>Pay {formatMoney(order.totalPaise, order.currency)}</StoreButton>}
      </section>

      {paid && ready.length > 1 && <div className="flex flex-col gap-1"><StoreButton variant="primary" accent={accent} onClick={downloadAll} disabled={Boolean(downloading)}><DownloadRounded className="mr-2" aria-hidden="true" />Download all {ready.length} photos</StoreButton><p className="text-center text-xs text-neutral-500">Your browser may ask to allow several downloads. If only one arrives, use the Download button beside each photo.</p></div>}

      <section className="rounded-2xl bg-white p-2 shadow-sm sm:p-4" aria-label="Your photos">
        <ul className="flex flex-col divide-y divide-neutral-100">
          {order.items.map((item) => <li key={item.id} className="flex items-center gap-3 p-2">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-neutral-100 sm:h-20 sm:w-20">{item.thumbnailUrl && <LazyImage src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />}</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{item.fileName || KIND_LABELS[item.kind]}</p>
              <p className="text-xs text-neutral-500">{KIND_LABELS[item.kind]} · {FULFILMENT_LABELS[item.fulfilment] || item.fulfilment}{item.downloadCount ? ` · downloaded ${item.downloadCount}×` : ""}{item.canDownload && item.downloadsLeft != null ? ` · ${item.downloadsLeft} download${item.downloadsLeft === 1 ? "" : "s"} left` : ""}</p>
              {item.downloadBlockedReason && <p className="mt-1 text-xs text-amber-800">{item.downloadBlockedReason}</p>}
              {item.deliveryNote && <p className="mt-1 text-xs text-neutral-700">“{item.deliveryNote}”</p>}
              {/^https?:\/\//i.test(item.deliveryUrl || "") && <a href={item.deliveryUrl} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 inline-block text-xs font-medium text-blue-700 underline">Open the studio&apos;s download link</a>}
              {item.fulfilment === "UNAVAILABLE" && <p className="mt-1 text-xs text-red-700">The studio has removed this photo - please contact them.</p>}
            </div>
            <span className="hidden text-sm tabular-nums text-neutral-700 sm:block">{formatMoney(item.chargedPaise, order.currency)}</span>
            {item.canDownload && <StoreButton size="md" variant="primary" accent={accent} busy={downloading === item.id} busyLabel="..." onClick={() => download(item)} aria-label={`Download ${item.fileName || "this photo"}`}><DownloadRounded style={{ fontSize: 18 }} aria-hidden="true" /><span className="ml-1 hidden sm:inline">Download</span></StoreButton>}
          </li>)}
        </ul>
      </section>

      <section className="flex flex-col gap-1 rounded-2xl bg-white p-5 text-sm shadow-sm" aria-label="Order total">
        <div className="flex justify-between"><span className="text-neutral-600">Photos</span><span className="tabular-nums">{formatMoney(order.subtotalPaise, order.currency)}</span></div>
        {order.discountPaise > 0 && <div className="flex justify-between text-green-700"><span>Package saving</span><span className="tabular-nums">− {formatMoney(order.discountPaise, order.currency)}</span></div>}
        {order.taxRateBps > 0 && <div className="flex justify-between text-neutral-500"><span>{order.pricesIncludeTax ? `Includes tax (${order.taxRateBps / 100}%)` : `Tax (${order.taxRateBps / 100}%)`}</span><span className="tabular-nums">{formatMoney(order.taxPaise, order.currency)}</span></div>}
        <div className="mt-1 flex justify-between border-t border-neutral-200 pt-2 text-base font-semibold"><span>{paid ? "Paid" : "Total"}</span><span className="tabular-nums">{formatMoney(order.totalPaise, order.currency)}</span></div>
      </section>

      <div className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 px-4 py-3 text-xs text-neutral-600">
        <span>Keep this order&apos;s link: it is how you come back to your photos on another device or browser.</span>
        <IconButton label="Copy order link" onClick={copyLink}><ContentCopyOutlined fontSize="small" /></IconButton>
      </div>
    </main>
  </div>;
}
