"use client";

import Check from "@mui/icons-material/Check";
import Remove from "@mui/icons-material/Remove";
import Button from "@/components/shared/Button";
import HelpTip from "@/components/shared/HelpTip";
import { CULLING_DECISION_STYLES, CULLING_SIGNAL_SCORES, cullingConfidenceLabel, cullingDecisionBasis, cullingGroupOf, cullingRankLabel, cullingReasonGroups, cullingSceneLabel, cullingSignalNotes, cullingSignalValue } from "@/lib/imageSelectionCulling.mjs";

/**
 * Why the AI said what it said about one photo, beside its preview: the recommendation, its score
 * and confidence, then what speaks for the photo and against it, read from the reason codes the
 * run stored (nothing is inferred here). The photographer's own decision is shown above the AI's
 * when there is one, because it is the one that counts, and can be changed from here.
 */
export default function CullingPhotoExplanation({ item, session = null, scenes = [], canWrite = false, busy = false, onDecide }) {
  const basis = cullingDecisionBasis(item, session);
  const why = cullingReasonGroups(item.reasonCodes);
  const ai = item.aiDecision ? CULLING_DECISION_STYLES[item.aiDecision] : null;
  const mine = item.userDecision ? CULLING_DECISION_STYLES[item.userDecision] : null;
  const scene = cullingSceneLabel(item.sceneLabel, scenes, item.sceneConfidence);
  // A similar series' place is one of the signal notes; the rank line is the duplicate or burst's.
  const group = cullingGroupOf(item);
  const rank = group && group.type !== "SIMILAR" ? cullingRankLabel(group.rank) : "";
  const signalNotes = cullingSignalNotes(item);
  const scores = CULLING_SIGNAL_SCORES.filter(([key]) => typeof item[key] === "number");
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 text-slate-700">
      <p className="truncate text-xs text-slate-500" title={item.upload?.fileName}>{item.upload?.fileName}</p>
      {mine && (
        <section aria-label="Your decision">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Your decision</p>
          <p className="mt-1 flex items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${mine.className}`}>{mine.label}</span><span className="text-[11px] text-slate-500">This is the one that counts.</span></p>
        </section>
      )}
      <section aria-label="AI recommendation">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">AI recommendation</p>
        {ai
          ? <p className="mt-1"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ai.className}`}>{ai.label}</span></p>
          : <p className="mt-1 text-xs text-slate-500">None - in this mode the AI scores and groups, and every decision is yours.</p>}
        {basis && <p className="mt-1.5 text-xs leading-5 text-slate-600">{basis}</p>}
        <dl className="mt-2 grid grid-cols-2 gap-2">
          {item.finalScore !== null && item.finalScore !== undefined && <div className="rounded-md bg-slate-50 px-2 py-1.5"><dt className="flex items-center text-[10px] text-slate-500">Score<HelpTip text="The AI's overall rating of this photo, 0 to 100, from the scores below. Higher scores lean towards Keep." /></dt><dd className="text-sm font-semibold tabular-nums">{item.finalScore}</dd></div>}
          {cullingConfidenceLabel(item.confidence) && <div className="rounded-md bg-slate-50 px-2 py-1.5"><dt className="flex items-center text-[10px] text-slate-500">Confidence<HelpTip text="How sure the AI is of its recommendation. A low figure means check this photo yourself." /></dt><dd className="text-sm font-semibold tabular-nums">{cullingConfidenceLabel(item.confidence)}</dd></div>}
        </dl>
      </section>
      {(why.positives.length > 0 || why.concerns.length > 0) && (
        <section aria-label="Why">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Why</p>
          <ul className="mt-1 space-y-1 text-xs">
            {why.positives.map((label) => <li key={label} className="flex items-center gap-1.5"><Check aria-hidden="true" style={{ fontSize: 14 }} className="text-emerald-600" /><span className="sr-only">For: </span>{label}</li>)}
            {why.concerns.map((label) => <li key={label} className="flex items-center gap-1.5"><Remove aria-hidden="true" style={{ fontSize: 14 }} className="text-red-600" /><span className="sr-only">Against: </span>{label}</li>)}
          </ul>
        </section>
      )}
      {(why.notes.length > 0 || scene || rank || signalNotes.length > 0) && (
        <section aria-label="Notes" className="space-y-1 text-[11px] text-slate-500">
          {scene && <p>Scene: {scene} (the AI&apos;s guess)</p>}
          {rank && <p>{rank} in its {group.type === "BURST" ? "burst" : "duplicate group"}</p>}
          {signalNotes.map((line) => <p key={line}>{line}</p>)}
          {why.notes.map((label) => <p key={label}>{label}</p>)}
        </section>
      )}
      {scores.length > 0 && (
        <section aria-label="Scores">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Scores (0-100)</p>
          <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
            {scores.map(([key, label]) => <div key={key} className="flex justify-between"><dt className="text-slate-500">{label}</dt><dd className="tabular-nums">{cullingSignalValue(item, key)}</dd></div>)}
          </dl>
        </section>
      )}
      {canWrite && (
        <section aria-label="Decide" className="mt-auto border-t border-slate-200 pt-3">
          <div className="grid grid-cols-3 gap-1.5">
            {["KEEP", "MAYBE", "REJECT"].map((value, index) => (
              <Button key={value} size="sm" variant={item.userDecision === value ? "primary" : "secondary"} disabled={busy} onClick={() => onDecide(item, value)} aria-pressed={item.userDecision === value} aria-keyshortcuts={String(index + 1)}>{CULLING_DECISION_STYLES[value].label}</Button>
            ))}
          </div>
          {item.userDecision && <Button size="sm" variant="ghost" className="mt-1.5 w-full" disabled={busy} onClick={() => onDecide(item, null)}>Back to the AI&apos;s answer</Button>}
          <p className="mt-2 hidden text-[11px] text-slate-500 md:block">Keys: 1 Keep · 2 Maybe · 3 Reject · 0 back to the AI · ←/→ next photo · Esc close</p>
        </section>
      )}
    </div>
  );
}
