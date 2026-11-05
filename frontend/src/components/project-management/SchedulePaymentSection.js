"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import SchemaFormSection from "@/components/schema-form/SchemaFormSection";
import SimpleTable from "@/components/data-table/SimpleTable";
import SharedDateField from "@/components/shared/DateField";
import ChevronIcon from "@/components/ui/ChevronIcon";
import CloseIcon from "@/components/ui/CloseIcon";
import { getMasterData } from "@/services/hrm/master-data.service";

/*
 * The payment schedule a project is booked on: what share of the signed quotation falls due, when,
 * and against what.
 *
 * Lifted out of Start / Edit Project so Create Project shows the same section rather than a second
 * copy of it - two schedules drifting apart is how the studio ends up with one form that knows
 * about Extras Services and another that does not.
 *
 * `signedQuotation` is passed in rather than worked out here, and it is the project's Initial
 * Converted Value - the figure taken from the quotation raised for the enquiry. It used to be the
 * service and deliverable rows priced at two constants, which scheduled percentages of a number the
 * studio had never quoted.
 *
 * NOT YET PERSISTED: the rows live in the form's state and reach no payload, so what is typed here
 * is lost when the form closes. It behaves the same way in both forms; a table of its own is the
 * follow-up.
 */

/*
 * The categories a schedule row can fall under, and the two things this section does with them.
 *
 * They were this array, and both meanings were the names themselves: "Final Settlement" was
 * compared against as a literal string in three places - the row that closes a schedule is pinned
 * to the bottom, takes no date, and nothing may follow it - and "Partial Payment" and "Extras
 * Services" were matched by a regular expression that numbered them as they were added. Renaming
 * any of the three in Settings therefore stopped all of that working, which is why they could not
 * be edited at all.
 *
 * The meaning is on the row now, so the list is edited in Settings -> Field Settings ->
 * Booking & Converts -> Category and the behaviour follows the flags rather than the spelling.
 * A read that fails leaves the fallback below, which is exactly what this offered before.
 */
const FALLBACK_PAYMENT_CATEGORIES = [
  { name: "Advance" },
  { name: "Partial Payment", repeatable: true },
  { name: "Extras Services", repeatable: true },
  { name: "Final Settlement", settlesBalance: true },
];

function escapeForRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The list, with the two sets of names the rules below are read from. */
function usePaymentCategories() {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let live = true;
    // Never allowed to answer with nothing: an empty list would leave the menu blank and every row
    // reading as a custom entry, so an empty read is left as no read at all.
    void getMasterData("payment-schedule-categories", { active: true })
      .then((response) => { if (live && response?.data?.length) setRows(response.data); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  return useMemo(() => {
    const list = rows || FALLBACK_PAYMENT_CATEGORIES;
    return {
      names: list.map((row) => row.name),
      settling: list.filter((row) => row.settlesBalance).map((row) => row.name),
      repeatable: list.filter((row) => row.repeatable).map((row) => row.name),
    };
  }, [rows]);
}

/** What a schedule starts as: the slot-booking advance every project takes. */
export const paymentScheduleDefaults = [{ id: "schedule-payment-1", category: "Advance", date: "", remarks: "Slot Booking", percentage: 5 }];

function formatCurrency(value) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(value || 0));
}

/**
 * The category a row is really under, with the number a repeatable one carries stripped off.
 *
 * "Partial Payment 2" is a Partial Payment; anything the list does not know is itself, so a
 * category typed by hand stays exactly as it was typed.
 */
function paymentCategoryBase(value, categories) {
  const normalized = String(value || "").trim();
  const numbered = categories.repeatable.find((name) => new RegExp(`^${escapeForRegExp(name)}(?:\\s+\\d+)?$`, "i").test(normalized));
  return numbered || normalized;
}

/** Whether this row is the one that closes the schedule - the flag, not the word. */
function settlesBalance(value, categories) {
  // Matched exactly, as the literal comparison this replaces was: a category typed by hand that
  // happens to read like the closing one is a custom entry, not the row that pins the schedule.
  return categories.settling.includes(paymentCategoryBase(value, categories));
}

function paymentCategoryLabel(row, rows, categories) {
  const base = paymentCategoryBase(row.category, categories);
  if (!base) return "";
  if (!categories.repeatable.includes(base)) return base;
  const count = rows.slice(0, rows.findIndex((item) => item.id === row.id) + 1).filter((item) => paymentCategoryBase(item.category, categories) === base).length;
  return `${base} ${count}`;
}

function emptyPaymentRow() {
  return { id: `schedule-payment-${Date.now()}-${Math.random().toString(36).slice(2)}`, category: "", date: "", remarks: "", percentage: "" };
}

function hasPaymentRowValue(row) {
  return ["category", "date", "remarks", "percentage"].some((field) => String(row[field] || "").trim());
}

function shouldAppendPaymentRow(row, categories) {
  return hasPaymentRowValue(row) && !settlesBalance(row.category, categories);
}

function PaymentCategoryInput({ value, displayValue, options, onChange }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      top: Math.min(rect.bottom + 4, window.innerHeight - 160),
      left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)),
      width: rect.width,
    });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!triggerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false);
    };
    updatePosition();
    document.addEventListener("mousedown", close);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  function select(option) {
    onChange(option);
    setOpen(false);
  }

  return <span ref={triggerRef} className="relative block">
    <input value={displayValue || value} onFocus={() => { updatePosition(); setOpen(true); }} onChange={(event) => onChange(event.target.value)} placeholder="Select or enter category" className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 pr-10 text-sm font-medium text-slate-700 outline-none placeholder:font-normal placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
    <button type="button" onClick={() => { updatePosition(); setOpen((current) => !current); }} aria-label="Open category menu" className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-slate-600 hover:bg-slate-100">
      <ChevronIcon size={20} />
    </button>
    {open && position && createPortal(<div ref={menuRef} className="themed-surface fixed z-[180] max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl" style={position}>
      {options.map((option) => <button key={option} type="button" onMouseDown={(event) => { event.preventDefault(); select(option); }} className="block w-full px-3 py-2 text-left text-sm font-normal text-slate-700 hover:bg-blue-50 hover:text-blue-700">{option}</button>)}
    </div>, document.body)}
  </span>;
}

/**
 * `onSignedQuotationChange` makes the figure at the top an answer rather than a statement.
 *
 * Create Project passes it: what the project converts at comes off the chosen quotation, and the
 * one place it is worth correcting is here, beside the rows that are shares of it - so the schedule
 * is read and set in one place instead of the number being typed in another section and its effect
 * checked in this one.
 *
 * Without it the figure is read-only, which is what Start / Edit Project wants: by then the sale is
 * settled and this whole screen plans against it.
 */
export default function SchedulePaymentSection({ signedQuotation, rows, onChange, onSignedQuotationChange }) {
  // Read here rather than passed in: both forms showing this section want the same list, and
  // neither has any other use for it.
  const categories = usePaymentCategories();

  const updateRow = (id, field, value) => onChange((current) => {
    const next = current.map((row) => row.id === id ? { ...row, [field]: value } : row);
    const settlementIndex = next.findIndex((row) => settlesBalance(row.category, categories));
    if (settlementIndex !== -1) return next.slice(0, settlementIndex + 1);
    return shouldAppendPaymentRow(next[next.length - 1], categories) ? [...next, emptyPaymentRow()] : next;
  });
  const deleteRow = (id) => onChange((current) => current.length === 1 ? current : current.filter((row) => row.id !== id));

  return <SchemaFormSection id="schedule-payment" title="Shedule Payment">
    <div className="mb-5 max-w-xl rounded-md border border-slate-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
        <span className="font-semibold text-slate-700">Signed Quotation</span>
        {onSignedQuotationChange
          /* Digits and one decimal point, the same rule the sale's own amount field kept. The
             currency sits outside the box so the value in it is the value that is stored. */
          ? <span className="flex items-center gap-2">
            <span className="text-lg font-semibold text-slate-900">₹</span>
            <input
              inputMode="decimal"
              aria-label="Signed Quotation"
              value={signedQuotation ?? ""}
              placeholder="0"
              onChange={(event) => onSignedQuotationChange(event.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"))}
              className="min-h-9 w-40 rounded-lg border border-slate-300 bg-white px-3 text-right text-lg font-semibold text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </span>
          : <span className="text-lg font-semibold text-slate-900">{formatCurrency(signedQuotation)}</span>}
      </div>
      {/* Said plainly rather than left as a schedule of percentages of nothing: every Amount below
          would read zero, which looks like a schedule that has been filled in. */}
      {/* Where it is answered, said by whichever form is showing it. Only Projects -> Edit Project
          offers the box; Bookings & Converted shows the figure the sale arrived with and sends the
          reader there rather than naming a field it does not have. */}
      {!Number(signedQuotation) && <p className="mt-1.5 text-xs text-slate-500">
        {onSignedQuotationChange
          ? "Every amount below is a share of this figure, so they all work out at zero until it is set."
          : "This project has no Signed Quotation yet, so every amount below works out at zero. It is set on Projects → Edit Project."}
      </p>}
    </div>
    <SimpleTable
      variant="form"
      classNames={{
        wrapper: "overflow-hidden bg-white",
        table: "min-w-full table-fixed text-sm text-slate-700",
        th: "border-b border-slate-200 !py-3",
        row: "!border-t-0 border-b border-slate-100 last:border-b-0",
        td: "!py-2.5",
      }}
      columns={[
        { key: "category", label: "Catagory", headerClassName: "w-[24%] !px-4", cellClassName: "!px-4", render: (row) => <PaymentCategoryInput value={row.category} displayValue={paymentCategoryLabel(row, rows, categories)} options={categories.names} onChange={(value) => updateRow(row.id, "category", value)} /> },
        { key: "date", label: "Date", headerClassName: "w-[17%] !px-4", cellClassName: "!px-4", render: (row) => (settlesBalance(row.category, categories) ? <span className="text-slate-400">—</span> : <SharedDateField value={row.date} onChange={(value) => updateRow(row.id, "date", value)} placeholder="" />) },
        { key: "remarks", label: "Remarks", headerClassName: "w-[28%] !px-4", cellClassName: "!px-4", render: (row) => <input value={row.remarks} onChange={(event) => updateRow(row.id, "remarks", event.target.value)} placeholder="Manual Remarks" className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /> },
        { key: "percentage", label: "Percentage", headerClassName: "w-[12%] !px-4", cellClassName: "!px-4", render: (row) => <input type="number" min="0" max="100" value={row.percentage} onChange={(event) => updateRow(row.id, "percentage", event.target.value)} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-right text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /> },
        { key: "amount", label: "Amount", headerClassName: "w-[14%] !px-4 text-right", cellClassName: "!px-4 text-right font-medium text-slate-700", render: (row) => formatCurrency(Math.round(Number(signedQuotation || 0) * (Number(row.percentage || 0) / 100))) },
        { key: "remove", label: "", headerClassName: "w-14 !px-2", cellClassName: "!px-2 text-center", render: (row) => <button type="button" disabled={rows.length === 1} onClick={() => deleteRow(row.id)} aria-label={`Delete ${paymentCategoryLabel(row, rows, categories)}`} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-35"><CloseIcon size={20} /></button> },
      ]}
      rows={rows}
    />
  </SchemaFormSection>;
}
