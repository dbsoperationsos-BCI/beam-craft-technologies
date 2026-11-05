"use client";

import HelpTip from "./HelpTip";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import KeyboardRoundedIcon from "@mui/icons-material/KeyboardRounded";
import ScheduleRoundedIcon from "@mui/icons-material/ScheduleRounded";
import calendarPlacement from "./calendarPlacement";
import IconButton from "./IconButton";
import useCloseWhenTriggerHidden from "./useCloseWhenTriggerHidden";
import useEscapeKey from "./useEscapeKey";
import {
  HOURS,
  MINUTES,
  angleFor,
  angleOf,
  displayOf,
  hourAt,
  minuteAt,
  partsOf,
  pointAt,
  typedHour,
  typedMinute,
  valueOf,
} from "@/lib/twelveHourTime.mjs";

/**
 * A time, with the same refusal every other field in the app shows.
 *
 * `error` reddens the border and says what is wrong under the box, the way `TextField` and
 * `DateField` do. Without it a required time refused on submit looked exactly like one that had
 * been answered - the asterisk was the only mark it ever carried, and an asterisk is there before
 * anybody gets it wrong.
 *
 * `twelveHour` - the default, everywhere - draws a clock-dial time picker of the app's own instead of
 * the browser's time box, whose 12- or 24-hour reading follows the computer's regional settings rather
 * than anything the page can ask for - so "14:00" is what a Windows machine set to 24 hours showed.
 * `twelveHour={false}` keeps the browser's box. The value is unchanged either way: `HH:MM` on the
 * 24-hour clock, handed to `onChange` as `{ target: { value } }`, the shape every caller already reads.
 */
export default function TimeField({ label, required = false, error = "", helperText = "", className = "", inputClassName = "", twelveHour = true, ...props }) {
  if (twelveHour) return <TwelveHourTimeField label={label} required={required} error={error} helperText={helperText} className={className} {...props} />;
  return <label className={`block text-xs font-semibold text-slate-600 ${className}`}><span>{label}{required && <span aria-hidden="true" className="ml-0.5 text-rose-500">*</span>}<HelpTip text={helperText} /></span><input type="time" {...props} aria-invalid={error ? true : undefined} className={`mt-1.5 block min-h-9 w-full rounded-lg border bg-white px-3 text-sm font-normal text-slate-700 outline-none transition focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 ${error ? "border-red-400 focus:border-red-500 focus:ring-red-100" : "border-slate-300 focus:border-blue-500 focus:ring-blue-100"} ${inputClassName}`} />{error && <p role="alert" className="mt-1.5 font-normal text-red-600">{error}</p>}</label>;
}

/** AM before noon and PM after it, so a time being picked starts on the half of the day it is now. */
const meridiemNow = () => (new Date().getHours() < 12 ? "AM" : "PM");

// The dial's own coordinates. The SVG scales to the panel, so a 300px phone and a laptop draw the
// same dial at different sizes and every number here stays true.
const DIAL = 240;
const CENTRE = DIAL / 2;
const LABEL_RADIUS = 92;
const KNOB_RADIUS = 20;

/**
 * The 12-hour picker, modelled on the clock-face time picker phones use: a field that reads like the
 * time it holds - `6:30 PM` beside a clock - opening a panel with the hour and minute large at the
 * top, AM / PM beside them, and a dial underneath.
 *
 * Pick the hour on the dial - tap it, or drag the hand round - and the dial turns to minutes, the way
 * the phone's does; any minute can be picked, not only the five-minute marks. Pressing the hour or
 * the minute at the top goes back to either. The keyboard at the foot swaps the dial for two boxes
 * to type into, for somebody who knows the time already, and the dial answers the arrow keys too.
 *
 * Nothing reaches the form until OK, so a half-picked time is never sent. The panel is placed like
 * the calendar (`calendarPlacement`) and portalled for the same reason: a field low in a dialog must
 * open its panel on screen, not under the dialog's edge. Its colours are the app's - the blue accent
 * and the slate greys the dark themes already recolour inside a `role="dialog"`.
 */
function TwelveHourTimeField({ label, required, error, helperText = "", className, value, onChange, disabled = false, readOnly = false, name }) {
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const dialRef = useRef(null);
  const draggingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const [draft, setDraft] = useState(() => partsOf(value));
  /** Which half of the time the dial is setting: "hour" or "minute". */
  const [mode, setMode] = useState("hour");
  /** Typing the time instead of using the dial, and what has been typed so far. */
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState({ hour: "", minute: "" });
  const inert = disabled || readOnly;
  const shown = displayOf(value);

  const measure = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setAnchor(calendarPlacement(rect, panelRef.current?.offsetHeight));
  }, []);

  // Placed again once drawn, and whenever the dial and the typing boxes swap, against its real height.
  useLayoutEffect(() => {
    if (open) measure();
  }, [measure, open, typing]);

  useCloseWhenTriggerHidden(open, triggerRef, () => setOpen(false));
  useEscapeKey(() => setOpen(false), open);

  /*
   * Focus goes to the dial when the panel opens and back to the field when it closes. The panel is
   * portalled to the end of the page, so inside a dialog - whose focus trap keeps Tab within it - a
   * keyboard could open the picker and never reach it. Typing mode focuses its own hour box.
   */
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && anchor && !typing) dialRef.current?.focus({ preventScroll: true });
    if (!open && wasOpen.current) triggerRef.current?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open, anchor, typing]);

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
    if (inert) return;
    if (!open) {
      // Starts from the time the field holds, or from nothing picked on the half of the day it is now.
      const start = value ? partsOf(value) : { hour: "", minute: "00", meridiem: meridiemNow() };
      setDraft(start);
      setTyped({ hour: start.hour, minute: start.minute });
      setMode("hour");
      setTyping(false);
      measure();
    }
    setOpen((current) => !current);
  }

  /** The time as it stands - from the dial, or from the boxes while typing. */
  const current = typing ? { hour: typedHour(typed.hour), minute: typedMinute(typed.minute), meridiem: draft.meridiem } : draft;
  const complete = Boolean(current.hour && current.minute);

  function confirm() {
    if (!complete) return;
    onChange?.({ target: { name, value: valueOf(current) } });
    setOpen(false);
  }

  /** Sets the hour or the minute from where the pointer is on the dial. */
  function pickAt(event) {
    const rect = dialRef.current?.getBoundingClientRect();
    if (!rect) return;
    const angle = angleOf(event.clientX - (rect.left + rect.width / 2), event.clientY - (rect.top + rect.height / 2));
    setDraft((before) => ({ ...before, [mode]: mode === "hour" ? hourAt(angle) : minuteAt(angle) }));
  }

  function onDialPointerDown(event) {
    draggingRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pickAt(event);
  }

  function onDialPointerUp() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    // The hour chosen, the dial moves on to the minutes, as the phone's does.
    if (mode === "hour") setMode("minute");
  }

  /** The arrow keys turn the dial; Enter moves on from the hour and confirms from the minute. */
  function onDialKeyDown(event) {
    const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[event.key];
    if (step) {
      event.preventDefault();
      setDraft((before) => {
        if (mode === "hour") return { ...before, hour: String(((((Number(before.hour) || 12) - 1 + step) % 12) + 12) % 12 + 1) };
        return { ...before, minute: String((((Number(before.minute) || 0) + step) % 60 + 60) % 60).padStart(2, "0") };
      });
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (mode === "hour" && draft.hour) setMode("minute");
      else confirm();
    }
  }

  function switchToTyping() {
    setTyped({ hour: draft.hour, minute: draft.minute });
    setTyping(true);
  }

  function switchToDial() {
    // What was typed carries over to the dial where it reads as a time; the rest stays as it was.
    setDraft((before) => ({ ...before, hour: typedHour(typed.hour) || before.hour, minute: typedMinute(typed.minute) || before.minute }));
    setTyping(false);
  }

  const selected = mode === "hour" ? draft.hour : draft.minute;
  const handAngle = angleFor(mode, selected);
  const knob = pointAt(handAngle, LABEL_RADIUS, CENTRE);
  const labels = mode === "hour" ? HOURS : MINUTES;
  // A minute between the five-minute marks has no label under the knob; a dot marks it instead.
  const offMark = mode === "minute" && selected && !MINUTES.includes(selected);

  const box = (active) => `flex h-[4.5rem] min-w-0 flex-1 items-center justify-center rounded-lg text-5xl font-normal tabular-nums transition ${active ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-900 hover:bg-slate-200"}`;
  const half = (active) => `flex flex-1 items-center justify-center px-2 text-sm font-semibold transition ${active ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-100"}`;
  const input = "h-[4.5rem] w-full min-w-0 rounded-lg border-2 border-blue-500 bg-white text-center text-5xl tabular-nums text-slate-900 outline-none focus:ring-2 focus:ring-blue-100";

  return <div className={`block text-xs font-semibold text-slate-600 ${className}`}>
    <span>{label}{required && <span aria-hidden="true" className="ml-0.5 text-rose-500">*</span>}<HelpTip text={helperText} /></span>
    <button
      ref={triggerRef}
      type="button"
      name={name}
      disabled={inert}
      onClick={toggle}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={`${label}${shown ? `, ${shown}` : ""}`}
      className={`mt-1.5 flex min-h-9 w-full items-center gap-2 rounded-lg border px-3 text-left text-sm font-normal outline-none transition focus:ring-2 disabled:cursor-not-allowed ${inert ? "bg-slate-50 text-slate-500" : "bg-white text-slate-700"} ${error ? "border-red-400 focus:border-red-500 focus:ring-red-100" : "border-slate-300 focus:border-blue-500 focus:ring-blue-100"}`}
    >
      <span className={`flex-1 tabular-nums ${shown ? "" : "text-slate-400"}`}>{shown || "Select time"}</span>
      <ScheduleRoundedIcon aria-hidden="true" fontSize="small" className="shrink-0 text-slate-500" />
    </button>
    {error && <p role="alert" className="mt-1.5 font-normal text-red-600">{error}</p>}

    {open && anchor && typeof document !== "undefined" && createPortal(
      <div
        ref={panelRef}
        role="dialog"
        aria-label={`${label} time`}
        onMouseDown={(event) => event.stopPropagation()}
        style={anchor}
        className="pointer-events-auto max-h-[calc(100dvh-24px)] overflow-y-auto rounded-2xl bg-white p-4 text-slate-700 shadow-xl ring-1 ring-slate-200"
      >
        <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{typing ? "Enter time" : "Select time"}</p>

        {/* The time, large: hour, minute, and AM / PM stacked beside them. */}
        <div className="mt-3 flex items-stretch gap-2">
          {typing
            ? <>
              <input aria-label="Hour" inputMode="numeric" maxLength={2} autoFocus value={typed.hour} onChange={(event) => setTyped((before) => ({ ...before, hour: event.target.value.replace(/\D/g, "") }))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); confirm(); } }} className={input} />
              <span aria-hidden="true" className="flex items-center text-4xl text-slate-900">:</span>
              <input aria-label="Minute" inputMode="numeric" maxLength={2} value={typed.minute} onChange={(event) => setTyped((before) => ({ ...before, minute: event.target.value.replace(/\D/g, "") }))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); confirm(); } }} className={input} />
            </>
            : <>
              <button type="button" aria-label="Choose the hour" aria-pressed={mode === "hour"} onClick={() => setMode("hour")} className={box(mode === "hour")}>{draft.hour ? draft.hour.padStart(2, "0") : "--"}</button>
              <span aria-hidden="true" className="flex items-center text-4xl text-slate-900">:</span>
              <button type="button" aria-label="Choose the minute" aria-pressed={mode === "minute"} onClick={() => setMode("minute")} className={box(mode === "minute")}>{draft.minute || "00"}</button>
            </>}
          <div role="group" aria-label="AM or PM" className="flex w-14 shrink-0 flex-col overflow-hidden rounded-lg border border-slate-300">
            {["AM", "PM"].map((choice) => <button key={choice} type="button" aria-pressed={draft.meridiem === choice} onClick={() => setDraft((before) => ({ ...before, meridiem: choice }))} className={`${half(draft.meridiem === choice)} ${choice === "PM" ? "border-t border-slate-300" : ""}`}>{choice}</button>)}
          </div>
        </div>

        {typing
          ? <p className="mt-3 text-xs font-normal text-slate-500">
            Hour 1-12 and minute 0-59.{(typed.hour && !typedHour(typed.hour)) || (typed.minute && !typedMinute(typed.minute)) ? <span className="ml-1 font-medium text-red-600">That is not a time.</span> : null}
          </p>
          // The disc is the wrapper's `bg-slate-100` and the numbers take `currentColor` from its
          // `text-slate-700`: the dark themes recolour those two classes, and would not recolour an
          // SVG `fill-*`, which left a light dial on a dark panel.
          : <div className="mx-auto mt-5 aspect-square w-full max-w-60 rounded-full bg-slate-100 text-slate-700"><svg
            ref={dialRef}
            viewBox={`0 0 ${DIAL} ${DIAL}`}
            role="slider"
            tabIndex={0}
            aria-label={mode === "hour" ? "Hour" : "Minute"}
            aria-valuemin={mode === "hour" ? 1 : 0}
            aria-valuemax={mode === "hour" ? 12 : 59}
            // `Number(selected) || undefined` lost minute 00, which is a value.
            aria-valuenow={selected ? Number(selected) : undefined}
            aria-valuetext={selected ? (mode === "hour" ? `${selected} o'clock` : `${selected} minutes`) : "None chosen"}
            onPointerDown={onDialPointerDown}
            onPointerMove={(event) => { if (draggingRef.current) pickAt(event); }}
            onPointerUp={onDialPointerUp}
            onPointerCancel={() => { draggingRef.current = false; }}
            onKeyDown={onDialKeyDown}
            // `touch-none` so dragging the hand round turns the dial rather than scrolling the page.
            className="block h-full w-full cursor-pointer touch-none select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
          >
            {selected && <>
              <line x1={CENTRE} y1={CENTRE} x2={knob.x} y2={knob.y} strokeWidth={2} className="stroke-blue-600" />
              <circle cx={CENTRE} cy={CENTRE} r={4} className="fill-blue-600" />
              <circle cx={knob.x} cy={knob.y} r={KNOB_RADIUS} className="fill-blue-600" />
              {offMark && <circle cx={knob.x} cy={knob.y} r={3} className="fill-white" />}
            </>}
            {labels.map((text, index) => {
              const at = pointAt(index * 30, LABEL_RADIUS, CENTRE);
              const chosen = text === selected || (mode === "hour" && text === draft.hour);
              return <text key={text} x={at.x} y={at.y} textAnchor="middle" dominantBaseline="central" className={`pointer-events-none text-[15px] ${chosen ? "fill-white font-semibold" : "fill-current"}`}>{text}</text>;
            })}
          </svg></div>}

        <div className="mt-4 flex items-center justify-between">
          <IconButton
            label={typing ? "Pick the time on the clock" : "Type the time"}
            title={typing ? "Pick the time on the clock" : "Type the time"}
            onClick={typing ? switchToDial : switchToTyping}
            className="text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            {typing ? <ScheduleRoundedIcon fontSize="small" aria-hidden="true" /> : <KeyboardRoundedIcon fontSize="small" aria-hidden="true" />}
          </IconButton>
          <span className="flex items-center gap-1 text-sm font-semibold">
            <button type="button" onClick={() => setOpen(false)} className="min-h-10 rounded-md px-3 text-blue-600 hover:bg-blue-50 hover:text-blue-700">Cancel</button>
            <button type="button" disabled={!complete} onClick={confirm} className="min-h-10 rounded-md px-3 text-blue-600 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent">OK</button>
          </span>
        </div>
      </div>,
      document.body,
    )}
  </div>;
}
