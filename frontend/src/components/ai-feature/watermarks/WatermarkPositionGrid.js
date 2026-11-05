"use client";

import Button from "@/components/shared/Button";
import { POSITIONS, POSITION_LABELS } from "@/lib/watermarkGeometry.mjs";

/**
 * The nine anchors as a 3 × 3 grid of cells, the chosen one filled. A radio group in effect: each
 * cell says its position to a screen reader and whether it is the chosen one.
 */
export default function WatermarkPositionGrid({ value, onChange, disabled = false }) {
  return <div role="radiogroup" aria-label="Position" className="grid w-full max-w-[168px] grid-cols-3 gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-1.5">
    {POSITIONS.map((position) => {
      const chosen = value === position;
      return <Button
        key={position}
        type="button"
        size="none"
        variant="plain"
        role="radio"
        aria-checked={chosen}
        ariaLabel={POSITION_LABELS[position]}
        title={POSITION_LABELS[position]}
        disabled={disabled}
        onClick={() => onChange(position)}
        className={`grid aspect-square min-h-10 place-items-center rounded-md border ${chosen ? "border-blue-600 bg-blue-600" : "border-slate-200 bg-white hover:border-blue-300"}`}
      >
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${chosen ? "bg-white" : "bg-slate-300"}`} />
      </Button>;
    })}
  </div>;
}
