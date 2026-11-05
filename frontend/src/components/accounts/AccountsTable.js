"use client";

import { useMemo } from "react";
import DataTable from "@/components/data-table/DataTable";
import { CASH_ENTRY_IMPORT_COLUMNS } from "@/constants/importColumns";
import { buildTableColumns, defaultVisibilityFor } from "@/components/data-table/tableCells";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { accountsListFilters, accountsStatusStyles, accountsTableFields } from "@/constants/accountsConfig";
import { groupCashEntriesByProject } from "@/lib/cashEntryGroups.mjs";
import { createExportFileName, exportToCsv } from "@/lib/tableExport";

/**
 * A cash entry's ⋮ - one list, read by this table's row and by the Board's card on the Accounts page.
 * `onShareInvoice` is passed only with Read / Write; Edit and Delete need `canWrite`.
 */
export function cashEntryActionItems(entry, { canWrite, onView, onDownloadInvoice, onShareInvoice, onEdit, onDelete }) {
  return [
    ...(onView ? [{ label: "View", onSelect: () => onView(entry) }] : []),
    // Money received has an invoice - a read, so offered to whoever sees the table.
    ...(onDownloadInvoice && entry.entryType === "Received" ? [{ label: "Download invoice", onSelect: () => onDownloadInvoice(entry) }] : []),
    // Handing the invoice to the client is a write, so the caller passes this only with Read / Write.
    ...(onShareInvoice && entry.entryType === "Received" ? [{ label: "Share invoice", onSelect: () => onShareInvoice(entry) }] : []),
    ...(canWrite ? [
      { label: "Edit", onSelect: () => onEdit?.(entry) },
      { label: "Delete", tone: "danger", onSelect: () => onDelete?.(entry) },
    ] : []),
  ];
}

/** The shared table, given the accounts columns. Cells and sorting come from `tableCells`. */
// `canWrite` comes from the page, which knows the permission this table is read under. Both entries
// in the row menu change a cash entry, so without it there is no menu rather than one that opens
// onto refusals.
export default function AccountsTable({ entries, fields = accountsTableFields, loading, density, freezeCount, selectedEntryId, onEdit, onDelete, onDownloadInvoice, onShareInvoice, onRowClick, onRowDoubleClick, onTableNotice, onInfiniteStats, onFreezeColumnsChange, onImported, selection, canWrite = true, grouped = false }) {
  /*
   * `grouped` - the reader's choice on All, Received and Spent, off by default: one row per project,
   * its entries under it with their own ⋮
   * (`groupCashEntriesByProject`). The project row has no ⋮, cannot be ticked, and a click or double
   * click on it opens nothing; a filter searches the entries under it, and the CSV lists the entries.
   */
  const data = useMemo(() => (grouped ? groupCashEntriesByProject(entries) : entries), [entries, grouped]);
  const entryOnly = (handler) => (handler ? (entry) => { if (!entry?.isProjectGroup) handler(entry); } : handler);
  const defaultVisibility = useMemo(() => defaultVisibilityFor(fields), [fields]);
  const columns = useMemo(() => buildTableColumns({
    fields,
    statusStyles: accountsStatusStyles,
    listFilters: accountsListFilters,
    // Not gated on canWrite any more: View is offered to everybody, because on a touch screen this
    // menu is the only way into the record view — a double-click there is the browser's own zoom.
    renderActions: (entry) => (entry.isProjectGroup ? null : <OptionsMenu ariaLabel={`Actions for ${entry.entryId || "entry"}`} items={cashEntryActionItems(entry, { canWrite, onView: onRowDoubleClick, onDownloadInvoice, onShareInvoice, onEdit, onDelete })} />),
  }), [canWrite, fields, onDelete, onDownloadInvoice, onEdit, onRowDoubleClick, onShareInvoice]);

  // The entries themselves, one line each, never the project rows that sum them - the same columns and
  // cell values the table's own export writes.
  async function exportEntries({ rows, columns: shown }) {
    const flat = rows.flatMap((row) => (row.isProjectGroup ? row.entries : [row]));
    const exported = await exportToCsv({
      fileName: createExportFileName("accounts"),
      columns: shown.filter((column) => column.id !== "actions" && column.exportable !== false).map((column) => ({
        key: column.meta?.exportKey || column.id,
        label: typeof column.header === "string" ? column.header : column.id,
        value: (row, index) => column.exportValue?.(row, index) ?? column.accessorFn?.(row, index) ?? row?.[column.accessorKey || column.id],
      })),
      rows: flat,
    });
    onTableNotice?.(exported ? "Accounts CSV export downloaded." : "No rows available to export.");
  }

  return <DataTable
    /*
     * One importer for both directions. Money in and money out are written by the same endpoint and
     * counted apart by their own identifiers; the file's Entry Type column is what says which each
     * row is, so a studio moving its cash book in does it once rather than twice.
     */
    importConfig={canWrite ? { prefix: "/api/accounts/cash-entries", columns: CASH_ENTRY_IMPORT_COLUMNS, templateName: "accounts-import-template", title: "Import Cash Entries", onImported } : undefined}
    columns={columns}
    data={data}
    density={density}
    loading={loading}
    loadingMessage="Loading accounts..."
    emptyMessage="No accounts entries yet."
    noMatchMessage="No matching entries found."
    selectedRowId={selectedEntryId}
    onRowClick={entryOnly(onRowClick)}
    onRowDoubleClick={entryOnly(onRowDoubleClick)}
    defaultColumnVisibility={defaultVisibility}
    onVisibleRowsChange={onInfiniteStats}
    ariaLabel="Accounts table"
    features={{
      filtering: true,
      sorting: true,
      columnVisibility: true,
      columnResize: true,
      frozenColumns: { count: freezeCount, onChange: onFreezeColumnsChange },
      infiniteScroll: { pageSize: 50 },
      ...(grouped ? { expandable: { label: "this project's entries", canExpand: (row) => Boolean(row.isProjectGroup), getSubRows: (row) => row.entries || [] } } : {}),
      csvExport: { enabled: true, fileName: "accounts", ...(grouped ? { onExport: exportEntries } : {}), onResult: (exported) => onTableNotice?.(exported ? "Accounts CSV export downloaded." : "No rows available to export.") },
      // The tick boxes, decided by the page: this table draws whatever it is handed, and is handed
      // nothing at all by a role without `ADMIN / Table Select All`.
      // A project row's box ticks every entry under it; each entry has its own (`subRows`).
      selection: selection && grouped ? { ...selection, subRows: true, rowLabel: selection.rowLabel || ((row) => row.projectCode && row.isProjectGroup ? row.projectCode : row.entryId || "this entry"), canSelectRow: (row) => !row.isProjectGroup && (!selection.canSelectRow || selection.canSelectRow(row)) } : selection,
    }}
  />;
}
