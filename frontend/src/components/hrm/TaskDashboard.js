"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DataTable from "@/components/data-table/DataTable";
import DataTableShell from "@/components/data-table/DataTableShell";
import TableFooter from "@/components/data-table/TableFooter";
import { CardState, EmptyDashboard } from "@/components/shared/DashboardCard";
import DashboardMetricCards from "@/components/shared/DashboardMetricCards";
import DashboardRangeBar from "@/components/shared/DashboardRangeBar";
import DashboardTableHeading from "@/components/shared/DashboardTableHeading";
import useAutoRefresh from "@/components/shared/useAutoRefresh";
import { DEFAULT_RANGE, relativeTime } from "@/lib/dashboardRange.mjs";
import { REFRESH_INTERVALS } from "@/lib/refreshPolicy.mjs";
import { taskDashboardCaption, taskDashboardCards, taskViewLabel, tasksForCard } from "@/lib/taskDashboard.mjs";
import { taskStatusStyles } from "@/constants/taskConfig";
import { getTaskDashboard } from "@/services/hrm/tasks.service";

/**
 * HRM → Tasks → Dashboard, built from the same parts as Image Selection's: the range bar, the ten
 * metric cards with their arrows, and the Recent table they filter.
 *
 * One request paints it (`/api/hrm/tasks/dashboard`): the reader's own tasks - what is assigned to
 * them and what they gave - and, for a reader of All Tasks, a first row over everything that list
 * reaches. The cards are filters on the table below them; a row
 * opens the task itself (`onOpen`), on the Tasks page it came from. It keeps itself current
 * (`useAutoRefresh`) rather than offering a Refresh button, as Image Selection's does.
 */

const dateOnly = (value) => (value ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value)) : "—");

function StatusDot({ label }) {
  return <span className="inline-flex items-center gap-1.5">
    <span className={`h-2 w-2 shrink-0 rounded-full ${taskStatusStyles[label] || "bg-slate-400"}`} aria-hidden="true" />{label}
  </span>;
}

export default function TaskDashboard({ onOpen, onError }) {
  const [range, setRange] = useState(DEFAULT_RANGE);
  // The pressed card - what Recent Tasks is narrowed to. Null is every task.
  const [view, setView] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [selectedId, setSelectedId] = useState(null);
  const hasData = useRef(false);

  const load = useCallback(async ({ quiet = false } = {}) => {
    const silent = quiet && hasData.current;
    if (!silent) setLoading(true);
    setError("");
    try {
      const response = await getTaskDashboard({ range });
      setData(response?.data || null);
      hasData.current = true;
      setNow(new Date());
    } catch (caught) {
      const message = caught?.message || "Unable to load the task dashboard.";
      setError(message);
      if (hasData.current) onError?.(message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [onError, range]);

  useEffect(() => {
    const timer = setTimeout(() => void load({ quiet: true }), 0);
    return () => clearTimeout(timer);
  }, [load]);
  useAutoRefresh(load, { intervalMs: REFRESH_INTERVALS.tasks });

  const rows = useMemo(() => tasksForCard(data?.recentTasks, view), [data?.recentTasks, view]);
  const columns = useMemo(() => [
    // The ID a column of its own, so it reads, sorts and filters like the rest.
    { id: "taskCode", header: "Task ID", accessorFn: (row) => row.taskCode || "", width: 130 },
    { id: "task", header: "Task", accessorFn: (row) => row.title || "", width: 260, cell: ({ row }) => <span className="block truncate font-medium text-slate-800">{row.original.title}</span> },
    // Whose task it is, from the reader's side: assigned to them, given by them, or between others.
    { id: "side", header: "Who Given", accessorFn: (row) => ({ mine: "My Task", given: "Given" }[row.side] || "Studio"), width: 110 },
    { id: "assignedTo", header: "Assigned To", accessorFn: (row) => row.assignedToName || "", width: 160 },
    { id: "assignedBy", header: "Assigned By", accessorFn: (row) => row.assignedByName || "", width: 160 },
    // The holder's sent-back work reads Completed, as it does under My Tasks.
    { id: "status", header: "Status", accessorFn: (row) => (row.side === "mine" && row.status === "SUBMITTED" ? "Completed" : row.statusLabel), width: 160, cell: ({ getValue }) => <StatusDot label={getValue()} /> },
    { id: "due", header: "Due", accessorFn: (row) => row.dueOn || "", width: 110, cell: ({ row }) => dateOnly(row.original.dueOn) },
    { id: "activity", header: "Last Activity", accessorFn: (row) => row.lastActivityAt || "", width: 130, cell: ({ row }) => relativeTime(row.original.lastActivityAt, now) },
  ], [now]);

  const label = taskViewLabel(view);
  const total = data?.recentTasks?.length || 0;
  const footerText = loading ? "Loading..." : view ? `${rows.length} of ${total} tasks · ${label}` : `${total} tasks, most recently active first`;
  const isEmpty = !loading && !error && data && data.totalTasks === 0;

  return <div className="dashboard-canvas min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
    {error && !data
      ? <CardState error={error} onRetry={load} />
      : isEmpty
        ? <EmptyDashboard title="No tasks yet" message="Tasks assigned to you, and tasks you assign, are counted here." />
        : <>
          <DashboardRangeBar caption={taskDashboardCaption(data)} range={range} onRangeChange={setRange} />
          <DashboardMetricCards cards={taskDashboardCards(data?.summary)} summary={data?.summary} trend={data?.trend} rangeKey={data?.range?.key || range} loading={loading} view={view} onViewChange={setView} />
          <section className="mt-3 flex min-w-0 flex-col">
            <DashboardTableHeading title="Recent Tasks" label={view ? label : null} onClear={() => setView(null)} noun="tasks" />
            <DataTableShell className="shadow-sm" footer={<TableFooter><span className="text-xs">{footerText}</span></TableFooter>}>
              <DataTable
                columns={columns}
                data={rows}
                loading={loading}
                loadingMessage="Loading tasks..."
                emptyMessage={view ? `No tasks under ${label} right now.` : "No tasks yet."}
                noMatchMessage="Nothing matches that search."
                getRowId={(row) => row.id}
                selectedRowId={selectedId || undefined}
                onRowClick={(row) => setSelectedId(row.id)}
                onRowDoubleClick={(row) => onOpen?.(row)}
                ariaLabel="Recent tasks"
                className="max-h-110"
                features={{ filtering: true, sorting: true, infiniteScroll: { pageSize: 15 } }}
              />
            </DataTableShell>
          </section>
        </>}
  </div>;
}
