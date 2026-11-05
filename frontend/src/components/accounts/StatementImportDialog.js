"use client";

import { useMemo, useState } from "react";
import Dialog from "@/components/ui/Dialog";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Button from "@/components/shared/Button";
import FileUploadField from "@/components/shared/FileUploadField";
import TextField from "@/components/shared/TextField";
import ProgressChip from "@/components/shared/ProgressChip";
import StatTile from "@/components/shared/StatTile";
import Tabs from "@/components/ui/Tabs";
import SimpleTable from "@/components/data-table/SimpleTable";
import { formatAmount } from "@/components/data-table/tableCells";
import { PROGRESS_COLORS } from "@/lib/progressStatus.mjs";
import { extractStatement } from "@/services/accounts/statement-import.service";
import { createCashEntry } from "@/services/accounts/cash-entries.service";
import CashEntryFormPanel from "./CashEntryFormPanel";

const STATUS_COLORS = {
  New: PROGRESS_COLORS.inProgress,
  Recorded: PROGRESS_COLORS.completed,
  Duplicate: PROGRESS_COLORS.partiallyCompleted,
  "No transactions": PROGRESS_COLORS.notStarted,
  Failed: PROGRESS_COLORS.notStarted,
};

// A date the PDF did not yield reads as a dash, never as an error that takes the dialog down.
const PAGE_SIZE = 100;
const formatDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date) : "—";
};
// A file is known by its name and size while it waits to be read, so removing one from the list
// does not hand its password to the file that moves up into its place.
const fileKey = (file) => `${file.name}:${String(file.data || "").length}`;

function errorMessage(error, fallback) {
  if (error?.status === 401) return "Your session has expired. Please sign in again.";
  if (error?.status === 403) return error?.data?.message || "You do not have permission to import statements.";
  return error?.data?.message || error?.message || fallback;
}

/**
 * Accounts Manager -> Import from PDF.
 *
 * Several bank statements and receipts at once, each with its own password. They are read one at a
 * time, so a file that fails - a wrong password, a scanned image - is reported for itself and stays
 * in the list to be tried again, while the rest go through.
 *
 * Every transaction found lands in one table with what it is: **New** to be recorded, **Duplicate**
 * when a payment with the same transaction ID, date, amount and details is already in the cash book or
 * earlier in this batch, **Recorded** once
 * filed here. A file that gave nothing is a row of its own - **No transactions** or **Failed** -
 * with why.
 *
 * Nothing is saved by reading. Record opens the ordinary cash entry form filled in from the PDF, and
 * the person importing chooses the project, the category (advance, extras, final settlement...) and
 * whatever else the payment needs, exactly as for an entry typed in by hand.
 */
export default function StatementImportDialog({ options, onClose, onRecorded }) {
  const [files, setFiles] = useState([]);
  const [passwords, setPasswords] = useState({});
  // Why each file still waiting failed last time, under its password box.
  const [fileErrors, setFileErrors] = useState({});
  const [results, setResults] = useState([]);
  const [reading, setReading] = useState(null);
  const [recorded, setRecorded] = useState({});
  const [recording, setRecording] = useState(null);
  const [confirmClose, setConfirmClose] = useState(false);
  // Which money the table lists: everything, what came in, what went out, or only what is left to record.
  const [view, setView] = useState("All");
  // A statement can run to hundreds of rows; the table draws them a page at a time.
  const [shown, setShown] = useState(PAGE_SIZE);

  async function readFiles() {
    const queue = [...files];
    const failedFiles = [];
    const errors = {};
    for (let index = 0; index < queue.length; index += 1) {
      const file = queue[index];
      setReading({ current: index + 1, total: queue.length, name: file.name });
      let result;
      try {
        const answer = await extractStatement({ fileName: file.name, data: file.data, password: passwords[fileKey(file)] || "" });
        result = answer?.data;
      } catch (requestError) {
        result = { fileName: file.name, status: "failed", message: errorMessage(requestError, "Unable to read this PDF."), transactions: [] };
      }
      if (result.status === "failed") {
        failedFiles.push(file);
        errors[fileKey(file)] = result.message;
      }
      // A file read again replaces what it said last time, by name for one that never opened.
      setResults((current) => [
        ...current.filter((item) => (result.fileHash && item.fileHash ? item.fileHash !== result.fileHash : item.fileName !== result.fileName)),
        result,
      ]);
    }
    setFiles(failedFiles);
    setFileErrors(errors);
    setReading(null);
  }

  /*
   * The table's rows, worked out from every file read so far. A payment met twice in the batch -
   * the same transaction ID, date, amount and details, as two overlapping statements of one account show - is
   * a duplicate the second time, as much as one the cash book already holds.
   */
  const rows = useMemo(() => {
    const seen = new Map();
    const list = [];
    for (const file of results) {
      if (file.status !== "read") {
        list.push({ key: `file-${file.fileHash || file.fileName}`, status: file.status === "empty" ? "No transactions" : "Failed", fileName: file.fileName, note: file.message });
        continue;
      }
      for (const transaction of file.transactions) {
        // The same transaction ID, date, amount and details - all four - and the same direction, or it
        // is a different payment.
        const reference = transaction.transactionId
          ? [transaction.entryType, String(transaction.transactionId).toUpperCase(), transaction.date, Number(transaction.amount).toFixed(2), String(transaction.description || "").replace(/\s+/g, " ").trim().toUpperCase()].join("|")
          : "";
        const earlier = reference ? seen.get(reference) : null;
        if (reference && !earlier) seen.set(reference, file.fileName);
        let status = "New";
        let note = "";
        if (recorded[transaction.key]) { status = "Recorded"; note = `Recorded as ${recorded[transaction.key]}.`; }
        // `duplicateOf` is only named for an entry this person may see; one elsewhere is still a duplicate.
        else if (transaction.duplicate) { status = "Duplicate"; note = transaction.duplicateOf ? `Already recorded as ${transaction.duplicateOf}.` : "Already recorded in the cash book."; }
        else if (earlier) { status = "Duplicate"; note = `Also in ${earlier}.`; }
        list.push({ ...transaction, status, note, fileName: file.fileName });
      }
    }
    return list;
  }, [recorded, results]);

  const counts = useMemo(() => rows.reduce((total, row) => ({ ...total, [row.status]: (total[row.status] || 0) + 1 }), {}), [rows]);
  /*
   * The status bar: money in and money out, each as what was found, what it comes to, and how far
   * recording has got through it. It moves as each row is recorded, so "to record" reaching nothing
   * is the import being done.
   */
  const tally = useMemo(() => Object.fromEntries(["Received", "Spent"].map((entryType) => {
    const own = rows.filter((row) => row.entryType === entryType);
    const of = (status) => own.filter((row) => row.status === status).length;
    return [entryType, {
      found: own.length,
      total: own.reduce((sum, row) => sum + Number(row.amount || 0), 0),
      // What is still to be booked - the duplicates and what is already recorded are not.
      pendingTotal: own.filter((row) => row.status === "New").reduce((sum, row) => sum + Number(row.amount || 0), 0),
      recorded: of("Recorded"),
      duplicate: of("Duplicate"),
      pending: of("New"),
    }];
  })), [rows]);
  // A file that gave nothing is a row of its own, listed under every view so its reason is never hidden.
  const viewRows = useMemo(() => {
    if (view === "To record") return rows.filter((row) => row.status === "New");
    return view === "All" ? rows : rows.filter((row) => !row.entryType || row.entryType === view);
  }, [rows, view]);
  const shownRows = viewRows.slice(0, shown);
  const readBefore = results.filter((file) => file.previousUpload);
  // Statements whose printed Total Credits or Total Debits the payments found do not add up to.
  const mismatched = results.flatMap((file) => [
    ...(file.check && !file.check.matches ? [{ file, check: file.check, what: "credits" }] : []),
    ...(file.debitCheck && !file.debitCheck.matches ? [{ file, check: file.debitCheck, what: "debits" }] : []),
  ]);
  const matched = results.filter((file) => file.check?.matches || file.debitCheck?.matches).length;
  const pending = counts.New || 0;

  function close() {
    if (reading) return;
    if (pending || files.length) { setConfirmClose(true); return; }
    onClose();
  }

  async function record(payload) {
    // Recorded through the ordinary form, and marked as having come from a PDF in the Source column.
    const saved = await createCashEntry({ ...payload, source: "PDF Import" });
    const entryId = saved?.data?.entryId || "";
    setRecorded((current) => ({ ...current, [recording.key]: entryId || "an entry" }));
    setRecording(null);
    onRecorded?.(saved, entryId);
  }

  // Record sits beside the status rather than at the far end, so on a phone it is in view without
  // scrolling the table sideways.
  const columns = [
    { key: "status", label: "Status", render: (row) => <ProgressChip color={STATUS_COLORS[row.status]}>{row.status}</ProgressChip> },
    {
      key: "action",
      label: "Action",
      srOnly: true,
      render: (row) => (row.status === "New"
        ? <Button type="button" aria-label={`Record ${row.entryType === "Spent" ? "spent" : "received"} ${formatAmount(row.amount)} of ${formatDate(row.date)}`} onClick={() => setRecording(row)}>Record</Button>
        : null),
    },
    { key: "entryType", label: "Type", render: (row) => row.entryType || "" },
    { key: "fileName", label: "File", cellClassName: "max-w-[10rem] truncate" },
    { key: "date", label: "Date", render: (row) => (row.key.startsWith("file-") ? "" : formatDate(row.date)), cellClassName: "whitespace-nowrap" },
    { key: "amount", label: "Amount", render: (row) => (row.amount ? formatAmount(row.amount) : ""), cellClassName: "whitespace-nowrap text-right", headerClassName: "text-right" },
    { key: "paymentMode", label: "Mode" },
    { key: "transactionId", label: "Transaction ID / UTR", cellClassName: "whitespace-nowrap" },
    {
      key: "description",
      label: "Details",
      cellClassName: "min-w-[14rem]",
      render: (row) => <>
        {row.description && <span className="block">{row.description}</span>}
        {row.note && <span className="block text-slate-500">{row.note}</span>}
      </>,
    },
  ];

  // The tiles carry the money; this line only says what came of files that gave none.
  const summary = ["No transactions", "Failed"]
    .filter((status) => counts[status])
    .map((status) => `${counts[status]} ${status.toLowerCase()}`)
    .join(" · ");

  return <>
    <Dialog
      title="Import from PDF"
      description="Bank statements and payment receipts. Money received and spent is checked against the cash book, then recorded by you - received against its project, spent against its shoot."
      size="full"
      height="tall"
      busy={Boolean(reading)}
      onClose={close}
      footer={<Button className="max-sm:flex-1" type="button" onClick={close} disabled={Boolean(reading)}>Done</Button>}
    >
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-3">
          {/* `compressImages` is only what makes the field say which files were too large, rather
              than dropping them silently; a PDF is read as it is. */}
          <FileUploadField
            label="PDF files"
            helperText="Bank statements or receipts as PDFs, up to 10 at a time."
            accept=".pdf,application/pdf"
            value={files}
            // The same file picked twice is kept once - it would only be read, and flagged, twice.
            onChange={(next) => setFiles(next.filter((file, index) => (/\.pdf$/i.test(file.name) || /^data:application\/pdf/.test(file.data))
              && next.findIndex((other) => fileKey(other) === fileKey(file)) === index))}
            maxFiles={10}
            compressImages
            disabled={Boolean(reading)}
          />
          {files.length > 0 && <div className="grid gap-3 md:grid-cols-2">
            {files.map((file) => <TextField
              key={fileKey(file)}
              label={`Password for ${file.name}`}
              helperText="The PDF's own password, used only to open it for reading."
              type="password"
              autoComplete="new-password"
              placeholder="Leave empty if it has none"
              value={passwords[fileKey(file)] || ""}
              onChange={(event) => setPasswords((current) => ({ ...current, [fileKey(file)]: event.target.value }))}
              error={fileErrors[fileKey(file)] || ""}
              disabled={Boolean(reading)}
            />)}
          </div>}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="primary" onClick={() => void readFiles()} disabled={!files.length || Boolean(reading)}>
              {reading ? `Reading ${reading.current} of ${reading.total}...` : `Read ${files.length > 1 ? `${files.length} files` : "file"}`}
            </Button>
            {reading && <span className="min-w-0 truncate text-xs text-slate-500 sm:text-sm">{reading.name}</span>}
          </div>
        </section>

        {readBefore.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 sm:text-sm">
          {readBefore.map((file) => <p key={file.fileHash}>
            {file.fileName} was uploaded before{file.previousUpload.fileName !== file.fileName ? ` as ${file.previousUpload.fileName}` : ""}, on {formatDate(file.previousUpload.uploadedAt)}{file.previousUpload.uploadedByName ? ` by ${file.previousUpload.uploadedByName}` : ""}. Payments already recorded from it are marked Duplicate.
          </p>)}
        </div>}

        {mismatched.length > 0 && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 sm:text-sm">
          {mismatched.map(({ file, check, what }) => <p key={`${file.fileHash}-${what}`}>
            {file.fileName} says its total money {what === "credits" ? "received" : "spent"} is {formatAmount(check.stated)}, but what was found adds up to {formatAmount(check.found)}. Some rows may be missing or misread - check them against the PDF before recording.
          </p>)}
        </div>}

        {/* Announced as it changes, so recording a row is heard as well as seen. */}
        {rows.length > 0 && <section aria-label="Import status" aria-live="polite" className="grid gap-3 sm:grid-cols-2">
          {[["Received", "Cash Received", "text-emerald-700"], ["Spent", "Cash Spent", undefined]].map(([entryType, label, tone]) => {
            const figures = tally[entryType];
            return <StatTile key={entryType} label={label} value={formatAmount(figures.total)} tone={tone}>
              <span className="block">{figures.found} found · {figures.recorded} recorded · {figures.duplicate} duplicate</span>
              <span className="block font-semibold text-slate-900">{figures.pending} to record · {formatAmount(figures.pendingTotal)}</span>
            </StatTile>;
          })}
        </section>}

        {rows.length > 0 && <section className="flex min-w-0 flex-col gap-2">
          <Tabs
            ariaLabel="Show transactions"
            tabs={[
              { id: "All", label: "All", count: tally.Received.found + tally.Spent.found },
              { id: "Received", label: "Received", count: tally.Received.found },
              { id: "Spent", label: "Spent", count: tally.Spent.found },
              { id: "To record", label: "To record", count: counts.New || 0 },
            ]}
            value={view}
            onChange={(next) => { setView(next); setShown(PAGE_SIZE); }}
          />
          {(summary || matched > 0) && <p className="text-xs text-slate-600 sm:text-sm">
            {[summary, matched > 0 ? (matched === 1 ? "Matches the statement's own totals" : "Match the statements' own totals") : ""].filter(Boolean).join(" · ")}
          </p>}
          <SimpleTable
            ariaLabel="Transactions found"
            columns={columns}
            rows={shownRows}
            rowKey={(row) => row.key}
            emptyMessage={view === "To record" ? "Nothing left to record." : view === "Spent" ? "No money spent was found in these files." : "No money received was found in these files."}
          />
          {viewRows.length > shownRows.length && <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={() => setShown((current) => current + PAGE_SIZE)}>Show {Math.min(PAGE_SIZE, viewRows.length - shownRows.length)} more</Button>
            <span className="text-xs text-slate-500 sm:text-sm">Showing {shownRows.length} of {viewRows.length}</span>
          </div>}
        </section>}
      </div>
    </Dialog>

    {/* The same form Add Entry offers, with the kind still to be chosen: the statement's credit or
        debit pre-selects Cash Received or Cash Spent, and the person recording it marks it as
        received, spent or a branch transfer. */}
    {recording && <CashEntryFormPanel
      preset={{
        entryType: recording.entryType || "Received",
        entryTypeOpen: true,
        values: {
          amount: recording.amount || "",
          entryDate: recording.date || "",
          paymentMode: recording.paymentMode || "",
          paymentModeOther: recording.paymentModeOther || "",
          transactionId: recording.transactionId || "",
          description: recording.description || "",
        },
      }}
      options={options}
      submitLabel="Record Payment"
      onRecord={record}
      onClose={() => setRecording(null)}
      onSaved={() => {}}
    />}

    <ConfirmDialog
      open={confirmClose}
      title="Close the import?"
      message={[
        pending ? `${pending} ${pending === 1 ? "payment has" : "payments have"} not been recorded yet.` : "",
        files.length ? `${files.length} ${files.length === 1 ? "file is" : "files are"} still waiting to be read.` : "",
        "Closing loses this list; the PDFs can be uploaded again later.",
      ].filter(Boolean).join(" ")}
      confirmLabel="Close Import"
      cancelLabel="Keep Recording"
      tone="danger"
      layer="dialogOverPanel"
      onCancel={() => setConfirmClose(false)}
      onConfirm={() => { setConfirmClose(false); onClose(); }}
    />
  </>;
}
