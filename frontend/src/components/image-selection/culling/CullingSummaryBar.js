"use client";

import Button from "@/components/shared/Button";
import { CULLING_DECISION_STYLES, cullingConfidenceBands } from "@/lib/imageSelectionCulling.mjs";
import formatDateTime from "@/lib/formatDateTime.mjs";

/**
 * The review's summary: how many photos, where the run stands, Keep / Maybe / Reject (the
 * session's own counters, refreshed by every decision), how sure the AI was (the overview's
 * confidence spread), and the one step that moves the work on - Finalize while reviewing, Reopen
 * once finalized. Every number arrives from the server.
 */
export default function CullingSummaryBar({ session, confidence, finalized = false, canWrite = true, busy = false, onFinalize, onReopen }) {
  const bands = cullingConfidenceBands(confidence);
  const decided = [["KEEP", session.keepCount], ["MAYBE", session.maybeCount], ["REJECT", session.rejectCount]];
  const pending = Math.max(0, (Number(session.totalImages) || 0) - decided.reduce((sum, [, value]) => sum + (Number(value) || 0), 0));
  // Pending stands beside the three: it is hidden by a finalize too, so it is seen before one.
  const decisions = [...decided, ["PENDING", pending]];
  return (
    <section aria-label="Culling summary" className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-2xl font-semibold tabular-nums text-slate-800">{session.totalImages}<span className="ml-1.5 text-sm font-medium text-slate-500">photo{session.totalImages === 1 ? "" : "s"}</span></p>
          <p className="text-xs text-slate-500">{finalized ? `Culling finalized${session.finalizedAt ? ` on ${formatDateTime(session.finalizedAt)}` : ""}` : "AI culling complete - your review decides"}</p>
        </div>
        {canWrite && (finalized
          ? <Button variant="secondary" onClick={onReopen} disabled={busy}>Reopen Culling</Button>
          : <Button variant="primary" onClick={onFinalize} disabled={busy}>Finalize Culling</Button>)}
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {decisions.map(([id, value]) => (
            <div key={id} className="rounded-lg bg-slate-50 px-3 py-2">
              <dt><span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${CULLING_DECISION_STYLES[id].className}`}>{CULLING_DECISION_STYLES[id].label}</span></dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-800">{value ?? 0}</dd>
            </div>
          ))}
        </dl>
        {bands && (
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <p className="flex items-baseline justify-between gap-2 text-[10px] font-medium uppercase tracking-wide text-slate-500">
              AI confidence {bands.average && <span className="text-sm font-semibold normal-case tracking-normal text-slate-800">{bands.average} average</span>}
            </p>
            <dl className="mt-1 grid grid-cols-3 gap-2">
              {bands.bands.map((band) => (
                <div key={band.id}>
                  <dt className="text-[11px] text-slate-500">{band.label}</dt>
                  <dd className="text-sm font-semibold tabular-nums text-slate-700">{band.count}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </section>
  );
}
