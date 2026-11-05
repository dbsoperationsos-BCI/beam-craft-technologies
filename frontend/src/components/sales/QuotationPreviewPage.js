"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Button from "@/components/shared/Button";
import PublicQuotationPage from "./PublicQuotationPage";
import { PREVIEW_MESSAGE_TYPES, acceptedPreviewMessage, previewMessage, readQuotationPreviewEntry, stashQuotationPreview } from "@/lib/quotationPreview.mjs";
import { previewSalesQuotation } from "@/services/sales/projects.service";

/**
 * The tab the Quotation Generator's Preview opens, kept up to date while it stays open.
 *
 * It belongs to one preview session - one opening of the generator - whose id is its address. It
 * starts from the form the generator left in its session storage, asks the generator for anything
 * newer, and from then on shows each form the generator sends when Preview is pressed again
 * (`lib/quotationPreview.mjs`). Every form goes to `POST /api/sales/quotations/preview` under the
 * signed-in person's own session and is drawn by the client's own page in its preview mode; nothing
 * is saved.
 *
 * Only the newest form ever reaches the screen: one older than what is held is refused, and a
 * server answer for anything but the newest is dropped. While a newer one loads, the quotation on
 * screen stays and says it is updating; if that fails, it stays and says so, with Retry.
 */
export default function QuotationPreviewPage({ previewKey }) {
  const session = previewKey;
  const [quotation, setQuotation] = useState(null);
  const [status, setStatus] = useState({ loading: true, updating: false, error: "", closed: false, retryable: false });
  // The newest form this tab holds, and the press it came from.
  const latest = useRef({ seq: -1, payload: null });

  // Tells the generator how a form it sent came out, so its "Preview up to date" is only ever said
  // once the server has drawn it. To the window that opened this tab, on this origin, only.
  const report = useCallback((type, seq, message = "") => {
    const generator = window.opener && !window.opener.closed ? window.opener : null;
    if (!generator) return;
    try { generator.postMessage(previewMessage(type, session, seq, null, message), window.location.origin); } catch { /* the generator is gone */ }
  }, [session]);

  const show = useCallback((payload, seq) => {
    latest.current = { seq, payload };
    setStatus((current) => ({ ...current, updating: true, error: "", retryable: true }));
    previewSalesQuotation(payload)
      .then((response) => {
        if (latest.current.seq !== seq) return; // a newer form has arrived since
        setQuotation(response.data);
        setStatus((current) => ({ ...current, loading: false, updating: false, error: "" }));
        report(PREVIEW_MESSAGE_TYPES.RENDERED, seq);
      })
      .catch((error) => {
        if (latest.current.seq !== seq) return;
        const message = error.message || "Unable to preview the quotation.";
        setStatus((current) => ({ ...current, loading: false, updating: false, error: message }));
        report(PREVIEW_MESSAGE_TYPES.FAILED, seq, message);
      });
  }, [report]);

  useEffect(() => {
    const origin = window.location.origin;
    const generator = window.opener && !window.opener.closed ? window.opener : null;
    const stored = readQuotationPreviewEntry(session);

    function receive(event) {
      const message = acceptedPreviewMessage(event, { session, origin, source: window.opener });
      if (!message) return;
      if (message.type === PREVIEW_MESSAGE_TYPES.CLOSED) {
        setStatus((current) => ({ ...current, closed: true }));
        if (latest.current.payload) stashQuotationPreview(latest.current.payload, { key: session, seq: latest.current.seq, closed: true });
        return;
      }
      if (message.type !== PREVIEW_MESSAGE_TYPES.UPDATE || message.seq <= latest.current.seq) return;
      // Kept first, so a reload of this tab shows this form even if the generator has gone.
      stashQuotationPreview(message.payload, { key: session, seq: message.seq });
      setStatus((current) => ({ ...current, closed: false }));
      show(message.payload, message.seq);
    }
    window.addEventListener("message", receive);

    // Started on the next tick, not in the effect's own body, so the page settles once.
    const timer = window.setTimeout(() => {
      if (stored) {
        if (stored.closed) setStatus((current) => ({ ...current, closed: true }));
        show(stored.payload, stored.seq);
      } else if (!generator) {
        setStatus({ loading: false, updating: false, error: "This preview is no longer available here. Go back to the Quotation Generator and press Preview again.", closed: false, retryable: false });
      }
      // Anything newer than what this tab was opened (or last reloaded) with.
      if (generator) {
        try { generator.postMessage(previewMessage(PREVIEW_MESSAGE_TYPES.READY, session, Math.max(0, stored?.seq ?? 0)), origin); } catch { /* the generator is gone */ }
      }
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("message", receive);
    };
  }, [session, show]);

  const retry = () => { if (latest.current.payload) show(latest.current.payload, latest.current.seq); };

  if (!quotation) {
    if (status.error) return <main className="grid min-h-dvh place-items-center bg-white p-6">
      <div className="max-w-md space-y-3 text-center">
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700">{status.error}</p>
        {status.retryable && <Button type="button" variant="secondary" onClick={retry}>Retry</Button>}
      </div>
    </main>;
    return <main className="grid min-h-dvh place-items-center bg-white p-6 text-slate-500" role="status">Loading preview…</main>;
  }

  return <>
    {/* The state of the preview, over the sheet and never part of it: updating, failed, or no longer
        updating because its generator was closed. */}
    {(status.updating || status.error || status.closed) && <div className="no-print fixed inset-x-0 top-3 z-50 flex justify-center px-4">
      {status.updating
        ? <p role="status" className="rounded-full bg-slate-900/85 px-4 py-2 text-sm font-medium text-white shadow-lg">Updating preview…</p>
        : status.error
          ? <div role="alert" className="flex max-w-xl flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm text-red-700 shadow-lg">
            <span className="min-w-0 flex-1">{status.error} The last preview is still shown.</span>
            <Button type="button" size="sm" variant="secondary" onClick={retry}>Retry</Button>
          </div>
          : <p role="status" className="max-w-xl rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-center text-sm text-amber-900 shadow-lg">The Quotation Generator was closed, so this preview will not update again. It shows the last version it was sent.</p>}
    </div>}
    <PublicQuotationPage token={null} previewQuotation={quotation} />
  </>;
}
