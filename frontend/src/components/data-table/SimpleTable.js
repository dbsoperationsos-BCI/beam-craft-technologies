"use client";

import { useLayoutEffect, useRef, useState } from "react";
import Loader from "@/components/shared/Loader";
import { CELL_CLIP } from "./tableLayout";

/**
 * A small table: columns and rows, and nothing a `DataTable` does.
 *
 * ── What it is for ────────────────────────────────────────────────────────────────────────────
 *
 * The lists inside a form, a dialog or a panel - a lead's call logs, the meetings booked against
 * it, the payment schedule on a project, the invites a candidate has been sent. Tens of rows at
 * most, no column anybody sorts, hides or drags, and a shape decided by the card it sits in. A
 * `DataTable` there would be the wrong thing: its ⋮ menu, its filter row and its remembered
 * arrangement are for a register somebody works, not for a list they read once.
 *
 * What those lists had in common was that each of them was its own `<table>`: fifteen copies of a
 * header row, a body, an empty-state line and sometimes a footer, each spelling out the same
 * structure with a slightly different set of classes, and each one a place for the next
 * correction to miss. So the structure lives here once, and a caller says what the columns are
 * and what a row holds.
 *
 * ── How it is drawn ───────────────────────────────────────────────────────────────────────────
 *
 * `variant` is the family the list belongs to: `card` is the rounded white card the CRM's popup
 * tables and the WhatsApp Users list are drawn as, `plain` is the sticky-headed list inside the
 * screening-form invite dialog and the attendance dashboard, and `form` is the tighter list inside
 * a form. Each is a set of
 * classes for the parts, and `classNames` lays a caller's own over any of them - a list that has
 * always been `text-xs sm:text-sm` says so there rather than becoming a fourth variant.
 *
 * The onboarding invites list is not here any more: it is a register somebody works, filtered and
 * sorted like the Employee Repository beside it, so it is a `DataTable` -
 * `employees/OnboardingInviteTable.js`.
 *
 * A column is `{ key, label, render?, headerClassName?, cellClassName?, srOnly? }`. `render(row,
 * index)` draws the cell; without it the cell shows `row[key]`. `srOnly` names a column to a screen
 * reader and draws nothing on screen - the row-menu column every table in the OS ends with.
 *
 * `renderRow` is the way out for a list whose rows are not one `<tr>` each - the invite dialogs
 * fold a candidate's earlier attempts under their current one. It is handed the row and returns
 * whatever rows it wants drawn; the columns still decide the header.
 */

const VARIANTS = {
  card: {
    wrapper: "overflow-x-auto rounded-xl border border-slate-200",
    table: "w-full border-collapse text-left",
    head: "bg-slate-50 text-xs font-bold tracking-wide text-slate-600",
    headRow: "",
    th: "whitespace-nowrap border-b border-slate-200 px-5 py-3",
    body: "divide-y divide-slate-100 bg-white",
    row: "",
    td: "px-5 py-3 text-sm",
    empty: "px-5 py-8 text-center text-sm text-slate-500",
  },
  plain: {
    wrapper: "min-h-0 flex-1 overflow-auto",
    table: "w-full text-left text-sm",
    head: "sticky top-0 z-10 bg-white text-xs font-semibold uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_#e2e8f0]",
    headRow: "",
    th: "whitespace-nowrap px-3 py-2",
    body: "",
    row: "border-b border-slate-100 text-slate-700",
    td: "whitespace-nowrap px-3 py-3",
    empty: "px-3 py-8 text-center text-sm text-slate-500",
  },
  form: {
    wrapper: "overflow-x-auto rounded-lg border border-slate-200",
    table: "w-full border-collapse text-left",
    head: "bg-slate-50 text-xs font-semibold tracking-wide text-slate-500",
    headRow: "",
    th: "px-3 py-2",
    body: "",
    row: "border-t border-slate-100",
    td: "px-3 py-2",
    empty: "px-3 py-4 text-center text-sm text-slate-500",
  },
};

const join = (...parts) => parts.filter(Boolean).join(" ");

export default function SimpleTable({
  columns = [],
  rows = [],
  variant = "card",
  classNames = {},
  /** The row's key, where it is not `row.id`. Falls back to the index for a list with no ids. */
  rowKey,
  /** Props for one `<tr>` - a click, a class, a role - or nothing. */
  rowProps,
  /** Whole rows for one record, where a record is not one `<tr>`. Returns nodes; keys are the caller's. */
  renderRow,
  /** A second header row - a filter row, drawn by the caller as `<tr>`. */
  headerRow,
  /** A `<tr>` (or several) for the foot of the table - a total. */
  footer,
  emptyMessage,
  loading = false,
  loadingMessage = "Loading...",
  ariaLabel,
}) {
  const styles = VARIANTS[variant] || VARIANTS.card;
  const part = (name) => join(styles[name], classNames[name]);
  const colSpan = columns.length || 1;
  const keyOf = (row, index) => rowKey?.(row, index) ?? row?.id ?? index;
  /*
   * The wrapper's visible width. Loading and the empty message span every column, so on a table
   * wider than its card they were centred across all of it, out of sight; held to this width and
   * pinned to the wrapper's left edge, they stay in view however far it is scrolled across.
   */
  const wrapperRef = useRef(null);
  const [visibleWidth, setVisibleWidth] = useState(0);
  useLayoutEffect(() => {
    const element = wrapperRef.current;
    if (!element) return undefined;
    const measure = () => setVisibleWidth((current) => (current === element.clientWidth ? current : element.clientWidth));
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const inView = visibleWidth ? { width: visibleWidth } : undefined;

  return (
    <div ref={wrapperRef} className={part("wrapper")}>
      <table aria-label={ariaLabel} className={part("table")}>
        <thead className={part("head")}>
          <tr className={part("headRow") || undefined}>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={join(styles.th, classNames.th, column.headerClassName)}>
                {column.srOnly ? <span className="sr-only">{column.label}</span> : column.label}
              </th>
            ))}
          </tr>
          {headerRow}
        </thead>
        <tbody className={part("body") || undefined}>
          {loading && (
            <tr><td colSpan={colSpan} className="p-0"><div className={`sticky left-0 ${classNames.loading || "px-4"}`} style={inView}><Loader label={loadingMessage} /></div></td></tr>
          )}
          {!loading && rows.length === 0 && emptyMessage && (
            <tr><td colSpan={colSpan} className="p-0"><div className={`sticky left-0 ${part("empty")}`} style={inView}>{emptyMessage}</div></td></tr>
          )}
          {!loading && rows.map((row, index) => {
            if (renderRow) return renderRow(row, index);
            const { className: rowClassName, ...props } = rowProps?.(row, index) || {};
            return (
              <tr key={keyOf(row, index)} {...props} className={join(styles.row, classNames.row, rowClassName) || undefined}>
                {columns.map((column) => {
                  /*
                   * A column that says how wide it may grow clips what overflows, ending in "..."
                   * rather than widening the table for one long value - a shoot named for several
                   * at once, say. Opt-in, so every other table here is drawn exactly as before, and
                   * whatever is clipped is still readable: the value goes in the cell's `title`,
                   * the same rule `DataTable` follows (`tableLayout.js`).
                   */
                  const content = column.render ? column.render(row, index) : row?.[column.key];
                  const clipped = Boolean(column.maxWidth);
                  const full = clipped ? (column.title?.(row, index) ?? (typeof content === "string" ? content : undefined)) : undefined;
                  return <td
                    key={column.key}
                    className={join(styles.td, classNames.td, column.cellClassName, clipped ? CELL_CLIP : "") || undefined}
                    style={clipped ? { maxWidth: column.maxWidth } : undefined}
                    title={full || undefined}
                  >
                    {content}
                  </td>;
                })}
              </tr>
            );
          })}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  );
}
