"use client";

import { useMemo } from "react";
import DataTable from "@/components/data-table/DataTable";
import { TableCellValue } from "@/components/data-table/tableCells";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { REQUEST_TYPE_LABELS, STATUS_DOTS, STATUS_LABELS, isDecided, rupees } from "@/lib/changeRequests.mjs";

/*
 * Client Requests -> Raised Requests: one row a request the studio raised on a project, newest
 * first - each column a fact that can be filtered, sorted, hidden and exported, as every table in the
 * OS reads. Double click opens it, as does the row's ⋮ - Review for whoever may decide it while it is
 * open, View otherwise; there is no separate Action column.
 */

const when = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");

export default function RaisedRequestsTable({ rows, loading, density, emptyMessage, canApprove = false, onOpen, onVisibleRowsChange }) {
  const columns = useMemo(() => {
    const text = (id, header, value, width = 160) => ({ id, header, accessorFn: value, cell: ({ row }) => value(row.original) || "—", exportValue: value, width, minWidth: Math.min(width, 120) });
    return [
      text("requestCode", "Request ID", (row) => row.requestCode, 140),
      text("eventId", "Event ID", (row) => row.eventId, 210),
      text("client", "Client", (row) => row.clientName, 240),
      text("type", "Request Type", (row) => REQUEST_TYPE_LABELS[row.requestType] || row.requestType, 140),
      text("shoot", "Shoot", (row) => row.correctionCategory || [row.shootCode, row.shootName].filter(Boolean).join(" · "), 200),
      text("requestedBy", "Requested By", (row) => row.requestedByName, 170),
      text("requestedAt", "Requested Date", (row) => when(row.requestedAt), 170),
      text("items", "Items", (row) => String(row.itemCount), 90),
      text("approvedAmount", "Approved Amount", (row) => (row.approvedCount ? rupees(row.approvedAmount) : ""), 150),
      { ...text("status", "Status", (row) => STATUS_LABELS[row.status], 170), cell: ({ row }) => <TableCellValue value={STATUS_LABELS[row.original.status]} type="status" statusStyles={STATUS_DOTS} /> },
      text("updatedAt", "Last Updated", (row) => when(row.updatedAt), 170),
      {
        id: "menu",
        header: "",
        accessorFn: () => "",
        enableColumnFilter: false,
        enableSorting: false,
        width: 56,
        minWidth: 56,
        cell: ({ row }) => <OptionsMenu ariaLabel="Request actions" items={[{ label: canApprove && !isDecided(row.original) ? "Review" : "View", onSelect: () => onOpen(row.original) }]} />,
      },
    ];
  }, [canApprove, onOpen]);

  return <DataTable
    columns={columns}
    data={rows || []}
    density={density}
    loading={loading}
    loadingMessage="Loading raised requests..."
    emptyMessage={emptyMessage}
    noMatchMessage="No requests match."
    onVisibleRowsChange={onVisibleRowsChange}
    onRowDoubleClick={onOpen}
    getRowId={(row) => String(row.id)}
    ariaLabel="Raised requests table"
    features={{ filtering: true, sorting: true, columnVisibility: true, infiniteScroll: { pageSize: 50 }, csvExport: { enabled: true, fileName: "raised-requests" } }}
  />;
}
