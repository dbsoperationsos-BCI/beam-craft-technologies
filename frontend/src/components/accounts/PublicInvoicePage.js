"use client";

import { useEffect, useState } from "react";
import ReceiptLongOutlinedIcon from "@mui/icons-material/ReceiptLongOutlined";
import Button from "@/components/shared/Button";
import Loader from "@/components/shared/Loader";
import { getPublicInvoice, publicInvoicePdfUrl } from "@/services/accounts/public-invoice.service";

const rupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const onDate = (value) => {
  const at = value ? new Date(value) : null;
  return at && !Number.isNaN(at.getTime()) ? `${String(at.getDate()).padStart(2, "0")} ${MONTHS[at.getMonth()]} ${at.getFullYear()}` : "";
};

/**
 * `/i/<token>` - the invoice a client opens from the link in their receipt, with no sign-in.
 *
 * A person is sent straight to the PDF by the route (`app/i/[token]/page.js`); this page is what a
 * link preview reads, and what a dead link comes back to (`unavailable`, from the PDF route).
 *
 * What the payment was - its number, date, amount and who it is for - and **View invoice**, which
 * opens the PDF itself (served inline, so the phone's own viewer reads and saves it). A link that
 * names no live payment says so plainly: the payment may have been withdrawn, and the studio is who
 * to ask.
 */
export default function PublicInvoicePage({ token, unavailable = false }) {
  const [invoice, setInvoice] = useState(null);
  const [problem, setProblem] = useState(unavailable ? "Invoice not found." : "");

  useEffect(() => {
    if (unavailable) return undefined;
    let current = true;
    getPublicInvoice(token)
      .then((response) => { if (current) setInvoice(response?.data || null); })
      .catch((error) => { if (current) setProblem(error.message || "Unable to load this invoice."); });
    return () => { current = false; };
  }, [token, unavailable]);

  return <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-8">
    <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      {problem ? <div className="space-y-2 text-center">
        <h1 className="text-lg font-semibold text-slate-900">This invoice is not available</h1>
        <p className="text-sm text-slate-600">The link may be mistyped, or the payment may have been withdrawn. Please ask the studio for a new link.</p>
      </div>
        : !invoice ? <Loader label="Loading your invoice..." />
          : <div className="space-y-5">
            <header className="flex items-center gap-3">
              {invoice.logoUrl
                // eslint-disable-next-line @next/next/no-img-element -- the studio's own logo, from any host it is kept on
                ? <img src={invoice.logoUrl} alt={invoice.studioName || "Studio logo"} className="h-10 w-10 shrink-0 rounded-lg object-contain" />
                : <ReceiptLongOutlinedIcon aria-hidden="true" className="shrink-0 text-slate-400" sx={{ fontSize: 36 }} />}
              <div className="min-w-0">
                {invoice.studioName && <p className="truncate text-sm font-semibold text-slate-900">{invoice.studioName}</p>}
                <h1 className="text-xs text-slate-500">Payment receipt and invoice</h1>
              </div>
            </header>
            <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {[["Invoice", invoice.number], ["Received from", invoice.clientName], ["Date", onDate(invoice.date)], ["Amount", rupees.format(Number(invoice.amount || 0))]]
                .filter(([, value]) => value)
                .map(([label, value]) => <div key={label} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
                  <dt className="text-sm text-slate-600">{label}</dt>
                  <dd className="min-w-0 break-words text-right text-sm font-semibold text-slate-900">{value}</dd>
                </div>)}
            </dl>
            <Button type="button" variant="primary" size="lg" className="w-full font-semibold" onClick={() => window.open(publicInvoicePdfUrl(token), "_blank", "noopener")}>
              View invoice
            </Button>
          </div>}
    </section>
  </main>;
}
