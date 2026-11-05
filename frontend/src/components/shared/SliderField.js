"use client";

import { useId } from "react";
import Button from "@/components/shared/Button";

/**
 * A labelled range slider with its value beside it - the control an adjustment is made with
 * (exposure -100..100, a tool's strength 0..100). Native `<input type="range">` underneath, so the
 * keyboard, a screen reader and a phone thumb all work as they expect; the label, the value
 * readout and the optional "Auto" and reset affordances are decided once here.
 *
 * - `value` null with `auto` on means "left to the AI": the thumb sits at the centre, the readout
 *   says Auto, and the Auto button is pressed. Moving the thumb takes the value back; pressing Auto
 *   gives it up again. `autoValue` shows what the AI chose last time, beside the word.
 * - `onReset` draws a small reset when the value is not the default; double-clicking the slider
 *   resets too.
 * - `disabled` greys the whole row.
 */
export default function SliderField({ label, value, min = -100, max = 100, step = 1, defaultValue = 0, onChange, auto = false, autoValue = null, disabled = false, className = "", unit = "" }) {
  const id = useId();
  const isAuto = auto && value === null;
  const shown = isAuto ? (autoValue == null ? defaultValue : autoValue) : value ?? defaultValue;
  const readout = isAuto ? `Auto${autoValue != null ? ` (${autoValue > 0 ? "+" : ""}${autoValue}${unit})` : ""}` : `${shown > 0 && min < 0 ? "+" : ""}${shown}${unit}`;
  const changed = !isAuto && shown !== defaultValue;
  return (
    <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 ${disabled ? "opacity-50" : ""} ${className}`}>
      <label htmlFor={id} className="truncate text-[11px] font-medium text-slate-700">{label}</label>
      <span className="flex items-center justify-end gap-1 text-[11px] tabular-nums text-slate-500">
        {changed && <Button size="none" variant="plain" ariaLabel={`Reset ${label}`} title="Reset" onClick={() => onChange(defaultValue)} disabled={disabled} className="grid min-h-6 min-w-6 place-items-center rounded text-[12px] text-slate-600 hover:text-slate-900">↺</Button>}
        <span>{readout}</span>
      </span>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        disabled={disabled}
        aria-valuetext={readout}
        onChange={(event) => onChange(Number(event.target.value))}
        onDoubleClick={() => onChange(defaultValue)}
        className={`h-6 w-full cursor-pointer accent-blue-600 ${isAuto ? "opacity-60" : ""}`}
      />
      {auto && (
        <Button size="none" variant="plain" aria-pressed={isAuto} ariaLabel={`${label}: let the AI choose`} title={isAuto ? "Set by the AI - move the slider to choose yourself" : "Let the AI choose"} onClick={() => onChange(isAuto ? (autoValue ?? defaultValue) : null)} disabled={disabled} className={`justify-self-end rounded px-1.5 py-0.5 text-[10px] font-semibold ${isAuto ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
          Auto
        </Button>
      )}
    </div>
  );
}
