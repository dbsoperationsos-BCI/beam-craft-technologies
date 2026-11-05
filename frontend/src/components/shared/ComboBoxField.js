"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import useCloseWhenTriggerHidden from "./useCloseWhenTriggerHidden";
import useEscapeKey from "@/components/shared/useEscapeKey";

/**
 * A form field that can be picked from a list or typed into freely.
 *
 * For values that usually come from a known set but are not closed - a relationship, or where
 * a lead heard about the studio. The list covers the common answers so they are spelled
 * consistently, and anything not on it can still be typed, because the CRM should not refuse
 * an answer the list's author did not think of.
 *
 * Borrows TextField's label, height, radius and focus ring so it lines up with the fields
 * beside it, and portals its menu so a dialog's own overflow cannot clip it.
 *
 * As in `Dropdown` and `MultiSelectField`: `disabled` is a control that is off for now and keeps its
 * chevron, because it is still a control waiting on an earlier answer. `readOnly` is a value being
 * read back, and loses it - there is no list behind it, so the arrow would be pointing at nothing.
 * It takes TextField's own read-back tone with it, grey with dimmed text, so a row of read-only
 * fields is one colour rather than each control's idea of one.
 */
export default function ComboBoxField({
  ariaLabel,
  className = "",
  disabled = false,
  // Why the value is not accepted, shown under the field and turning its outline red. It had no way
  // to say one at all, which made a required combo box the one field on a form that could refuse a
  // save and give the reader nothing to look at.
  error = "",
  hideLabel = false,
  label,
  onChange,
  options = [],
  placeholder = "Select or type",
  readOnly = false,
  required = false,
  value = "",
}) {
  const inert = disabled || readOnly;
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState(null);
  // Which option the keyboard is on. Reset to the first whenever the text changes, so typing
  // "insta" and pressing Enter takes Instagram without having to arrow onto it.
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapperRef = useRef(null);
  const menuRef = useRef(null);
  // Portalled, so scrolling the pane moves the field but not the popover; closing is
  // the honest answer, and reopening is one click.
  useCloseWhenTriggerHidden(open, wrapperRef, () => setOpen(false));

  const typed = String(value || "").trim().toLowerCase();
  // A value that exactly matches an option is a choice already made, not a search - the list
  // stays whole so the others can still be reached.
  const exact = options.some((option) => option.toLowerCase() === typed);
  const shown = typed && !exact ? options.filter((option) => option.toLowerCase().includes(typed)) : options;

  // Closes the suggestions and nothing else - not the form they are being typed into.
  useEscapeKey(() => setOpen(false), open);

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

  // Tracked per frame: the popup this sits in scrolls, and its rows move as they are filled.
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
        const openAbove = below < 200 && above > below;
        const next = {
          position: "fixed",
          left: rect.left,
          width: rect.width,
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

  /**
   * Keyboard use of the list.
   *
   * Enter takes the option the list is on - type "insta", see Instagram, press Enter and it
   * lands in the box. With nothing matching, Enter simply keeps what was typed and closes,
   * because a value off the list is a valid answer here.
   */
  function handleKeyDown(event) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) setOpen(true);
      setActiveIndex((current) => {
        if (!shown.length) return 0;
        const next = event.key === "ArrowDown" ? current + 1 : current - 1;
        return (next + shown.length) % shown.length;
      });
      return;
    }
    if (event.key === "Enter") {
      const picked = shown[activeIndex];
      if (open && picked) {
        event.preventDefault();
        onChange?.(picked);
      }
      setOpen(false);
      return;
    }
    if (event.key === "Tab") setOpen(false);
  }

  return (
    <div className={`block text-xs font-semibold text-slate-600 ${className}`}>
      {!hideLabel && <span>{label}{required && <span aria-hidden="true" className="ml-0.5 text-rose-500">*</span>}</span>}
      <span ref={wrapperRef} className={`relative flex min-h-9 w-full items-center rounded-lg border transition ${error ? "border-red-400" : "border-slate-300"} ${readOnly ? "bg-slate-100" : error ? "bg-white focus-within:border-red-500 focus-within:ring-2 focus-within:ring-red-100" : "bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100"} ${hideLabel ? "" : "mt-1.5"}`}>
        <input
          value={value}
          disabled={disabled}
          readOnly={readOnly}
          placeholder={readOnly ? "" : placeholder}
          aria-label={ariaLabel || label || placeholder}
          onChange={(event) => {
            onChange?.(event.target.value);
            setActiveIndex(0);
            if (!open) setOpen(true);
          }}
          // Read-only, focus opens nothing: there is a list behind this field and no way to choose
          // from it, so opening one would be a menu that cannot be acted on.
          onFocus={() => { if (!inert) setOpen(true); }}
          onKeyDown={(event) => { if (!inert) handleKeyDown(event); }}
          className={`min-w-0 flex-1 bg-transparent px-3 text-sm font-normal outline-none placeholder:text-slate-400 disabled:cursor-not-allowed ${readOnly ? "cursor-default text-slate-600" : "text-slate-700"}`}
        />
        {!readOnly && <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          aria-label={`${label || ariaLabel || "Field"} options`}
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className="flex shrink-0 items-center px-2 text-slate-700 transition hover:text-slate-900 disabled:cursor-not-allowed"
        >
          <ExpandMoreIcon aria-hidden="true" className={`transition-transform ${open ? "rotate-180" : ""}`} fontSize="small" />
        </button>}
      </span>
      {error && <p role="alert" className="mt-1.5 font-normal text-red-600">{error}</p>}

      {open && menuStyle && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          aria-label={label || ariaLabel || placeholder}
          style={menuStyle}
          className="z-[9999] overflow-y-auto overscroll-contain rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-[0_12px_28px_rgba(15,23,42,0.16)]"
        >
          {shown.length === 0 ? (
            <p className="px-3 py-2 font-normal text-slate-500">No match. What you type is kept.</p>
          ) : shown.map((option, index) => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={option === value}
              onClick={() => {
                onChange?.(option);
                setOpen(false);
              }}
              onMouseEnter={() => setActiveIndex(index)}
              className={`block w-full px-3 py-2 text-left font-normal transition ${
                option === value
                  ? "bg-blue-50 font-medium text-blue-700"
                  : index === activeIndex
                    ? "bg-slate-50 text-slate-700"
                    : "text-slate-700"
              }`}
            >
              {option}
            </button>
          ))}
        </div>,
        document.body)}
    </div>
  );
}
