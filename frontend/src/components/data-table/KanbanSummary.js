"use client";

import { useMemo, useState } from "react";
import Dropdown from "@/components/shared/Dropdown";
import SearchField from "@/components/shared/SearchField";
import { trendLook } from "@/components/shared/SummaryCard";
import useStickyTab from "@/components/shared/useStickyTab";
import { DEFAULT_SUMMARY_PERIOD, SUMMARY_PERIODS, boardSummary, periodBack, periodDays, periodLabel, periodWhen } from "@/lib/kanbanSummary.mjs";
import { formatRupees } from "@/lib/saleExtras.mjs";

/**
 * The small dashboard every Board carries, drawn **inside each column**: the trend's arrow and then
 * the count in the header's corner (`ColumnTrendMark`), and under the header one line - the
 * column's period on the left, a small line of when its cards came in on the right. Picking a period also narrows the column to the cards that came in during it
 * (`rowsInPeriod`, applied by `KanbanBoard`), so the figure and the cards answer the same question.
 * The period is remembered per screen and column. Figures from `kanbanSummary.mjs`.
 */

/** A column's period choice, remembered per screen and column. */
export function useColumnPeriod(screenKey = "board", columnValue = "") {
  const [period, setPeriod] = useStickyTab(`${screenKey}-${columnValue}-trend`, DEFAULT_SUMMARY_PERIOD, SUMMARY_PERIODS.map((option) => option.value));
  return { period, setPeriod };
}

const spanLabel = periodLabel;

/** A column's trend over its period, from the rows a board holds; null where rows carry no date. */
export function useColumnTrend({ rows, column, dateOf, period }) {
  const days = periodDays(period);
  const back = periodBack(period);
  return useMemo(() => {
    if (!dateOf) return null;
    const [summary] = boardSummary({ rows, columns: [column], statusOf: () => column.value, dateOf, days, back });
    return { trend: summary.trend };
  }, [back, column, dateOf, days, rows]);
}

/**
 * The column's trend as a mark in its header's corner: the arrow alone, in its colour, and its
 * number ("+1") beside it on hover, keyboard focus or a tap - nothing more, so the header carries
 * the direction at a glance and the figure only when it is asked for. A screen reader hears the
 * whole of it from the label.
 */
export function ColumnTrendMark({ trend: given, noun, period }) {
  const span = spanLabel(period);
  // A board whose rows carry dates, but none in this column: the trend still reads, as nothing came in.
  const trend = given || { delta: 0, before: 0, now: 0 };
  const { Icon, tone, text } = trendLook(trend);
  // A phone has no hover: a tap shows the number until the mark loses focus.
  const [shown, setShown] = useState(false);
  return <button
    type="button"
    aria-label={`Trend ${text} vs previous ${span}: ${trend.now} ${noun} came in ${periodWhen(period)}, ${trend.before} in the ${span} before`}
    onClick={() => setShown((current) => !current)}
    onBlur={() => setShown(false)}
    className={`group inline-flex shrink-0 items-center gap-0.5 rounded-md px-0.5 text-xs font-bold tabular-nums transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500 ${tone}`}
  >
    <span aria-hidden="true" className={`${shown ? "inline" : "hidden"} group-hover:inline group-focus-visible:inline`}>{text}</span>
    <Icon aria-hidden="true" style={{ fontSize: 20 }} />
  </button>;
}

/**
 * The column's line under its header: the period on the left, and on the right `aside` - anything
 * else the board says about the column (the CRM's ₹ worth). No line of its own: the trend's arrow in
 * the header already says which way the column is going.
 */
export function ColumnTrendBar({ name, period, setPeriod, aside = null }) {
  // Compact throughout, so the lane's own cards keep the room.
  // The period picker never gives way: it keeps its width, and the figure beside it takes what is
  // left and wraps onto a second line when it is long ("Client paid ₹7,36,000 · Balance due ₹3,219"),
  // rather than squeezing the picker shut.
  return <div className="flex shrink-0 items-center justify-between gap-2 px-2 py-0.5">
    <div className="flex shrink-0 items-center">
      <Dropdown mode="switch" compact ariaLabel={`${name}: show cards from`} value={period} onChange={setPeriod} options={SUMMARY_PERIODS} searchable={false} sorted={false} placeholder="Period" className="w-[6.25rem]" />
    </div>
    <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 pr-1 text-right">
      {aside}
    </div>
  </div>;
}

/**
 * A money figure for a column, beside its period picker: "Converted ₹6,59,200", "Est. ₹23,50,000" -
 * the CRM's worth of its leads and Bookings' converted value of its projects, drawn the one way.
 */
// `text` in place of `amount` for a figure that is not money - "7 · next event 14 Nov".
export function ColumnAmount({ label, amount, text, title }) {
  const parts = String(text ?? formatRupees(amount)).split(" · ");
  // Wraps rather than truncating: a figure cut off at "To receive ₹3,2…" is a wrong figure.
  return <span className="min-w-0 break-words text-xs font-semibold leading-snug tabular-nums text-slate-600" title={title}>
    {label && <span className="font-medium text-slate-500">{label} </span>}
    {/* A figure of two parts ("Client paid ₹… · Balance due ₹…") wraps between them, never inside one;
        a figure of one part ("Oldest invite sent 19 days ago") wraps between its words like any sentence. */}
    {parts.map((part, index) => <span key={index}>{index > 0 && " · "}<span className={parts.length > 1 ? "whitespace-nowrap" : undefined}>{part}</span></span>)}
  </span>;
}

/** A column's own search box, under its trend line - it narrows that column alone. */
export function ColumnSearch({ name, noun, value, onChange }) {
  return <div className="shrink-0 px-2 pb-1.5 pt-0.5">
    <SearchField compact value={value} onChange={onChange} ariaLabel={`Search ${name}`} placeholder={`Search ${noun} in ${name}`} preventSubmit />
  </div>;
}
