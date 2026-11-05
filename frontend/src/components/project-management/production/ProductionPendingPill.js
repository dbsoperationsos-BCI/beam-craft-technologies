/**
 * What a shoot is waiting on, as one short pill - the board's last column, the panel header and the
 * project's Status tab. The house status colours: amber waiting or stopped (plan pending, paused, on
 * hold), green done, red rejected, blue a step in progress. Fill and text only - the dark themes
 * repaint those, and an outline ring they do not.
 */
const TONES = {
  "Plan pending": "bg-amber-50 text-amber-800",
  Done: "bg-emerald-50 text-emerald-700",
  Paused: "bg-amber-50 text-amber-800",
  Hold: "bg-amber-50 text-amber-800",
  Rejected: "bg-red-50 text-red-700",
};

export default function ProductionPendingPill({ label }) {
  return <span className={`inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-xs font-medium ${TONES[label] || "bg-blue-50 text-blue-700"}`}>{label || "—"}</span>;
}
