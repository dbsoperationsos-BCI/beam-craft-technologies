"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useCloseWhenTriggerHidden from "./useCloseWhenTriggerHidden";
import EventIcon from "@mui/icons-material/Event";
import CalendarPanel, { parseDateKey } from "./CalendarPanel";
import useEscapeKey from "@/components/shared/useEscapeKey";

// Roughly what the calendar occupies once open, which is all the placement decision needs: whether
// there is room below the field, and where the panel's top edge goes when there is not. These match
// the size CalendarPanel actually renders at, and the ones FilterDateInput measures against; keep
// the three in step, or the calendar will be placed against a size it is not.
const CALENDAR_HEIGHT = 372;
const CALENDAR_WIDTH = 300;
const GAP = 8;
const EDGE = 12;

/*
 * ── A date, and optionally a time with it ─────────────────────────────────────────────────────
 *
 * `withTime` is what makes this the app's answer to a date *and* time, instead of the browser's.
 * There were two native `datetime-local` inputs in the whole application - the CRD document's
 * event start and end - and they were native for one reason: this field had no time, so it could
 * not express the question. A native picker beside eight of these reads as a different application,
 * looks different in every browser, and takes none of the bounds `restriction`/`minDate`/`maxDate`
 * express.
 *
 * The value is the date key with the time after a `T`, which is the shape the CRD document already
 * stored and what a native `datetime-local` input itself uses: `2026-09-08T22:30`. Without
 * `withTime` nothing changes - the value stays the plain `YYYY-MM-DD` key every existing caller
 * passes, and no time is shown or committed.
 *
 * A date chosen with no time takes `00:00` rather than refusing to commit: the studio's own data
 * has dates with no time all through it, and a calendar that will not close until somebody sets a
 * clock is a calendar people fight.
 */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DEFAULT_TIME = "00:00";

/** `2026-09-08T22:30` as its two halves. Anything unparseable gives back what it can. */
function splitDateTime(value) {
  const [datePart = "", timePart = ""] = String(value ?? "").split("T");
  return { datePart: datePart.trim(), timePart: TIME_PATTERN.test(timePart.trim()) ? timePart.trim() : "" };
}

/** What the closed field reads. The `T` is the format's, not something to show a person. */
const displayValue = (value, withTime) => (withTime ? String(value ?? "").replace("T", " ") : value);

// `labelClassName` styles the label text itself. Callers must not reach the label through an
// arbitrary variant on `className` (`[&>span:first-child]:text-slate-700`): the dark themes
// recolor text by matching plain utility classes such as `.text-slate-700`, and a color set
// through a variant escapes them, leaving a near-black label on a dark rail.
// `placeholder` is what the button reads before a day is picked. It defaults to "Select date" -
// what this field has always said - and is worth naming where two of these sit side by side and the
// empty state is the only thing telling them apart.
export default function DateField({ className = "", disabled = false, error = "", label, labelClassName = "", maxDate = "", minDate = "", onChange, placeholder = "Select date", readOnly = false, restriction = "none", required = false, value, withTime = false }) {
  const triggerRef = useRef(null);
  const calendarRef = useRef(null);
  const [open, setOpen] = useState(false);
  // Where the calendar sits on screen. It is rendered into the body rather than beside the field,
  // because a field inside a scrolling pane — the Image Selection settings rail, a table info
  // panel — would otherwise have its calendar clipped by that pane and scrolled away with the
  // content. Fixed coordinates measured from the field are what let it escape.
  const [anchor, setAnchor] = useState(null);
  const { datePart, timePart } = splitDateTime(value);
  /*
   * A value the calendar cannot open on — `#N/A`, `20sept2026`, whatever a spreadsheet left in a
   * free-text date column. It stays in the button rather than being blanked: it is the record's
   * own data, and a field that hides what it cannot read is a field quietly disagreeing with the
   * row behind it. The note under it is what makes it actionable — `parseDateKey` answers `null`
   * for it, so the grid opens on today and picking a day replaces it.
   *
   * Measured against the whole `value`, never against `datePart`: `splitDateTime` cuts on the `T`
   * that separates a date from a time, so a value that merely *starts* with one - `TBD`, `T`, `To
   * be confirmed` - splits into an empty date half and would read as a field nobody had answered
   * yet. The calendar was right either way, opening on today; it was the notice that went missing,
   * on exactly the placeholder text somebody is most likely to have typed into a date column.
   */
  const unrecognisedFormat = Boolean(String(value ?? "").trim()) && parseDateKey(datePart) === null;
  /*
   * The time being drafted, held apart from the date the calendar is drafting.
   *
   * `CalendarPanel` owns the OK button and answers with a date key alone, so the time cannot live
   * inside it. Seeded from the value each time the popover opens - keyed the same way the panel is
   * - so reopening a field shows the time it holds rather than the last one somebody typed and
   * cancelled out of.
   */
  const [draftTime, setDraftTime] = useState(timePart || DEFAULT_TIME);

  const measure = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(CALENDAR_WIDTH, window.innerWidth - 2 * EDGE);
    // Below the field when it fits, or when there is even less room above; otherwise above it.
    const above = window.innerHeight - rect.bottom < CALENDAR_HEIGHT && rect.top > window.innerHeight - rect.bottom;
    setAnchor({
      width,
      left: Math.max(EDGE, Math.min(rect.left, window.innerWidth - width - EDGE)),
      ...(above ? { bottom: window.innerHeight - rect.top + GAP } : { top: rect.bottom + GAP }),
    });
  }, []);

  // The calendar is portalled for the same reason the dropdown menu is, and carries the same cost:
  // scrolling the pane moves the field but not the calendar. Closing is the honest answer.
  useCloseWhenTriggerHidden(open, triggerRef, () => setOpen(false));

  // Closes the calendar without closing the form it was opened from.
  useEscapeKey(() => setOpen(false), open);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (!triggerRef.current?.contains(event.target) && !calendarRef.current?.contains(event.target)) setOpen(false); };

    // Fixed coordinates do not follow the field, so any scroll — including the pane the field sits
    // in, which is why this listens in the capture phase — re-measures against where it now is.
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [measure, open]);

  function toggleCalendar() {
    if (readOnly || disabled) return;
    if (!open) {
      measure();
      setDraftTime(timePart || DEFAULT_TIME);
    }
    setOpen((current) => !current);
  }

  /** What the field hands back: the date alone, or the date with the drafted time after it. */
  function commit(nextDateKey) {
    // Clearing the date clears the whole value - a time with no day is not an answer.
    onChange?.(nextDateKey && withTime ? `${nextDateKey}T${draftTime || DEFAULT_TIME}` : nextDateKey);
    setOpen(false);
  }

  return <div className={`block text-[11px] font-semibold text-slate-600 sm:text-xs ${className}`}>
    <span className={labelClassName}>{label}{required && <span aria-hidden="true" className="ml-0.5 text-rose-500">*</span>}</span>
    <span className="relative mt-1.5 block">
      {/*
        `readOnly` is a value being read back, and it loses the calendar icon with the calendar:
        there is no list to open, so an icon pointing at one is pointing at nothing. It takes
        `TextField`'s own read-back grey, so a row of read-only fields is one colour - which is
        exactly what the CRD document's Event Details block is. `disabled` keeps the icon, being a
        control waiting on an earlier answer rather than a value being shown.
      */}
      {readOnly
        ? <span className="flex min-h-9 w-full cursor-default items-center rounded-lg border border-slate-300 bg-slate-100 px-3 text-xs font-normal text-slate-600 sm:text-sm">
          <span className={`truncate ${value ? "" : "text-slate-400"}`}>{displayValue(value, withTime) || placeholder}</span>
        </span>
        : <button ref={triggerRef} type="button" disabled={disabled} onClick={toggleCalendar} className={`flex min-h-9 w-full items-center rounded-lg border bg-white px-3 text-left text-xs font-normal text-slate-700 outline-none transition sm:text-sm focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-50 ${error ? "border-red-400 focus:border-red-500 focus:ring-red-100" : unrecognisedFormat ? "border-amber-400 focus:border-amber-500 focus:ring-amber-100" : "border-slate-300 focus:border-blue-500 focus:ring-blue-100"}`}>
          <span className={`truncate ${value ? "" : "text-slate-400"}`}>{displayValue(value, withTime) || placeholder}</span><EventIcon aria-hidden="true" className="ml-auto shrink-0 text-slate-900" fontSize="small" />
        </button>}
      {open && anchor && typeof document !== "undefined" && createPortal(
        <span
          ref={calendarRef}
          role="dialog"
          aria-label={`${label} calendar`}
          onMouseDown={(event) => event.stopPropagation()}
          // The calendar is a popover and must sit above whatever opened it. A value from the
          // layers scale silently loses to any dialog stacked higher - at z-140 it opened behind
          // the Meetings dialog (z-180) and the Table Settings builder (z-170), which reads as the
          // date field being dead. 9999 matches Dropdown's portalled menu and FilterDateInput's
          // calendar, the other controls of this kind.
          style={{ position: "fixed", left: anchor.left, width: anchor.width, zIndex: 9999, ...(anchor.top === undefined ? { bottom: anchor.bottom } : { top: anchor.top }) }}
          className="pointer-events-auto block max-h-[calc(100vh-24px)] overflow-y-auto rounded-2xl bg-white p-3 text-slate-700 shadow-xl ring-1 ring-slate-200"
        >
          {/* Above the calendar rather than below it, because `CalendarPanel` ends in its own
              Clear / Cancel / OK row and a control under that row reads as belonging to nothing.
              The time is drafted here and only lands when OK does - see `commit`. */}
          {withTime && <label className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-slate-600 sm:text-xs">
            <span className="shrink-0">Time</span>
            <input
              type="time"
              value={draftTime}
              onChange={(event) => setDraftTime(event.target.value || DEFAULT_TIME)}
              aria-label={`${label} time`}
              className="min-h-9 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-xs font-normal text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:text-sm"
            />
          </label>}
          {/* Remounted per opening (keyed on the value) so the panel picks up the current
              date as its starting draft rather than keeping the last one it was opened with. */}
          <CalendarPanel
            key={value || "empty"}
            // The date half only: the panel parses a `YYYY-MM-DD` key and a value carrying a time
            // would read as no date at all, opening the calendar on today with nothing selected.
            value={datePart}
            restriction={restriction}
            maxDate={maxDate}
            minDate={minDate}
            onCommit={commit}
            onCancel={() => setOpen(false)}
            onClear={() => commit("")}
          />
        </span>, document.body)}
    </span>
    {error
      ? <p role="alert" className="mt-1.5 font-normal text-red-600">{error}</p>
      : unrecognisedFormat && <p className="mt-1.5 font-normal text-amber-600">Unrecognised date format{readOnly ? "." : " — pick a date to replace it."}</p>}
  </div>;
}
