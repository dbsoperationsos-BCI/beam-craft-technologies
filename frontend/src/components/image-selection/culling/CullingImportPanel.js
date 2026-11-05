"use client";

import Button from "@/components/shared/Button";
import ProgressBar from "@/components/ai-feature/shared/ProgressBar";
import { cullingImportProgress, cullingImportStatus, cullingModeSummary } from "@/lib/imageSelectionCulling.mjs";

function Figure({ label, value, tone = "text-slate-700" }) {
  return (
    <div className="rounded-lg bg-white/70 px-2 py-2">
      <dt className="text-[11px] font-medium text-slate-600">{label}</dt>
      <dd className={`text-base font-semibold tabular-nums ${tone}`}>{value}</dd>
    </div>
  );
}

/**
 * The web's view of an import that culls itself on the desktop: the server's own counts of what
 * landed, what is still on its way and how much of it the workstation has analyzed, with the
 * same progress rule the desktop draws (`cullingImportProgress`: settled units, never an average).
 * The upload itself lives on the workstation, so there is no pause here - only the hand-over the
 * server can do from previews and the run's own stop, each behind the workspace's confirmation.
 */
export default function CullingImportPanel({ overview, session, canWrite, busy = false, onHandOver, onCancelRun }) {
  const localAnalysis = session?.analysisSource === "DESKTOP";
  const progress = cullingImportProgress({ importing: overview?.importing, counts: overview?.photoCounts, localAnalysis, session });
  const status = cullingImportStatus(progress);
  const inFlight = overview?.importing ? overview.importing.inFlight : Math.max(0, progress.total - progress.landed);
  return (
    <section aria-label="Import and AI analysis" className="mx-auto max-w-180 rounded-xl border border-blue-100 bg-blue-50/50 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-800">Importing for AI Culling</p>
          <p className="mt-0.5 text-xs text-slate-600"><span role="status">{status}</span>{session && cullingModeSummary(session) ? ` · ${cullingModeSummary(session)}` : ""}</p>
        </div>
        <span className="text-lg font-semibold tabular-nums text-blue-700">{progress.percent}%</span>
      </div>
      <ProgressBar percent={progress.percent} label="Import and AI analysis progress" className="mt-2" />
      <p className="mt-1 text-xs text-slate-600">{progress.uploaded.toLocaleString()} of {progress.total.toLocaleString()} photo{progress.total === 1 ? "" : "s"} uploaded{localAnalysis ? ` · ${progress.analyzed.toLocaleString()} analyzed on the desktop app` : ""}</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        <Figure label="Discovered" value={progress.total.toLocaleString()} />
        <Figure label="Uploaded" value={progress.uploaded.toLocaleString()} tone="text-blue-700" />
        {localAnalysis ? <Figure label="Analyzed" value={progress.analyzed.toLocaleString()} tone="text-blue-700" /> : <Figure label="Ready to review" value={progress.ready.toLocaleString()} tone="text-emerald-700" />}
        <Figure label="Still arriving" value={inFlight.toLocaleString()} />
        {progress.failed > 0 && <Figure label="Could not be processed" value={progress.failed.toLocaleString()} tone="text-amber-700" />}
      </dl>
      {overview?.importing?.problem && <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800" role="alert">{overview.importing.problem}</p>}
      {canWrite && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={onHandOver} disabled={busy}>Let the server finish now</Button>
          <Button variant="ghost" size="sm" onClick={onCancelRun} disabled={busy}>Stop culling</Button>
        </div>
      )}
    </section>
  );
}
