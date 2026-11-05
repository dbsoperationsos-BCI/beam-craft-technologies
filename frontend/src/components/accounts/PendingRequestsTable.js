"use client";

import { useMemo } from "react";
import DataTable from "@/components/data-table/DataTable";
import { buildTableColumns, defaultVisibilityFor } from "@/components/data-table/tableCells";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { requestTableFields } from "@/constants/paymentRequestConfig";

/*
 * Accounts Manager's Pending tab: the requests that have been **approved** and not yet paid — the
 * studio's queue of money to release, read beside the cash book that records what it has released.
 *
 * Not the requests waiting for a decision. Those belong to the Payment Requests screen, which is
 * where somebody says yes or no; a request reaches this tab the moment it is approved and leaves it
 * the moment the money goes. Having both queues here meant approving and paying happened in one
 * breath, by one person, and a request only ever appeared in the cash book once it was too late to
 * question.
 *
 * The ⋮ offers View and **Record Payment** — the one that writes the cash entries, and for a salary
 * advance the payroll row that takes it back. `items` comes from `usePaymentRequestActions`, shared
 * with the Payment Requests screen so a request's actions have one definition rather than two; what
 * each screen offers is decided there by the permissions it passes in.
 *
 * The ⋮ also gives the row the height every other table here has — its trigger's `min-h-10` is what
 * sets it — so a table without one reads as a cramped band of text beside them.
 *
 * Three of the requests table's own columns are left out: every row here is APPROVED, awaiting
 * payment, and has written no cash entry, so Status, Payment and Cash Entries would be two columns
 * of one repeated word and one of blanks. Decided On stays — on this tab it is how long the money
 * has been waiting.
 */
const DECIDED_ONLY = ["status", "paymentStatus", "cashEntryCode"];
const FIELDS = requestTableFields.filter(([key]) => !DECIDED_ONLY.includes(key));

export default function PendingRequestsTable({ rows, loading, density, items, onOpen, onVisibleRowsChange, onExported }) {
  const columns = useMemo(() => buildTableColumns({
    fields: FIELDS,
    listFilters: ["typeLabel", "branch"],
    renderActions: items
      ? (row) => <OptionsMenu ariaLabel={`Actions for ${row.requestCode}`} items={items(row)} />
      : undefined,
  }), [items]);
  const defaultVisibility = useMemo(() => defaultVisibilityFor(FIELDS), []);

  return <DataTable
    columns={columns}
    data={rows}
    density={density}
    loading={loading}
    loadingMessage="Loading pending requests..."
    emptyMessage="Nothing is waiting to be paid. An approved payment request appears here until the money is released."
    noMatchMessage="No matching requests found."
    // Reads the request in full, as a double click does on every other table in the OS.
    onRowDoubleClick={onOpen ? (row) => onOpen(row) : undefined}
    onVisibleRowsChange={onVisibleRowsChange}
    ariaLabel="Approved payment requests awaiting payment table"
    defaultColumnVisibility={defaultVisibility}
    features={{
      filtering: true,
      sorting: true,
      columnVisibility: true,
      infiniteScroll: { pageSize: 50 },
      csvExport: { enabled: true, fileName: "pending-payment-requests", onResult: onExported },
    }}
  />;
}
