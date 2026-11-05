"use client";

import { useCallback, useEffect, useState } from "react";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import EventIcon from "@mui/icons-material/Event";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import ShareOutlinedIcon from "@mui/icons-material/ShareOutlined";
import PaymentsOutlinedIcon from "@mui/icons-material/PaymentsOutlined";
import CashEntryFormPanel from "@/components/accounts/CashEntryFormPanel";
import PaymentStatusPill from "@/components/accounts/PaymentStatusPill";
import ScheduledPaymentPanel from "@/components/accounts/ScheduledPaymentPanel";
import ReceiptMessageDialog from "@/components/accounts/ReceiptMessageDialog";
import ExtraQuotationFormPanel from "./ExtraQuotationFormPanel";
import { approveExtraQuotation, rejectExtraQuotation } from "@/services/sales/extra-quotations.service";
import { useModuleAccess } from "@/components/auth/PermissionsProvider";
import Button from "@/components/shared/Button";
import IconButton from "@/components/shared/IconButton";
import Loader from "@/components/shared/Loader";
import HelpTip from "@/components/shared/HelpTip";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import { downloadCashReceipt, getCashEntry, getCashEntryOptions } from "@/services/accounts/cash-entries.service";
import { getProjectPayments } from "@/services/project-management/project-workflow.service";
import { getScheduledPayment, getScheduledPayments } from "@/services/accounts/scheduled-payments.service";
import { dueDateText } from "@/lib/paymentSchedule.mjs";

/**
 * The money against one project, as the Payments section of the record a double-click opens shows
 * it: what came in, what went out, and where that leaves the project.
 *
 * The rows are Accounts' cash entries filed against this project — not a second set of figures kept
 * here — so recording one opens Accounts' own form rather than a form of this tab's own. Both the
 * reading and the writing therefore answer to ACCOUNTS / Cash Management: the tab is shown to
 * somebody holding it as well as Projects, and the two Add buttons only to somebody who may write
 * it. A viewer who may read the money but not record it sees the lists and no buttons, which is
 * Rule 4's "absent, never disabled".
 *
 * The project the tab was opened from is handed to that form already answered, so a payment filed
 * from here cannot land against the wrong project, and money out is offered this project's shoots
 * alone.
 *
 * It fetches for itself rather than being handed rows by the table. The record view is drawn from
 * the row already in hand, so the figures are the one thing on it that is not, and loading them for
 * every row in the table would mean a request per project to fill a section most rows never open.
 *
 * `readOnly` drops every control — Add, Edit, Approve and Reject — whatever the viewer's rights.
 * The double-click record view is a reading of the project, not a place to change it, so it asks
 * for this; Edit Project draws the same view with the controls on.
 *
 * It renders the section's body only: the panel around it supplies the heading and the rail entry,
 * the same way every other section of that record does.
 */

const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const entryDate = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });

/**
 * The edit control on a row: an outlined disc in the row's own colour rather than a grey one, so it
 * belongs to the row it sits on instead of reading as a control borrowed from somewhere else.
 *
 * Filled in the row's own colour with a white ring and a white pencil. The fill has to be a
 * saturated shade for that to work: a white ring on the pale `50` tint the row itself uses would
 * disappear into it.
 *
 * A saturated fill is also the one kind of colour the dark themes deliberately leave alone —
 * `globals.css` says so of anything already carrying a colour of its own, a status pill or a blue
 * button — so emerald, rose and amber at `500` read on a dark row exactly as they do on a light
 * one, and the white on top of them stays white.
 *
 * No colour of its own. The fill is the row's own tint and the pencil the shade that row's amount
 * is already written in, so the disc introduces nothing the list was not using.
 *
 * The white ring is dimmed by sixty per cent, and stays dimmed on hover — it lifts only to half,
 * which is enough to answer the pointer without the ring becoming the brightest thing on the row.
 * At full strength it was exactly that, which is not what an edit button should be. An alpha on white is safe in both themes — white is not a
 * colour the dark rules repaint, so fading it means the same thing on either ground. The shadow
 * carries the edge in a light theme, where white on a pale tint has little to say either way.
 *
 * A saturated fill was tried and is what "too bright" meant — a mid green or red reads as loud
 * wherever it is put, and the dark themes deliberately leave a saturated colour alone, so it stayed
 * just as loud on a dark row. These names are ones they do repaint: the `50` fills, the `200`
 * borders, the `700` inks. The hover deepens the ring rather than changing the fill, which would
 * have needed a tint the dark rules miss.
 *
 * `variant="plain"` is what stops the shared button contributing a grey hover of its own.
 */
const EDIT_BUTTON = "border-2 border-white/40 shadow transition hover:border-white/50";
const EDIT_TONE = {
  received: "bg-emerald-50 text-emerald-700",
  spent: "bg-rose-50 text-rose-600",
  pending: "bg-amber-50 text-amber-700",
};

const formatAmount = (value) => currency.format(Number(value || 0));
const formatSigned = (value, sign) => `${sign}${formatAmount(Math.abs(Number(value || 0)))}`;
const formatDate = (value) => value ? entryDate.format(new Date(value)) : "";
/** The machine-readable half of the stamp, for anything reading the page rather than looking at it. */
const isoDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : undefined;
};

/** What the entry was for, in the words the person filing it used, falling back to its category. */
const entryTitle = (entry) => entry.description?.trim() || entry.category || entry.entryId;

/**
 * What the row says beside its date, which is as little as tells it apart.
 *
 * Money in carries the category, and only where the entry was described in its own words — the
 * title is that description, so the category is what places it.
 *
 * Money out carries the shoot it was spent on and nothing else. Who was paid is on the entry in
 * Accounts for anyone who needs it; here it crowded a row whose question is which shoot cost what.
 *
 * The date is drawn separately with a calendar beside it, since it is on every row and worth
 * finding without reading.
 */
function entryMeta(entry, received) {
  if (!received) return entry.shootName || "";
  return entry.description?.trim() && entry.category ? entry.category : "";
}

function EntryRow({ entry, tone, onEdit, editing, onDownload, downloading, onShare }) {
  const received = tone === "received";
  const meta = entryMeta(entry, received);
  // The tints carry no opacity modifier on purpose: `bg-emerald-50/70` is a different class as far
  // as CSS is concerned, and the dark themes in globals.css repaint the plain names only — written
  // with the modifier a row stays pastel, with light text on it, on a dark page.
  return <li className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md px-3 py-2.5 ${received ? "bg-emerald-50" : "bg-rose-50"}`}>
    {/* Wrapping rather than truncating: on a phone there is no hover to recover a clipped title
        from, and "Wedding Photography Packag…" is not what the row is for. */}
    <div className="min-w-0 flex-1 basis-48">
      <p className="break-words text-sm font-medium text-slate-800">{entryTitle(entry)}</p>
      {/* The date it moved, and only then the rest. Which date it is follows from the list the row
          is in, so the title says it for anyone who cannot tell the two lists apart. */}
      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
        <EventIcon aria-hidden="true" sx={{ fontSize: 14 }} className="shrink-0" />
        <time dateTime={isoDate(entry.entryDate)} title={`${received ? "Received" : "Spent"} on ${formatDate(entry.entryDate) || "an unrecorded date"}`}>
          {formatDate(entry.entryDate) || "—"}
        </time>
        {/* The separator is its own item so that when the detail wraps to the next line it wraps
            without it: a line beginning with a lone middot reads as something missing. */}
        {meta && <>
          <span aria-hidden="true">·</span>
          <span className="min-w-0 break-words">{meta}</span>
        </>}
      </p>
    </div>
    <span className="flex shrink-0 items-center gap-1">
      {/* The payment's invoice as a PDF, for money received only - a read, so it is there for
          anyone who can see the tab, readOnly or not. */}
      {onDownload && <IconButton size="xs" shape="circle" ariaLabel={`Download invoice ${entry.entryId || ""}`.trim()} onClick={() => onDownload(entry)} disabled={downloading} variant="plain" className="text-emerald-700">
        <FileDownloadOutlinedIcon aria-hidden="true" className="block" sx={{ fontSize: 17 }} />
      </IconButton>}
      {/* The receipt with its invoice link, to copy or send to the project's group - Cash Management write. */}
      {onShare && <IconButton size="xs" shape="circle" ariaLabel={`Share invoice ${entry.entryId || ""}`.trim()} onClick={() => onShare(entry)} variant="plain" className="text-emerald-700">
        <ShareOutlinedIcon aria-hidden="true" className="block" sx={{ fontSize: 16 }} />
      </IconButton>}
      <p className={`text-sm font-semibold tabular-nums ${received ? "text-emerald-700" : "text-rose-600"}`}>
        {formatSigned(entry.amount, received ? "+" : "-")}
      </p>
      {/* Correcting an entry is Accounts' own form, opened on the whole record — so a figure typed
          wrongly is fixed where it was filed rather than withdrawn and entered again. Absent for a
          viewer who may only read the money. */}
      {onEdit && <IconButton size="xs" shape="circle" ariaLabel={`Edit ${entryTitle(entry)}`} title="Edit this entry" onClick={() => onEdit(entry)} disabled={editing} variant="plain" className={`${EDIT_BUTTON} ${received ? EDIT_TONE.received : EDIT_TONE.spent}`}>
        {/* `block` so the glyph sits in the middle of the disc: an inline SVG is laid out on the
            text baseline, which pushes it low however the disc centres its content. */}
        <EditOutlinedIcon aria-hidden="true" className="block" sx={{ fontSize: 15 }} />
      </IconButton>}
    </span>
  </li>;
}

function EntryList({ title, help, entries, tone, emptyMessage, addLabel, onAdd, addBusy = false, onEdit, editingId, onDownload, downloadingId, onShare }) {
  return <section>
    <div className="mb-2 flex items-center justify-between gap-3">
      <h3 className="flex items-center text-sm font-semibold text-slate-800">{title}<HelpTip text={help} /></h3>
      {/* Absent rather than disabled for a viewer who may not record one — and present on an empty
          list, which is the moment the button is most wanted. Disabled only while the form it opens
          is being fetched: a button that vanishes for a second reads as something breaking. */}
      {onAdd && <IconButton size="xs" shape="circle" ariaLabel={addLabel} title={addLabel} onClick={onAdd} disabled={addBusy} className={tone === "received" ? "text-emerald-700 hover:bg-emerald-50" : "text-rose-600 hover:bg-rose-50"}>
        <AddCircleOutlineIcon aria-hidden="true" sx={{ fontSize: 22 }} />
      </IconButton>}
    </div>
    {entries.length === 0
      ? <p className="rounded-md border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-500">{emptyMessage}</p>
      : <ul className="space-y-1.5">{entries.map((entry) => <EntryRow key={entry.id} entry={entry} tone={tone} onEdit={onEdit} editing={editingId === entry.id} onDownload={onDownload} downloading={downloadingId === entry.id} onShare={onShare} />)}</ul>}
  </section>;
}

/**
 * What the project's payment schedule still has to bring in, soonest first: each part with its due
 * date, what is left of it and its status - Overdue, Due, On Hold, and a part not near its date yet.
 *
 * **Still to Receive**, not "Dues": the list is every part the server has not marked Cleared, which
 * includes ones nothing is owed on yet - a Final Settlement months away, a part Accounts has held.
 * Calling it Dues read as "overdue or nearly due" and quietly misdescribed half of them. A part
 * received in full is left out, because it is already on this tab under Cash Received, as the money
 * that actually arrived.
 *
 * `onRecord` is Accounts' own Record, given only to somebody who may write cash.
 */
function DuesList({ dues, onRecord, openingId }) {
  return <section>
    <h3 className="mb-2 flex items-center text-sm font-semibold text-slate-800">Still to Receive<HelpTip text="Every part of this project's payment schedule that has not been received in full - overdue, due, on hold, and parts not near their date yet. A part received in full is under Cash Received instead." /></h3>
    {dues.length === 0
      ? <p className="rounded-md border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-500">Every part of this project&apos;s payment schedule has been received.</p>
      : <ul className="space-y-1.5">{dues.map((due) => <li key={due.id} className="rounded-md bg-amber-50 px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <div className="min-w-0 flex-1 basis-40">
            <p className="break-words text-sm font-medium text-slate-800">{due.category}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
              <EventIcon aria-hidden="true" sx={{ fontSize: 14 }} className="shrink-0" />
              {due.dueDate ? <time dateTime={due.dueDate}>{formatDate(due.dueDate)}</time> : <span>{dueDateText(due, formatDate, "With the final settlement")}</span>}
              {due.received > 0 && <><span aria-hidden="true">·</span><span>{formatAmount(due.received)} of {formatAmount(due.amount)} paid</span></>}
            </p>
          </div>
          <span className="flex shrink-0 items-center gap-2">
            <PaymentStatusPill status={due.status} />
            <p className="text-sm font-semibold tabular-nums text-amber-700">{formatAmount(due.pending)}</p>
            {/* The row's own disc, as Cash Received and Spent draw theirs: a payment icon in the due's tint. */}
            {onRecord && <IconButton size="xs" shape="circle" ariaLabel={`Record a payment for ${due.category}`} onClick={() => onRecord(due)} disabled={Boolean(openingId)} variant="plain" className={`${EDIT_BUTTON} ${EDIT_TONE.pending}`}>
              <PaymentsOutlinedIcon aria-hidden="true" className="block" sx={{ fontSize: 15 }} />
            </IconButton>}
          </span>
        </div>
      </li>)}</ul>}
  </section>;
}

/**
 * One extra, approved or still waiting. A waiting one is drawn back and says so.
 *
 * The service, the shoot, the date and the amount, and nothing else: this column sits beside two
 * others and is read down, so who raised it and what they wrote about it are detail rather than
 * identity. Both are on the Extra Quotations table, which is where an extra is read in full.
 */
function ExtraRow({ extra, canDecide, onDecide, deciding, onEdit }) {
  const pending = extra.status === "PENDING";
  /*
   * Only the tint names the dark themes actually repaint. `bg-amber-50/60` is a different class from
   * `bg-amber-50` as far as CSS is concerned and the dark rules miss it, and neither `bg-amber-100`
   * nor `border-amber-300` is named at all — so a pending row stayed pale yellow on a dark panel
   * with light text on it. The same trap the cash rows were written around.
   */
  return <li className={`rounded-md px-3 py-2.5 ${pending ? "border border-dashed border-amber-200 bg-amber-50" : "bg-emerald-50"}`}>
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <div className="min-w-0 flex-1 basis-40">
        <p className="break-words text-sm font-medium text-slate-800">{extra.service || "Extra work"}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
          <EventIcon aria-hidden="true" sx={{ fontSize: 14 }} className="shrink-0" />
          <time dateTime={isoDate(pending ? extra.raisedAt : extra.approvedAt)}>{formatDate(pending ? extra.raisedAt : extra.approvedAt) || "—"}</time>
          {extra.shootName && <><span aria-hidden="true">·</span><span className="min-w-0 break-words">{extra.shootName}</span></>}
        </p>
        {/* Who added it - the employee an extra is credited to (`requestedByName` on the server), so
            the row says whose agreement it is. */}
        {extra.addedBy && <p className="mt-0.5 break-words text-xs text-slate-500">Added by <span className="font-medium text-slate-700">{extra.addedBy}</span></p>}
      </div>
      <span className="flex shrink-0 items-center gap-1">
        <p className={`text-sm font-semibold tabular-nums ${pending ? "text-amber-700" : "text-emerald-700"}`}>{formatAmount(extra.amount)}</p>
        {/* Only while it waits. Once a manager has approved it the figure is what the project agreed
            to sell, and changing it afterwards would move that quietly — the server refuses it too. */}
        {pending && onEdit && <IconButton size="xs" shape="circle" ariaLabel={`Edit ${extra.requestCode}`} title="Edit this extra" onClick={() => onEdit(extra)} variant="plain" className={`${EDIT_BUTTON} ${EDIT_TONE.pending}`}>
          <EditOutlinedIcon aria-hidden="true" className="block" sx={{ fontSize: 15 }} />
        </IconButton>}
      </span>
    </div>
    {pending && <div className="mt-2 flex flex-wrap items-center gap-2">
      {/* Outlined rather than filled: the row is already the warn tint, so a second block of the
          same colour would vanish into it — and `bg-amber-100`, the shade that would have set it
          apart, is one the dark themes leave alone. */}
      <span className="rounded-full border border-amber-200 px-2 py-0.5 text-xs font-medium text-amber-800">Approval pending</span>
      {/* The attachments travel with the request, because deciding it means looking at what the
          client actually agreed to rather than taking the amount on trust. */}
      {(extra.proofUrls || []).map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer" className="text-xs font-medium text-blue-600 hover:text-blue-700">Attachment {index + 1}</a>)}
      {/* Shown only to whoever may actually decide it — the project's manager, or a super admin. */}
      {canDecide && <span className="ml-auto flex items-center gap-2">
        <Button type="button" size="sm" busy={deciding} onClick={() => onDecide(extra, "reject")}>Reject</Button>
        <Button type="button" size="sm" variant="primary" disabled={deciding} onClick={() => onDecide(extra, "approve")}>{deciding ? "Saving..." : "Approve"}</Button>
      </span>}
    </div>}
  </li>;
}

function SummaryRow({ label, value, help, className = "text-slate-700" }) {
  return <div className="flex items-baseline justify-between gap-4 py-1.5">
    <dt className="flex items-center text-sm text-slate-600">{label}<HelpTip text={help} /></dt>
    <dd className={`text-sm font-semibold tabular-nums ${className}`}>{value}</dd>
  </div>;
}

/**
 * Where the project stands on the money it is booked to receive, above what it is signed for: its
 * Accounts status - Hold, Overdue, Due, or Active - the same as on Accounts Manager.
 */
function AccountsStatus({ status }) {
  return <section className="mb-6 flex items-center justify-between gap-2">
    <h3 className="flex items-center text-sm font-semibold text-slate-800">Accounts Status<HelpTip text="Where the project stands on its scheduled payments, as on Accounts Manager: Hold, Overdue, Due, or Active when none of those apply." /></h3>
    <PaymentStatusPill status={status || "Active"} />
  </section>;
}

/**
 * What the project is signed for, above the extras that are half of it.
 *
 * The two figures it adds are already on the tab — the quotation and the extras sit in the summary
 * on the far side — but only as two figures to hold in the head. This is the number somebody
 * actually quotes back to a client, and it belongs at the top of the column that explains it: the
 * extras listed underneath are what the second line is made of.
 *
 * Approved extras only, which is what the server totals. Anything still waiting is named under the
 * figure rather than folded into it — an extra nobody has agreed to is not money the project is
 * signed for, and a total that quietly counted it would be wrong on exactly the projects where the
 * figure is being checked.
 */
function SignedQuotation({ summary, pendingCount = 0 }) {
  return <section className="mb-6 rounded-md border border-slate-200 bg-white px-4 py-3">
    <h3 className="mb-1 flex items-center text-sm font-semibold text-slate-800">Signed Quotation<HelpTip text="What the client is signed for: the amount the sale was booked at plus the extras the project manager has approved." /></h3>
    <dl>
      {/* Only the parts being added are a divided list; the total sits outside it. With the total
          inside, `divide-y` put a hairline under the Extra quotation row and the total's own rule
          sat 4px below it, on the far side of its top margin — two rules where the card has one. */}
      <div className="divide-y divide-slate-100">
        <SummaryRow label="Initial signed" help="The amount the sale was signed for when it was booked (its Initial Converted Value)." value={formatAmount(summary?.totalQuotation)} className="text-slate-900" />
        <SummaryRow label="Extra quotation" help="The total of the extra work approved since the sale. Extras still waiting for approval are not counted." value={formatAmount(summary?.totalExtra)} className="text-emerald-700" />
        {/* The published Sale Extras from Edit Sale Details - additions less removals - when there are any. */}
        {Number(summary?.totalSaleExtras || 0) !== 0 && <SummaryRow label="Sale extras" help="The net of the extras published from Edit Sale Details: shoots, services and deliverables added or removed after booking, at the amounts entered there." value={formatAmount(summary?.totalSaleExtras)} className="text-emerald-700" />}
      </div>
      {/* The sum reads as the answer rather than as a third row of the same weight: a heavier rule
          above it, and the only line on the tab in the darkest ink. */}
      <div className="mt-1 flex items-baseline justify-between gap-4 border-t-2 border-slate-200 pt-2">
        <dt className="flex items-center text-sm font-semibold text-slate-800">Total signed<HelpTip text="Initial signed plus Extra quotation and any published Sale extras: the figure to quote back to the client." /></dt>
        <dd className="text-base font-semibold tabular-nums text-slate-900">{formatAmount(summary?.totalSigned)}</dd>
      </div>
    </dl>
    {pendingCount > 0 && <p className="mt-2 text-xs text-slate-500">
      {pendingCount === 1 ? "One extra is waiting for approval and is not counted here." : `${pendingCount} extras are waiting for approval and are not counted here.`}
    </p>}
  </section>;
}

/**
 * The extra work on this project: what has been agreed, and what is still waiting to be.
 *
 * Waiting ones sit above the approved, drawn back and labelled, because they are the ones somebody
 * has to do something about. They are not counted anywhere — the summary totals approved extras
 * only — so the column can show them without overstating what the project has sold.
 */
function ExtrasColumn({ extras, pending, canDecide, onDecide, decidingId, onAdd, addBusy, onEdit }) {
  const approved = extras || [];
  const waiting = pending || [];
  return <section className="min-w-0">
    <div className="mb-2 flex items-center justify-between gap-3">
      <h3 className="flex items-center text-sm font-semibold text-slate-800">Extras<HelpTip text="Extra work agreed after the sale, raised as extra quotations. The project manager approves or rejects each one." /></h3>
      {onAdd && <IconButton size="xs" shape="circle" ariaLabel="Raise an extra quotation" title="Raise an extra quotation" onClick={onAdd} disabled={addBusy} className="text-emerald-700 hover:bg-emerald-50">
        <AddCircleOutlineIcon aria-hidden="true" sx={{ fontSize: 22 }} />
      </IconButton>}
    </div>
    {approved.length === 0 && waiting.length === 0
      ? <p className="rounded-md border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-500">No extra work on this project yet.</p>
      : <ul className="space-y-1.5">
        {waiting.map((extra) => <ExtraRow key={extra.id} extra={extra} canDecide={canDecide} onDecide={onDecide} deciding={decidingId === extra.id} onEdit={onEdit} />)}
        {approved.map((extra) => <ExtraRow key={extra.id} extra={extra} canDecide={false} onDecide={onDecide} deciding={false} />)}
      </ul>}
  </section>;
}

function PaymentSummary({ summary }) {
  return <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
    <h3 className="mb-1 flex items-center text-sm font-semibold text-slate-800">Project Summary<HelpTip text="The project's money at a glance, from the cash entries Accounts has filed against it." /></h3>
    {/* What moved first, then what it is measured against: the two totals the lists beside this add
        up to, and under them the figure the project was sold for and what has come in over it.
        Deliberately nothing drawn from all four — what a project made is a question for Accounts,
        who know what else it cost. */}
    <dl className="divide-y divide-slate-100">
      <SummaryRow label="Total cash received" help="All the money received against this project in Accounts, leaving out withdrawn entries." value={formatAmount(summary?.totalReceived)} className="text-emerald-700" />
      <SummaryRow label="Total cash spent" help="All the money spent against this project's shoots in Accounts, leaving out withdrawn entries." value={formatAmount(summary?.totalSpent)} className="text-rose-600" />
      <SummaryRow label="Total quotation" help="The amount the sale was signed for when it was booked, before any extras." value={formatAmount(summary?.totalQuotation)} className="text-slate-900" />
      {/* Whatever has come in above the quotation — an add-on shoot agreed after the sale is paid
          for on top of it, so the money over the quoted figure is the money for the add-ons. A
          slice of what came in rather than a figure to add to it, hence the same green. Zero until
          the project has been paid past its quotation. */}
      <SummaryRow label="Extra" help="The total of the extra work the project manager has approved, whether or not it has been paid yet." value={formatAmount(summary?.totalExtra)} className="text-emerald-700" />
    </dl>
  </div>;
}

/*
 * The three columns side by side need the width of the whole panel. `stacked` is for a panel that
 * keeps a rail of its own beside this body - Pre Production's Follow-ups - where the pane is a rail
 * narrower than the screen: the columns there wait for a wider screen (`2xl`) before sitting side by
 * side. Whole class strings, so Tailwind sees each one.
 */
const LAYOUT = {
  wide: { grid: "grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)] xl:gap-10", summary: "min-w-0 xl:sticky xl:top-4", spacer: "hidden xl:block xl:min-h-72" },
  stacked: { grid: "grid items-start gap-8 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)] 2xl:gap-10", summary: "min-w-0 2xl:sticky 2xl:top-4", spacer: "hidden 2xl:block 2xl:min-h-72" },
};

/*
 * `allowRaiseExtra={false}` leaves out the Extras column's add button and nothing else - the extras,
 * their Edit while they wait and their approval stay. Edit Project's Payments tab passes it: no extra
 * is raised from there. The Pre Production and Production panels keep the button.
 */
export default function ProjectPaymentsView({ projectId, readOnly = false, stacked = false, allowRaiseExtra = true }) {
  const layout = stacked ? LAYOUT.stacked : LAYOUT.wide;
  const [payments, setPayments] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Recording one is a write to Accounts' own records, so it asks for Accounts' own write.
  const { canWrite: canWriteCash } = useModuleAccess("ACCOUNTS", "Cash Management");
  const canRecordCash = canWriteCash && !readOnly;
  // An extra is a quotation raised on the project, which the server writes under PROJECT / Projects
  // (`extra-quotations/routes.js`): its Add and Edit are offered only to somebody who may write that -
  // on the Production and Pre Production panels somebody may see the money without it.
  const { canWrite: canWriteProjects } = useModuleAccess("PROJECT", "Projects");
  const canRaiseExtras = canWriteProjects && !readOnly;
  const [recording, setRecording] = useState(null);
  const [raisingExtra, setRaisingExtra] = useState(false);
  const [editingExtra, setEditingExtra] = useState(null);
  const [decidingExtraId, setDecidingExtraId] = useState("");
  const [cashOptions, setCashOptions] = useState(null);
  const [openingForm, setOpeningForm] = useState("");
  const [editingEntry, setEditingEntry] = useState(null);
  const [openingEntryId, setOpeningEntryId] = useState("");
  const { notice, showSuccess, showError, clearNotice } = useNotice();
  const [downloadingId, setDownloadingId] = useState("");
  // The schedule's unpaid parts, and the one opened to record against - Accounts' own panel.
  const [dues, setDues] = useState([]);
  const [openDue, setOpenDue] = useState(null);
  const [openingDueId, setOpeningDueId] = useState("");
  // The receipt and invoice link to hand the client - from a row's Share, or the moment one is recorded.
  const [sharing, setSharing] = useState(null);

  const downloadReceipt = useCallback(async (entry) => {
    setDownloadingId(entry.id);
    try {
      await downloadCashReceipt(entry.id, entry.entryId);
    } catch (downloadError) {
      showError(downloadError.message || "Unable to download the invoice.");
    } finally {
      setDownloadingId("");
    }
  }, [showError]);

  // `quiet` re-reads in place, for the refresh after an entry is filed: the lists are already on
  // screen and replacing them with a spinner for a moment reads as the tab reloading itself.
  const load = useCallback(async ({ quiet = false } = {}) => {
    // No project to ask about reads as "nothing against it" rather than as a wait that never ends.
    if (!projectId) {
      setPayments(null);
      setLoading(false);
      return;
    }
    if (!quiet) setLoading(true);
    setError("");
    try {
      const [response, owed] = await Promise.all([getProjectPayments(projectId), getScheduledPayments({ projectId })]);
      setPayments(response?.data || null);
      setDues(Array.isArray(owed?.data) ? owed.data : []);
    } catch (loadError) {
      // A refresh that fails leaves what was read last on screen and says so, rather than throwing
      // away a list that is merely a moment out of date.
      if (quiet) showError(loadError.message || "Unable to refresh payments.");
      else setError(loadError.message || "Unable to load payments for this project.");
    } finally {
      setLoading(false);
    }
  }, [projectId, showError]);

  // Deferred by a tick rather than fetched in the effect body, the way the projects page loads its
  // own rows: the state the fetch sets is then never set synchronously during the effect.
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  /**
   * Opens Accounts' entry form on this project, in the direction the button pressed asks for.
   *
   * The form's dropdowns — branches, employees, accounts, the recent projects and shoots — are one
   * request, and it is made on the first Add rather than with the tab: most readings of this tab
   * record nothing, and the tab is not going to wait on a list it may never show. Once fetched it
   * is kept for the rest of the session on screen, so the second Add opens at once.
   */
  const ensureOptions = useCallback(async () => {
    if (cashOptions) return cashOptions;
    const response = await getCashEntryOptions();
    const loaded = response?.data || {};
    setCashOptions(loaded);
    return loaded;
  }, [cashOptions]);

  const record = useCallback(async (entryType) => {
    const project = payments?.project;
    if (!project) return;
    setOpeningForm(entryType);
    try {
      await ensureOptions();
      setRecording({ entryType, project });
    } catch (optionsError) {
      showError(optionsError.message || "Unable to open the cash entry form.");
    } finally {
      setOpeningForm("");
    }
  }, [ensureOptions, payments, showError]);

  /**
   * Correcting an entry already filed.
   *
   * The row on this tab is a summary — what it was for, when, how much — while the form edits the
   * whole record: the account it moved through, who handled it, the proof. So the entry is read
   * back in full before the form opens, rather than the form being given the little this tab knows
   * and quietly blanking the rest on save.
   */
  const editEntry = useCallback(async (row) => {
    setOpeningEntryId(row.id);
    try {
      await ensureOptions();
      const response = await getCashEntry(row.id);
      if (!response?.data) throw new Error("That entry could not be found.");
      setEditingEntry(response.data);
    } catch (readError) {
      showError(readError.data?.message || readError.message || "Unable to open that entry.");
    } finally {
      setOpeningEntryId("");
    }
  }, [ensureOptions, showError]);

  /**
   * Recording a payment against a due: Accounts' scheduled payment panel, read in full and opened to
   * work - Clear, Partially paid or On Hold, the cash entry filed against this part of the schedule.
   */
  const recordDue = useCallback(async (due) => {
    setOpeningDueId(due.id);
    try {
      await ensureOptions();
      const response = await getScheduledPayment(due.id);
      setOpenDue(response?.data || due);
    } catch (openError) {
      showError(openError.data?.message || openError.message || "Unable to open this payment.");
    } finally {
      setOpeningDueId("");
    }
  }, [ensureOptions, showError]);

  /**
   * Approving or rejecting an extra, from the column it sits in.
   *
   * A rejection has to say why — the person who raised it is owed the reason — so it asks for one
   * rather than sending an empty decision the server would refuse.
   */
  const decideExtra = useCallback(async (extra, decision) => {
    let remarks = null;
    if (decision === "reject") {
      remarks = window.prompt(`Why is ${extra.requestCode} being rejected?`);
      if (!remarks || !remarks.trim()) return;
    }
    setDecidingExtraId(extra.id);
    try {
      if (decision === "approve") await approveExtraQuotation(extra.id, remarks ? { remarks } : {});
      else await rejectExtraQuotation(extra.id, { remarks: remarks.trim() });
      showSuccess(`${extra.requestCode} ${decision === "approve" ? "approved" : "rejected"}.`);
      await load({ quiet: true });
    } catch (decisionError) {
      showError(decisionError.data?.message || decisionError.message || "Unable to record that decision.");
    } finally {
      setDecidingExtraId("");
    }
  }, [load, showError, showSuccess]);

  const received = payments?.received || [];
  const spent = payments?.spent || [];
  // Nothing to file an entry against until the project has arrived with them.
  const canAdd = canRecordCash && Boolean(payments?.project);

  return <>
    <FloatingNotice notice={notice} onClose={clearNotice} />
    {loading ? <Loader label="Loading payments..." /> : error
      ? <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        <p>{error}</p>
        {/* `type="button"`: the panel around this is a form, and a retry must not read as its
            submit. */}
        <Button type="button" size="sm" className="mt-2" onClick={() => void load()}>Try again</Button>
      </div>
      : <>
        {/* Three columns, and they read left to right as the money does: what was agreed on top of
            the quotation, what actually moved, and what it all comes to. They stack in that same
            order on a narrow screen, so the summary is still the last thing read. */}
        <div className={layout.grid}>
          <div className="min-w-0">
            <AccountsStatus status={payments?.accountsStatus} />
            <SignedQuotation summary={payments?.summary} pendingCount={(payments?.pendingExtras || []).length} />
            <ExtrasColumn
              extras={payments?.extras}
              pending={payments?.pendingExtras}
              // The server's answer for this reader (the project's manager or a Super Admin), and the
              // permission its approve route asks (PROJECT / Projects write) - a manager who reached this
              // from Production or Pre Production without it is not offered a decision that would be refused.
              canDecide={!readOnly && canWriteProjects && Boolean(payments?.canDecideExtras)}
              onDecide={(extra, decision) => void decideExtra(extra, decision)}
              decidingId={decidingExtraId}
              onAdd={canRaiseExtras && allowRaiseExtra && payments?.project ? () => setRaisingExtra(true) : null}
              addBusy={Boolean(decidingExtraId)}
              onEdit={canRaiseExtras ? (extra) => setEditingExtra(extra) : null}
            />
          </div>
          <div className="min-w-0 space-y-6">
            <EntryList title="Cash Received" help="Each payment received from the client for this project, as recorded in Accounts." entries={received} tone="received" emptyMessage="No money received against this project yet." addLabel="Record cash received" onAdd={canAdd ? () => void record("Received") : null} addBusy={Boolean(openingForm)} onEdit={canRecordCash ? (row) => void editEntry(row) : null} editingId={openingEntryId} onDownload={(row) => void downloadReceipt(row)} downloadingId={downloadingId} onShare={canRecordCash ? (row) => setSharing({ entryId: row.entryId, cashEntryId: row.id }) : null} />
            <EntryList title="Cash Spent" help="Each expense paid for this project's shoots, as recorded in Accounts." entries={spent} tone="spent" emptyMessage="No money spent against this project yet." addLabel="Record cash spent" onAdd={canAdd ? () => void record("Spent") : null} addBusy={Boolean(openingForm)} onEdit={canRecordCash ? (row) => void editEntry(row) : null} editingId={openingEntryId} />
          </div>
          {/* Room under the summary, left deliberately empty: it is where the details this tab will
              grow into go, and it keeps the summary at the top of its column where it is read. */}
          <div className={layout.summary}>
            <PaymentSummary summary={payments?.summary} />
            {/* What is still owed, under what has moved - read with the summary it follows from. */}
            <div className="mt-6"><DuesList dues={dues} onRecord={canRecordCash ? (due) => void recordDue(due) : null} openingId={openingDueId} /></div>
            <div aria-hidden="true" className={layout.spacer} />
          </div>
        </div>
      </>}
    {/* Above the record it was opened from rather than in place of it: filing a payment is a
        detour from reading the project, and closing the form returns to where it started. */}
    {/* The same panel it was raised in, opened on the extra itself. */}
    {editingExtra && <ExtraQuotationFormPanel
      extra={editingExtra}
      onClose={() => setEditingExtra(null)}
      onCreated={(updated, message) => {
        setEditingExtra(null);
        showSuccess(message);
        void load({ quiet: true });
      }}
    />}
    {raisingExtra && payments?.project && <ExtraQuotationFormPanel
      project={{ id: payments.project.id, eventId: payments.project.eventId, name: payments.project.clientName }}
      onClose={() => setRaisingExtra(false)}
      onCreated={(created, message) => {
        setRaisingExtra(false);
        showSuccess(message);
        void load({ quiet: true });
      }}
    />}
    {/* Over the cash form too, which sits at the panel-over-panel layer and stays open on Save & Next. */}
    {sharing && <ReceiptMessageDialog {...sharing} layer="confirmOverDialog" onClose={() => setSharing(null)} />}
    {openDue && <ScheduledPaymentPanel
      key={openDue.id}
      payment={openDue}
      recording
      canWrite={canRecordCash}
      cashOptions={cashOptions}
      zIndexClassName="z-[130]"
      onClose={() => setOpenDue(null)}
      onChanged={(payment, message) => {
        if (payment) setOpenDue(payment);
        if (message) showSuccess(message);
        void load({ quiet: true });
      }}
    />}
    {/* The same panel Accounts edits an entry in, opened on the whole record. */}
    {editingEntry && <CashEntryFormPanel
      entry={editingEntry}
      options={cashOptions || {}}
      zIndexClassName="z-[130]"
      onClose={() => setEditingEntry(null)}
      onSaved={(message) => {
        showSuccess(message);
        setEditingEntry(null);
        void load({ quiet: true });
      }}
    />}
    {recording && <CashEntryFormPanel
      preset={recording}
      options={cashOptions || {}}
      zIndexClassName="z-[130]"
      onClose={() => setRecording(null)}
      onSaved={(message, { keepOpen } = {}) => {
        showSuccess(message);
        if (!keepOpen) setRecording(null);
        // Money received: its receipt goes to the project's WhatsApp group from the server, so nothing opens here.
        // The lists and the totals are the point of the tab, so they are re-read whether or not the
        // form stayed open for the next entry.
        void load({ quiet: true });
      }}
    />}
  </>;
}
