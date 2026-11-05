"use client";

import CheckCircle from "@mui/icons-material/CheckCircle";
import RadioButtonUnchecked from "@mui/icons-material/RadioButtonUnchecked";
import RemoveCircleOutline from "@mui/icons-material/RemoveCircleOutlined";
import Autorenew from "@mui/icons-material/Autorenew";
import DashboardProgressBar from "@/components/shared/DashboardProgressBar";
import { PROGRESS_COLORS } from "@/lib/progressStatus.mjs";

const ICONS = {
  done: { Icon: CheckCircle, color: PROGRESS_COLORS.completed, word: "Done" },
  current: { Icon: Autorenew, color: PROGRESS_COLORS.inProgress, word: "In progress" },
  pending: { Icon: RadioButtonUnchecked, color: "#94A3B8", word: "Waiting" },
  skipped: { Icon: RemoveCircleOutline, color: "#94A3B8", word: "Not used for this run" },
};

/**
 * The run's analysis as the photographer follows it: one row per stage (done, in progress,
 * waiting, or not used on this run), then the bar and the count of photos analyzed. `steps` come
 * from `cullingStageSteps`, so a stage that did not run is never ticked. With no `percent` it is
 * the record of a finished run.
 */
export default function CullingStageList({ steps, percent = null, processed = null, total = null }) {
  return (
    <div>
      <ol className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {steps.map((step) => {
          const { Icon, color, word } = ICONS[step.state] || ICONS.pending;
          return (
            <li key={step.id} className="flex min-w-0 items-start gap-2" title={step.hint}>
              <Icon aria-hidden="true" style={{ fontSize: 16, color }} className={`mt-0.5 shrink-0 ${step.state === "current" ? "animate-spin motion-reduce:animate-none" : ""}`} />
              <span className="min-w-0">
                <span className={`block text-xs font-medium ${step.state === "skipped" || step.state === "pending" ? "text-slate-500" : "text-slate-700"}`}>{step.label}</span>
                <span className="block text-[11px] text-slate-500">{step.state === "current" || step.state === "skipped" ? word : step.hint}</span>
              </span>
              {step.state !== "current" && step.state !== "skipped" && <span className="sr-only">{word}</span>}
            </li>
          );
        })}
      </ol>
      {percent !== null && (
        <div className="mt-4">
          <DashboardProgressBar percent={percent} color={PROGRESS_COLORS.inProgress} />
          {total !== null && <p className="mt-1.5 text-xs text-slate-500">{processed ?? 0} of {total} photos analyzed</p>}
        </div>
      )}
    </div>
  );
}
