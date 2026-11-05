/**
 * A Photo Selling status as a pill - drawn as the AI Feature's own status pill
 * (ai-feature/shared/StatusChip.js): bordered, pastel, 11px - so a gallery's Live / Draft reads like
 * an event's Active / Draft. A tone rather than a status key, because Photo Selling's statuses are
 * its own words (galleryStatus, the server's readiness): green for ready or live, blue for in hand,
 * amber for waiting, red for what went wrong, slate for what is closed.
 */
const TONES = {
  green: "bg-green-50 text-green-700 border-green-200",
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  bronze: "bg-amber-50 text-amber-800 border-amber-200",
  red: "bg-red-50 text-red-700 border-red-200",
  slate: "bg-slate-100 text-slate-600 border-slate-200",
};

export default function SaleStatusChip({ tone = "slate", children, className = "" }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONES[tone] || TONES.slate} ${className}`}>{children}</span>;
}
