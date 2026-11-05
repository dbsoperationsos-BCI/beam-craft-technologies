"use client";

import CloseRounded from "@mui/icons-material/CloseRounded";
import LockOutlined from "@mui/icons-material/LockOutlined";
import { useEffect, useState } from "react";
import Dialog from "@/components/ui/Dialog";
import IconButton from "@/components/shared/IconButton";
import Loader from "@/components/shared/Loader";
import TextField from "@/components/shared/TextField";
import LazyImage from "@/components/ai-feature/shared/LazyImage";
import { cartKey as lineKey, formatMoney, isIndianMobile } from "@/lib/photoSelling.mjs";
import { quoteCart } from "@/services/photo-selling/photo-store-public.service";
import StoreButton from "./StoreButton";

/**
 * The cart and checkout, one panel. Every amount on it is the server's: the cart is sent as photos
 * only, priced from the gallery's own rows (packages applied, tax worked out) and shown as it comes
 * back - the browser adds nothing up. A photo that stopped being for sale is taken out and the buyer
 * told which.
 *
 * What they are buying is said before they pay: each photo's original file, downloadable from their
 * order page as soon as the payment is confirmed.
 */
export default function StoreCart({ code, session, meta, cart, onRemove, onDropUnavailable, onCheckout, checkingOut = false, checkoutError = "", onClose }) {
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [buyer, setBuyer] = useState({ name: "", phone: "", email: "" });
  const [errors, setErrors] = useState({});
  const accent = meta.accentColor;
  const cartKey = cart.map(lineKey).join(",");

  useEffect(() => {
    if (!cart.length) return undefined;
    let alive = true;
    const timer = setTimeout(() => {
      quoteCart(code, session, cart)
        .then((response) => { if (alive) { setQuote(response.data); setQuoteError(""); } })
        .catch((error) => {
          if (!alive) return;
          const unavailable = error?.data?.details?.unavailable;
          if (error.status === 409 && Array.isArray(unavailable)) onDropUnavailable(unavailable, error.message);
          else setQuoteError(error.message || "We couldn't price your cart. Please try again.");
        });
    }, 150);
    return () => { alive = false; clearTimeout(timer); };
    // The cart's contents, not its identity, decide when to price it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, session, cartKey, attempt]);

  const lines = new Map((quote?.lines || []).map((line) => [lineKey(line), line]));
  const fresh = quote && cart.every((line) => lines.has(lineKey(line))) && quote.lines.length === cart.length;
  const set = (key) => (event) => setBuyer((current) => ({ ...current, [key]: event.target.value }));
  const policy = meta.downloads;

  function pay(event) {
    event?.preventDefault?.();
    const next = {};
    if (buyer.name.trim().length < 2) next.name = "Enter your name.";
    if (!isIndianMobile(buyer.phone)) next.phone = "Enter a 10-digit mobile number.";
    if (buyer.email.trim() && !/^\S+@\S+\.\S+$/.test(buyer.email.trim())) next.email = "Enter a valid email, or leave it empty.";
    setErrors(next);
    if (Object.keys(next).length || !fresh) return;
    onCheckout({ name: buyer.name.trim(), phone: buyer.phone.trim(), email: buyer.email.trim() || undefined });
  }

  return <Dialog title="Your cart" description={cart.length ? `${cart.length} item${cart.length === 1 ? "" : "s"}` : ""} onClose={onClose} size="lg" height="full" onSubmit={cart.length ? pay : undefined} busy={checkingOut}
    footer={cart.length > 0 && <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <span className="flex items-center gap-1 text-xs text-slate-500"><LockOutlined style={{ fontSize: 14 }} aria-hidden="true" />Secure payment by Cashfree</span>
      <StoreButton type="submit" accent={accent} variant="primary" disabled={!fresh} busy={checkingOut} busyLabel="Opening payment..." className="w-full sm:w-auto">
        {fresh ? `Pay ${formatMoney(quote.totalPaise, quote.currency)}` : quoteError ? "Total unavailable" : "Working out your total..."}
      </StoreButton>
    </div>}>
    {cart.length === 0 && checkoutError && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{checkoutError}</p>}
    {cart.length === 0
      ? <div className="py-10 text-center"><p className="text-base font-semibold text-slate-900">Your cart is empty</p><p className="mt-1 text-sm text-slate-500">Tap the + on any photo to add it.</p></div>
      : <div className="flex flex-col gap-5">
        <ul className="flex flex-col divide-y divide-slate-100">
          {cart.map((line) => {
            const priced = lines.get(lineKey(line));
            return <li key={lineKey(line)} className="flex items-center gap-3 py-2">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-slate-100">{line.thumbnailUrl && <LazyImage src={line.thumbnailUrl} alt="" className="h-full w-full object-cover" />}</div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">Original photo</p>
                <p className="text-xs text-slate-500">Full quality, unwatermarked</p>
              </div>
              <div className="text-right text-sm tabular-nums">
                {priced ? <>
                  <span className="font-semibold text-slate-900">{formatMoney(priced.chargedPaise, quote.currency)}</span>
                  {priced.chargedPaise !== priced.unitPricePaise && <span className="block text-xs text-slate-500 line-through">{formatMoney(priced.unitPricePaise, quote.currency)}</span>}
                </> : <span className="text-slate-500" aria-label="Pricing">…</span>}
              </div>
              <IconButton label="Remove from cart" onClick={() => onRemove(line)}><CloseRounded fontSize="small" /></IconButton>
            </li>;
          })}
        </ul>

        {quoteError && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"><span>{quoteError}</span><StoreButton size="sm" onClick={() => { setQuoteError(""); setAttempt((value) => value + 1); }}>Try again</StoreButton></div>}
        {!quote && !quoteError && <Loader label="Working out your total..." size="sm" />}
        {quote && <dl className="flex flex-col gap-1 rounded-xl bg-slate-50 p-4 text-sm">
          <div className="flex justify-between"><dt className="text-slate-600">Photos</dt><dd className="tabular-nums">{formatMoney(quote.subtotalPaise, quote.currency)}</dd></div>
          {quote.discountPaise > 0 && <div className="flex justify-between text-green-700"><dt>{quote.packagesApplied.map((pack) => pack.name).join(", ") || "Package"} saving</dt><dd className="tabular-nums">− {formatMoney(quote.discountPaise, quote.currency)}</dd></div>}
          {quote.taxRateBps > 0 && <div className="flex justify-between text-slate-500"><dt>{quote.pricesIncludeTax ? `Includes tax (${quote.taxRateBps / 100}%)` : `Tax (${quote.taxRateBps / 100}%)`}</dt><dd className="tabular-nums">{formatMoney(quote.taxPaise, quote.currency)}</dd></div>}
          <div className="mt-1 flex justify-between border-t border-slate-200 pt-2 text-base font-semibold text-slate-900"><dt>Total</dt><dd className="tabular-nums">{formatMoney(quote.totalPaise, quote.currency)}</dd></div>
        </dl>}
        {meta.packages.length > 0 && quote && quote.discountPaise === 0 && <p className="text-xs text-slate-500">Packages: {meta.packages.map((pack) => `${pack.photoCount} photos for ${formatMoney(pack.pricePaise, meta.currency)}`).join(" · ")}. The best one is applied automatically.</p>}

        <div className="rounded-xl border border-slate-200 p-3 text-sm text-slate-700">
          <p className="font-semibold text-slate-900">What you get</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            <li>Each photo&apos;s original file - full quality, without the watermark.</li>
            <li>Ready to download from your order page as soon as your payment is confirmed.</li>
            {policy && <li>Up to {policy.limit} downloads of each photo, for {policy.days} days after payment.</li>}
          </ul>
        </div>

        <fieldset className="flex flex-col gap-3" disabled={checkingOut}>
          <legend className="mb-1 text-sm font-semibold text-slate-900">Your details</legend>
          <TextField label="Name" required autoComplete="name" value={buyer.name} onChange={set("name")} error={errors.name} maxLength={120} />
          <TextField label="Mobile number" required type="tel" inputMode="tel" autoComplete="tel" value={buyer.phone} onChange={set("phone")} error={errors.phone} note="For your payment receipt." maxLength={16} />
          <TextField label="Email (optional)" type="email" autoComplete="email" value={buyer.email} onChange={set("email")} error={errors.email} maxLength={191} />
        </fieldset>
        {checkoutError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{checkoutError}</p>}
      </div>}
  </Dialog>;
}
