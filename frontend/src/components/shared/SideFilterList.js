"use client";

import { useRef } from "react";

/**
 * A short list of filters drawn **down the side** of a table, each with its count - one chosen at a
 * time. For a tab that holds several views of its own: User Management's Pending tab lists each kind
 * of pending work here and the table beside it shows the one chosen.
 *
 * A vertical tab list (`role="tablist"`, `aria-orientation="vertical"`): Up and Down move between the
 * items and choose them, as the tabs across the top do sideways. Below `md` there is no room for a
 * column beside the table, so the same items wrap into a row above it instead.
 *
 * A label is never cut short: it is read whole or not at all, so a long one ("Employee Submission
 * Pending") wraps onto a second line rather than ending in "...".
 *
 * `items` is `[{ id, label, count }]`; `value` the chosen id; `onChange(id)`.
 */
export default function SideFilterList({ items = [], value, onChange, ariaLabel }) {
  const refs = useRef([]);
  const move = (event, index) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (index + step + items.length) % items.length;
    onChange?.(items[next].id);
    refs.current[next]?.focus();
  };
  return <div role="tablist" aria-label={ariaLabel} aria-orientation="vertical" className="flex shrink-0 flex-wrap gap-1 border-b border-slate-200 bg-white p-2 md:w-72 md:flex-col md:flex-nowrap md:overflow-y-auto md:border-b-0 md:border-r">
    {items.map((item, index) => {
      const active = item.id === value;
      return <button
        key={item.id}
        ref={(node) => { refs.current[index] = node; }}
        type="button"
        role="tab"
        aria-selected={active}
        tabIndex={active ? 0 : -1}
        onClick={() => onChange?.(item.id)}
        onKeyDown={(event) => move(event, index)}
        className={`flex min-h-9 items-center justify-between gap-3 rounded-md px-3 py-1.5 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${active ? "bg-blue-50 font-medium text-blue-700" : "text-slate-700 hover:bg-slate-50"}`}
      >
        <span className="min-w-0 break-words leading-snug">{item.label}</span>
        <span className={`shrink-0 rounded-full px-2 text-xs tabular-nums ${active ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}`}>{item.count ?? 0}</span>
      </button>;
    })}
  </div>;
}
