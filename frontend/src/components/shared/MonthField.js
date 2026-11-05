"use client";

import HelpTip from "./HelpTip";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import EventIcon from "@mui/icons-material/Event";
import Button from "@/components/shared/Button";
import IconButton from "@/components/shared/IconButton";
import calendarPlacement from "./calendarPlacement";
import useCloseWhenTriggerHidden from "./useCloseWhenTriggerHidden";
import useEscapeKey from "@/components/shared/useEscapeKey";

/**
 * A month and its year, picked in one place - the payroll register's period, say.
 *
 * Two dropdowns did this before, a month list and a year list, each a scrolling menu - and a menu
 * as narrow as its button cut "September" off and needed a sideways scrollbar to read it. This is
 * the calendar's own shape, one level up: a button that says "October 2026", and a panel with the
 * year between two arrows and the twelve months in a 3 x 4 grid, every name whole. Picking a month
 * is the answer, so there is no OK; Escape, a click outside or the trigger scrolling away closes it.
 *
 * Portalled and placed the way `DateField`'s calendar is (`calendarPlacement`), so it escapes a
 * scrolling pane and sits above whatever opened it. Opening it moves focus onto the chosen month -
 * or this month, or January - so a keyboard reaches the grid at once rather than after the whole
 * page; Tab walks the arrows and the months, and closing hands focus back to the button.
 *
 * `value` and `onChange` speak `{ year, month }` - numbers, month 1 to 12. `minYear` / `maxYear`
 * bound the arrows; the year shown never passes them.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function MonthField({ label, hideLabel = false, ariaLabel, value, onChange, minYear = null, maxYear = null, disabled = false, error = "", helperText = "", className = "" }) {
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);
  // The year the grid is showing, which the arrows move without choosing anything yet.
  const [viewYear, setViewYear] = useState(Number(value?.year) || new Date().getFullYear());
  // Set once focus has gone into the panel for this opening - the anchor moves on every scroll.
  const focusedRef = useRef(false);
  const year = Number(value?.year) || null;
  const month = Number(value?.month) || null;
  const today = new Date();

  const measure = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setAnchor(calendarPlacement(rect, panelRef.current?.offsetHeight));
  }, []);

  useLayoutEffect(() => {
    if (open) measure();
  }, [measure, open]);
  // Into the grid once it is placed: the chosen month, else this month, else January.
  useEffect(() => {
    if (!open) { focusedRef.current = false; return; }
    if (!anchor || focusedRef.current || !panelRef.current) return;
    focusedRef.current = true;
    const target = panelRef.current.querySelector('[aria-pressed="true"]')
      || panelRef.current.querySelector('[aria-current="date"]')
      || panelRef.current.querySelector("[data-month]");
    target?.focus();
  }, [open, anchor]);
  useCloseWhenTriggerHidden(open, triggerRef, () => setOpen(false));
  useEscapeKey(() => setOpen(false), open);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (!triggerRef.current?.contains(event.target) && !panelRef.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [measure, open]);

  function toggle() {
    if (disabled) return;
    if (!open) {
      setViewYear(year || today.getFullYear());
      measure();
    }
    setOpen((current) => !current);
  }

  function pick(nextMonth) {
    onChange?.({ year: viewYear, month: nextMonth });
    setOpen(false);
    triggerRef.current?.focus();
  }

  const canBack = minYear == null || viewYear > minYear;
  const canForward = maxYear == null || viewYear < maxYear;
  const shown = year && month ? `${MONTH_NAMES[month - 1]} ${year}` : "Choose a month";

  // `relative` holds a hidden label (`sr-only`) inside the field, as Dropdown's does.
  return <div className={`relative block text-[11px] font-semibold text-slate-600 sm:text-xs ${className}`}>
    <span className={hideLabel ? "sr-only" : ""}>{label}<HelpTip text={helperText} /></span>
    <span className={`relative block ${hideLabel ? "" : "mt-1.5"}`}>
      <button
        ref={triggerRef}
        type="button"
        data-field-control
        data-invalid={error ? true : undefined}
        disabled={disabled}
        aria-label={`${ariaLabel || label}: ${shown}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
        className={`flex min-h-9 w-full items-center gap-2 whitespace-nowrap rounded-lg border bg-white px-3 text-left text-xs font-normal text-slate-700 outline-none transition focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-50 sm:text-sm ${error ? "border-red-400 focus:border-red-500 focus:ring-red-100" : "border-slate-300 focus:border-blue-500 focus:ring-blue-100"}`}
      >
        <span>{shown}</span>
        <EventIcon aria-hidden="true" className="ml-auto shrink-0 text-slate-900" fontSize="small" />
      </button>
      {open && anchor && typeof document !== "undefined" && createPortal(
        <span
          ref={panelRef}
          role="dialog"
          aria-label={`${ariaLabel || label} - choose a month`}
          onMouseDown={(event) => event.stopPropagation()}
          style={anchor}
          className="pointer-events-auto block max-h-[calc(100vh-24px)] overflow-y-auto rounded-2xl bg-white p-3 text-slate-700 shadow-xl ring-1 ring-slate-200"
        >
          <span className="mb-2 flex items-center justify-between">
            <IconButton label="Previous year" size="sm" shape="circle" disabled={!canBack} onClick={() => setViewYear((current) => current - 1)}>
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
            <span className="text-sm font-semibold text-slate-900" aria-live="polite">{viewYear}</span>
            <IconButton label="Next year" size="sm" shape="circle" disabled={!canForward} onClick={() => setViewYear((current) => current + 1)}>
              <ChevronRightIcon fontSize="small" />
            </IconButton>
          </span>
          <span className="grid grid-cols-3 gap-1.5">
            {MONTHS.map((short, index) => {
              const number = index + 1;
              const chosen = year === viewYear && month === number;
              const current = today.getFullYear() === viewYear && today.getMonth() + 1 === number;
              return <Button
                key={short}
                type="button"
                variant={chosen ? "primary" : "ghost"}
                size="sm"
                aria-pressed={chosen}
                // This month is ringed - and said so - so "now" can be found from any year's page.
                aria-current={current ? "date" : undefined}
                aria-label={`${MONTH_NAMES[index]} ${viewYear}`}
                data-month={number}
                className={`min-h-10 w-full ${current && !chosen ? "ring-1 ring-blue-400" : ""}`}
                onClick={() => pick(number)}
              >
                {short}
              </Button>;
            })}
          </span>
        </span>, document.body)}
    </span>
    {error && <p role="alert" className="mt-1.5 font-normal text-red-600">{error}</p>}
  </div>;
}
