"use client";

import { useMemo, useState } from "react";
import DataTable from "@/components/data-table/DataTable";
import DataTableShell from "@/components/data-table/DataTableShell";
import TableFooter from "@/components/data-table/TableFooter";
import { CardState } from "@/components/shared/DashboardCard";
import DashboardProgressBar from "@/components/shared/DashboardProgressBar";
import DashboardTableHeading from "@/components/shared/DashboardTableHeading";
import ProofingStatusChip, { ALBUM_STATE_LABELS } from "@/components/image-selection/album-proofing/ProofingStatusChip";
import { relativeTime } from "@/lib/dashboardRange.mjs";
import { PROGRESS_COLORS } from "@/lib/progressStatus.mjs";
import { LINK_TONES, correctionsText, linkLabel, rowsForView, versionText, viewLabel } from "@/lib/albumProofingDashboard.mjs";

/**
 * Recent Albums: every live album across every Album Proofing project, most recently active
 * first, in the same `DataTable` every module's tables use — the per-column filter row, sorting,
 * the Table Options menu and its Compact view included, fifteen rows tall and scrolled for the
 * rest. The Image Selection dashboard's Recent Projects, over albums.
 *
 * Two narrowings, one after the other: the cards above ask what state an album is in (`view`),
 * the filter row asks which album. Both happen here on rows the page already holds. A click picks
 * a row out; a double click opens the album on the Projects page — the gesture every other table
 * in the application answers to.
 */
const stageColor = (row) => (row.stagePercent >= 100 ? PROGRESS_COLORS.completed : row.stagePercent > 0 ? PROGRESS_COLORS.inProgress : PROGRESS_COLORS.notStarted);

export default function AlbumDashboardRecentAlbums({ rows = [], view = null, onClearView, loading, error, onRetry, onOpen, now }) {
  const shown = useMemo(() => rowsForView(rows, view), [rows, view]);
  const label = viewLabel(view);
  const [selectedId, setSelectedId] = useState(null);
  // How many rows survived the table's own filter row, which only the table can say; the setter
  // is passed straight in because the table reports from an effect keyed on the callback.
  const [stats, setStats] = useState(null);
  const columns = useMemo(() => [
    { id: "album", header: "Album", accessorFn: (row) => `${row.name} ${row.projectName || ""}`, width: 220, cell: ({ row }) => <span className="block min-w-0">
      <span className="block truncate font-medium text-slate-800">{row.original.name}</span>
      {row.original.projectName && <span className="block truncate text-[10px] text-slate-400">{row.original.projectName}</span>}
    </span> },
    { id: "client", header: "Client", accessorFn: (row) => row.clientName || "", width: 150, cell: ({ row }) => row.original.clientName || "—" },
    { id: "version", header: "Version", accessorFn: (row) => row.currentVersionNumber ?? 0, width: 100, cell: ({ row }) => versionText(row.original) },
    { id: "status", header: "Status", accessorFn: (row) => ALBUM_STATE_LABELS[row.status] || row.status, width: 150, cell: ({ row }) => <ProofingStatusChip status={row.original.status} /> },
    { id: "corrections", header: "Corrections", accessorFn: (row) => row.openCorrections, width: 110, cell: ({ row }) => <span className={row.original.openCorrections ? "font-medium text-rose-700" : ""}>{correctionsText(row.original)}</span> },
    { id: "progress", header: "Progress", accessorFn: (row) => row.stagePercent, width: 150, cell: ({ row }) => <DashboardProgressBar percent={row.original.stagePercent} color={stageColor(row.original)} /> },
    { id: "link", header: "Link", accessorFn: (row) => linkLabel(row.link), width: 110, cell: ({ row }) => <span className={row.original.link ? LINK_TONES[row.original.link.state] || "" : "text-slate-400"}>{linkLabel(row.original.link)}</span> },
    { id: "activity", header: "Last Activity", accessorFn: (row) => row.lastActivityAt || "", width: 130, cell: ({ row }) => relativeTime(row.original.lastActivityAt, now) },
  ], [now]);

  const matched = Math.min(stats?.total ?? shown.length, shown.length);
  const narrowed = matched !== rows.length;
  const footerText = loading
    ? "Loading..."
    : narrowed
      ? `${matched} of ${rows.length} albums${view ? ` · ${label}` : ""}`
      : `${rows.length} albums, most recently active first`;

  return <section className="flex min-w-0 flex-col">
    <DashboardTableHeading title="Recent Albums" label={view ? label : null} onClear={onClearView} noun="albums" />
    <DataTableShell className="shadow-sm" footer={<TableFooter><span className="text-xs">{footerText}</span></TableFooter>}>
      {error
        ? <div className="p-3"><CardState error={error} onRetry={onRetry} /></div>
        : <DataTable
          columns={columns}
          data={shown}
          loading={loading}
          loadingMessage="Loading albums..."
          emptyMessage={view ? `No albums under ${label} right now.` : "No albums yet."}
          noMatchMessage="Nothing matches that search."
          getRowId={(row) => row.id}
          selectedRowId={selectedId || undefined}
          onRowClick={(row) => setSelectedId(row.id)}
          onRowDoubleClick={(row) => onOpen(row)}
          ariaLabel="Recent album proofs"
          // Fifteen rows tall, a maximum: the rest load as this pane is scrolled (see the Image
          // Selection dashboard's table for why it is a shade under sixteen).
          className="max-h-110"
          onVisibleRowsChange={setStats}
          features={{ filtering: true, sorting: true, infiniteScroll: { pageSize: 15 } }}
        />}
    </DataTableShell>
  </section>;
}
