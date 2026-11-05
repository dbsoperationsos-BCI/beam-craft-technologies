"use client";

import { useMemo, useState } from "react";
import DataTable from "@/components/data-table/DataTable";
import DataTableShell from "@/components/data-table/DataTableShell";
import TableFooter from "@/components/data-table/TableFooter";
import { TableCellValue } from "@/components/data-table/tableCells";
import KanbanBoard, { columnsFromRows, groupValue } from "@/components/data-table/KanbanBoard";
import { columnSumText } from "@/lib/kanbanSummary.mjs";
import TableBoardSwitch, { useTableBoardLayout } from "@/components/data-table/TableBoardSwitch";
import { CardState } from "@/components/shared/DashboardCard";
import { branchLabel } from "@/lib/branchName";
import { clockLabel, formatTotalMinutes } from "@/lib/attendanceTime.mjs";
import { mapLinkFor } from "@/lib/mapLink.mjs";

/**
 * Every employee on the administrator's Dashboard, with their own figures for the range - the table
 * under the cards, drawn the way Image Selection's Recent Projects sits under its own.
 *
 * The cards are filters on this table, not links. Pressing Absent narrows it to the people who were
 * absent at least once and puts the most absent first; it stays so until another card is pressed or
 * the chip beside the heading clears it. So a card answers
 * "how many" and this answers "who", without the page moving.
 */

const number = (value) => Number(value || 0).toLocaleString("en-IN");

/**
 * The people a pressed card means, and the order they are shown in: somebody counted by it, most
 * first. With nothing pressed, everybody, in name order as the server sent them.
 */
export function rowsForCard(rows, key) {
  if (!key) return rows;
  return rows.filter((row) => Number(row[key] || 0) > 0).sort((a, b) => Number(b[key] || 0) - Number(a[key] || 0));
}

export default function AdminAttendanceEmployees({ rows = [], view = null, viewLabel = "", onClearView, loading, error, onRetry }) {
  const shown = useMemo(() => rowsForCard(rows, view), [rows, view]);
  // How many rows survived the table's own filter row, which only the table can say. The setter is
  // passed straight in: the table reports from an effect keyed on it, and a setter never changes.
  const [stats, setStats] = useState(null);
  // Table or Board. Nobody here has a status, so the board stands people under their branch - a view
  // only, and a card opens nothing, as a row opens nothing.
  const [layout, setLayout] = useTableBoardLayout("attendance-dashboard-employees");
  const onBoard = layout === "board";
  const branchOf = (row) => branchLabel(row.branchName);

  const columns = useMemo(() => [
    { id: "employee", header: "Employee", accessorFn: (row) => row.employeeName, width: 210, cell: ({ row }) => <span className="block min-w-0">
      <span className="block truncate font-medium text-slate-800">{row.original.employeeName}</span>
      {row.original.employeeCode && <span className="block text-[10px] text-slate-500">{row.original.employeeCode}</span>}
    </span> },
    { id: "branch", header: "Branch", accessorFn: (row) => branchLabel(row.branchName) || "", width: 130, cell: ({ row }) => branchLabel(row.original.branchName) || "—" },
    { id: "present", header: "Present", accessorFn: (row) => row.present, width: 95, cell: ({ row }) => number(row.original.present) },
    { id: "absent", header: "Absent", accessorFn: (row) => row.absent, width: 95, cell: ({ row }) => number(row.original.absent) },
    // The days this person had an approved permission - read beside Absent, which is the figure it
    // explains: an hour off is not a day missed.
    { id: "permission", header: "Permission", accessorFn: (row) => row.permission, width: 110, cell: ({ row }) => number(row.original.permission) },
    { id: "onLeave", header: "On Leave", accessorFn: (row) => row.onLeave, width: 100, cell: ({ row }) => number(row.original.onLeave) },
    { id: "late", header: "Late", accessorFn: (row) => row.late, width: 85, cell: ({ row }) => number(row.original.late) },
    { id: "halfDay", header: "Half Day", accessorFn: (row) => row.halfDay, width: 100, cell: ({ row }) => number(row.original.halfDay) },
    { id: "earlyExit", header: "Early Exit", accessorFn: (row) => row.earlyExit, width: 100, cell: ({ row }) => number(row.original.earlyExit) },
    /*
     * The day's times. Over a range each person has many check-ins, so these are the average of the
     * days they marked - and over a single day, simply that day's time. Somebody who marked none
     * reads as a dash.
     */
    { id: "checkIn", header: "Check In", accessorFn: (row) => row.avgCheckInMinutes ?? -1, width: 120, cell: ({ row }) => clockLabel(row.original.avgCheckInMinutes) },
    // How they worked - Office, Work from home, Field work, Flexible Shift - the latest day in the
    // range, the day itself over one day. A dash where nothing was marked.
    { id: "workMode", header: "Work Mode", accessorFn: (row) => row.workMode || "", width: 140, cell: ({ row }) => row.original.workMode || "—" },
    { id: "checkOut", header: "Check Out", accessorFn: (row) => row.avgCheckOutMinutes ?? -1, width: 125, cell: ({ row }) => clockLabel(row.original.avgCheckOutMinutes) },
    // Check-in to check-out, less any time logged out between two logins. Breaks are not taken off.
    { id: "worked", header: "Worked", accessorFn: (row) => row.workedMinutes, width: 110, cell: ({ row }) => formatTotalMinutes(row.original.workedMinutes) },
    // Every Break In to Break Off in the range, added up - shown beside Worked, not subtracted from it.
    { id: "breakTime", header: "Break Time", accessorFn: (row) => row.breakMinutes, width: 110, cell: ({ row }) => formatTotalMinutes(row.original.breakMinutes) },
    // Of the days owed, how many were attended; a person owed nothing in the range has no rate.
    // Where the login and the logout were captured - the latest in the range, the day itself over
    // one day - opened on the map in a new tab. A dash where no position was captured.
    { id: "loginLocation", header: "Login location link", accessorFn: (row) => mapLinkFor(row.loginLocation) || "", width: 165, enableSorting: false, cell: ({ row }) => <TableCellValue value={mapLinkFor(row.original.loginLocation)} type="link" linkLabel="View on map" /> },
    { id: "logoutLocation", header: "Logout location link", accessorFn: (row) => mapLinkFor(row.logoutLocation) || "", width: 170, enableSorting: false, cell: ({ row }) => <TableCellValue value={mapLinkFor(row.original.logoutLocation)} type="link" linkLabel="View on map" /> },
    { id: "rate", header: "Attendance", accessorFn: (row) => row.attendanceRate ?? -1, width: 115, cell: ({ row }) => (row.original.attendanceRate == null ? "—" : `${row.original.attendanceRate}%`) },
  ], []);

  const matched = Math.min(stats?.total ?? shown.length, shown.length);
  const narrowed = matched !== rows.length;
  const people = (value) => `${number(value)} ${Number(value) === 1 ? "employee" : "employees"}`;
  const footerText = loading
    ? "Loading..."
    : narrowed
      ? `${matched} of ${people(rows.length)}${view ? ` · ${viewLabel}` : ""}`
      : people(rows.length);

  return <section className="flex min-w-0 flex-col">
    <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
      <h2 className="min-w-0 text-sm font-medium text-slate-700">
        Employees
        {/* What the table is narrowed to, and the one place to let it go from down here. */}
        {view && <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
          {viewLabel}
          <button type="button" onClick={onClearView} aria-label={`Show every employee instead of ${viewLabel}`} className="rounded px-0.5 leading-none hover:bg-blue-100">×</button>
        </span>}
      </h2>
      <TableBoardSwitch value={layout} onChange={setLayout} />
    </div>
    {onBoard && !error ? <div className="flex h-110 min-h-0 min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm">
      <KanbanBoard
        rows={shown}
        columns={columnsFromRows(shown, branchOf)}
        statusOf={(row) => groupValue(branchOf(row))}
        // Under each branch: the late days its people add up to, from the table's own `late`.
        columnAmount={(rows) => columnSumText(rows, (row) => row.late, "Late days", String)}
        card={{
          title: (row) => row.employeeName,
          subtitle: (row) => [row.employeeCode, row.workMode].filter(Boolean).join(" · "),
          meta: (row) => `Present ${number(row.present)} · Absent ${number(row.absent)}${row.attendanceRate == null ? "" : ` · ${row.attendanceRate}%`}`,
        }}
        getRowId={(row) => String(row.employeeId)}
        viewOnly="Employees are grouped by their branch. Change the branch in the employee's record."
        loading={loading}
        noun="employees"
        ariaLabel="Employee attendance board"
      />
    </div> : <DataTableShell className="shadow-sm" footer={<TableFooter><span className="text-xs">{footerText}</span></TableFooter>}>
      {error
        ? <div className="p-3"><CardState error={error} onRetry={onRetry} /></div>
        : <DataTable
          columns={columns}
          data={shown}
          loading={loading}
          loadingMessage="Loading employees..."
          emptyMessage={view ? `Nobody under ${viewLabel} in this range.` : "No employees in this range."}
          noMatchMessage="Nothing matches that search."
          getRowId={(row) => row.employeeId}
          // No row click: a row opens nothing, and a highlight that led nowhere read as a control.
          ariaLabel="Employee attendance over the range"
          // Fifteen rows tall at most, and the rest scroll inside the panel - the same cap, and the
          // same reason for it, as Image Selection's Recent Projects.
          className="max-h-110"
          onVisibleRowsChange={setStats}
          features={{ filtering: true, sorting: true, infiniteScroll: { pageSize: 15 } }}
        />}
    </DataTableShell>}
  </section>;
}
