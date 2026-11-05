"use client";

import { useMemo } from "react";
import Button from "@/components/shared/Button";
import { scheduleEntryCell, scheduleEntryLead } from "@/lib/schedule";
import { weekLanes } from "@/lib/weekLanes.mjs";

/**
 * The calendar's Week view, as the Shoot Board lays out its days (`lib/weekLanes.mjs`): the seven days
 * across, each with its date and its ⋮, and every booking a bar over the days it covers - a project's
 * shoots on days one after another one continuous bar on one line, the rest a bar of a day. The lines
 * scroll inside the pane; the day lines run the full height.
 */
export default function CalendarWeekLanes({ days, byDay, todayKey, dayMenu, onOpen, tooltip }) {
  const { spans, lanes } = useMemo(() => weekLanes(days, byDay), [days, byDay]);

  return <div className="flex min-h-0 flex-1 flex-col">
    {/* The days: the date, and what may be started on it. */}
    <div className="grid shrink-0 grid-cols-7 border-b border-slate-200">
      {days.map((day) => {
        const isToday = day.key === todayKey;
        const count = (byDay.get(day.key) || []).length;
        return <div key={day.key} title={count ? `${count} booked` : undefined} className="group flex items-center justify-between border-r border-slate-200 bg-white px-2 py-1">
          {/* Today is marked on the number itself, as on Month. */}
          <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] ${isToday ? "bg-blue-600 font-semibold text-white" : "text-slate-500"}`}>
            {day.date.getDate()}
          </span>
          {dayMenu && <span className="opacity-60 transition group-hover:opacity-100 focus-within:opacity-100">{dayMenu(day)}</span>}
        </div>;
      })}
    </div>

    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div
        className="grid min-h-full grid-cols-7 gap-y-1 py-1"
        style={{ gridTemplateRows: `${lanes ? `repeat(${lanes}, auto) ` : ""}1fr` }}
      >
        {/* The day lines, down the whole height behind the bars. */}
        {days.map((day, index) => <div key={`line-${day.key}`} aria-hidden="true" className={`border-r border-slate-200 ${day.key === todayKey ? "bg-blue-50/40" : "bg-white"}`} style={{ gridColumn: index + 1, gridRow: `1 / ${lanes + 2}` }} />)}

        {spans.map((span) => {
          const [first] = span.entries;
          const titles = [...new Set(span.entries.map((entry) => entry.title))].join(" · ");
          const lead = span.entries.length > 1 ? "" : scheduleEntryLead(first);
          return <div key={`${first.id}-${span.start}`} className="relative z-[1] min-w-0 px-1" style={{ gridColumn: `${span.start + 1} / ${span.end + 2}`, gridRow: span.lane + 1 }}>
            <Button
              type="button"
              variant="plain"
              size="none"
              onClick={() => onOpen(first, span.entries)}
              title={span.entries.map(tooltip).join(" | ")}
              className={`w-full min-w-0 !flex-col !items-stretch !justify-start rounded px-1.5 py-1 text-left text-[11px] leading-4 transition ${scheduleEntryCell(first)}`}
            >
              <span className="block truncate">
                {lead && <><span className="font-medium">{lead}</span>{" "}</>}
                {titles}
              </span>
              {/* Where - or, for a run of a project's shoots, its event id - on its own line. */}
              {(span.entries.length > 1 ? first.subject : first.location) && (
                <span className="block truncate text-[10px] opacity-75">{span.entries.length > 1 ? `${first.subject}${first.location ? ` · ${first.location}` : ""}` : first.location}</span>
              )}
            </Button>
          </div>;
        })}
      </div>
    </div>
  </div>;
}
