import { PAYMENT_STATUS_TONES } from "@/lib/scheduledPayments.mjs";

/** Where a scheduled payment - or its project's accounts - stands, in the house colours. */
export default function PaymentStatusPill({ status, label }) {
  if (!status) return null;
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${PAYMENT_STATUS_TONES[status] || "bg-slate-100 text-slate-600"}`}>{label || status}</span>;
}
