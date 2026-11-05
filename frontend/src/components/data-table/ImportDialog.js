"use client";

import SimpleTable from "./SimpleTable";
import { useState } from "react";
import Button from "@/components/shared/Button";
import Checkbox from "@/components/shared/Checkbox";
import Dialog from "@/components/ui/Dialog";
import {
  importChunks,
  importSummaryText,
  inspectImportFile,
  mergeImportResults,
  parseCsv,
  templateCsv,
} from "@/lib/tableImport";

/**
 * Importing a spreadsheet into a module's table.
 *
 * One dialog for every table that offers Import, because the shape of the job is the same wherever
 * it is done: get the template, fill it in, hand it back, and be told what happened to each row. A
 * module supplies three things and nothing else - its columns, where to post, and what to do once
 * the rows have landed.
 *
 * ── What it insists on ──
 *
 * The file is read and judged *before* anything is sent. A file missing a required column is said
 * so here, by name, rather than by the server after a wait - and the template is one press away in
 * the same sentence, because that is always the answer.
 *
 * ── What it does not do ──
 *
 * It does not decide whether a row is valid. Each module already says so in its own schema, and the
 * server answers per row; this shows those answers with the row numbers they belong to. A file of
 * two hundred with three bad rows imports the other hundred and ninety-seven.
 */
export default function ImportDialog({
  onClose,
  title,
  columns = [],
  templateName = "import-template",
  // How each cell is to be written - a date's format, a yes/no's spelling - for a table whose cells
  // the template's headings alone do not explain.
  hints = [],
  /*
   * An import that can delete what already exists and bring the file's version in its place - Pre
   * Production's "Replace projects that already exist". `{ label, description }`; left out, there is
   * no such choice. Ticked, Import first runs a preview that changes nothing and lists what would be
   * deleted, and only "Delete and import" does it.
   */
  replaceOption = null,
  /*
   * An import that can bring back what was deleted in the app when a row names it again - Pre
   * Production's "Restore deleted projects and shoots". `{ label, description }`, like the one above.
   * Nothing is deleted by it, so it asks for no preview of its own.
   */
  restoreOption = null,
  /*
   * An import that keeps a row the file got wrong, with the cells it could not read left empty -
   * "Import rows with errors". `{ label, description }`, like the two above. A cell the table cannot
   * do without still refuses its row, and the summary says which columns were emptied, per row.
   */
  lenientOption = null,
  onImportChunk,
  onImported,
}) {
  // Rendered by the caller only while it is open, the way every other Dialog in the application is.
  // That is what resets it: a reopened dialog is a fresh mount, so the last file, its verdict and
  // its summary go with the run that is over rather than greeting the next one.
  const [inspection, setInspection] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [replace, setReplace] = useState(false);
  const [restore, setRestore] = useState(false);
  const [lenient, setLenient] = useState(false);
  // What an import with Replace would do, shown before anything is deleted.
  const [preview, setPreview] = useState(null);

  function downloadTemplate() {
    const blob = new Blob([templateCsv(columns)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${templateName}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function chooseFile(event) {
    const chosen = event.target.files?.[0] || null;
    setResult(null); setError(""); setInspection(null); setPreview(null);
    if (!chosen) return;
    try {
      setInspection(inspectImportFile(columns, parseCsv(await chosen.text())));
    } catch (readError) {
      setInspection({ ok: false, reason: readError.message || "This file could not be read as a CSV." });
    }
  }

  async function startImport() {
    if (!inspection?.ok || busy) return;
    // Replace ticked and not yet previewed: the first press only asks what would happen.
    const previewing = replace && !preview;
    setBusy(true); setError(""); setResult(null);

    const chunks = importChunks(inspection.rows);
    let running;
    try {
      for (const [index, chunk] of chunks.entries()) {
        // Said before the request rather than after, so a slow batch shows as the batch it is
        // working on rather than as the one it has finished.
        setProgress({ done: index, total: chunks.length, rows: inspection.rows.length });
        const options = { ...(replace ? { replace: true, preview: previewing } : {}), ...(restore ? { restore: true } : {}), ...(lenient ? { lenient: true } : {}) };
        const answer = await onImportChunk({ headers: inspection.headers, rows: chunk.rows, startRow: chunk.startRow }, Object.keys(options).length ? options : undefined);
        running = mergeImportResults(running, answer);
      }
      if (previewing) {
        setPreview(running);
        return;
      }
      setResult(running);
      // Only once, and only at the end: the table is reloaded when the file is done rather than per
      // batch, or a four-batch import redraws the page four times under the reader.
      await onImported?.(running);
    } catch (importError) {
      setError(importError?.message || "The import stopped part way through.");
      // What did land, so a failure half way is not reported as nothing having happened.
      if (running) setResult(running);
    } finally {
      setBusy(false); setProgress(null);
    }
  }

  const rowCount = inspection?.rows?.length || 0;
  const replacing = preview?.replaced?.length || 0;
  const importLabel = busy ? (replace && !preview ? "Checking…" : "Importing…") : preview ? (replacing ? `Delete ${replacing} and import` : "Import") : replace ? "Preview" : "Import";

  return <Dialog
    title={title || "Import"}
    description="One row per record. The table is left untouched until you press Import."
    onClose={onClose}
    busy={busy}
    size="md"
    footer={<>
      <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>{result ? "Close" : "Cancel"}</Button>
      {preview && !result && <Button type="button" variant="secondary" onClick={() => setPreview(null)} disabled={busy}>Back</Button>}
      {!result && <Button type="button" variant={preview && replacing ? "danger" : "primary"} onClick={startImport} disabled={!inspection?.ok || busy}>
        {importLabel}
      </Button>}
    </>}
  >
    <div className="space-y-4 text-sm">
      <p className="text-slate-600">
        Download the template, fill in one row per record, and upload it here. Columns may be in any
        order; columns this table does not have are ignored.
      </p>

      {hints.length > 0 && <ul className="list-disc space-y-1 pl-5 text-[13px] text-slate-600">
        {hints.map((hint) => <li key={hint}>{hint}</li>)}
      </ul>}

      <Button type="button" variant="secondary" size="sm" onClick={downloadTemplate}>Download CSV Template</Button>

      <label className="block">
        <span className="mb-1 block text-[13px] font-semibold text-slate-600">CSV file</span>
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={chooseFile}
          className="block w-full cursor-pointer rounded-lg border border-slate-200 p-2 text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700"
        />
      </label>

      {replaceOption && !result && <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
        <Checkbox
          className="mt-0.5 shrink-0"
          ariaLabel={replaceOption.label}
          checked={replace}
          disabled={busy}
          onChange={(checked) => { setReplace(checked); setPreview(null); }}
        />
        <span className="min-w-0">
          <span className="block font-medium text-amber-900">{replaceOption.label}</span>
          {replaceOption.description && <span className="mt-0.5 block text-[13px] text-amber-800">{replaceOption.description}</span>}
        </span>
      </label>}

      {restoreOption && !result && <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <Checkbox
          className="mt-0.5 shrink-0"
          ariaLabel={restoreOption.label}
          checked={restore}
          disabled={busy}
          onChange={(checked) => { setRestore(checked); setPreview(null); }}
        />
        <span className="min-w-0">
          <span className="block font-medium text-slate-800">{restoreOption.label}</span>
          {restoreOption.description && <span className="mt-0.5 block text-[13px] text-slate-600">{restoreOption.description}</span>}
        </span>
      </label>}

      {lenientOption && !result && <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <Checkbox
          className="mt-0.5 shrink-0"
          ariaLabel={lenientOption.label}
          checked={lenient}
          disabled={busy}
          onChange={(checked) => { setLenient(checked); setPreview(null); }}
        />
        <span className="min-w-0">
          <span className="block font-medium text-slate-800">{lenientOption.label}</span>
          {lenientOption.description && <span className="mt-0.5 block text-[13px] text-slate-600">{lenientOption.description}</span>}
        </span>
      </label>}

      {/* What this file is, before a row of it is sent. */}
      {inspection && !inspection.ok && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{inspection.reason}</p>}
      {inspection?.ok && !result && !preview && <div className="rounded-lg bg-slate-50 px-3 py-2 text-slate-700">
        <p>{rowCount.toLocaleString()} {rowCount === 1 ? "row" : "rows"} ready to import.</p>
        {inspection.unknown?.length > 0 && <p className="mt-1 text-[13px] text-slate-500">
          Ignored {inspection.unknown.length === 1 ? "column" : "columns"}: {inspection.unknown.join(", ")}.
        </p>}
      </div>}

      {progress && <p className="text-slate-600">
        {replace && !preview ? "Checking" : "Importing"}… batch {progress.done + 1} of {progress.total}.
      </p>}

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}

      {/* Nothing has changed yet: what pressing on would delete, and which rows would not come in. */}
      {preview && !result && <div className="space-y-2">
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
          <span className="font-medium">Preview - nothing has been changed yet.</span>{" "}
          {preview.imported.toLocaleString()} {preview.imported === 1 ? "row" : "rows"} would import
          {replacing ? `, and ${replacing} existing ${replacing === 1 ? "project" : "projects"} with the same client name would be deleted with all ${replacing === 1 ? "its" : "their"} shoots and replaced by the file's` : ""}.
          {preview.restored?.length > 0 && ` ${restoredText(preview.restored)} would be restored.`}
          {preview.linked?.length > 0 && ` ${linkedText(preview.linked, true)}`}
          {preview.skipped > 0 && ` ${preview.skipped.toLocaleString()} would be skipped.`}
          <span className="mt-1 block text-[13px] text-amber-800">Each row is checked on its own, so the final count can differ slightly.</span>
        </p>
        {replacing > 0 && <ReplacedTable replaced={preview.replaced} />}
        {preview.errors?.length > 0 && <SkippedTable errors={preview.errors} />}
      </div>}

      {result && <div className="space-y-2">
        <p className="rounded-lg bg-emerald-50 px-3 py-2 font-medium text-emerald-800">
          {importSummaryText(result)}{result.replaced?.length ? ` ${result.replaced.length} existing ${result.replaced.length === 1 ? "project was" : "projects were"} replaced.` : ""}{result.restored?.length ? ` ${restoredText(result.restored)} restored.` : ""}{result.linked?.length ? ` ${linkedText(result.linked, false)}` : ""}{result.emptied?.length ? ` ${emptiedText(result.emptied)}` : ""}
        </p>
        {result.replaced?.length > 0 && <ReplacedTable replaced={result.replaced} />}
        {result.emptied?.length > 0 && <EmptiedTable emptied={result.emptied} />}
        {result.errors?.length > 0 && <SkippedTable errors={result.errors} />}
      </div>}
    </div>
  </Dialog>;
}

/** "2 deleted projects and 86 deleted shoots", for what Restore brought back. */
/*
 * Projects that were already in the app and were kept: given the sheet's IDs beside their own, with
 * the sheet's details added where they had none. Replace leaves one alone when it holds payments or
 * a gallery, or when this person may not delete it - said here, so nothing seems to have vanished.
 */
function linkedText(linked, previewing) {
  const n = linked.length;
  const kept = linked.filter((project) => project.reason).length;
  const what = `${n} ${n === 1 ? "project" : "projects"} already in the app ${previewing ? "would be" : n === 1 ? "was" : "were"} kept and given the sheet's IDs, with the sheet's details added where ${n === 1 ? "it had" : "they had"} none.`;
  if (!kept) return what;
  const who = kept === n ? (n === 1 ? "It" : "They") : `${kept} of them`;
  return `${what} ${who} ${previewing ? "would not be" : kept === 1 && kept === n ? "was not" : "were not"} replaced - payments, a gallery, or your delete rights.`;
}

/*
 * Rows that came in with a cell the file got wrong left empty ("Import rows with errors"). Said in the
 * summary and listed per row, so a studio knows exactly what to go back and fill in on the board.
 */
function emptiedText(emptied) {
  const n = emptied.length;
  return `${n} ${n === 1 ? "row" : "rows"} came in with ${n === 1 ? "a cell" : "cells"} left empty.`;
}

function restoredText(restored) {
  const count = (kind) => restored.filter((item) => item.kind === kind).length;
  const part = (n, word) => (n ? `${n} deleted ${word}${n === 1 ? "" : "s"}` : "");
  return [part(count("Project"), "project"), part(count("Shoot"), "shoot")].filter(Boolean).join(" and ");
}

/** Which columns of which rows came in empty, so they can be filled in on the board. */
function EmptiedTable({ emptied }) {
  return <SimpleTable
    variant="form"
    classNames={TABLE_CLASSES}
    columns={[
      { key: "row", label: "Row", cellClassName: "whitespace-nowrap text-slate-700", render: (entry) => entry.row },
      { key: "columns", label: "Came in empty", cellClassName: "text-slate-700", render: (entry) => entry.columns.join(", ") },
    ]}
    rows={emptied}
    rowKey={(entry) => String(entry.row)}
  />;
}

const TABLE_CLASSES = { wrapper: "max-h-48 !overflow-auto", table: "text-[13px]", head: "!text-[13px] !font-normal !tracking-normal", th: "!py-1.5 font-semibold", td: "!py-1.5" };

/** The rows that did not come in, named with the row number in the studio's own spreadsheet, so a refusal can be found and fixed rather than hunted for. */
function SkippedTable({ errors }) {
  return <SimpleTable
    variant="form"
    classNames={TABLE_CLASSES}
    columns={[
      { key: "row", label: "Row", cellClassName: "text-slate-500", render: (entry) => entry.row },
      { key: "message", label: "Why it was skipped", cellClassName: "text-slate-700", render: (entry) => entry.message },
    ]}
    rows={errors}
    rowKey={(entry) => `${entry.row}-${entry.message}`}
  />;
}

/** The projects already in the app that an import with Replace deletes, beside the file's booking that takes their place. */
function ReplacedTable({ replaced }) {
  return <SimpleTable
    variant="form"
    classNames={TABLE_CLASSES}
    columns={[
      { key: "eventId", label: "Deleted project", cellClassName: "whitespace-nowrap text-slate-700", render: (entry) => entry.eventId },
      { key: "clientName", label: "Client name", cellClassName: "text-slate-700", render: (entry) => entry.clientName },
      { key: "sheetEventId", label: "Replaced by", cellClassName: "whitespace-nowrap text-slate-500", render: (entry) => `${entry.sheetEventId} (row ${entry.row})` },
    ]}
    rows={replaced}
    rowKey={(entry) => entry.eventId}
  />;
}
