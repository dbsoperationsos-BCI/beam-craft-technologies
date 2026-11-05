"use client";

import { useId } from "react";
import TextField from "@/components/shared/TextField";

/**
 * A colour, picked from the browser's swatch or typed as #RRGGBB - the two kept as one value. The
 * swatch is the native colour input, so the platform's own picker opens on a phone and a desktop
 * alike; the text box beside it takes a brand colour pasted in.
 */
export default function ColorField({ label, value, onChange, error = "", helperText = "", disabled = false, className = "" }) {
  const id = useId();
  const valid = /^#[0-9a-fA-F]{6}$/.test(value || "");
  return <div className={`flex items-end gap-2 ${className}`}>
    <label htmlFor={id} className="sr-only">{`${label} swatch`}</label>
    <input id={id} type="color" value={valid ? value.toLowerCase() : "#ffffff"} disabled={disabled} onChange={(event) => onChange(event.target.value.toUpperCase())} className="h-9 w-11 shrink-0 cursor-pointer rounded-lg border border-slate-300 bg-white p-1 disabled:cursor-not-allowed disabled:opacity-60" />
    <TextField label={label} value={value || ""} maxLength={7} disabled={disabled} error={error} helperText={helperText} onChange={(event) => onChange(event.target.value.trim().toUpperCase())} className="min-w-0 flex-1" />
  </div>;
}
