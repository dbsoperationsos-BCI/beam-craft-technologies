"use client";

import SimpleTable from "./SimpleTable";
import { useState } from "react";
import Button from "@/components/shared/Button";
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
    setResult(null); setError(""); setInspection(null);
    if (!chosen) return;
    try {
      setInspection(inspectImportFile(columns, parseCsv(await chosen.text())));
    } catch (readError) {
      setInspection({ ok: false, reason: readError.message || "This file could not be read as a CSV." });
    }
  }

  async function startImport() {
    if (!inspection?.ok || busy) return;
    setBusy(true); setError(""); setResult(null);

    const chunks = importChunks(inspection.rows);
    let running;
    try {
      for (const [index, chunk] of chunks.entries()) {
        // Said before the request rather than after, so a slow batch shows as the batch it is
        // working on rather than as the one it has finished.
        setProgress({ done: index, total: chunks.length, rows: inspection.rows.length });
        const answer = await onImportChunk({ headers: inspection.headers, rows: chunk.rows, startRow: chunk.startRow });
        running = mergeImportResults(running, answer);
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

  return <Dialog
    title={title || "Import"}
    description="One row per record. The table is left untouched until you press Import."
    onClose={onClose}
    busy={busy}
    size="md"
    footer={<>
      <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>{result ? "Close" : "Cancel"}</Button>
      {!result && <Button type="button" variant="primary" onClick={startImport} disabled={!inspection?.ok || busy}>
        {busy ? "Importing…" : "Import"}
      </Button>}
    </>}
  >
    <div className="space-y-4 text-sm">
      <p className="text-slate-600">
        Download the template, fill in one row per record, and upload it here. Columns may be in any
        order; columns this table does not have are ignored.
      </p>

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

      {/* What this file is, before a row of it is sent. */}
      {inspection && !inspection.ok && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{inspection.reason}</p>}
      {inspection?.ok && !result && <div className="rounded-lg bg-slate-50 px-3 py-2 text-slate-700">
        <p>{rowCount.toLocaleString()} {rowCount === 1 ? "row" : "rows"} ready to import.</p>
        {inspection.unknown?.length > 0 && <p className="mt-1 text-[13px] text-slate-500">
          Ignored {inspection.unknown.length === 1 ? "column" : "columns"}: {inspection.unknown.join(", ")}.
        </p>}
      </div>}

      {progress && <p className="text-slate-600">
        Importing… batch {progress.done + 1} of {progress.total}.
      </p>}

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}

      {result && <div className="space-y-2">
        <p className="rounded-lg bg-emerald-50 px-3 py-2 font-medium text-emerald-800">{importSummaryText(result)}</p>
        {/* Named with the row number in the studio's own spreadsheet, so a refusal can be found and
            fixed rather than hunted for. */}
        {result.errors?.length > 0 && <SimpleTable
          variant="form"
          classNames={{ wrapper: "max-h-48 !overflow-auto", table: "text-[13px]", head: "!text-[13px] !font-normal !tracking-normal", th: "!py-1.5 font-semibold", td: "!py-1.5" }}
          columns={[
            { key: "row", label: "Row", cellClassName: "text-slate-500", render: (entry) => entry.row },
            { key: "message", label: "Why it was skipped", cellClassName: "text-slate-700", render: (entry) => entry.message },
          ]}
          rows={result.errors}
          rowKey={(entry) => `${entry.row}-${entry.message}`}
        />}
      </div>}
    </div>
  </Dialog>;
}
