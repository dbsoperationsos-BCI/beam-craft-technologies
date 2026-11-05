"use client";

import { useEffect, useId, useRef, useState } from "react";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";
import Dropdown from "@/components/shared/Dropdown";
import TextField from "@/components/shared/TextField";

/**
 * A table cell edited where it stands, the way a spreadsheet's is - for a register whose rows are
 * worked on line by line rather than opened one at a time.
 *
 * - `text` and `number` show their value, underlined dotted so it reads as something to change; a
 *   click (or Enter / F2 on the focused cell) opens a box in place. Enter or leaving the box saves,
 *   Escape puts the value back - and never saves, even as the box closes. After Enter, focus comes
 *   back to the cell.
 * - `select` and `date` show their own control in the cell, and save the moment a choice is made.
 *
 * `onSave(next)` is the caller's write - it is handed the raw text or option value and returns a
 * promise. While it runs the cell says so, and says Saved after. A refusal is shown on the cell and the
 * box stays open on what was typed, so nothing is lost; a write the caller withdraws (`{ cancelled }`,
 * a confirmation answered No) puts the value back quietly. A value that did not change - numbers
 * compared as numbers - is not written, and a number below `min` is refused before it is sent.
 *
 * `readOnly` draws the value alone - for a viewer who may not write, or a figure that is settled.
 * `readOnlyNote` says why on hover, where a settled figure would otherwise just stop responding.
 * The keys the cell answers (Enter, Escape, F2) and clicks inside it stop here, so editing never also
 * opens the row; every other key goes on to the table.
 */
export default function EditableCell({ value, display, type = "text", options = [], onSave, readOnly = false, readOnlyNote = "", ariaLabel, min, step, placeholder = "", clearable = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const cancelledRef = useRef(false);
  const refocusRef = useRef(false);
  const buttonRef = useRef(null);
  const errorId = useId();
  const shown = display ?? (value === null || value === undefined || value === "" ? "-" : String(value));
  const current = value === null || value === undefined ? "" : String(value);

  // "Saved" for a moment after a write, then the cell is just its value again.
  useEffect(() => {
    if (!saved) return undefined;
    const timer = window.setTimeout(() => setSaved(false), 1500);
    return () => window.clearTimeout(timer);
  }, [saved]);

  // Back to the cell once the box closes after Enter or Escape, so a keyboard keeps its place.
  useEffect(() => {
    if (editing || !refocusRef.current) return;
    refocusRef.current = false;
    buttonRef.current?.focus();
  }, [editing]);

  if (readOnly) return <span className="block truncate" title={readOnlyNote ? `${shown} - ${readOnlyNote}` : shown}>{shown}</span>;

  const unchanged = (next) => (type === "number"
    ? (String(next ?? "") === "" ? current === "" : current !== "" && Number(next) === Number(current))
    : String(next ?? "") === current);

  async function commit(next) {
    if (unchanged(next)) { setEditing(false); setError(""); return; }
    if (type === "number" && String(next ?? "") !== "" && (!Number.isFinite(Number(next)) || (min !== undefined && Number(next) < Number(min)))) {
      setError(min !== undefined ? `Enter ${min} or more.` : "Enter a number.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(next);
      setEditing(false);
      setSaved(true);
    } catch (saveError) {
      // Withdrawn by the caller - a confirmation answered No - is no failure: the value goes back.
      if (saveError?.cancelled) { setEditing(false); return; }
      setError(saveError?.data?.message || saveError?.message || "Not saved.");
    } finally {
      setSaving(false);
    }
  }

  const startEditing = () => { setDraft(current); setError(""); setEditing(true); };
  const stopKeys = (event) => { if (["Enter", "Escape", "F2"].includes(event.key)) event.stopPropagation(); };
  const textEditing = editing && (type === "text" || type === "number");

  // The cell reads in the table's own type - its size, line height and weight - whatever the
  // control inside it would set for a form: the value, the box it opens and a dropdown's or a date's
  // trigger alike. (An open menu is drawn outside the cell, so it keeps its own.)
  const wrap = (child) => <div className="min-w-0 [&_button]:![font-size:inherit] [&_button]:![line-height:inherit] [&_input]:![font-size:inherit] [&_input]:![line-height:inherit]" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onKeyDown={stopKeys}>
    {child}
    {saving && <span className="mt-0.5 block text-[11px] text-slate-500">Saving...</span>}
    {!saving && saved && <span aria-live="polite" className="mt-0.5 block text-[11px] text-emerald-700">Saved</span>}
    {/* A text box carries its own error; the controls and the closed cell show it here. */}
    {error && !textEditing && <span id={errorId} role="alert" className="mt-0.5 block whitespace-normal text-[11px] text-red-600">{error}</span>}
  </div>;

  if (type === "select") {
    return wrap(<Dropdown hideLabel label={ariaLabel} ariaLabel={ariaLabel} options={options} value={current} placeholder={placeholder || "Select"} disabled={saving} clearable={clearable} sorted={false} searchable={options.length > 8} error={error} onChange={(next) => void commit(next ?? "")} />);
  }
  if (type === "date") {
    return wrap(<DateField hideLabel label={ariaLabel} value={current} disabled={saving} placeholder={placeholder || "Select date"} error={error} onChange={(next) => void commit(next || "")} />);
  }
  if (!editing) {
    return wrap(<Button
      ref={buttonRef}
      type="button"
      variant="plain"
      size="none"
      aria-label={`${ariaLabel}: ${shown}. Edit`}
      title={`${shown} - click to edit`}
      className="block min-h-9 w-full !justify-start truncate rounded border-b border-dashed border-slate-300 px-1 text-left ![font-weight:inherit] hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
      onClick={startEditing}
      onKeyDown={(event) => { if (event.key === "F2") startEditing(); }}
    >{shown}</Button>);
  }
  return wrap(<TextField
    autoFocus
    aria-label={ariaLabel}
    aria-describedby={error ? errorId : undefined}
    type={type === "number" ? "number" : "text"}
    inputMode={type === "number" ? "decimal" : undefined}
    min={min}
    step={step}
    value={draft}
    disabled={saving}
    error={error}
    onChange={(event) => { setDraft(event.target.value); if (error) setError(""); }}
    onBlur={() => {
      // Escape closed the box: the blur that comes with it is not a save.
      if (cancelledRef.current) { cancelledRef.current = false; return; }
      if (!saving) void commit(draft);
    }}
    onKeyDown={(event) => {
      if (event.key === "Enter") { event.preventDefault(); refocusRef.current = true; void commit(draft); }
      if (event.key === "Escape") { event.preventDefault(); cancelledRef.current = true; refocusRef.current = true; setEditing(false); setError(""); }
    }}
  />);
}
