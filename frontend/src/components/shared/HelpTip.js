"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import InfoOutlined from "@mui/icons-material/InfoOutlined";
import { layers } from "@/constants/layers";
import useEscapeKey from "./useEscapeKey";

/**
 * A field's helper text, minimised: a small ⓘ beside the label, and the text in a tooltip.
 *
 * Every input that takes `helperText` draws this rather than a grey line under the box, so a form
 * full of fields stays one label and one box each. Opens on hover and on keyboard focus, and on a
 * tap for a phone, which has no hover; Escape, a tap elsewhere or leaving closes it. Drawn into
 * the body and kept inside the window, so a field in a dialog or near the screen's edge does not
 * clip it.
 */
export default function HelpTip({ text, className = "" }) {
  const id = useId();
  const buttonRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [place, setPlace] = useState(null);

  const close = useCallback(() => { setOpen(false); setPinned(false); }, []);

  useEffect(() => {
    if (!open || !buttonRef.current) return undefined;
    const measure = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(256, window.innerWidth - 16);
      const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8);
      // Under the ⓘ, or above it where there is no room below.
      const below = rect.bottom + 6;
      setPlace({ left, width, top: below + 80 > window.innerHeight ? null : below, bottom: below + 80 > window.innerHeight ? window.innerHeight - rect.top + 6 : null });
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => { if (!buttonRef.current?.contains(event.target)) close(); };
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [close, open]);

  useEscapeKey(close, open);

  if (!text) return null;

  return <>
    <button
      ref={buttonRef}
      type="button"
      aria-label={`Help: ${text}`}
      aria-describedby={open ? id : undefined}
      // Inside a field's <label>: the tap is the tip's, not a click on the field.
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); const next = !pinned; setPinned(next); setOpen(next); }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => { if (!pinned) setOpen(false); }}
      onFocus={() => setOpen(true)}
      onBlur={() => { if (!pinned) setOpen(false); }}
      className={`ml-1 inline-flex size-4 shrink-0 items-center justify-center rounded-full align-middle text-slate-400 transition hover:text-blue-600 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500 ${className}`}
    >
      <InfoOutlined aria-hidden="true" style={{ fontSize: 14 }} />
    </button>
    {open && place && typeof document !== "undefined" && createPortal(
      <span
        id={id}
        role="tooltip"
        style={{ left: place.left, width: place.width, ...(place.top !== null ? { top: place.top } : { bottom: place.bottom }) }}
        className={`pointer-events-none fixed ${layers.popover} rounded-md bg-slate-800 px-2.5 py-1.5 text-xs font-normal leading-snug text-white shadow-lg`}
      >
        {text}
      </span>,
      document.body,
    )}
  </>;
}
