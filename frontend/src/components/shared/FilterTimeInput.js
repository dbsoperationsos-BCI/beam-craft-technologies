"use client";

import { useEffect, useRef, useState } from "react";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import useEscapeKey from "@/components/shared/useEscapeKey";

/**
 * A column filter for a time: typed into like the plain filters, or picked from the
 * browser's own time picker - the same hour/minute/AM-PM control the Start time field in
 * Meetings uses, rather than a hand-rolled list of half-hour steps.
 *
 * Typing is kept because the filter is matched as text: "09" narrows to the nine o'clock
 * hour, which a picker that only yields a complete time cannot express.
 *
 * Two things about the native picker have to be worked around:
 *
 * It anchors to the box of the input it belongs to, not to whatever was clicked, so a small
 * input tucked against the right edge threw the panel out sideways over the next column. The
 * real input is stretched across the whole field instead, transparent and untouchable, so
 * the panel drops squarely underneath it.
 *
 * And there is no hidePicker(): the panel is tied to focus, so the only way to dismiss it is
 * to blur the input. Whether it is open therefore has to be tracked here - the browser will
 * not say - so that the clock can toggle it shut and a click anywhere else can close it.
 */
export default function FilterTimeInput({ ariaLabel, onChange, placeholder = "Filter", value = "" }) {
  const pickerRef = useRef(null);
  const wrapperRef = useRef(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // The native input only accepts a complete HH:mm. A partial filter is perfectly good text,
  // so it is left in the box and simply not handed to the picker.
  const pickerValue = /^\d{2}:\d{2}$/.test(value) ? value : "";

  function closePicker() {
    pickerRef.current?.blur();
    setPickerOpen(false);
  }

  function openPicker() {
    const input = pickerRef.current;
    if (!input) return;
    if (typeof input.showPicker === "function") {
      try {
        input.showPicker();
        setPickerOpen(true);
        return;
      } catch {
        // Refused - fall through to the click below.
      }
    }
    input.focus();
    input.click();
    setPickerOpen(true);
  }

  // Closes the clock and leaves the filter row, and the board behind it, exactly as they were.
  useEscapeKey(closePicker, pickerOpen);

  useEffect(() => {
    if (!pickerOpen) return undefined;
    // A click inside the panel itself lands on browser chrome rather than the document, so
    // this only ever fires for clicks elsewhere on the page - which should dismiss it.
    const closeOnOutside = (event) => {
      if (wrapperRef.current?.contains(event.target)) return;
      closePicker();
    };
    document.addEventListener("mousedown", closeOnOutside);
    // The table scrolls out from under an open panel, which would otherwise leave it
    // floating over unrelated columns.
    window.addEventListener("scroll", closePicker, true);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      window.removeEventListener("scroll", closePicker, true);
    };
  }, [pickerOpen]);

  return (
    <div ref={wrapperRef} className="relative flex min-h-7 w-full items-center rounded border border-slate-200 bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
      <input
        ref={pickerRef}
        type="time"
        value={pickerValue}
        onChange={(event) => onChange?.(event.target.value)}
        // Keeps our idea of "open" honest when the browser dismisses the panel on its own,
        // after a value is chosen or the window loses focus.
        onBlur={() => setPickerOpen(false)}
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
      />
      <input
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        // Typing is the other way to answer this filter, so it closes the panel rather than
        // competing with it.
        onFocus={() => pickerOpen && closePicker()}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="relative min-w-0 flex-1 bg-transparent px-2 py-1 text-[11px] text-slate-600 outline-none placeholder:text-slate-400"
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={`${ariaLabel} picker`}
        aria-expanded={pickerOpen}
        onClick={() => (pickerOpen ? closePicker() : openPicker())}
        className="relative flex h-full shrink-0 items-center px-1.5 text-slate-400 transition hover:text-slate-700"
      >
        <AccessTimeIcon aria-hidden="true" sx={{ fontSize: 16 }} />
      </button>
    </div>
  );
}
