"use client";

import { useMemo, useState } from "react";
import DataTable from "@/components/data-table/DataTable";
import DataTableShell from "@/components/data-table/DataTableShell";
import TableFooter from "@/components/data-table/TableFooter";
import { CardState } from "@/components/shared/DashboardCard";
import DashboardProgressBar from "@/components/shared/DashboardProgressBar";
import DashboardTableHeading from "@/components/shared/DashboardTableHeading";
import StatusChip from "@/components/ai-feature/shared/StatusChip";
import { EVENT_STATUS_LABELS, formatEventRange } from "@/lib/aiFeature.mjs";
import { number, relativeTime } from "@/lib/dashboardRange.mjs";
import { PROGRESS_COLORS } from "@/lib/progressStatus.mjs";
import { rowsForView, viewLabel } from "@/lib/aiDashboard.mjs";

/**
 * Recent Events: every live event, most recently active first, in the same `DataTable` every
 * module's tables use — the per-column filter row, sorting, the Table Options menu and its
 * Compact view included, fifteen rows tall and scrolled for the rest. The Image Selection
 * dashboard's Recent Projects, over events.
 *
 * Two narrowings, one after the other: the cards above ask what state an event is in (`view`),
 * the filter row asks which event. Both happen here on rows the page already holds. A click
 * picks a row out; a double click opens the event workspace — the gesture every other table in
 * the application answers to.
 */
const progressColor = (row) => (row.failedCount > 0 ? PROGRESS_COLORS.partiallyCompleted : row.percent >= 100 ? PROGRESS_COLORS.completed : PROGRESS_COLORS.inProgress);

export default function AiDashboardRecentEvents({ rows = [], view = null, onClearView, loading, error, onRetry, onOpen, now }) {
  const shown = useMemo(() => rowsForView(rows, view), [rows, view]);
  const label = viewLabel(view);
  const [selectedId, setSelectedId] = useState(null);
  // How many rows survived the table's own filter row, which only the table can say; the setter
  // is passed straight in because the table reports from an effect keyed on the callback.
  const [stats, setStats] = useState(null);
  const columns = useMemo(() => [
    { id: "event", header: "Event", accessorFn: (row) => row.name, width: 220, cell: ({ row }) => <span className="block min-w-0">
      <span className="block truncate font-medium text-slate-800">{row.original.name}</span>
      {row.original.eventType && <span className="block text-[10px] text-slate-400">{row.original.eventType}</span>}
    </span> },
    { id: "date", header: "Date", accessorFn: (row) => row.startDate || "", width: 140, cell: ({ row }) => formatEventRange(row.original.startDate, row.original.endDate) || "—" },
    { id: "type", header: "Event Type", accessorFn: (row) => row.eventType || "", width: 120, cell: ({ row }) => row.original.eventType || "—" },
    { id: "photos", header: "Photos", accessorFn: (row) => row.mediaCount, width: 100, cell: ({ row }) => number(row.original.mediaCount) },
    { id: "processed", header: "Processed", accessorFn: (row) => row.processedCount, width: 110, cell: ({ row }) => number(row.original.processedCount) },
    { id: "people", header: "People", accessorFn: (row) => row.peopleCount, width: 90, cell: ({ row }) => number(row.original.peopleCount) },
    { id: "faces", header: "Faces", accessorFn: (row) => row.faceCount, width: 90, cell: ({ row }) => number(row.original.faceCount) },
    { id: "progress", header: "Progress", accessorFn: (row) => row.percent ?? -1, width: 150, cell: ({ row }) => <span className="block min-w-0">
      <DashboardProgressBar percent={row.original.mediaCount ? row.original.percent : null} color={progressColor(row.original)} emptyText="No photos" />
      {row.original.failedCount > 0 && <span className="block text-[10px] text-red-600">{number(row.original.failedCount)} failed</span>}
    </span> },
    { id: "status", header: "Status", accessorFn: (row) => EVENT_STATUS_LABELS[row.status] || row.status, width: 110, cell: ({ row }) => <StatusChip status={row.original.status} /> },
    { id: "activity", header: "Last Activity", accessorFn: (row) => row.lastActivityAt || "", width: 130, cell: ({ row }) => relativeTime(row.original.lastActivityAt, now) },
  ], [now]);

  const matched = Math.min(stats?.total ?? shown.length, shown.length);
  const narrowed = matched !== rows.length;
  const footerText = loading
    ? "Loading..."
    : narrowed
      ? `${matched} of ${rows.length} events${view ? ` · ${label}` : ""}`
      : `${rows.length} events, most recently active first`;

  return <section className="flex min-w-0 flex-col">
    <DashboardTableHeading title="Recent Events" label={view ? label : null} onClear={onClearView} noun="events" />
    <DataTableShell className="shadow-sm" footer={<TableFooter><span className="text-xs">{footerText}</span></TableFooter>}>
      {error
        ? <div className="p-3"><CardState error={error} onRetry={onRetry} /></div>
        : <DataTable
          columns={columns}
          data={shown}
          loading={loading}
          loadingMessage="Loading events..."
          emptyMessage={view ? `No events under ${label} right now.` : "No events yet."}
          noMatchMessage="Nothing matches that search."
          getRowId={(row) => row.id}
          selectedRowId={selectedId || undefined}
          onRowClick={(row) => setSelectedId(row.id)}
          onRowDoubleClick={(row) => onOpen(row)}
          ariaLabel="Recent AI events"
          // Fifteen rows tall, a maximum: the rest load as this pane is scrolled (see the Image
          // Selection dashboard's table for why it is a shade under sixteen).
          className="max-h-110"
          onVisibleRowsChange={setStats}
          features={{ filtering: true, sorting: true, infiniteScroll: { pageSize: 15 } }}
        />}
    </DataTableShell>
  </section>;
}
