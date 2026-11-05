import ProgressBar from "@/components/ai-feature/shared/ProgressBar";
import { formatBytes, formatCount } from "@/lib/aiFeature.mjs";

const plural = (count, one, many) => (count === 1 ? one : many);

function Stat({ label, value, tone = "text-slate-800" }) {
  return <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
    <dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt>
    <dd className={`text-sm font-semibold tabular-nums ${tone}`}>{formatCount(value)}</dd>
  </div>;
}

/**
 * The batch at a glance: how much, how far, and how the files are spread across the stages. While
 * it runs the bar and the stage counts say everything; a sentence is added - and announced - only
 * when the state changes: paused, finished, finished with failures.
 */
// `doneNote` and `holder` let another module word the finished line for itself (Photo Selling's
// galleries); the AI Feature's wording is the default.
const AI_DONE_NOTE = "Face recognition is processing in the background. People will fill in as it goes.";

export default function UploadSummary({ session, doneNote = AI_DONE_NOTE, holder = "this event" }) {
  const { counts, total, percent } = session;
  const optimized = session.optimizedBytes || 0;
  const tone = session.finished ? (counts.failed ? "bg-amber-500" : "bg-green-600") : session.paused ? "bg-amber-500" : "bg-blue-600";
  const title = `${session.finished ? "" : session.paused ? "Paused · " : "Uploading "}${formatCount(total)} ${plural(total, "photo", "photos")}${session.folderName ? ` to ${session.folderName}` : ""}`;
  const stateLine = session.finished
    ? counts.failed ? `${formatCount(counts.completed)} of ${formatCount(total)} uploaded; ${formatCount(counts.failed)} failed.` : `${formatCount(counts.completed)} ${plural(counts.completed, "photo", "photos")} uploaded successfully.`
    : session.paused ? (session.pausedReason || "Paused. Resume when you are ready.") : "";
  return <section aria-label="Upload progress" className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <p className="text-xs text-slate-500">{optimized ? `${formatBytes(optimized)} optimized` : formatBytes(session.sourceBytes || 0)}{optimized && session.sourceBytes ? ` from ${formatBytes(session.sourceBytes)}` : ""}</p>
    </div>
    <div className="flex items-center gap-3">
      <ProgressBar percent={percent} tone={tone} className="flex-1" label="Upload progress" />
      <span className="w-10 text-right text-sm font-semibold tabular-nums text-slate-800">{percent}%</span>
    </div>
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      <Stat label="Preparing" value={counts.preparing + counts.ready} />
      <Stat label="Compressing" value={counts.compressing} tone="text-blue-700" />
      <Stat label="Uploading" value={counts.uploading} tone="text-blue-700" />
      <Stat label="Completed" value={counts.completed} tone="text-green-700" />
      <Stat label="Failed" value={counts.failed} tone={counts.failed ? "text-red-700" : "text-slate-800"} />
    </dl>
    {/* Only a change of state is spoken: a live region that re-read every landed photo would talk over the person. */}
    <p aria-live="polite" className={`text-xs ${session.paused && !session.finished ? "text-amber-700" : "text-slate-600"} ${stateLine ? "" : "sr-only"}`}>
      {session.finished && !counts.failed && <span aria-hidden="true">✓ </span>}{stateLine}
    </p>
    {session.finished && <p className="text-xs text-slate-500">
      {counts.failed > 0 && "Retry failed uploads sends them again. "}
      {counts.completed - counts.duplicates > 0 && doneNote}
      {counts.duplicates ? ` ${formatCount(counts.duplicates)} ${plural(counts.duplicates, "was", "were")} already in ${holder}.` : ""}
    </p>}
  </section>;
}
