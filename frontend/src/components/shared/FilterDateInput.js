"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import EventIcon from "@mui/icons-material/Event";
import CalendarPanel from "./CalendarPanel";
import calendarPlacement from "./calendarPlacement";
import useCloseWhenTriggerHidden from "./useCloseWhenTriggerHidden";
import useEscapeKey from "@/components/shared/useEscapeKey";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";

/**
 * A column filter for a date: typed into like the plain filters, or picked from a calendar.
 *
 * Both matter. Typing "2026-08" narrows to a whole month, which no date picker can express,
 * while picking a day is quicker than typing it and gets the format right. The filter is
 * matched as text server-side, so whatever the calendar writes is just the ISO day the
 * column stores.
 *
 * Built to the filter row's shape - the same height, border and text size as the plain
 * inputs beside it - so the row still reads as one strip of controls.
 *
 * `range` makes it a filter for a span of date *and* time instead of a day: the box takes a typed
 * `from - to`, and the calendar opens a From and a To picker (`DateField withTime`) whose Apply
 * writes the range back into the box. The column decides the text both ways: `formatRangeEnd`
 * turns a picked `2026-10-15T21:20` into how the column writes a time, `parseRangeEnd` turns a typed
 * end back into a picker value. `invalid` marks text that is not a range yet.
 */
export default function FilterDateInput({ ariaLabel, formatRangeEnd, invalid = false, onChange, parseRangeEnd, placeholder = "Filter", range = false, value = "" }) {
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState(null);
  const wrapperRef = useRef(null);
  const panelRef = useRef(null);
  // Portalled, so scrolling the pane moves the field but not the popover; closing is
  // the honest answer, and reopening is one click.
  useCloseWhenTriggerHidden(open, wrapperRef, () => setOpen(false));

  // Closes the calendar and leaves the filter row, and the board behind it, exactly as they were.
  useEscapeKey(() => setOpen(false), open);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (wrapperRef.current?.contains(event.target)) return;
      if (panelRef.current?.contains(event.target)) return;
      // The month and year pickers portal their menus outside this panel, so a click in one is
      // still a click inside the calendar: without this, choosing a year closed the calendar.
      if (event.target.closest?.('[role="listbox"]')) return;
      // A range's pickers open calendars of their own, portalled beside this panel: choosing a day
      // in one is still choosing inside this filter, not leaving it.
      if (range && event.target.closest?.('[role="dialog"]')) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => {
      document.removeEventListener("mousedown", close);
    };
  }, [open, range]);

  // Tracked each frame while open: the filter row scrolls sideways with the table.
  useEffect(() => {
    if (!open) return undefined;
    let frame = 0;
    let previous = "";
    const track = () => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (rect) {
        const next = calendarPlacement(rect, panelRef.current?.offsetHeight);
        const signature = JSON.stringify(next);
        if (signature !== previous) {
          previous = signature;
          setPanelStyle(next);
        }
      }
      frame = window.requestAnimationFrame(track);
    };
    track();
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  return (
    <div ref={wrapperRef} className={`relative flex min-h-7 w-full items-center rounded border bg-white focus-within:ring-2 ${invalid ? "border-red-400 focus-within:border-red-500 focus-within:ring-red-100" : "border-slate-200 focus-within:border-blue-500 focus-within:ring-blue-100"}`}>
      <input
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        title={invalid ? "Not a range yet - write it as the placeholder shows, or pick it from the calendar" : undefined}
        className="min-w-0 flex-1 bg-transparent px-2 py-1 text-[11px] text-slate-600 outline-none placeholder:text-slate-400"
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={`${ariaLabel} calendar`}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-full shrink-0 items-center px-1.5 text-slate-400 transition hover:text-slate-700"
      >
        <EventIcon aria-hidden="true" sx={{ fontSize: 16 }} />
      </button>
      {open && panelStyle && typeof document !== "undefined" && createPortal(
        <span
          ref={panelRef}
          role="dialog"
          aria-label={`${ariaLabel} calendar`}
          onMouseDown={(event) => event.stopPropagation()}
          className="pointer-events-auto block max-h-[calc(100vh-24px)] overflow-y-auto rounded-2xl bg-white p-3 text-slate-700 shadow-xl ring-1 ring-slate-200"
          style={panelStyle}
        >
          {range
            ? <RangePanel
              key={value || "empty"}
              value={value}
              formatEnd={formatRangeEnd}
              parseEnd={parseRangeEnd}
              onCommit={(next) => { onChange?.(next); setOpen(false); }}
              onCancel={() => setOpen(false)}
            />
            : <CalendarPanel
            key={value || "empty"}
            // Only a full ISO day can seed the calendar; a partial filter like "2026-08" is
            // still perfectly good as text, so it is left alone and the panel opens on today.
            value={/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ""}
            onCommit={(next) => { onChange?.(next); setOpen(false); }}
            onCancel={() => setOpen(false)}
            onClear={() => { onChange?.(""); setOpen(false); }}
          />}
        </span>, document.body)}
    </div>
  );
}

/**
 * The two ends of a range filter, picked rather than typed. Opens on whatever the box already holds,
 * so adjusting one end of a typed range does not mean typing the other again. Apply with one end
 * left empty writes an open-ended range (`from -` or `- to`); Clear empties the filter.
 */
function RangePanel({ formatEnd = (end) => end, onCancel, onCommit, parseEnd = () => "", value }) {
  const [typedFrom = "", typedTo = ""] = String(value || "").split(" - ");
  const [from, setFrom] = useState(() => parseEnd(typedFrom.trim()));
  const [to, setTo] = useState(() => parseEnd(typedTo.trim()));
  const backwards = Boolean(from && to && to < from);
  const apply = () => {
    if (!from && !to) return onCommit("");
    onCommit(`${from ? formatEnd(from) : ""} - ${to ? formatEnd(to) : ""}`.trim());
  };
  return (
    <span className="flex w-[min(18rem,calc(100vw-48px))] flex-col gap-3">
      <DateField label="From" withTime value={from} maxDate={to} onChange={setFrom} placeholder="Start" />
      <DateField label="To" withTime value={to} minDate={from} onChange={setTo} placeholder="End" error={backwards ? "End time must be after start time" : ""} />
      <span className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => onCommit("")}>Clear</Button>
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="button" variant="primary" size="sm" onClick={apply} disabled={backwards}>Apply</Button>
      </span>
    </span>
  );
}
