"use client";

import { useState } from "react";
import Button from "@/components/shared/Button";
import HelpTip from "@/components/shared/HelpTip";
import CloseIcon from "@/components/ui/CloseIcon";
import { addListEntry, removeListEntry } from "@/lib/aiEventDefaults.mjs";

/**
 * A short list of plain words edited as chips - the event types a studio offers, the file formats
 * it accepts. Each entry is a chip with its own ×; a new one is typed into the box and added with
 * Enter or the button.
 *
 * The value is the same array of strings the server already stores, so this changes only how the
 * list is edited: the previous comma-separated box hid a missing comma until two types became one,
 * and offered no way to take one off without retyping the rest.
 *
 * `protect(item)` names an entry that may not be removed - the type currently chosen as the default,
 * which would otherwise leave the Default event type pointing at nothing - and `min` keeps the list
 * from being emptied where the server refuses an empty one.
 */
export default function ChipListField({
  label, values = [], onChange, placeholder = "Add…", addLabel = "Add", description,
  max = 40, maxLength = 60, min = 0, normalize, protect, protectedReason, disabled = false,
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  const add = () => {
    const next = addListEntry(values, draft, { max, maxLength, normalize });
    setError(next.error);
    if (next.error) return;
    if (next.list !== values) onChange(next.list);
    setDraft("");
  };
  const remove = (item) => {
    const next = removeListEntry(values, item, { min });
    if (next !== values) onChange(next);
  };

  return <div>
    <p className="text-[11px] font-semibold text-slate-600 sm:text-xs">{label}<HelpTip text={description} /></p>
    <ul className="mt-2 flex flex-wrap gap-2" aria-label={label}>
      {values.map((item) => {
        const held = protect?.(item);
        const canRemove = !disabled && !held && values.length > min;
        return <li key={item} className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-300 bg-slate-50 py-1 pl-3 pr-1.5 text-xs text-slate-700 sm:text-sm">
          <span className="truncate">{item}</span>
          {canRemove
            ? <button type="button" onClick={() => remove(item)} aria-label={`Remove ${item}`} className="rounded-full p-0.5 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"><CloseIcon aria-hidden="true" sx={{ fontSize: 14 }} /></button>
            : <span className="w-1.5" title={held ? protectedReason : undefined} />}
        </li>;
      })}
      {values.length === 0 && <li className="text-xs text-slate-400">Nothing listed yet.</li>}
    </ul>
    {!disabled && <div className="mt-2 flex gap-2">
      <input
        type="text"
        value={draft}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-label={`New ${label.toLowerCase()}`}
        aria-invalid={error ? true : undefined}
        onChange={(event) => { setDraft(event.target.value); if (error) setError(""); }}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }}
        className={`block min-h-9 min-w-0 flex-1 rounded-lg border bg-white px-3 text-xs text-slate-700 outline-none transition focus:ring-2 sm:text-sm ${error ? "border-red-400 focus:border-red-500 focus:ring-red-100" : "border-slate-300 focus:border-blue-500 focus:ring-blue-100"}`}
      />
      <Button type="button" size="sm" onClick={add} disabled={!draft.trim()}>+ {addLabel}</Button>
    </div>}
    {error && <p role="alert" className="mt-1.5 text-xs text-red-600">{error}</p>}
  </div>;
}
