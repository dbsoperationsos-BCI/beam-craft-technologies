"use client";

import { useMemo, useState } from "react";
import Dropdown from "./Dropdown";

/**
 * The month grid itself, without any opinion about what opens it.
 *
 * Pulled out of DateField so the column filters can offer the same calendar rather than a
 * second one drawn slightly differently. Everything that makes a calendar a calendar - the
 * month and year steppers, today's marker, the past/future restriction, Clear/Cancel/OK -
 * lives here once, including the double-click that takes a day straight into the field.
 *
 * The caller owns positioning and whatever the panel is anchored to.
 */

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const weekdayNames = ["S", "M", "T", "W", "T", "F", "S"];
const pad = (value) => String(value).padStart(2, "0");

export const toDateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/*
 * ── What a value has to be before the grid will open on it ────────────────────────────────────
 *
 * This was `new Date(`${value}T00:00:00`)`, which trusts the column to hold a date key. The
 * studio's free-text date columns do not: leads carry `#N/A`, `20sept2026` and whatever else a
 * spreadsheet left behind. `new Date("#N/AT00:00:00")` is an **Invalid Date** — an object, so
 * truthy, so it became `draftDate` and `viewDate` below and every `getFullYear()`/`getMonth()`
 * read `NaN`. That is the "NaN, NaN" in the calendar header, an empty grid under it, and no way
 * to pick a day — the field dead for exactly the lead somebody was trying to fix.
 *
 * `DD/MM/YYYY` is accepted beside the key because it is a real answer rather than junk: it is the
 * second shape `sales_crm_lead`'s generated `follow_up_day` column parses, so the board and the
 * follow-up tabs already count those leads as scheduled, and a calendar refusing to open on one
 * would be this component disagreeing with the database about a date they both hold. Read
 * day-first, which is what that column does. Committing normalises it — `toDateKey` only ever
 * writes the key — so a lead edited once stops being the odd one out.
 *
 * Anything else answers `null`, exactly as an empty value does: the grid opens on today and the
 * day is there to be picked. The text is never touched — `DateField` goes on showing it and marks
 * it as an unrecognised format, so nobody loses a value they were meant to read.
 */
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})/;
const SLASH_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/*
 * Matching the shape is not enough on its own: `2026-02-31` and `31/04/2026` are the right shape
 * and no day at all. `new Date(2026, 1, 31)` rolls forward into March rather than refusing, so the
 * only honest test is to build the date and ask whether it kept the three numbers it was handed.
 */
/*
 * How tall the month and year menus may be.
 *
 * They were native `<select>`s, and a native list of eighty-odd years is drawn by the browser: on
 * Windows and on a phone that is a list as tall as the window, over the calendar that opened it.
 * The shared `Dropdown` draws its own menu instead, measured against the room the trigger has and
 * capped here, so the years scroll inside a box the size of the calendar rather than taking the page.
 */
const MENU_MAX_HEIGHT = 240;

const dayOrNull = (year, month, day) => {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
};

export const parseDateKey = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const key = DATE_KEY.exec(text);
  if (key) return dayOrNull(Number(key[1]), Number(key[2]), Number(key[3]));
  const slash = SLASH_DATE.exec(text);
  if (slash) return dayOrNull(Number(slash[3]), Number(slash[2]), Number(slash[1]));
  return null;
};
export const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

function monthDays(monthDate) {
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const firstCell = new Date(first);
  firstCell.setDate(1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstCell);
    date.setDate(firstCell.getDate() + index);
    return date;
  });
}

export default function CalendarPanel({ maxDate = "", minDate = "", onCancel, onClear, onCommit, restriction = "none", value = "" }) {
  const selectedDate = parseDateKey(value);
  const latest = parseDateKey(maxDate);
  const earliest = parseDateKey(minDate);
  /*
   * Where the grid opens when nothing is chosen yet.
   *
   * Today, unless today is outside the bounds — a date of birth calendar stops eighteen years ago,
   * and opening it on this month would show a page of disabled days and leave OK committing one of
   * them. The nearest day it *will* accept is the honest place to start.
   */
  const opensOn = () => {
    const today = startOfDay(new Date());
    if (latest && today > startOfDay(latest)) return startOfDay(latest);
    if (earliest && today < startOfDay(earliest)) return startOfDay(earliest);
    return today;
  };
  const [draftDate, setDraftDate] = useState(() => selectedDate || opensOn());
  const [viewDate, setViewDate] = useState(() => selectedDate || opensOn());
  const days = useMemo(() => monthDays(viewDate), [viewDate]);
  const calendarYears = useMemo(
    () => Array.from({ length: Math.max(new Date().getFullYear() + 10, viewDate.getFullYear() + 10) - 1950 + 1 }, (_, index) => 1950 + index),
    [viewDate],
  );
  const today = startOfDay(new Date());

  /*
   * `maxDate` and `minDate` are the bounds a *rule* puts on the field rather than the ones "not in
   * the past" and "not in the future" express — the last day that still leaves somebody eighteen,
   * say. They are checked alongside `restriction`, not instead of it, so a field may carry both.
   */
  const isDisabled = (date) => {
    const day = startOfDay(date);
    if (latest && day > startOfDay(latest)) return true;
    if (earliest && day < startOfDay(earliest)) return true;
    return restriction === "past" ? day < today : restriction === "future" ? day > today : false;
  };
  const changeMonth = (offset) => setViewDate((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  const changeYear = (offset) => setViewDate((current) => new Date(current.getFullYear() + offset, current.getMonth(), 1));

  return (
    <>
      <span className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => changeMonth(-1)} aria-label="Previous month" className="rounded p-1 hover:bg-slate-100">‹</button>
        <Dropdown
          mode="switch"
          hideLabel
          label="Calendar month"
          value={String(viewDate.getMonth())}
          onChange={(value) => setViewDate((current) => new Date(current.getFullYear(), Number(value), 1))}
          options={monthNames.map((month, index) => ({ value: String(index), label: month }))}
          sorted={false}
          searchable={false}
          menuMaxHeight={MENU_MAX_HEIGHT}
        />
        <button type="button" onClick={() => changeMonth(1)} aria-label="Next month" className="rounded p-1 hover:bg-slate-100">›</button>
        <span className="mx-1 h-5 border-l border-slate-200" />
        <button type="button" onClick={() => changeYear(-1)} aria-label="Previous year" className="rounded p-1 hover:bg-slate-100">‹</button>
        {/* Typed into rather than scrolled through: eighty-odd years is a long way to drag to 1994. */}
        <Dropdown
          mode="switch"
          hideLabel
          label="Calendar year"
          value={String(viewDate.getFullYear())}
          onChange={(value) => setViewDate((current) => new Date(Number(value), current.getMonth(), 1))}
          options={calendarYears.map((year) => ({ value: String(year), label: String(year) }))}
          sorted={false}
          searchable
          menuMaxHeight={MENU_MAX_HEIGHT}
        />
        <button type="button" onClick={() => changeYear(1)} aria-label="Next year" className="rounded p-1 hover:bg-slate-100">›</button>
      </span>

      <span className="mt-3 grid grid-cols-7 gap-y-1 text-center text-sm">
        {weekdayNames.map((day, index) => <span key={`${day}-${index}`} className="py-1 font-medium">{day}</span>)}
        {days.map((date) => {
          const key = toDateKey(date);
          const selected = draftDate && key === toDateKey(draftDate);
          const isToday = key === toDateKey(today);
          const outsideMonth = date.getMonth() !== viewDate.getMonth();
          const unavailable = isDisabled(date);
          return (
            <button
              key={key}
              type="button"
              aria-current={isToday ? "date" : undefined}
              disabled={unavailable}
              onClick={() => setDraftDate(date)}
              /*
               * A double-click is the date and the OK in one.
               *
               * One click still only marks the day, so the month and year steppers, Clear and
               * Cancel all behave as they did - but picking a date and then reaching for OK is two
               * moves for one decision, and this is the shortcut every date field in the OS now
               * shares because they are all drawn by this panel.
               */
              onDoubleClick={() => onCommit?.(toDateKey(date))}
              className={`mx-auto flex h-9 w-9 items-center justify-center rounded-full text-sm ${
                selected
                  ? "bg-blue-600 font-semibold text-white"
                  : isToday
                    ? "font-semibold text-blue-700 ring-1 ring-inset ring-blue-500 hover:bg-blue-50"
                    : outsideMonth
                      ? "text-slate-400"
                      : "hover:bg-slate-100"
              } disabled:cursor-not-allowed disabled:opacity-35`}
            >
              {date.getDate()}
            </button>
          );
        })}
      </span>

      <span className="mt-4 flex items-center justify-between text-sm font-medium">
        <button type="button" onClick={onClear} className="text-blue-600 hover:text-blue-700">Clear</button>
        <span className="flex items-center gap-5">
          <button type="button" onClick={onCancel} className="text-blue-600 hover:text-blue-700">Cancel</button>
          <button type="button" onClick={() => onCommit?.(draftDate ? toDateKey(draftDate) : "")} className="text-blue-600 hover:text-blue-700">OK</button>
        </span>
      </span>
    </>
  );
}
