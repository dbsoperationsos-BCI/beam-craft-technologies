"use client";

import { useState } from "react";
import StepRail from "@/components/shared/StepRail";
import ProductionStepForm from "@/components/project-management/production/ProductionStepForm";
import { StepList } from "@/components/project-management/production/StepActionSlot";
import { stepIndex, stepsOf } from "@/lib/productionSteps.mjs";

/**
 * The shoot's day, one step at a time. Below lg the rail is a row of numbered circles above the step
 * (scrolls sideways when seven do not fit); from lg up it is a list in the shoot panel's own left
 * column (`StepList`), which stays put while the step scrolls - as the Plan's section list does. A finished step can be opened to read it
 * back (✓, who, when). The form is editable only on the current step, for anybody named on the shoot.
 *
 * The shoot's own Pause / Start again (`ProductionPauseControl`) sits on the step's title line, in
 * the form - a shoot that has stopped, which is not a step of its own - and while it is paused no
 * step can be completed, so the form is read-only until it starts again.
 */
export default function ProductionExecutionTab({ shootId, detail, options, canRunSteps, uploads, onDetail, onError, onRemoveFile }) {
  // An unknown step reads as the first, so the tab still draws rather than indexing past the list.
  // This shoot's own steps: an indoor shoot has four, with no travel and no pineapple meeting, and
  // calls Shoot started "Ready".
  const indoor = Boolean(detail.execution.indoor);
  const steps = stepsOf(detail.execution.steps, indoor);
  const furthest = Math.max(0, stepIndex(detail.execution.currentStep, steps));
  const lastIndex = steps.length - 1;
  const [viewed, setViewed] = useState(Math.min(furthest, lastIndex));
  // When the current step moves on, follow it to the next one. A WhatsApp message that did not go
  // is said in the notice the step leaves behind, and its Retry is on the finished step, a tap back.
  const [followed, setFollowed] = useState(furthest);
  if (followed !== furthest) {
    setFollowed(furthest);
    setViewed(Math.min(furthest, lastIndex));
  }

  // The steps open once the plan is submitted and the shoot is three days away; the server says
  // which is still missing (`execution.closedReason`) and refuses a step the same way.
  if (!detail.plan.planSubmittedAt || detail.execution.closedReason) {
    return <p className="m-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 sm:m-4">{detail.plan.planSubmittedAt
      ? detail.execution.closedReason
      : "The steps open once the Production Manager submits the plan, three days before the shoot."}</p>;
  }

  const [stepId] = steps[viewed] || steps[0];
  const rail = { steps, current: viewed, furthest, onSelect: setViewed, ariaLabel: "Production steps" };
  return <div className="flex min-w-0 flex-col gap-4 p-3 sm:p-4">
    <StepRail numbered part="bar" {...rail} />
    <StepList><StepRail part="list" {...rail} /></StepList>
    <div className="min-w-0 flex-1">
      <ProductionStepForm
        key={stepId}
        stepId={stepId}
        indoor={indoor}
        shootId={shootId}
        detail={detail}
        options={options}
        editable={canRunSteps && !detail.execution.paused && stepId === detail.execution.currentStep}
        canRunSteps={canRunSteps}
        uploads={uploads}
        onDetail={onDetail}
        onError={onError}
        onRemoveFile={onRemoveFile}
      />
    </div>
  </div>;
}
