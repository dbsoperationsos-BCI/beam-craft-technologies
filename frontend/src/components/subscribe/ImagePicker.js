"use client";

import { useState } from "react";

const MB = 1024 * 1024;
export const LOGO = { types: ["image/png"], maxBytes: 5 * MB, hint: "PNG, up to 5 MB.", accept: "image/png" };
export const FAVICON = { types: ["image/png", "image/svg+xml"], maxBytes: 1 * MB, hint: "PNG or SVG, up to 1 MB.", accept: "image/png,image/svg+xml" };

/** A logo or favicon picker: read as a data URI, refused here if it is the wrong type or too big. */
export default function ImagePicker({ label, rule, value, error, onPick, required = true }) {
  const [problem, setProblem] = useState("");
  function pick(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!rule.types.includes(file.type)) return setProblem(`${label} must be ${rule.hint.split(",")[0]}.`);
    if (file.size > rule.maxBytes) return setProblem(`${label} must be ${Math.round(rule.maxBytes / MB)} MB or smaller.`);
    setProblem("");
    const reader = new FileReader();
    reader.onload = () => onPick(String(reader.result || ""));
    reader.readAsDataURL(file);
  }
  const shown = problem || error;
  return <div className="text-[11px] font-semibold text-slate-600 sm:text-xs">
    <span>{label}{required && <span aria-hidden="true" className="ml-0.5 text-rose-500">*</span>}</span>
    <div className="mt-1.5 flex items-center gap-4">
      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-50">
        {/* eslint-disable-next-line @next/next/no-img-element -- a local data URI preview, not a served image */}
        {value ? <img src={value} alt={`${label} preview`} className="max-h-full max-w-full object-contain" /> : <span className="text-[11px] font-normal text-slate-400">No file</span>}
      </div>
      <div>
        <label className="inline-flex cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Choose file
          <input type="file" accept={rule.accept} className="sr-only" onChange={pick} />
        </label>
        <p className="mt-1.5 font-normal text-slate-500">{rule.hint}</p>
      </div>
    </div>
    {shown && <p role="alert" className="mt-1.5 font-normal text-red-600">{shown}</p>}
  </div>;
}
