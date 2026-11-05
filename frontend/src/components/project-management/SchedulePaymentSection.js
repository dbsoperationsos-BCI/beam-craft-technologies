"use client";

import { formatSignedRupees } from "@/lib/saleExtras.mjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { amountForPercentage, percentageForAmount, shootLinkLabel, undatedPayments } from "@/lib/paymentSchedule.mjs";
import PaymentDueDialog from "@/components/project-management/PaymentDueDialog";
import Button from "@/components/shared/Button";
import SchemaFormSection from "@/components/schema-form/SchemaFormSection";
import SimpleTable from "@/components/data-table/SimpleTable";
import SharedDateField from "@/components/shared/DateField";
import HelpTip from "@/components/shared/HelpTip";
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
 * Saved by each form to the project's own schedule (`project_payment_schedule`), which Accounts ->
 * Scheduled Payments works. A row Accounts has already worked - money received, a hold, a split -
 * comes back `locked`; it is edited and removed like any other, with where it stands (Cleared, On
 * Hold, Due) written under its remarks so nobody changes a paid payment without seeing that it is.
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

/**
 * The list, with the two sets of names the rules below are read from.
 *
 * Read by the form rather than by the section, and handed down as `categories`: the form refuses a
 * save with an undated payment (`undatedPayments`), and which row needs no date is this list's
 * answer - so the form's check and the cells it marks read the same list.
 */
export function usePaymentCategories() {
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
 * Start / Edit Project pass it too, so the figure can be corrected where it is scheduled against.
 * Without it the figure is read-only - Create Project once a quotation has supplied it.
 */
/**
 * `readOnly` shows the schedule as what it is rather than as a form: every row reads the way a row
 * Accounts has already worked reads (`lockedText`), with nothing to type in, no row to remove and
 * none to add. Edit Sale Details uses it for somebody who may read a project's schedule but not
 * change one - changing it answers to `PROJECT / Projects`, not to the sale's own permission.
 */
/**
 * `categories` is `usePaymentCategories()`, read by the form. `showDateErrors` marks every payment
 * still without a date, once the form has refused a save for it - not before, so a row somebody is
 * still filling in is not drawn as a mistake.
 *
 * `offerNewRow` (Edit Sale Details) keeps a blank row under the last payment from the moment the
 * schedule opens, so the next payment can be added without changing one first - unless the last
 * row settles the balance. Every row is a form whether Accounts has worked it or not.
 *
 * `onReceive(row)` (from `useScheduleReceiver`, given only to somebody who may record cash) puts
 * **Receive** under the Amount of every saved payment not yet received in full - read-only
 * or not, since it is Accounts' write rather than the schedule's. Typing "done" in Remarks records
 * nothing; this is how money received against a payment is recorded from here. `receivingId` is the
 * payment whose panel is opening.
 *
 * `ledger` is the server's reading of a saved project's books (`GET …/payment-schedule`'s `ledger`):
 * with it the summary above the table says what has been received and the Balance Amount still
 * owed. Nothing here works a balance out. Create Project has no saved books and passes none.
 */
export default function SchedulePaymentSection({ categories, signedQuotation, rows, onChange, onSignedQuotationChange, signedQuotationNote = "", readOnly = false, showDateErrors = false, shoots = [], publishedExtra = null, offerNewRow = false, ledger = null, onReceive = null, receivingId = "" }) {
  // The row whose due date is being answered in `PaymentDueDialog` - date known, or which shoot it follows.
  const [dueRowId, setDueRowId] = useState(null);
  const dueRow = dueRowId ? rows.find((row) => row.id === dueRowId) : null;
  const undatedIds = new Set(showDateErrors ? undatedPayments(rows, categories.settling).map((row) => row.id) : []);

  /*
   * The row whose Amount is being typed into, and the text in it.
   *
   * The Amount box is drawn from the row's percentage, so without this it would rewrite itself on every
   * keystroke: "5" is stored as a share and drawn back as "5", but a rounding disagreement anywhere in
   * that trip turns what is being typed into something else under the cursor. Cleared on blur, and by a
   * keystroke in the Percentage box beside it - that box is then the one being answered.
   */
  const [editingAmount, setEditingAmount] = useState(null);

  const updateRow = (id, field, value) => updateRowWith(id, { [field]: value });
  const updateRowWith = (id, changes) => readOnly || onChange((current) => {
    const next = current.map((row) => row.id === id ? { ...row, ...changes } : row);
    const settlementIndex = next.findIndex((row) => settlesBalance(row.category, categories));
    if (settlementIndex !== -1) return next.slice(0, settlementIndex + 1);
    return shouldAppendPaymentRow(next[next.length - 1], categories) ? [...next, emptyPaymentRow()] : next;
  });
  const deleteRow = (id) => readOnly || onChange((current) => current.length === 1 ? current : current.filter((row) => row.id !== id));

  // Receive: a payment the books know (in `ledger.rows`) and still owed in part or whole.
  const savedIds = useMemo(() => new Set((ledger?.rows || []).map((row) => row.id)), [ledger]);
  const receivable = (row) => Boolean(onReceive) && savedIds.has(row.id) && row.status !== "Cleared";
  const extraQuotations = Number(ledger?.extraQuotations || 0);
  /*
   * Net Extra - the published Sale Extras. Edit Sale Details hands in its Extra section's live figure
   * (`publishedExtra`), which moves the moment something is published there; a form without that
   * section (Start / Edit Project) reads the same total off the server's `ledger`, so the Updated
   * Total Amount above the balance is the one the balance is worked from.
   */
  const netExtra = publishedExtra ? Number(publishedExtra.net || 0) : Number(ledger?.saleExtras || 0);
  const showNetExtra = Boolean(publishedExtra) || netExtra !== 0;

  /*
   * How a read-only schedule reads: each cell says what it holds, the remarks say where the payment
   * stands, and there is nothing to remove a row with.
   */
  const lockedText = {
    category: (row) => paymentCategoryLabel(row, rows, categories),
    date: (row) => (row.dateKnown === false ? shootLinkLabel(row, shoots) : row.date || "—"),
    remarks: (row) => [row.status, row.remarks].filter(Boolean).join(" · "),
    percentage: (row) => `${row.percentage}%`,
    amount: (row) => formatCurrency(amountForPercentage(row.percentage, signedQuotation)),
    remove: () => null,
  };
  const lockedAware = (columns) => columns.map((column) => (lockedText[column.key]
    ? { ...column, render: (row) => (readOnly ? <span className="text-sm text-slate-700">{lockedText[column.key](row)}</span> : column.render(row)) }
    : column));
  // Receive sits under the Amount, in a read-only schedule as in an editable one.
  const withReceive = (columns) => columns.map((column) => (column.key === "amount"
    ? { ...column, render: (row) => <div className="flex flex-col">
      {column.render(row)}
      {receivable(row) && <Button type="button" variant="plain" size="none" disabled={Boolean(receivingId)} onClick={() => onReceive(row)} title="Record money received against this payment" className="min-h-8 self-end py-1 text-xs text-blue-700 hover:underline">{receivingId === row.id ? "Opening…" : "Receive"}</Button>}
    </div> }
    : column));

  // A blank row to add the next payment with, there as soon as the rows arrive, where the last leaves room.
  const needsNewRow = offerNewRow && !readOnly && (!rows.length || shouldAppendPaymentRow(rows[rows.length - 1], categories));
  useEffect(() => {
    if (!needsNewRow) return;
    onChange((current) => (current.length && !shouldAppendPaymentRow(current[current.length - 1], categories) ? current : [...current, emptyPaymentRow()]));
  }, [needsNewRow, onChange, categories]);

  return <SchemaFormSection id="schedule-payment" title="Shedule Payment">
    <div className="mb-5 max-w-xl rounded-md border border-slate-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
        <span className="font-semibold text-slate-700">Signed Quotation<HelpTip text="The total the client signed for; every payment below is a share of it." /></span>
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
      {/* The published Sale Extras (Edit Sale Details' Extra section), shown beside the figure and never
          in it: every payment below stays a share of the Signed Quotation, exactly as before. Only once
          something is published - live from that section, or from the `ledger` where there is none. */}
      {(showNetExtra || extraQuotations !== 0) && <dl className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-sm">
        {showNetExtra && <div className="flex flex-wrap items-center justify-between gap-x-4">
          <dt className="flex items-center text-slate-600">Net Extra<HelpTip text="The Sale Extras published from Edit Sale Details so far, added and removed together. Drafts are not included. The payments below are not changed by it." /></dt>
          <dd className="font-semibold tabular-nums text-slate-900">{formatSignedRupees(netExtra)}</dd>
        </div>}
        {/* Approved on Projects → Payments; counted in the balance as the client's receipt counts it. */}
        {extraQuotations !== 0 && <div className="flex flex-wrap items-center justify-between gap-x-4">
          <dt className="flex items-center text-slate-600">Extra Quotation<HelpTip text="Extra work approved on Projects → Payments. Extras still waiting for approval are not included. The payments below are not changed by it." /></dt>
          <dd className="font-semibold tabular-nums text-slate-900">{formatSignedRupees(extraQuotations)}</dd>
        </div>}
        <div className="flex flex-wrap items-center justify-between gap-x-4">
          <dt className="flex items-center font-semibold text-slate-700">Updated Total Amount<HelpTip text="Signed Quotation plus the extras above, before GST." /></dt>
          <dd className="text-lg font-semibold tabular-nums text-slate-900">{formatCurrency(Number(signedQuotation || 0) + netExtra + extraQuotations)}</dd>
        </div>
      </dl>}
      {/* What has come in against that total and what is still owed - the server's figures, from the
          receipts and refunds Accounts has recorded. A payment Due or Overdue takes nothing off. */}
      {ledger && <dl className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-4">
          <dt className="flex items-center text-slate-600">Received<HelpTip text="All the money Accounts has received against this project. Withdrawn entries are not included." /></dt>
          <dd className="font-semibold tabular-nums text-emerald-700">{formatCurrency(ledger.received)}</dd>
        </div>
        {Number(ledger.refunded) > 0 && <div className="flex flex-wrap items-center justify-between gap-x-4">
          <dt className="flex items-center text-slate-600">Refunded<HelpTip text="Money paid back to the client, recorded in Accounts as a Client Refund. It is owed again, so it is added back to the balance." /></dt>
          <dd className="font-semibold tabular-nums text-rose-600">{formatCurrency(ledger.refunded)}</dd>
        </div>}
        <div className="flex flex-wrap items-center justify-between gap-x-4">
          <dt className="flex items-center font-semibold text-slate-700">Balance Amount<HelpTip text="Updated Total Amount less the money received, plus any refund. A payment that is due or overdue is not taken off until it is received." /></dt>
          <dd className="text-lg font-semibold tabular-nums text-slate-900">{formatCurrency(ledger.balance)}</dd>
        </div>
        {Number(ledger.overpaid) > 0 && <div className="flex flex-wrap items-center justify-between gap-x-4">
          <dt className="flex items-center text-slate-600">Overpaid<HelpTip text="Received beyond the Updated Total Amount. Kept apart so the balance never reads below zero; settle it in Accounts." /></dt>
          <dd className="font-semibold tabular-nums text-amber-700">{formatCurrency(ledger.overpaid)}</dd>
        </div>}
      </dl>}
      {Number(ledger?.unscheduledReceived) > 0 && <p className="mt-1.5 text-xs text-slate-500">
        {formatCurrency(ledger.unscheduledReceived)} of the money received is on no payment below, and it counts in the Balance Amount.
      </p>}
      {/* Said plainly rather than left as a schedule of percentages of nothing: every Amount below
          would read zero, which looks like a schedule that has been filled in. */}
      {/* Where it is answered, said by whichever form is showing it. Projects -> Start / Edit
          Project offer the box; Create Project with a quotation shows the figure the sale arrived
          with and sends the reader there rather than naming a field it does not have. */}
      {/* Where the figure came from, said by the form that filled it - Create Project's sum of its
          lines, with any line Settings prices nothing for named as counting ₹0. */}
      {signedQuotationNote && <p role="status" className="mt-1.5 text-xs text-slate-500">{signedQuotationNote}</p>}
      {!Number(signedQuotation) && <p className="mt-1.5 text-xs text-slate-500">
        {onSignedQuotationChange
          ? "Every amount below is a share of this figure, so they all work out at zero until it is set."
          : "This project has no Signed Quotation yet, so every amount below works out at zero. It is set on Projects → Start or Edit Project."}
      </p>}
    </div>
    <SimpleTable
      variant="form"
      classNames={{
        wrapper: "overflow-hidden bg-white",
        table: "min-w-full table-fixed text-sm text-slate-700",
        th: "border-b border-slate-200 !py-3",
        row: "!border-t-0 border-b border-slate-100 last:border-b-0",
        /*
         * `align-top`, not the table default of middle. The Date cell is taller than the rest - its
         * box has "Date not known?" under it, or two lines naming the shoot it follows - and a
         * middle-aligned row centred every *other* box against that height, leaving the date box
         * standing above the ones beside it. Topped, every control begins on the same line and the
         * links hang below, which is what the row is read across.
         */
        td: "!py-2.5 align-top",
      }}
      columns={withReceive(lockedAware([
        { key: "category", label: <>Catagory<HelpTip text="What this payment is for, such as Advance or Final Settlement." /></>, headerClassName: "w-[24%] !px-4", cellClassName: "!px-4", render: (row) => <PaymentCategoryInput value={row.category} displayValue={paymentCategoryLabel(row, rows, categories)} options={categories.names} onChange={(value) => updateRow(row.id, "category", value)} /> },
        // Required on every payment but the one that settles the balance, which falls due on none.
        { key: "date", label: <>Date <span className="text-red-500" aria-hidden="true">*</span><HelpTip text="The day this payment falls due, or the shoot it follows when the date is not known; Final Settlement needs none." /></>, headerClassName: "w-[17%] !px-4", cellClassName: "!px-4", render: (row) => (settlesBalance(row.category, categories) ? <span className="flex min-h-10 items-center text-slate-400">—</span> : row.dateKnown === false
          // Date not known: what it follows, which opens the dialog again to change it.
          /*
           * Two lines at most, whatever it says. A payment that follows a shoot named for several -
           * "3 days before Groom Haldi + Bride Haldi" - ran to four and five lines in this column
           * and stretched the whole row with it, so a schedule of six payments could not be read
           * down. Clamped, every row is the same height; the whole phrase is on the title, and
           * Change opens the dialog that spells it out.
           */
          ? <Button type="button" variant="plain" size="none" title={shootLinkLabel(row, shoots)} onClick={() => setDueRowId(row.id)} className="min-h-10 w-full flex-col !items-start text-left text-sm text-blue-700"><span className="line-clamp-2 hover:underline">{shootLinkLabel(row, shoots)}</span><span className="text-xs text-slate-500">Change</span></Button>
          : <div className="space-y-1"><SharedDateField
          label="Date"
          hideLabel
          value={row.date}
          onChange={(value) => updateRow(row.id, "date", value)}
          placeholder=""
          // The row's other boxes are h-10, and the asterisk is on the column heading: a label or an
          // error line here would push this one box down out of line with them. A missing date is
          // the red outline alone; the form's notice says what it is.
          className={`[&_[data-field-control]]:min-h-10 ${undatedIds.has(row.id) ? "[&_[data-field-control]]:!border-red-400" : ""}`}
        />
          <Button type="button" variant="plain" size="none" onClick={() => setDueRowId(row.id)} className="min-h-8 py-1 text-xs text-blue-700 hover:underline">Date not known?</Button></div>) },
        { key: "remarks", label: <>Remarks<HelpTip text="Any note about this payment for the team to read." /></>, headerClassName: "w-[28%] !px-4", cellClassName: "!px-4", render: (row) => <div className="space-y-1">
          <input value={row.remarks} onChange={(event) => updateRow(row.id, "remarks", event.target.value)} placeholder="Manual Remarks" className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
          {/* A payment Accounts has worked says so while it is being changed. */}
          {row.locked && row.status && <span className="block text-xs text-slate-500">{row.status}</span>}
        </div> },
        /*
         * Digits and one decimal point, sanitised as typed - the same rule the Signed Quotation box above
         * uses. It was `type="number"` with no `step`, which is a step of one: a browser marks 11.9 invalid
         * against that and its arrows walk in whole numbers, and the decimals are not optional now that a
         * percentage can be worked out from an amount.
         */
        { key: "percentage", label: <>Percentage<HelpTip text="This payment's share of the signed quotation; the amount follows it." /></>, headerClassName: "w-[12%] !px-4", cellClassName: "!px-4", render: (row) => <input inputMode="decimal" aria-label="Percentage" value={row.percentage} onChange={(event) => { setEditingAmount(null); updateRow(row.id, "percentage", event.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1")); }} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-right text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /> },
        /*
         * Typed into as well as read. What is stored is still the percentage - see `percentageForAmount` -
         * so a schedule entered in rupees still follows a corrected quotation.
         *
         * **While a row is being typed into, the box shows what was typed.** Drawn from the percentage on
         * every keystroke it would rewrite itself under the cursor, and a rounding disagreement would turn
         * "50000" into "49999" mid-word. Leaving the box puts the derived figure back, which is also how
         * somebody sees that the share they entered came to what they meant.
         *
         * The ₹ sits outside the box, as it does on the Signed Quotation, so the value in it is the value.
         */
        { key: "amount", label: <>Amount<HelpTip text="This payment in rupees; typing it works out the percentage for you." /></>, headerClassName: "w-[14%] !px-4 text-right", cellClassName: "!px-4 text-right", render: (row) => <span className="flex items-center justify-end gap-1">
          <span className="text-sm text-slate-500">₹</span>
          <input
            inputMode="decimal"
            aria-label="Amount"
            // A share of nothing cannot be expressed, and the line under the figure above already says so.
            disabled={!Number(signedQuotation)}
            value={editingAmount?.id === row.id ? editingAmount.text : (row.percentage === "" ? "" : String(amountForPercentage(row.percentage, signedQuotation)))}
            onChange={(event) => {
              const text = event.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
              setEditingAmount({ id: row.id, text });
              updateRow(row.id, "percentage", percentageForAmount(text, signedQuotation));
            }}
            onBlur={() => setEditingAmount(null)}
            className="h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-right text-sm font-medium text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
          />
        </span> },
        { key: "remove", label: "", headerClassName: "w-14 !px-2", cellClassName: "!px-2 text-center", render: (row) => <button type="button" disabled={rows.length === 1} onClick={() => deleteRow(row.id)} aria-label={`Delete ${paymentCategoryLabel(row, rows, categories)}`} className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-35"><CloseIcon size={20} /></button> },
      ]))}
      rows={rows}
    />
    {dueRow && <PaymentDueDialog
      row={dueRow}
      shoots={shoots}
      onClose={() => setDueRowId(null)}
      onDone={(changes) => { updateRowWith(dueRow.id, changes); setDueRowId(null); }}
    />}
  </SchemaFormSection>;
}
