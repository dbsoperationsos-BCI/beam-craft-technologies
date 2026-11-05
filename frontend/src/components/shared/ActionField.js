"use client";

import HelpTip from "./HelpTip";
import IconButton from "@/components/shared/IconButton";

/**
 * A value the studio reads and acts on in place - a link, a PIN - with its actions as icons inside
 * the field: the Client URL / Access PIN pattern of Image Selection's publish panel, as one
 * component. With no value it shows `placeholder` greyed (what to do to get one), and every action
 * that needs the value is disabled; an action marked `always` (Generate) stays available.
 *
 * `actions`: `[{ label, icon, onClick, disabled?, always? }]` - `label` is the accessible name and
 * the tooltip. `mono` sets the value in a fixed-width face (a PIN, a code); `link` colours it as a link.
 * `labelAside` sits at the end of the label's line - the switch that decides whether the field
 * has a value at all (Require a PIN beside Access PIN).
 */
export default function ActionField({ label, labelAside = null, helperText = "", value = "", placeholder = "", actions = [], mono = false, link = false, className = "" }) {
  const shown = String(value || "");
  return <div className={className}>
    {(label || labelAside) && <div className="flex min-h-5 flex-wrap items-center justify-between gap-x-3 gap-y-1">
      {label && <p className="text-[11px] font-semibold text-slate-600 sm:text-xs">{label}<HelpTip text={helperText} /></p>}
      {labelAside}
    </div>}
    <div className={`mt-1.5 flex min-h-9 items-center gap-0.5 rounded-lg border border-slate-300 pl-3 pr-1 ${shown ? "bg-white" : "bg-slate-50"}`}>
      <span
        aria-label={label || undefined}
        title={shown || undefined}
        className={`min-w-0 flex-1 truncate text-xs sm:text-sm ${shown ? `select-all ${link ? "text-blue-600" : "text-slate-800"}` : "text-slate-400"} ${mono ? "font-mono tracking-wider" : ""}`}
      >
        {shown || placeholder}
      </span>
      {actions.map((action) => <IconButton
        key={action.label}
        label={action.label}
        title={action.label}
        size="sm"
        disabled={Boolean(action.disabled) || (!shown && !action.always)}
        onClick={action.onClick}
        className="text-slate-500 hover:bg-slate-100 hover:text-slate-700"
      >
        {action.icon}
      </IconButton>)}
    </div>
  </div>;
}
