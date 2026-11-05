import { EVENT_STATUS_LABELS, EVENT_STATUS_TONES, AI_STATUS_LABELS, MATCH_STATUS_LABELS } from "@/lib/aiFeature.mjs";

const AI_TONES = { QUEUED: "bg-slate-100 text-slate-600 border-slate-200", PROCESSING: "bg-blue-50 text-blue-700 border-blue-200", COMPLETED: "bg-green-50 text-green-700 border-green-200", FAILED: "bg-red-50 text-red-700 border-red-200", SKIPPED: "bg-slate-50 text-slate-500 border-slate-200" };
const MATCH_TONES = { MATCHED: "bg-blue-50 text-blue-700 border-blue-200", CONFIRMED: "bg-green-50 text-green-700 border-green-200", REJECTED: "bg-red-50 text-red-700 border-red-200", REVIEW_REQUIRED: "bg-amber-50 text-amber-700 border-amber-200" };

/** One small bordered pill for an event, processing or match status. `kind` picks the vocabulary. */
export default function StatusChip({ status, kind = "event", className = "" }) {
  const labels = kind === "ai" ? AI_STATUS_LABELS : kind === "match" ? MATCH_STATUS_LABELS : EVENT_STATUS_LABELS;
  const tones = kind === "ai" ? AI_TONES : kind === "match" ? MATCH_TONES : EVENT_STATUS_TONES;
  if (!status) return null;
  return <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${tones[status] || "bg-slate-100 text-slate-600 border-slate-200"} ${className}`}>{labels[status] || status}</span>;
}
