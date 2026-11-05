"use client";

import { useMemo } from "react";
import DataTable from "@/components/data-table/DataTable";
import { CASH_ENTRY_IMPORT_COLUMNS } from "@/constants/importColumns";
import { buildTableColumns, defaultVisibilityFor } from "@/components/data-table/tableCells";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { accountsStatusStyles, accountsTableFields } from "@/constants/accountsConfig";

/** The shared table, given the accounts columns. Cells and sorting come from `tableCells`. */
// `canWrite` comes from the page, which knows the permission this table is read under. Both entries
// in the row menu change a cash entry, so without it there is no menu rather than one that opens
// onto refusals.
export default function AccountsTable({ entries, fields = accountsTableFields, loading, density, freezeCount, startIndex, selectedEntryId, onEdit, onDelete, onRowClick, onRowDoubleClick, onTableNotice, onInfiniteStats, onFreezeColumnsChange, onImported, selection, canWrite = true }) {
  const defaultVisibility = useMemo(() => defaultVisibilityFor(fields), [fields]);
  const columns = useMemo(() => buildTableColumns({
    fields,
    startIndex,
    statusStyles: accountsStatusStyles,
    // Not gated on canWrite any more: View is offered to everybody, because on a touch screen this
    // menu is the only way into the record view — a double-click there is the browser's own zoom.
    renderActions: (entry) => <OptionsMenu ariaLabel={`Actions for ${entry.entryId || "entry"}`} items={[
      ...(onRowDoubleClick ? [{ label: "View", onSelect: () => onRowDoubleClick(entry) }] : []),
      ...(canWrite ? [
        { label: "Edit", onSelect: () => onEdit?.(entry) },
        { label: "Delete", tone: "danger", onSelect: () => onDelete?.(entry) },
      ] : []),
    ]} />,
  }), [canWrite, fields, onDelete, onEdit, onRowDoubleClick, startIndex]);

  return <DataTable
    /*
     * One importer for both directions. Money in and money out are written by the same endpoint and
     * counted apart by their own identifiers; the file's Entry Type column is what says which each
     * row is, so a studio moving its cash book in does it once rather than twice.
     */
    importConfig={canWrite ? { prefix: "/api/accounts/cash-entries", columns: CASH_ENTRY_IMPORT_COLUMNS, templateName: "accounts-import-template", title: "Import Cash Entries", onImported } : undefined}
    columns={columns}
    data={entries}
    density={density}
    loading={loading}
    loadingMessage="Loading accounts..."
    emptyMessage="No accounts entries yet."
    noMatchMessage="No matching entries found."
    selectedRowId={selectedEntryId}
    onRowClick={onRowClick}
    onRowDoubleClick={onRowDoubleClick}
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
      csvExport: { enabled: true, fileName: "accounts", onResult: (exported) => onTableNotice?.(exported ? "Accounts CSV export downloaded." : "No rows available to export.") },
      // The tick boxes, decided by the page: this table draws whatever it is handed, and is handed
      // nothing at all by a role without `ADMIN / Table Select All`.
      selection,
    }}
  />;
}
