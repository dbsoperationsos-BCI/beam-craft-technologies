"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import EventIcon from "@mui/icons-material/Event";
import CalendarPanel from "./CalendarPanel";
import useCloseWhenTriggerHidden from "./useCloseWhenTriggerHidden";
import useEscapeKey from "@/components/shared/useEscapeKey";

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
 */
export default function FilterDateInput({ ariaLabel, onChange, placeholder = "Filter", value = "" }) {
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
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => {
      document.removeEventListener("mousedown", close);
    };
  }, [open]);

  // Tracked each frame while open: the filter row scrolls sideways with the table.
  useEffect(() => {
    if (!open) return undefined;
    let frame = 0;
    let previous = "";
    const track = () => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (rect) {
        const width = window.innerWidth < 640 ? Math.min(window.innerWidth - 24, 300) : 300;
        const height = 372;
        const spaceBelow = window.innerHeight - rect.bottom - 12;
        const placeAbove = spaceBelow < height && rect.top - 12 > spaceBelow;
        const next = {
          position: "fixed",
          left: Math.min(Math.max(12, rect.left), window.innerWidth - width - 12),
          top: placeAbove ? Math.max(12, rect.top - height - 8) : rect.bottom + 8,
          width,
          zIndex: 9999,
        };
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
    <div ref={wrapperRef} className="relative flex min-h-7 w-full items-center rounded border border-slate-200 bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
      <input
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
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
          <CalendarPanel
            key={value || "empty"}
            // Only a full ISO day can seed the calendar; a partial filter like "2026-08" is
            // still perfectly good as text, so it is left alone and the panel opens on today.
            value={/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ""}
            onCommit={(next) => { onChange?.(next); setOpen(false); }}
            onCancel={() => setOpen(false)}
            onClear={() => { onChange?.(""); setOpen(false); }}
          />
        </span>, document.body)}
    </div>
  );
}
