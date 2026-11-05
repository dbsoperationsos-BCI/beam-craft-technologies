import { ALBUM_STATE_LABELS, CORRECTION_STATE_LABELS } from "@/lib/albumProofingStates.mjs";

/**
 * The Album Proofing status vocabulary rendered one way, everywhere. The label maps double as
 * the module's dictionary — the dashboard filters read `ALBUM_STATE_LABELS`, so a chip and a
 * filter can never spell a state differently.
 */

const tones = {
  slate: "bg-slate-100 text-slate-600",
  blue: "bg-blue-50 text-blue-700",
  amber: "bg-amber-50 text-amber-700",
  violet: "bg-violet-50 text-violet-700",
  emerald: "bg-emerald-50 text-emerald-700",
  rose: "bg-rose-50 text-rose-700",
  cyan: "bg-cyan-50 text-cyan-700",
};

// The words live in `lib/albumProofingStates.mjs` (pure, so the dashboard's vocabulary and its
// tests can read them); re-exported here so every screen that imports them from the chip still can.
export { ALBUM_STATE_LABELS };

const styles = {
  DRAFT: "slate", PROCESSING: "blue", PROCESSING_FAILED: "rose", READY_FOR_QC: "cyan",
  QC_REVIEW: "violet", QC_CHANGES_REQUESTED: "rose", QC_REVISION_IN_PROGRESS: "amber",
  QC_APPROVED: "emerald", READY_FOR_CLIENT: "cyan", CLIENT_REVIEW: "blue",
  CLIENT_CHANGES_REQUESTED: "rose", REVISION_IN_PROGRESS: "amber", REVISION_READY_FOR_QC: "cyan",
  CLIENT_APPROVED: "emerald", COMPLETED: "emerald", ARCHIVED: "slate",
  // Corrections
  OPEN: "rose", IN_PROGRESS: "amber", RESOLVED: "emerald", REOPENED: "violet",
};

const labels = { ...ALBUM_STATE_LABELS, ...CORRECTION_STATE_LABELS };

export default function ProofingStatusChip({ status }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold sm:text-[11px] ${tones[styles[status]] || tones.slate}`}>{labels[status] || status}</span>;
}
