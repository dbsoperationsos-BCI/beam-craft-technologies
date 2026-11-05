"use client";

import { useMemo } from "react";
import DataTable from "@/components/data-table/DataTable";
import { formatAmount } from "@/components/data-table/tableCells";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { formatDay } from "@/lib/productionSteps.mjs";
import { accountsStatusLabel, groupPaymentsByProject } from "@/lib/scheduledPayments.mjs";
import { createExportFileName, exportToCsv } from "@/lib/tableExport";
import PaymentStatusPill from "./PaymentStatusPill";
import { dueDateText } from "@/lib/paymentSchedule.mjs";

/*
 * The scheduled payments under Accounts Manager's Due, Overdue and On Hold tabs: one row per payment
 * a project is booked to receive - its Schedule Payment, saved by Create Project and Start / Edit
 * Project - earliest due first. A double click or the row's ⋮ View reads the payment (`onOpen(row)`);
 * ⋮ Record opens it to work (`onOpen(row, true)`) - for whoever may write the screen.
 *
 * `grouped` (Due and Overdue) folds a project's payments under one project row
 * (`groupPaymentsByProject`): opened with its chevron, each payment under it keeps its own ⋮ View /
 * Record. The project row itself has no ⋮ and a double click does nothing on it. A filter searches
 * the payments under a project too, and opens the project it found one in. The CSV holds the
 * payments themselves, one line each, never the project rows.
 */
const text = (value) => (value === null || value === undefined || value === "" ? "—" : String(value));
const columns = [
  { id: "eventId", label: "Event ID" },
  { id: "clientName", label: "Client Name" },
  { id: "category", label: "Category" },
  { id: "dueDate", label: "Due Date", value: (row) => dueDateText(row, formatDay), sort: (row) => row.dueDate || "9999" },
  { id: "amount", label: "Amount", value: (row) => formatAmount(row.amount), sort: (row) => row.amount },
  { id: "pending", label: "Pending", value: (row) => formatAmount(row.pending), sort: (row) => row.pending },
  { id: "status", label: "Status" },
  { id: "accountsStatus", label: "Project Accounts Status", value: (row) => text(accountsStatusLabel(row)) },
  { id: "branch", label: "Branch" },
  { id: "actions", label: "Actions", fixed: true, sortable: false, filterable: false },
];
const displayValue = (row, column) => (column.value ? column.value(row) : text(row[column.id]));

/** A payment's ⋮ - one list, read by this table's row and by the Board's card on the Accounts page. */
export function paymentActionItems(row, { canWrite, onOpen }) {
  return [
    { label: "View", onSelect: () => onOpen(row) },
    ...(canWrite ? [{ label: "Record", onSelect: () => onOpen(row, true) }] : []),
  ];
}

export default function ScheduledPaymentsTable({ rows, loading, density, canWrite, grouped = false, onOpen, onVisibleRowsChange, onExported }) {
  const data = useMemo(() => (grouped ? groupPaymentsByProject(rows) : rows), [grouped, rows]);
  const tableColumns = useMemo(() => columns.map((column) => ({
    ...column,
    header: column.label,
    accessorFn: (row) => displayValue(row, column),
    sortingFn: column.sort ? (first, second) => {
      const a = column.sort(first.original);
      const b = column.sort(second.original);
      return typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
    } : "alphanumeric",
    cell: column.id === "actions"
      ? ({ row }) => (row.original.isProjectGroup ? null : <OptionsMenu ariaLabel={`Actions for ${row.original.eventId} ${row.original.category}`} items={paymentActionItems(row.original, { canWrite, onOpen })} />)
      : column.id === "status"
        ? ({ row }) => <PaymentStatusPill status={row.original.status} />
        : ({ row }) => displayValue(row.original, column),
    exportValue: (row) => displayValue(row, column),
    width: column.id === "actions" ? 56 : 160,
    minWidth: column.id === "actions" ? 56 : 120,
  })), [canWrite, onOpen]);

  // The payments themselves, one line each: a project row stands for its payments, not beside them.
  const exportPayments = async ({ rows: shown }) => {
    const payments = shown.flatMap((row) => (row.isProjectGroup ? row.payments : [row]));
    const exported = await exportToCsv({
      fileName: createExportFileName("scheduled-payments"),
      columns: columns.filter((column) => column.id !== "actions").map((column) => ({ key: column.id, label: column.label, value: (row) => displayValue(row, column) })),
      rows: [...new Map(payments.map((payment) => [payment.id, payment])).values()],
    });
    onExported?.(exported);
  };

  return <DataTable
    columns={tableColumns}
    data={data}
    density={density}
    loading={loading}
    loadingMessage="Loading scheduled payments..."
    emptyMessage="No payments here. A project's Schedule Payment appears once it is saved on Create Project or Start / Edit Project."
    noMatchMessage="No matching payments found."
    onRowDoubleClick={(row) => { if (!row.isProjectGroup) onOpen(row); }}
    onVisibleRowsChange={onVisibleRowsChange}
    ariaLabel="Scheduled payments table"
    features={{
      filtering: true,
      sorting: true,
      columnVisibility: true,
      infiniteScroll: { pageSize: 50 },
      ...(grouped ? { expandable: { label: "this project's payments", canExpand: (row) => Boolean(row.isProjectGroup), getSubRows: (row) => row.payments || [] } } : {}),
      csvExport: grouped
        ? { enabled: true, fileName: "scheduled-payments", onExport: exportPayments }
        : { enabled: true, fileName: "scheduled-payments", onResult: onExported },
    }}
  />;
}
