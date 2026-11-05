"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DataTable from "@/components/data-table/DataTable";
import DataTableShell from "@/components/data-table/DataTableShell";
import Button from "@/components/shared/Button";
import Checkbox from "@/components/shared/Checkbox";
import PhoneField from "@/components/shared/PhoneField";
import TextField from "@/components/shared/TextField";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dialog from "@/components/ui/Dialog";
import OptionsMenu from "@/components/ui/OptionsMenu";
import {
  getExcludedNumbers, addExcludedNumber, updateExcludedNumber,
  removeExcludedNumber, removeExcludedNumbers, importExcludedNumbers,
} from "@/services/sales/excluded-numbers.service";
import { isUsableNumber, parseExcludedNumbersCsv, usableCount, csvTemplateBlob } from "@/lib/excludedNumbers";

/**
 * Settings -> Exclude Phone Numbers.
 *
 * The numbers the CRM must never make a lead out of. The Callyzer webhook reads the list on every
 * delivery and sets those calls aside before a lead is built, so a number added here stops producing
 * enquiries as soon as the save returns. The call itself is still recorded; what it no longer does
 * is create somebody to ring back.
 *
 * Built from the module's own parts - `DataTable` inside `DataTableShell` with its per-column
 * search and sorting, the select-all tick box in the column head that the CRM's lead table uses, an
 * `OptionsMenu` on each row, and `PhoneField` for the number, so a number here is entered the same
 * way as every other number in the application.
 *
 * One structural rule this screen has to obey: it renders inside `SchemaFormPanel`, which is itself
 * a `<form>`. A nested `<form>` is invalid HTML and would submit the panel, so nothing here is a
 * form - Add is a button, and Enter is handled by hand where it would be expected to work.
 */

// The settings panel portals to `z-[140]`, and `OptionsMenu` portals to the body beside it rather
// than inside it - so its own z-index has to clear that number rather than the layer constants,
// which stop below it. The dialogs do not portal, so `dialogOverPanel` is enough for them.
const MENU_Z_INDEX = 145;

/**
 * Add or edit one number.
 *
 * Two fields, stacked, in the application's small dialog. It was the wide form dialog with the
 * fields side by side - the size a lead form wants, and far too much room for a name and a number.
 *
 * The number is a `PhoneField`, so it behaves the way every other number in the application does:
 * the country is chosen from the list rather than typed, and the national part is ten digits.
 */
function NumberDialog({ entry = null, saving = false, error = "", onClose, onSubmit }) {
  const isEdit = Boolean(entry?.id);
  const [initial] = useState(() => ({ name: entry?.name || "", number: entry?.number || "" }));
  const [form, setForm] = useState(initial);

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));
  // The same rule the rest of the app's dialogs follow: Add needs a number, Update needs a change.
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const ready = isUsableNumber(form.number) && !saving && (!isEdit || dirty);
  const submit = () => onSubmit({ name: form.name.trim(), number: form.number.trim() });

  return <Dialog
    title={isEdit ? "Edit Excluded Number" : "Add Excluded Number"}
    description="Calls to and from this number will not create leads."
    size="sm"
    layer="dialogOverPanel"
    busy={saving}
    onClose={onClose}
    footer={<>
      <Button className="max-sm:flex-1" type="button" disabled={saving} onClick={onClose}>Cancel</Button>
      <Button className="max-sm:flex-1" type="button" variant="primary" disabled={!ready} onClick={submit}>
        {saving ? (isEdit ? "Saving..." : "Adding...") : (isEdit ? "Update" : "Add Number")}
      </Button>
    </>}
  >
    {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    <div className="space-y-4">
      <TextField
        label="Contact Name"
        value={form.name}
        onChange={(event) => set({ name: event.target.value })}
        // Enter is what anyone types at the end of a short form, and there is no form to submit it.
        onKeyDown={(event) => { if (event.key === "Enter" && ready) { event.preventDefault(); submit(); } }}
        placeholder="Whose number this is"
        disabled={saving}
      />
      <PhoneField
        label="Contact Number"
        field="number"
        required
        value={form.number}
        onChange={(_field, value) => set({ number: value })}
        disabled={saving}
      />
    </div>
  </Dialog>;
}

/**
 * A CSV of numbers, uploaded.
 *
 * A file rather than a box to paste into, because the list people already have is a spreadsheet or
 * a Callyzer export. The template says exactly which two columns it needs, and the file is read here
 * so the dialog can say how many numbers it holds before anything is sent.
 */
function ImportDialog({ saving = false, error = "", result = null, onClose, onSubmit }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [entries, setEntries] = useState([]);
  const [readError, setReadError] = useState("");

  const usable = usableCount(entries);

  async function readFile(chosen) {
    setFile(chosen);
    setEntries([]);
    setReadError("");
    if (!chosen) return;
    try {
      setEntries(parseExcludedNumbersCsv(await chosen.text()));
    } catch (parseError) {
      // A CSV that will not parse is named as such rather than reported as an empty file, which is
      // what an unterminated quote would otherwise look like.
      setReadError(parseError?.message || "That file could not be read as a CSV.");
    }
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(csvTemplateBlob());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "exclude-numbers-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return <Dialog
    title="Import Numbers"
    description="Upload a CSV of the numbers to exclude."
    size="md"
    layer="dialogOverPanel"
    busy={saving}
    onClose={onClose}
    footer={<>
      <Button className="max-sm:flex-1" type="button" disabled={saving} onClick={onClose}>{result ? "Close" : "Cancel"}</Button>
      <Button className="max-sm:flex-1" type="button" variant="primary" disabled={saving || !usable} onClick={() => onSubmit(entries)}>
        {saving ? "Importing..." : usable ? `Import ${usable.toLocaleString()} Number${usable === 1 ? "" : "s"}` : "Import"}
      </Button>
    </>}
  >
    {(error || readError) && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error || readError}</p>}

    {/* Hidden, driven by the button beside it: a bare file input cannot be styled and would be the
        one control on this screen that is not the application's own. */}
    <input
      ref={inputRef}
      type="file"
      accept=".csv,text/csv"
      className="sr-only"
      onChange={(event) => { void readFile(event.target.files?.[0] || null); event.target.value = ""; }}
    />

    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm text-slate-600">Supports a CSV with comma separated values</span>
        <Button type="button" variant="primary" size="sm" disabled={saving} onClick={() => inputRef.current?.click()}>Upload CSV</Button>
        <button
          type="button"
          onClick={downloadTemplate}
          className="text-sm font-medium text-blue-700 underline underline-offset-2 hover:text-blue-800"
        >
          Download CSV Template
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Two columns, <span className="font-medium text-slate-600">Name</span> and <span className="font-medium text-slate-600">Number</span>. The number is the one that matters — a row without one is not imported.
      </p>
    </div>

    {file && !readError && <p className="mt-3 text-sm text-slate-600">
      <span className="font-medium text-slate-800">{file.name}</span>
      {" — "}
      {entries.length
        ? `${usable.toLocaleString()} of ${entries.length.toLocaleString()} row${entries.length === 1 ? "" : "s"} carry a number.`
        : "no rows found."}
    </p>}

    {/* Reported row by row, because an import that added most of a file and refused one row should
        say which one rather than leaving somebody to compare two hundred rows by eye. */}
    {result?.failed?.length > 0 && <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
      <p className="text-xs font-semibold text-amber-800">{result.failed.length.toLocaleString()} row{result.failed.length === 1 ? "" : "s"} could not be read</p>
      <ul className="mt-1 space-y-0.5 text-xs text-amber-800">
        {result.failed.slice(0, 10).map((item) => <li key={`${item.line}-${item.number}`}>Row {item.line}: {item.number || "(blank)"} - {item.reason}</li>)}
        {result.failed.length > 10 && <li>and {(result.failed.length - 10).toLocaleString()} more.</li>}
      </ul>
    </div>}
  </Dialog>;
}

export default function ExcludedNumbersPanel({ canWrite = true, onNotice, onError }) {
  const [numbers, setNumbers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(() => new Set());
  const [editing, setEditing] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState("");

  const notify = useCallback((message) => onNotice?.(message), [onNotice]);
  const fail = useCallback((message) => onError?.(message), [onError]);
  /*
   * Put away before every action, so doing the same thing twice says so twice.
   *
   * The panel's notice line will not repeat a message that has just been dismissed - that is what
   * stops one failure reappearing on every render - so removing two numbers one after the other
   * would announce the first and stay silent for the second.
   */
  const clearNotices = useCallback(() => { onNotice?.(""); onError?.(""); }, [onError, onNotice]);

  /*
   * `loading` starts true and is only ever turned off, rather than being raised again here.
   *
   * A reload after a save is already covered by the dialog's own busy state - `saving` stays true
   * across the refetch - so blanking the table underneath it would be a second spinner for one
   * action, and the rows it replaces are about to be the same rows.
   */
  const load = useCallback(async () => {
    try {
      const response = await getExcludedNumbers();
      setNumbers(response?.data?.numbers || []);
      // A number that has just been removed must not stay ticked, or a second bulk delete would
      // send ids that no longer exist.
      setSelected(new Set());
    } catch (error) {
      fail(error?.message || "Unable to load the excluded phone numbers.");
    } finally {
      setLoading(false);
    }
  }, [fail]);

  useEffect(() => { void load(); }, [load]);

  const toggleOne = useCallback((id, checked) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const allSelected = numbers.length > 0 && selected.size === numbers.length;
  const someSelected = selected.size > 0 && !allSelected;

  const columns = useMemo(() => [
    {
      id: "select",
      /*
       * The select-all in the column head, which is where the CRM's own lead table keeps it: one
       * tick box that takes every row, showing the mixed state while only some are taken.
       */
      header: <Checkbox
        ariaLabel={allSelected ? "Clear the selection" : "Select every excluded number"}
        title={allSelected ? "Clear the selection" : "Select every excluded number"}
        checked={allSelected}
        indeterminate={someSelected}
        disabled={!canWrite || numbers.length === 0}
        onChange={(checked) => setSelected(checked ? new Set(numbers.map((row) => row.id)) : new Set())}
      />,
      // Not sortable and not filterable: a tick box is not a value, and a filter box under it would
      // be one people try to type in. Fixed for the same reason: a select-all belongs at the front
      // of the table, not somewhere a drag happens to leave it.
      sortable: false,
      filterable: false,
      fixed: true,
      width: 48,
      minWidth: 48,
      cell: ({ row }) => <Checkbox
        ariaLabel={`Select ${row.original.name || row.original.number}`}
        checked={selected.has(row.original.id)}
        disabled={!canWrite}
        onChange={(checked) => toggleOne(row.original.id, checked)}
      />,
      exportValue: () => "",
    },
    {
      id: "name",
      header: "Contact Name",
      accessorFn: (row) => row.name || "",
      cell: ({ row }) => row.original.name || <span className="text-slate-400">Not named</span>,
      width: 320,
      minWidth: 180,
    },
    {
      id: "number",
      header: "Contact Number",
      accessorFn: (row) => row.number || "",
      width: 240,
      minWidth: 160,
    },
    {
      id: "actions",
      header: "",
      sortable: false,
      filterable: false,
      width: 56,
      minWidth: 56,
      cell: ({ row }) => canWrite ? <OptionsMenu
        ariaLabel={`Actions for ${row.original.name || row.original.number}`}
        zIndex={MENU_Z_INDEX}
        items={[
          { label: "Edit", onSelect: () => { setDialogError(""); setEditing(row.original); } },
          { label: "Remove", tone: "danger", onSelect: () => setConfirming({ ids: [row.original.id], label: row.original.name || row.original.number }) },
        ]}
      /> : null,
      exportValue: () => "",
    },
  ], [allSelected, canWrite, numbers, selected, someSelected, toggleOne]);

  async function submitNumber(values) {
    setSaving(true);
    setDialogError("");
    clearNotices();
    try {
      if (editing?.id) await updateExcludedNumber(editing.id, values);
      else await addExcludedNumber(values);
      setEditing(null);
      notify(editing?.id ? "Excluded number updated." : "Number excluded.");
      await load();
    } catch (error) {
      // Reported inside the dialog rather than behind it: the person is looking at the field that
      // caused it, and "already excluded" is answered by changing the number, not by starting again.
      setDialogError(error?.message || "Unable to save that number.");
    } finally {
      setSaving(false);
    }
  }

  async function submitImport(entries) {
    setSaving(true);
    setDialogError("");
    setImportResult(null);
    clearNotices();
    try {
      const response = await importExcludedNumbers(entries);
      setImportResult(response?.data || null);
      notify(response?.message || "Numbers imported.");
      await load();
      // Closed only when every row was read; otherwise it stays open showing which were not.
      if (!response?.data?.failed?.length) setImporting(false);
    } catch (error) {
      setDialogError(error?.message || "Unable to import those numbers.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmRemoval() {
    const ids = confirming?.ids || [];
    setSaving(true);
    clearNotices();
    try {
      if (ids.length === 1) await removeExcludedNumber(ids[0]);
      else await removeExcludedNumbers(ids);
      setConfirming(null);
      notify(`${ids.length.toLocaleString()} number${ids.length === 1 ? "" : "s"} removed.`);
      await load();
    } catch (error) {
      fail(error?.message || "Unable to remove the selected numbers.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="flex min-h-0 flex-col gap-3">
    {/* One line, on the row the buttons are already on. It says the one thing somebody arriving
        here needs to know and nothing else - what the list does, not who to put on it. */}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-slate-600">Calls to and from these numbers are never turned into leads.</p>
      {canWrite && <div className="flex shrink-0 flex-wrap gap-2">
        <Button type="button" onClick={() => { setDialogError(""); setImportResult(null); setImporting(true); }}>Import Numbers</Button>
        <Button type="button" variant="primary" onClick={() => { setDialogError(""); setEditing({}); }}>Add Number</Button>
      </div>}
    </div>

    {/* Selecting rows is what the tick boxes are for, so the action they enable belongs beside them
        rather than inside a menu that has to be found. */}
    {selected.size > 0 && canWrite && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
      <span className="text-sm font-medium text-blue-900">{selected.size.toLocaleString()} selected</span>
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
        <Button type="button" size="sm" variant="danger" onClick={() => setConfirming({ ids: [...selected], label: `${selected.size.toLocaleString()} numbers` })}>Remove</Button>
      </div>
    </div>}

    <DataTableShell>
      <DataTable
        columns={columns}
        data={numbers}
        loading={loading}
        loadingMessage="Loading excluded numbers..."
        emptyMessage="No numbers are excluded yet."
        noMatchMessage="No excluded numbers match that search."
        getRowId={(row) => row.id}
        ariaLabel="Excluded phone numbers"
        /*
         * The cap goes on the table's own scrolling element, not on anything above it.
         *
         * This section's body is a padded div of no particular height, so `h-full` here would
         * resolve against `auto` and the table would grow the whole settings panel instead of
         * scrolling inside it - a percentage height needs a definite one to be a percentage of.
         */
        className="max-h-[28rem]"
        features={{ filtering: true, sorting: true, infiniteScroll: { pageSize: 50 } }}
      />
    </DataTableShell>

    {editing && <NumberDialog
      entry={editing.id ? editing : null}
      saving={saving}
      error={dialogError}
      onClose={() => { setEditing(null); setDialogError(""); }}
      onSubmit={submitNumber}
    />}

    {importing && <ImportDialog
      saving={saving}
      error={dialogError}
      result={importResult}
      onClose={() => { setImporting(false); setDialogError(""); setImportResult(null); }}
      onSubmit={submitImport}
    />}

    {confirming && <ConfirmDialog
      title="Remove from the exclude list?"
      message={`${confirming.label} will be removed. Calls to and from ${confirming.ids.length === 1 ? "that number" : "those numbers"} will create leads again.`}
      confirmLabel="Remove"
      busyLabel="Removing..."
      loading={saving}
      layer="dialogOverPanel"
      onCancel={() => setConfirming(null)}
      onConfirm={() => void confirmRemoval()}
    />}
  </div>;
}
