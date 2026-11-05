"use client";

import { useRef } from "react";

/**
 * A single choice made between a few options whose difference IS their description: a radio group
 * drawn as cards (label over one line of explanation), the selected one tinted. Arrow keys move the
 * choice the way a native radio group does, and only the chosen card is in the tab order.
 *
 * `options`: [{ value, label, description }]. `columns` lays the cards out from `sm` up (they
 * always stack on a phone).
 */
export default function ChoiceCards({ options, value, onChange, ariaLabel, columns = 1, disabled = false, error = "", className = "" }) {
  const refs = useRef([]);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const grid = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 xl:grid-cols-4" }[columns] || "";
  function onKeyDown(event, index) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  }
  return (<>
    <div role="radiogroup" aria-label={ariaLabel} aria-invalid={error ? true : undefined} className={`grid gap-2 ${grid} ${className}`}>
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => { refs.current[index] = node; }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={index === selectedIndex ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`min-h-11 rounded-[14px] border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-60 ${checked ? "border-blue-500 bg-blue-50/60" : error ? "border-red-400 bg-white" : "border-slate-300 bg-white hover:border-slate-400"}`}
          >
            <span className={`block text-xs font-semibold ${checked ? "text-blue-700" : "text-slate-700"}`}>{option.label}</span>
            {option.description && <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{option.description}</span>}
          </button>
        );
      })}
    </div>
    {error && <p role="alert" className="mt-1.5 text-xs font-normal text-red-600">{error}</p>}
  </>);
}
