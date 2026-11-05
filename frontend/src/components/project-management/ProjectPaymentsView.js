"use client";

import { useCallback, useEffect, useState } from "react";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import EventIcon from "@mui/icons-material/Event";
import CashEntryFormPanel from "@/components/accounts/CashEntryFormPanel";
import ExtraQuotationFormPanel from "./ExtraQuotationFormPanel";
import { approveExtraQuotation, rejectExtraQuotation } from "@/services/sales/extra-quotations.service";
import { useModuleAccess } from "@/components/auth/PermissionsProvider";
import Button from "@/components/shared/Button";
import IconButton from "@/components/shared/IconButton";
import Loader from "@/components/shared/Loader";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import { getCashEntry, getCashEntryOptions } from "@/services/accounts/cash-entries.service";
import { getProjectPayments } from "@/services/project-management/project-workflow.service";

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

function EntryRow({ entry, tone, onEdit, editing }) {
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

function EntryList({ title, entries, tone, emptyMessage, addLabel, onAdd, addBusy = false, onEdit, editingId }) {
  return <section>
    <div className="mb-2 flex items-center justify-between gap-3">
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      {/* Absent rather than disabled for a viewer who may not record one — and present on an empty
          list, which is the moment the button is most wanted. Disabled only while the form it opens
          is being fetched: a button that vanishes for a second reads as something breaking. */}
      {onAdd && <IconButton size="xs" shape="circle" ariaLabel={addLabel} title={addLabel} onClick={onAdd} disabled={addBusy} className={tone === "received" ? "text-emerald-700 hover:bg-emerald-50" : "text-rose-600 hover:bg-rose-50"}>
        <AddCircleOutlineIcon aria-hidden="true" sx={{ fontSize: 22 }} />
      </IconButton>}
    </div>
    {entries.length === 0
      ? <p className="rounded-md border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-500">{emptyMessage}</p>
      : <ul className="space-y-1.5">{entries.map((entry) => <EntryRow key={entry.id} entry={entry} tone={tone} onEdit={onEdit} editing={editingId === entry.id} />)}</ul>}
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

function SummaryRow({ label, value, className = "text-slate-700" }) {
  return <div className="flex items-baseline justify-between gap-4 py-1.5">
    <dt className="text-sm text-slate-600">{label}</dt>
    <dd className={`text-sm font-semibold tabular-nums ${className}`}>{value}</dd>
  </div>;
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
    <h3 className="mb-1 text-sm font-semibold text-slate-800">Signed Quotation</h3>
    <dl>
      {/* Only the parts being added are a divided list; the total sits outside it. With the total
          inside, `divide-y` put a hairline under the Extra quotation row and the total's own rule
          sat 4px below it, on the far side of its top margin — two rules where the card has one. */}
      <div className="divide-y divide-slate-100">
        <SummaryRow label="Initial signed" value={formatAmount(summary?.totalQuotation)} className="text-slate-900" />
        <SummaryRow label="Extra quotation" value={formatAmount(summary?.totalExtra)} className="text-emerald-700" />
      </div>
      {/* The sum reads as the answer rather than as a third row of the same weight: a heavier rule
          above it, and the only line on the tab in the darkest ink. */}
      <div className="mt-1 flex items-baseline justify-between gap-4 border-t-2 border-slate-200 pt-2">
        <dt className="text-sm font-semibold text-slate-800">Total signed</dt>
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
      <h3 className="text-sm font-semibold text-slate-800">Extras</h3>
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
    <h3 className="mb-1 text-sm font-semibold text-slate-800">Project Summary</h3>
    {/* What moved first, then what it is measured against: the two totals the lists beside this add
        up to, and under them the figure the project was sold for and what has come in over it.
        Deliberately nothing drawn from all four — what a project made is a question for Accounts,
        who know what else it cost. */}
    <dl className="divide-y divide-slate-100">
      <SummaryRow label="Total cash received" value={formatAmount(summary?.totalReceived)} className="text-emerald-700" />
      <SummaryRow label="Total cash spent" value={formatAmount(summary?.totalSpent)} className="text-rose-600" />
      <SummaryRow label="Total quotation" value={formatAmount(summary?.totalQuotation)} className="text-slate-900" />
      {/* Whatever has come in above the quotation — an add-on shoot agreed after the sale is paid
          for on top of it, so the money over the quoted figure is the money for the add-ons. A
          slice of what came in rather than a figure to add to it, hence the same green. Zero until
          the project has been paid past its quotation. */}
      <SummaryRow label="Extra" value={formatAmount(summary?.totalExtra)} className="text-emerald-700" />
    </dl>
  </div>;
}

export default function ProjectPaymentsView({ projectId, readOnly = false }) {
  const [payments, setPayments] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Recording one is a write to Accounts' own records, so it asks for Accounts' own write.
  const { canWrite: canWriteCash } = useModuleAccess("ACCOUNTS", "Cash Management");
  const canRecordCash = canWriteCash && !readOnly;
  const [recording, setRecording] = useState(null);
  const [raisingExtra, setRaisingExtra] = useState(false);
  const [editingExtra, setEditingExtra] = useState(null);
  const [decidingExtraId, setDecidingExtraId] = useState("");
  const [cashOptions, setCashOptions] = useState(null);
  const [openingForm, setOpeningForm] = useState("");
  const [editingEntry, setEditingEntry] = useState(null);
  const [openingEntryId, setOpeningEntryId] = useState("");
  const { notice, showSuccess, showError, clearNotice } = useNotice();

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
      const response = await getProjectPayments(projectId);
      setPayments(response?.data || null);
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
        <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)] xl:gap-10">
          <div className="min-w-0">
            <SignedQuotation summary={payments?.summary} pendingCount={(payments?.pendingExtras || []).length} />
            <ExtrasColumn
              extras={payments?.extras}
              pending={payments?.pendingExtras}
              canDecide={!readOnly && Boolean(payments?.canDecideExtras)}
              onDecide={(extra, decision) => void decideExtra(extra, decision)}
              decidingId={decidingExtraId}
              onAdd={!readOnly && payments?.project ? () => setRaisingExtra(true) : null}
              addBusy={Boolean(decidingExtraId)}
              onEdit={readOnly ? null : (extra) => setEditingExtra(extra)}
            />
          </div>
          <div className="min-w-0 space-y-6">
            <EntryList title="Cash Received" entries={received} tone="received" emptyMessage="No money received against this project yet." addLabel="Record cash received" onAdd={canAdd ? () => void record("Received") : null} addBusy={Boolean(openingForm)} onEdit={canRecordCash ? (row) => void editEntry(row) : null} editingId={openingEntryId} />
            <EntryList title="Cash Spent" entries={spent} tone="spent" emptyMessage="No money spent against this project yet." addLabel="Record cash spent" onAdd={canAdd ? () => void record("Spent") : null} addBusy={Boolean(openingForm)} onEdit={canRecordCash ? (row) => void editEntry(row) : null} editingId={openingEntryId} />
          </div>
          {/* Room under the summary, left deliberately empty: it is where the details this tab will
              grow into go, and it keeps the summary at the top of its column where it is read. */}
          <div className="min-w-0 xl:sticky xl:top-4">
            <PaymentSummary summary={payments?.summary} />
            <div aria-hidden="true" className="hidden xl:block xl:min-h-72" />
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
        // The lists and the totals are the point of the tab, so they are re-read whether or not the
        // form stayed open for the next entry.
        void load({ quiet: true });
      }}
    />}
  </>;
}
