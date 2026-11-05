"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import useCloseWhenTriggerHidden from "./useCloseWhenTriggerHidden";
import useEscapeKey from "@/components/shared/useEscapeKey";

/**
 * A column filter that can be typed into as well as picked from.
 *
 * The other column filters are plain text boxes; a closed set like Status is easier to pick
 * from a list. This is both: the text is the filter, and the list narrows as it is typed, so
 * a known value can be typed straight in without hunting the menu, and an unfamiliar one can
 * still be found by opening it.
 *
 * Styled to the filter row it sits in - the same height, border and text size as the plain
 * inputs beside it, so the row reads as one strip of controls.
 *
 * ── Options that are fetched rather than known ──
 *
 * `onOpen` is called each time the list opens, for a caller whose options are the values a column
 * actually holds - a question only the server can answer when the table is paged. It is called on
 * opening rather than on mounting because there is one of these per column and a reader opens one:
 * asking for every column's values up front would be a dozen queries over the whole board to fill a
 * menu nobody looked at. `loading` is what the menu says while that answer is on its way, so an
 * empty list reads as "still asking" rather than as "nothing here".
 */
export default function FilterCombobox({ ariaLabel, loading = false, onChange, onOpen, options = [], placeholder = "Filter", value = "" }) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState(null);
  const wrapperRef = useRef(null);
  const menuRef = useRef(null);
  /*
   * Through a ref, so a caller may pass a fresh arrow every render - which every caller does -
   * without the effect below re-firing and asking the server again on each keystroke.
   */
  const onOpenRef = useRef(onOpen);
  useEffect(() => { onOpenRef.current = onOpen; }, [onOpen]);
  // Portalled, so scrolling the pane moves the field but not the popover; closing is
  // the honest answer, and reopening is one click.
  useCloseWhenTriggerHidden(open, wrapperRef, () => setOpen(false));

  const normalized = options.map((option) => (typeof option === "string" ? { value: option, label: option } : option));
  const typed = String(value || "").trim().toLowerCase();
  // Typing narrows the list, but a value that exactly matches an option is treated as a
  // choice already made rather than a search - otherwise picking one leaves a menu of one.
  const exact = normalized.some((option) => option.label.toLowerCase() === typed);
  const shown = typed && !exact ? normalized.filter((option) => option.label.toLowerCase().includes(typed)) : normalized;

  // Closes the list and leaves the filter row, and the board behind it, exactly as they were.
  useEscapeKey(() => setOpen(false), open);

  // Opening is three gestures - the field taking focus, typing into it, and the chevron - so the
  // callback hangs off the state rather than off any one of them.
  useEffect(() => {
    if (open) onOpenRef.current?.();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (wrapperRef.current?.contains(event.target)) return;
      if (menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => {
      document.removeEventListener("mousedown", close);
    };
  }, [open]);

  // The menu is portalled, so it has to be told where the field is on every frame it is
  // open - the table it sits in scrolls horizontally underneath it.
  useEffect(() => {
    if (!open) return undefined;
    let frame = 0;
    let previous = "";
    const track = () => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (rect) {
        const padding = 12;
        const below = window.innerHeight - rect.bottom - padding;
        const above = rect.top - padding;
        const openAbove = below < 180 && above > below;
        const next = {
          position: "fixed",
          left: rect.left,
          minWidth: rect.width,
          top: openAbove ? "auto" : rect.bottom + 4,
          bottom: openAbove ? window.innerHeight - rect.top + 4 : "auto",
          maxHeight: Math.max(160, Math.min(280, openAbove ? above : below)),
        };
        const signature = JSON.stringify(next);
        if (signature !== previous) {
          previous = signature;
          setMenuStyle(next);
        }
      }
      frame = window.requestAnimationFrame(track);
    };
    track();
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const menu = open && menuStyle && typeof document !== "undefined" ? createPortal(
    <div
      ref={menuRef}
      role="listbox"
      aria-label={ariaLabel}
      style={menuStyle}
      className="z-[9999] overflow-y-auto overscroll-contain rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-[0_12px_28px_rgba(15,23,42,0.16)]"
    >
      {shown.length === 0 ? (
        // "Still asking" and "nothing to offer" are different answers, and a menu that says the
        // second while the first is true reads as a column with no values in it.
        <p className="px-3 py-2 text-slate-500">{loading ? "Loading..." : "No matches."}</p>
      ) : shown.map((option) => (
        <button
          key={option.value}
          type="button"
          role="option"
          aria-selected={option.value === value}
          onClick={() => {
            onChange?.(option.value);
            setOpen(false);
          }}
          className={`block w-full whitespace-nowrap px-3 py-2 text-left transition hover:bg-slate-50 ${
            option.value === value ? "bg-blue-50 font-medium text-blue-700" : "text-slate-700"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>,
    document.body,
  ) : null;

  return (
    <div ref={wrapperRef} className="relative flex min-h-7 w-full items-center rounded border border-slate-200 bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
      <input
        value={value}
        onChange={(event) => {
          onChange?.(event.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="min-w-0 flex-1 bg-transparent px-2 py-1 text-[11px] text-slate-600 outline-none placeholder:text-slate-400"
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={`${ariaLabel} options`}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-full shrink-0 items-center px-1 text-slate-400 transition hover:text-slate-700"
      >
        <ExpandMoreIcon aria-hidden="true" className={`transition-transform ${open ? "rotate-180" : ""}`} fontSize="small" />
      </button>
      {menu}
    </div>
  );
}
