"use client";

import { useMemo, useState } from "react";
import DataTable from "@/components/data-table/DataTable";
import DataTableShell from "@/components/data-table/DataTableShell";
import TableFooter from "@/components/data-table/TableFooter";
import { CardState } from "@/components/shared/DashboardCard";
import DashboardProgressBar from "@/components/shared/DashboardProgressBar";
import DashboardTableHeading from "@/components/shared/DashboardTableHeading";
import { formatCompact, relativeTime } from "@/lib/dashboardRange.mjs";
import { PROGRESS_COLORS } from "@/lib/progressStatus.mjs";
import { CULLING_GROUP_TONES, SIGNATURE_ALBUM_STATUS_LABELS, SIGNATURE_ALBUM_STATUS_TONES, cullingStatusLabel, rowsForView, stageDashboard, viewLabel } from "@/lib/stageDashboards.mjs";

/**
 * The rows under a stage dashboard's cards - culling runs, projects in editing, or albums - in the
 * same `DataTable` every module's dashboard table uses: the filter row, sorting, Table Options and
 * its Compact view, fifteen rows tall and scrolled for the rest. A card above narrows it (`view`),
 * the filter row narrows it further, and a double click opens the row's project on the stage's own
 * tab - only for a reader the Projects page itself would let in (`onOpen` is null otherwise).
 */
const percentColor = (percent) => (percent >= 100 ? PROGRESS_COLORS.completed : percent > 0 ? PROGRESS_COLORS.inProgress : PROGRESS_COLORS.notStarted);
const count = (value) => (value == null ? "—" : formatCompact(value));

const projectColumn = (header, title) => ({
  id: "project", header, width: 220,
  accessorFn: (row) => `${title(row) || ""} ${row.projectName || ""} ${row.projectCode || ""}`,
  cell: ({ row }) => <span className="block min-w-0">
    <span className="block truncate font-medium text-slate-800">{title(row.original)}</span>
    <span className="block truncate text-[10px] text-slate-400">{[row.original.projectCode, title(row.original) === row.original.projectName ? null : row.original.projectName].filter(Boolean).join(" · ")}</span>
  </span>,
});
const clientColumn = { id: "client", header: "Client", width: 150, accessorFn: (row) => row.clientName || "", cell: ({ row }) => row.original.clientName || "—" };
const activityColumn = (now) => ({ id: "activity", header: "Last Activity", width: 130, accessorFn: (row) => row.lastActivityAt || "", cell: ({ row }) => relativeTime(row.original.lastActivityAt, now) });

function columnsFor(stage, now) {
  if (stage === "culling") return [
    projectColumn("Project", (row) => row.projectName),
    { id: "shoot", header: "Shoot", width: 150, accessorFn: (row) => row.shootName || "Whole project", cell: ({ row }) => <span className={row.original.shootName ? "" : "text-slate-400"}>{row.original.shootName || "Whole project"}</span> },
    clientColumn,
    { id: "status", header: "Status", width: 170, accessorFn: (row) => cullingStatusLabel(row.status), cell: ({ row }) => <span className={`font-medium ${CULLING_GROUP_TONES[row.original.group] || ""}`} title={row.original.error || undefined}>{cullingStatusLabel(row.original.status)}</span> },
    { id: "progress", header: "Progress", width: 150, accessorFn: (row) => row.progressPercent ?? 0, cell: ({ row }) => <DashboardProgressBar percent={row.original.progressPercent} color={percentColor(row.original.progressPercent)} /> },
    { id: "photos", header: "Photos", width: 100, accessorFn: (row) => row.totalImages ?? 0, cell: ({ row }) => <span className="tabular-nums">{count(row.original.processedImages)} / {count(row.original.totalImages)}</span> },
    { id: "verdicts", header: "Kept · Maybe · Rejected", width: 170, accessorFn: (row) => row.keepCount ?? -1, cell: ({ row }) => row.original.keepCount == null ? <span className="text-slate-400">—</span> : <span className="tabular-nums">{count(row.original.keepCount)} · {count(row.original.maybeCount)} · {count(row.original.rejectCount)}</span> },
    activityColumn(now),
  ];
  if (stage === "editing") return [
    projectColumn("Project", (row) => row.projectName),
    clientColumn,
    { id: "photos", header: "Photos", width: 90, accessorFn: (row) => row.totalPhotos, cell: ({ row }) => <span className="tabular-nums">{count(row.original.totalPhotos)}</span> },
    { id: "edited", header: "Edited", width: 150, accessorFn: (row) => row.percentEdited, cell: ({ row }) => <DashboardProgressBar percent={row.original.percentEdited} color={percentColor(row.original.percentEdited)} /> },
    { id: "awaiting", header: "Awaiting", width: 90, accessorFn: (row) => row.awaitingEdit, cell: ({ row }) => <span className="tabular-nums">{count(row.original.awaitingEdit)}</span> },
    { id: "inProgress", header: "Rendering", width: 100, accessorFn: (row) => row.queued + row.rendering + row.waitingForDesktop, cell: ({ row }) => <span className="tabular-nums">{count(row.original.queued + row.original.rendering + row.original.waitingForDesktop)}</span> },
    { id: "failed", header: "Failed", width: 80, accessorFn: (row) => row.failed, cell: ({ row }) => <span className={`tabular-nums ${row.original.failed ? "font-medium text-rose-700" : ""}`}>{count(row.original.failed)}</span> },
    { id: "sent", header: "Sent to Selection · Album", width: 170, accessorFn: (row) => row.sentToPhotoSelection + row.sentToAlbum, cell: ({ row }) => <span className="tabular-nums">{count(row.original.sentToPhotoSelection)} · {count(row.original.sentToAlbum)}{row.original.albumSyncFailed ? <span className="ml-1 text-rose-700">({count(row.original.albumSyncFailed)} sync failed)</span> : null}</span> },
    activityColumn(now),
  ];
  return [
    projectColumn("Album", (row) => row.title || row.projectName),
    clientColumn,
    { id: "status", header: "Status", width: 150, accessorFn: (row) => SIGNATURE_ALBUM_STATUS_LABELS[row.status] || row.status, cell: ({ row }) => <span className="block min-w-0">
      <span className={`block font-medium ${SIGNATURE_ALBUM_STATUS_TONES[row.original.status] || ""}`}>{SIGNATURE_ALBUM_STATUS_LABELS[row.original.status] || row.original.status}</span>
      {row.original.blocker && <span className="block truncate text-[10px] text-slate-400">{row.original.blocker}</span>}
    </span> },
    { id: "photos", header: "Photos · Chapters", width: 130, accessorFn: (row) => row.photoCount, cell: ({ row }) => <span className="tabular-nums">{count(row.original.photoCount)} · {count(row.original.chapterCount)}</span> },
    { id: "expires", header: "Link Expires", width: 130, accessorFn: (row) => row.expiresAt || "", cell: ({ row }) => !row.original.expiresAt || row.original.status === "DRAFT" || row.original.status === "READY"
      ? <span className="text-slate-400">—</span>
      : <span className={row.original.status === "EXPIRED" ? "text-rose-700" : row.original.expiringSoon ? "font-medium text-amber-700" : ""}>{new Date(row.original.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span> },
    { id: "access", header: "Client Access", width: 150, accessorFn: (row) => `${row.requirePin ? "PIN" : "Open"} ${row.allowDownload ? "Download" : ""}`, cell: ({ row }) => <span className="text-slate-600">{row.original.requirePin ? "PIN" : "No PIN"} · {row.original.allowDownload ? "downloads on" : "downloads off"}</span> },
    activityColumn(now),
  ];
}

export default function StageDashboardTable({ stage, rows = [], view = null, onClearView, loading, error, onRetry, onOpen, now }) {
  const spec = stageDashboard(stage);
  const shown = useMemo(() => rowsForView(stage, rows, view), [stage, rows, view]);
  const label = viewLabel(stage, view);
  const [selectedId, setSelectedId] = useState(null);
  const [stats, setStats] = useState(null);
  const columns = useMemo(() => columnsFor(stage, now), [stage, now]);

  const matched = Math.min(stats?.total ?? shown.length, shown.length);
  const footerText = loading
    ? "Loading..."
    : matched !== rows.length
      ? `${matched} of ${rows.length} ${spec.noun}${view ? ` · ${label}` : ""}`
      : `${rows.length} ${spec.noun} · ${spec.note.toLowerCase()}${onOpen ? " · double-click a row to open it" : ""}`;

  return <section className="flex min-w-0 flex-col">
    <DashboardTableHeading title={spec.tableTitle} label={view ? label : null} onClear={onClearView} noun={spec.noun} />
    <DataTableShell className="shadow-sm" footer={<TableFooter><span className="text-xs">{footerText}</span></TableFooter>}>
      {error
        ? <div className="p-3"><CardState error={error} onRetry={onRetry} /></div>
        : <DataTable
          columns={columns}
          data={shown}
          loading={loading}
          loadingMessage={`Loading ${spec.noun}...`}
          emptyMessage={view ? `No ${spec.noun} under ${label} right now.` : `No ${spec.noun} yet.`}
          noMatchMessage="Nothing matches that search."
          getRowId={(row) => row.id}
          selectedRowId={selectedId || undefined}
          onRowClick={(row) => setSelectedId(row.id)}
          onRowDoubleClick={onOpen ? (row) => onOpen(row) : undefined}
          ariaLabel={spec.tableTitle}
          className="max-h-110"
          onVisibleRowsChange={setStats}
          features={{ filtering: true, sorting: true, infiniteScroll: { pageSize: 15 } }}
        />}
    </DataTableShell>
  </section>;
}
