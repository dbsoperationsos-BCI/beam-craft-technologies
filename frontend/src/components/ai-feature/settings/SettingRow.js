"use client";

import ToggleSwitch from "@/components/shared/ToggleSwitch";

/**
 * One switch in a settings card: the label and a line under it saying what the switch does, with
 * the switch itself at the end of the row. Rows in a card are separated by a hairline, so a card
 * of four switches reads as a list rather than a cluster.
 *
 * `disabled` covers both the viewer who may only read and a switch made inert by a parent one; the
 * value is drawn either way, never blanked. `note` is a remark drawn amber under the description -
 * "guests can only use this once…" - about a value that is allowed but will not do anything yet.
 *
 * The switch takes the label as its accessible name, since the visible label is drawn beside the
 * description rather than inside the switch.
 */
export default function SettingRow({ label, description, note, checked, onChange, disabled = false, title }) {
  return <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-3 last:border-b-0">
    <div className="min-w-0">
      <p className={`text-sm font-medium ${disabled ? "text-slate-500" : "text-slate-800"}`}>{label}</p>
      {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      {note && <p className="mt-1 text-xs text-amber-700">{note}</p>}
    </div>
    <ToggleSwitch ariaLabel={label} title={title} checked={Boolean(checked)} disabled={disabled} onCheckedChange={(next) => onChange?.(next)} className="mt-0.5 shrink-0" />
  </div>;
}
