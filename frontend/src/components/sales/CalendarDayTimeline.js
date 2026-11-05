"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Button from "@/components/shared/Button";
import { scheduleEntryCell, scheduleKind } from "@/lib/schedule";
import { SLOTS_PER_HOUR, WORKDAY_START_HOUR, dayTimeline, hourLabel, minutesLabel, spanSlots } from "@/lib/dayTimeline.mjs";

/**
 * The calendar's Day view, hour by hour - laid out as the Shoot Board is: what is booked down the
 * left, the hours across the top, and each booking as a bar from its start to its end
 * (`lib/dayTimeline.mjs` says when each kind runs). What has no hour - Absent and the other attendance
 * marks, a holiday, a shoot with no start time - is a bar across the whole day, among the
 * rest, reading All day.
 *
 * The hours scroll sideways inside the pane and the booking column stays put; five minutes
 * is a column, so 6:30 starts half-way across 6 pm. Each hour's header carries the day's ⋮
 * (`hourMenu(hour)`), so what is started from it starts at that hour. Each row's label carries its time too, so a short
 * bar still says when it is. On today, a line marks the time now, and the pane opens scrolled to it -
 * on another day, to the first booking.
 */
export default function CalendarDayTimeline({ dateLabel, isToday, entries, hourMenu, onOpen, tooltip }) {
  const { timed, firstHour, hours } = useMemo(() => dayTimeline(entries), [entries]);
  const slots = hours.length * SLOTS_PER_HOUR;
  const now = useNow(isToday);
  const nowSlot = isToday && now !== null && now >= firstHour * 60 && now < (firstHour + hours.length) * 60
    ? Math.floor((now - firstHour * 60) / (60 / SLOTS_PER_HOUR))
    : null;

  // All 24 hours are there to scroll through; the pane opens at now on today, at the first booking
  // on any other day, and at 8 am on a day with neither - a 5 pm shoot is otherwise off the edge. Once per day shown, so it does not pull back while somebody scrolls.
  const scrollRef = useRef(null);
  const scrolledFor = useRef(null);
  // A whole-day row starts at midnight, so the first booking with an hour of its own is what it opens at.
  const firstTimed = timed.find((row) => !row.allDay);
  const focusSlot = nowSlot ?? (firstTimed ? spanSlots(firstTimed, firstHour).from : (WORKDAY_START_HOUR - firstHour) * SLOTS_PER_HOUR);
  useEffect(() => {
    const box = scrollRef.current;
    if (!box || focusSlot === null || scrolledFor.current === dateLabel) return;
    scrolledFor.current = dateLabel;
    const corner = box.querySelector("[data-corner]");
    const slotWidth = (box.scrollWidth - (corner?.offsetWidth || 0)) / slots;
    // An hour of room before it, so what comes just before is in sight as well.
    box.scrollLeft = Math.max(0, (focusSlot - SLOTS_PER_HOUR) * slotWidth);
  }, [dateLabel, focusSlot, slots]);

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5">
      <span className={`text-xs font-semibold ${isToday ? "text-blue-700" : "text-slate-700"}`}>
        {isToday ? `Today · ${dateLabel}` : dateLabel}
        <span className="ml-2 font-normal text-slate-500">{entries.length ? `${entries.length} booked` : "Nothing booked"}</span>
      </span>
    </div>

    <div ref={scrollRef} role="region" aria-label={`Bookings by hour on ${dateLabel}`} className="min-h-0 flex-1 overflow-auto overscroll-x-contain bg-white [--hour-width:8rem] [--label-width:9rem] sm:[--label-width:13rem]">
      <div
        className="grid min-h-full w-full"
        style={{
          minWidth: `calc(var(--label-width) + ${hours.length} * var(--hour-width))`,
          gridTemplateColumns: `var(--label-width) repeat(${slots}, minmax(calc(var(--hour-width) / ${SLOTS_PER_HOUR}), 1fr))`,
          gridTemplateRows: `auto repeat(${Math.max(timed.length, 1)}, minmax(3.25rem, auto)) 1fr`,
        }}
      >
        {/* The corner and the hour row stay put while the grid scrolls under them. */}
        <div data-corner className="sticky left-0 top-0 z-30 flex items-end border-b border-r border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600" style={{ gridColumn: 1, gridRow: 1 }}>
          Booked{timed.length ? ` (${timed.length})` : ""}
        </div>
        {hours.map((hour, index) => <div
          key={hour}
          className={`sticky top-0 z-20 flex items-center justify-between gap-1 border-b border-slate-300 bg-slate-50 py-1 pl-1.5 pr-0.5 text-[11px] font-medium text-slate-500 ${index ? "border-l" : ""}`}
          style={{ gridColumn: `${index * SLOTS_PER_HOUR + 2} / span ${SLOTS_PER_HOUR}`, gridRow: 1 }}
        >
          <span className="whitespace-nowrap">{hourLabel(hour)}</span>
          {hourMenu?.(hour)}
        </div>)}

        {timed.map((row, rowIndex) => {
          const { entry } = row;
          // A project's shoots that run into each other are one row: their names together, as the Shoot Board shows them.
          const title = row.entries.map((one) => one.title).join(" · ");
          const references = [...new Set(row.entries.map((one) => one.reference).filter(Boolean))].join(" · ");
          const gridRow = rowIndex + 2;
          const { from, to } = spanSlots(row, firstHour);
          // A whole-day row - Absent, a holiday, an untimed shoot - reads All day, across every hour.
          const when = row.allDay ? "All day" : `${minutesLabel(row.start)} – ${row.end >= 24 * 60 ? "midnight" : minutesLabel(row.end)}`;
          return [
            <div key={`${entry.id}-label`} className="sticky left-0 z-10 flex min-w-0 items-center gap-2 border-r border-slate-300 bg-white px-3 py-1.5" style={{ gridColumn: 1, gridRow }}>
              <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${scheduleKind(entry.kind).dot}`} />
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold text-slate-900">{title}</span>
                <span className="block truncate text-[11px] text-slate-500">{when}</span>
              </span>
            </div>,
            // The hour cells behind the bar: the lines between hours.
            ...hours.map((hour, index) => <div key={`${entry.id}-${hour}`} aria-hidden="true" className={index ? "border-l border-slate-200" : ""} style={{ gridColumn: `${index * SLOTS_PER_HOUR + 2} / span ${SLOTS_PER_HOUR}`, gridRow }} />),
            <div key={`${entry.id}-bar`} className="relative z-[5] flex min-w-0 items-center px-0.5 py-1" style={{ gridColumn: `${from + 2} / ${to + 2}`, gridRow }}>
              <Button
                type="button"
                variant="plain"
                size="none"
                onClick={() => onOpen(entry, row.entries)}
                title={row.entries.map(tooltip).join(" | ")}
                aria-label={[scheduleKind(entry.kind).label.replace(/s$/, ""), title, when, entry.location].filter(Boolean).join(", ")}
                className={`h-full min-h-10 w-full min-w-0 overflow-hidden rounded-lg !justify-start text-left shadow-sm transition hover:shadow-md ${scheduleEntryCell(entry)}`}
              >
                <span aria-hidden="true" className={`w-1.5 self-stretch ${scheduleKind(entry.kind).dot}`} />
                <span className="min-w-0 flex-1 px-2 py-1">
                  <span className="block truncate text-xs font-semibold">{title}</span>
                  <span className="block truncate text-[11px] opacity-80">{[references, entry.location].filter(Boolean).join(" · ") || scheduleKind(entry.kind).label.replace(/s$/, "")}</span>
                </span>
              </Button>
            </div>,
          ];
        })}

        {/* Nothing at an hour: one empty row, the hour lines still through it, and why. */}
        {!timed.length && <>
          <div className="sticky left-0 z-10 flex items-center border-r border-slate-300 bg-white px-3 py-2 text-xs text-slate-500" style={{ gridColumn: 1, gridRow: 2 }}>
            Nothing booked
          </div>
          {hours.map((hour, index) => <div key={`empty-${hour}`} aria-hidden="true" className={index ? "border-l border-slate-200" : ""} style={{ gridColumn: `${index * SLOTS_PER_HOUR + 2} / span ${SLOTS_PER_HOUR}`, gridRow: 2 }} />)}
        </>}

        {/* The filler row: the hour lines carried down to the bottom. */}
        <div aria-hidden="true" className="sticky left-0 z-10 border-r border-slate-300 bg-white" style={{ gridColumn: 1, gridRow: Math.max(timed.length, 1) + 2 }} />
        {hours.map((hour, index) => <div key={`filler-${hour}`} aria-hidden="true" className={index ? "border-l border-slate-200" : ""} style={{ gridColumn: `${index * SLOTS_PER_HOUR + 2} / span ${SLOTS_PER_HOUR}`, gridRow: Math.max(timed.length, 1) + 2 }} />)}

        {/* Now, on today: a line down through every row. */}
        {nowSlot !== null && <div aria-hidden="true" className="pointer-events-none relative z-[6] border-l-2 border-rose-500" style={{ gridColumn: `${nowSlot + 2} / span 1`, gridRow: `2 / ${Math.max(timed.length, 1) + 3}` }} />}
      </div>
    </div>
  </div>;
}

/** Minutes past midnight now, kept current each minute - only while `live`. */
function useNow(live) {
  const [now, setNow] = useState(null);
  useEffect(() => {
    if (!live) return undefined;
    const tick = () => { const date = new Date(); setNow(date.getHours() * 60 + date.getMinutes()); };
    tick();
    const timer = setInterval(tick, 60 * 1000);
    return () => clearInterval(timer);
  }, [live]);
  return live ? now : null;
}
