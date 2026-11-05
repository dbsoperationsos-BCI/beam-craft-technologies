"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import DataTable from "@/components/data-table/DataTable";
import useTableSelection from "@/components/data-table/useTableSelection";
import DataTableInfoPanel from "@/components/data-table/DataTableInfoPanel";
import DataTableShell from "@/components/data-table/DataTableShell";
import TableFooter from "@/components/data-table/TableFooter";
import { buildTableColumns, defaultVisibilityFor, displayValue } from "@/components/data-table/tableCells";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import useCompactView from "@/components/shared/useCompactView";
import useStickyTab from "@/components/shared/useStickyTab";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import DropdownMenu from "@/components/ui/DropdownMenu";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { usePermissions, useRouteAccess } from "@/components/auth/PermissionsProvider";
import TaskDetailPanel from "@/components/hrm/TaskDetailPanel";
import TaskDashboard from "@/components/hrm/TaskDashboard";
import KanbanBoard from "@/components/data-table/KanbanBoard";
import { columnCount } from "@/lib/kanbanSummary.mjs";
import TableBoardSwitch, { useTableBoardLayout } from "@/components/data-table/TableBoardSwitch";
import TaskFormPanel from "@/components/hrm/TaskFormPanel";
import { approveTask, completeTask, deleteTask, getAllTasks, getMyTasks, getTask, getTaskOptions, getTasksGiven, startTask } from "@/services/hrm/tasks.service";
import {
  ALL_STATUSES,
  OVERDUE,
  daysOverdue,
  DEFAULT_TASK_VIEW,
  TASK_PRIORITIES,
  TASK_STATUS_FILTERS,
  TASK_TYPES,
  OTHER_TASK_TYPE,
  TASK_VIEWS,
  taskDefaultHiddenColumns,
  taskInfoSections,
  taskIsClosed,
  taskStatusCounts,
  taskStatusStyles,
  taskTableFields,
  tasksForStatus,
  taskStatusFiltersFor,
  rowForView,
  taskTab,
} from "@/constants/taskConfig";

// A task's flow, left to right: waiting, being worked, sent back for approval, done - then the two
// it leaves by (passed to somebody else, called off).
const TASK_BOARD_ORDER = ["PENDING", "IN_PROGRESS", "SUBMITTED", "COMPLETED", "REASSIGNED", "CANCELLED"];
// The Board columns with nothing left to chase: no Overdue count under them, and no Overdue tag on their cards.
const CLOSED_TASK_COLUMNS = ["COMPLETED", "CANCELLED", "SUBMITTED", "REASSIGNED"];

/**
 * Tasks: what the studio has asked of you, what you have asked of it, and — for the people who may
 * see it — everything either way round.
 *
 * Laid out the way Payment Requests beside it is, and for the same reason: a module header, a table
 * shell filling the rest of the page, and the info panel beside the table inside it. The views are
 * a dropdown beside the heading and the statuses are the header's tab row, because they are two
 * different questions — whose task is this, and where has it got to — and folding them into one bar
 * of fifteen entries would have made both harder to read.
 *
 * The three views are three endpoints rather than one filtered here. My Tasks and Tasks Given are
 * already scoped to the person asking; All Tasks is the whole studio's list behind its own
 * permission, and giving it a tab over a shared endpoint would have served everybody every task and
 * left the tab as decoration.
 */

// What the page offers before the options endpoint answers, and if it never does. `OTHER_TASK_TYPE`
// is what asked for a description before which types ask became a flag on the row.
const emptyOptions = { users: [], taskTypes: TASK_TYPES, taskTypesAskingForDetails: [OTHER_TASK_TYPE], priorities: TASK_PRIORITIES, departments: [], branches: [] };

function errorMessage(error, fallback) {
  if (error?.status === 401) return "Your session has expired. Please sign in again.";
  return error?.data?.message || error?.message || fallback;
}

export default function TasksPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // HRM / Task Management. READ reads the screen; READ_WRITE is what giving a task, completing one
  // and sending one back all need.
  const { canWrite } = useRouteAccess();
  /*
   * A view is offered only where its own permission is held. Reading the whole studio's list is its
   * own permission on its own endpoint, so the All Tasks tab is shown only to somebody the API will
   * actually answer — a tab that opened onto a refusal would be worse than no tab.
   *
   * Asked of the permission each view names rather than of All Tasks by name, so a second gated
   * view added to the config is gated by its own row and not by this one's. An empty `views` is not
   * reachable: only All Tasks carries a permission, so every reader keeps My Tasks and Tasks Given.
   */
  const { hasPermission } = usePermissions();
  const views = useMemo(
    () => TASK_VIEWS.filter((view) => !view.permission || hasPermission(view.permission.module, view.permission.feature, "READ")),
    [hasPermission],
  );

  // Opens on My Tasks whatever order the list is in: All Tasks leads it, but most roles do not
  // hold it, and the screen has to open on the one view everybody has.
  const [activeView, setActiveView] = useStickyTab("hrm-tasks-view", DEFAULT_TASK_VIEW, TASK_VIEWS.map((view) => view.id));
  /*
   * The status is remembered across a reload too, under its own key.
   *
   * Both halves of the question have to survive: somebody working through Pending in My Tasks
   * reloads to see what has moved, and coming back to the whole list is exactly the wrong answer —
   * it is the case `useStickyTab` was written for. Kept separate from the view's key so the two are
   * remembered independently; a status is a filter across whichever list is open, not a property of
   * one of them.
   */
  const [statusFilter, setStatusFilter] = useStickyTab("hrm-tasks-status", ALL_STATUSES, TASK_STATUS_FILTERS.map((filter) => filter.id));
  const [tasks, setTasks] = useState([]);
  const [options, setOptions] = useState(emptyOptions);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [infiniteStats, setInfiniteStats] = useState({ total: 0, showing: 0 });
  const [infoTask, setInfoTask] = useState(null);
  const [infoPanelState, setInfoPanelState] = useState("collapsed");
  const [detailTask, setDetailTask] = useState(null);
  const [assigning, setAssigning] = useState(false);
  /*
   * The task the form is open on, and which job it is doing: `{ task, mode }` for an edit or a
   * duplicate, null for a new one.
   *
   * One piece of state rather than two booleans, because the two cannot both be true and holding
   * them apart is how a form ends up open in edit mode on a task it is duplicating.
   */
  const [formTask, setFormTask] = useState(null);
  const { notice, showNotice, showSuccess, showError, clearNotice } = useNotice();
  const { density } = useCompactView();

  /*
   * A view the reader may not open falls back to their own tasks.
   *
   * `useStickyTab` remembers the last view across visits, so somebody who loses the All Tasks
   * permission — or who shares a browser with somebody who has it — would otherwise return to a
   * view that is no longer listed and see an empty table with nothing chosen in the dropdown.
   */
  const view = views.find((entry) => entry.id === activeView) || views[0];
  // The tag on a Board card its column's Overdue count includes, with how late it is; the count is these cards.
  const overdueFlag = (task, column) => {
    if (CLOSED_TASK_COLUMNS.includes(column.value)) return "";
    const late = daysOverdue(task, view?.id);
    return late > 0 ? `Overdue ${late} ${late === 1 ? "day" : "days"}` : "";
  };
  useEffect(() => {
    if (view && view.id !== activeView) setActiveView(view.id);
  }, [activeView, setActiveView, view]);

  const load = useCallback(async () => {
    // The Dashboard reads its own endpoint; there is no list to fetch behind it.
    if (!view || view.dashboard) return;
    setLoading(true);
    try {
      /*
       * The whole view, whatever status is being looked at.
       *
       * The status used to be sent to the server so a long list was narrowed before it was sent.
       * That is why the status tabs could not count: the browser only ever held the one status it
       * was showing, so every other tab had nothing to count and showed nothing. Nothing is saved by
       * it either — this endpoint does not paginate, so the All tab was already fetching every task
       * in the view — and asking again on each tab made switching a round trip for rows that were
       * about to be thrown away.
       *
       * So it is fetched once per view and filtered below. The counts fall out of it, and moving
       * between statuses stops touching the network at all.
       */
      const fetcher = view.id === "all" ? getAllTasks : view.id === "given" ? getTasksGiven : getMyTasks;
      const result = await fetcher("");
      setTasks(Array.isArray(result?.data) ? result.data : []);
      setLastUpdated(new Date());
    } catch (loadError) {
      setTasks([]);
      showError(errorMessage(loadError, "Unable to load tasks."));
    } finally {
      setLoading(false);
    }
  }, [showError, view]);

  // Deferred a tick so the first render is not the one that flips the table into loading.
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  /*
   * The people a task can be given to, fetched only for somebody who may give one. A read-only
   * viewer never opens the form, and firing the call anyway would report its own refusal as an
   * error on a screen that is working exactly as granted.
   */
  useEffect(() => {
    if (!canWrite) return undefined;
    const timer = window.setTimeout(() => {
      void getTaskOptions()
        .then((result) => setOptions({ ...emptyOptions, ...(result?.data || {}) }))
        .catch(() => setOptions(emptyOptions));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [canWrite]);

  /*
   * The bell's link: `/hrm/tasks?task=123` opens that task the moment the page arrives.
   *
   * Read through its own endpoint rather than looked up in `tasks`, because the notice may well be
   * about a task the current view does not hold — one you gave, opened from My Tasks. The parameter
   * is dropped once it has been used, so reloading the page does not reopen a panel somebody closed.
   */
  const deepLinkId = searchParams.get("task");
  useEffect(() => {
    if (!deepLinkId) return undefined;
    const timer = window.setTimeout(() => {
      void getTask(deepLinkId)
        .then((result) => { if (result?.data) setDetailTask(result.data); })
        .catch((linkError) => showError(errorMessage(linkError, "That task could not be opened.")))
        .finally(() => router.replace("/hrm/tasks", { scroll: false }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [deepLinkId, router, showError]);

  /*
   * The task a Delete is being confirmed for, and whether that delete is in flight.
   *
   * The task itself rather than its id, because the dialog names it - "Delete DBS-TK-00042?" is a
   * question somebody can answer, and "Delete this task?" over a list of forty is not.
   */
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  /**
   * Starting or completing a task straight from its row menu — the two verbs that need nothing
   * typed. Memoised because the row menus close over it, so a new function each render would make
   * every column definition new each render too.
   */
  const act = useCallback(async (task, action) => {
    try {
      const response = await ({ start: startTask, complete: completeTask, approve: approveTask })[action](task.id);
      showSuccess(action === "start" ? `${task.taskCode} is now in progress.`
        : action === "complete" && task.completeSendsBack ? `${task.taskCode} finished and sent back to ${task.assignedByName}.`
          : `${task.taskCode} marked as completed.`);
      // The info panel beside the table holds a snapshot, so it is replaced rather than left
      // showing the status the task had a moment ago.
      if (response?.data) setInfoTask((current) => current?.id === task.id ? response.data : current);
      await load();
    } catch (actionError) {
      showError(errorMessage(actionError, "Unable to update that task."));
    }
  }, [load, showError, showSuccess]);

  // What the open tab shows, and how many sit behind each of them. Both read the whole view — see
  // `tasksForStatus` and `taskStatusCounts`, which is where the reasoning for filtering here rather
  // than at the server lives.
  // The tabs this view offers; a remembered tab the view does not have reads as All.
  const statusFilters = useMemo(() => taskStatusFiltersFor(view?.id), [view?.id]);
  const shownFilter = statusFilters.some((filter) => filter.id === statusFilter) ? statusFilter : ALL_STATUSES;
  const visibleTasks = useMemo(() => tasksForStatus(tasks, shownFilter, view?.id).map((task) => rowForView(task, view?.id)), [shownFilter, tasks, view?.id]);
  /*
   * The tick boxes, for a role holding `ADMIN / Table Select All`.
   *
   * `canDelete` is the screen's own Read / Write. Which *tasks* then go is still the service's
   * decision per task - the giver, or a Super Admin - so a selection reaching across somebody
   * else's work loses only the part that was this person's to delete and keeps the rest ticked.
   */
  const bulk = useTableSelection({
    prefix: "/api/hrm/tasks",
    rows: visibleTasks,
    noun: "task",
    canDelete: canWrite,
    showSuccess,
    showError,
    onDeleted: () => load(),
  });
  const statusCounts = useMemo(() => taskStatusCounts(tasks, view?.id), [tasks, view?.id]);

  /*
   * The Board: the same view's tasks in a column per status tab, in the tab order. A card opens the
   * task; dropping one runs the same action its ⋮ menu would, and only where the task offers it -
   * Start, Finish & Send Back, Mark as Completed - or opens the task where that action asks
   * something first (Reassign, Revoke, Cancel).
   */
  const [layout, setLayout] = useTableBoardLayout("hrm-tasks");
  const onBoard = layout === "board" && !view?.dashboard;
  // Overdue is an overlay over the statuses, not a column a card could sit in or be dropped on. The
  // columns run in a task's own flow (`TASK_BOARD_ORDER`), not the tabs' order.
  const boardColumns = useMemo(() => statusFilters.filter((filter) => filter.id !== ALL_STATUSES && filter.id !== OVERDUE)
    .sort((a, b) => TASK_BOARD_ORDER.indexOf(a.id) - TASK_BOARD_ORDER.indexOf(b.id)).map((filter) => ({
    value: filter.id,
    label: filter.label,
    className: `${taskStatusStyles[filter.label] || "bg-slate-400"} text-white`,
  })), [statusFilters]);
  const boardRows = useMemo(() => tasks.map((task) => rowForView(task, view?.id)), [tasks, view?.id]);
  const boardStatusOf = useCallback((task) => taskTab(task, view?.id), [view?.id]);
  const canDropAt = useCallback((task, to) => {
    if (!canWrite) return false;
    if (to === "IN_PROGRESS") return task.canStart;
    if (to === "SUBMITTED") return task.canComplete && task.completeSendsBack;
    if (to === "COMPLETED") return task.canApprove || task.canComplete;
    if (to === "REASSIGNED") return task.canReassign;
    if (to === "PENDING") return task.canRevoke;
    if (to === "CANCELLED") return task.canCancel;
    return false;
  }, [canWrite]);
  const dropTask = useCallback((task, to) => {
    if (to === "IN_PROGRESS") return void act(task, "start");
    if (to === "SUBMITTED" || (to === "COMPLETED" && task.canComplete)) return void act(task, "complete");
    if (to === "COMPLETED") return void act(task, "approve");
    // Reassigning, revoking and cancelling ask who or why, so the task opens on its own buttons.
    return setDetailTask(task);
  }, [act]);

  const defaultVisibility = useMemo(() => {
    const visibility = defaultVisibilityFor(taskTableFields);
    for (const hidden of taskDefaultHiddenColumns) visibility[hidden] = false;
    return visibility;
  }, []);

  /*
   * One task's ⋮ - the table row's and the Board card's, so the two never drift. What a row offers
   * is the server's answer per task, not a guess from who is signed in: whoever holds it gets
   * Start, Reassign and - once started - Mark Complete, whoever set it gets Cancel, and a
   * supervisor reading through All Tasks gets neither because neither is theirs.
   *
   * Without `canWrite` the whole menu goes, and the table's column with it, rather than a ⋮ that
   * only ever says "View" beside a row you can already double-click.
   */
  const taskActionItems = useCallback((task) => {
    if (!canWrite) return undefined;
    const items = [{ label: "View", onSelect: () => setDetailTask(task) }];
    // Only the two verbs that need nothing typed act from the menu. Reassigning needs a person
    // and a reason and cancelling needs a reason, so they open the panel that can ask. No trailing
    // ellipsis on any entry: the studio reads "…" after a label as a stray third dot beside the ⋮.
    if (task.canStart) items.push({ label: "Start", onSelect: () => void act(task, "start") });
    // The holder finishes and sends it back to whoever assigned it; the assigner then marks it completed.
    if (task.canComplete) items.push({ label: task.completeSendsBack ? "Finish & Send Back" : "Mark as Completed", onSelect: () => void act(task, "complete") });
    if (task.canApprove) items.push({ label: "Mark as Completed", onSelect: () => void act(task, "approve") });
    // Revoking asks who it goes to next, so it opens the task and its dialog.
    if (task.canRevoke) items.push({ label: "Revoke Task", onSelect: () => setDetailTask(task) });
    // Reassigning asks for a person and a reason, and cancelling asks for a reason, so both open
    // the task rather than acting from the menu. Reassigning is not a danger action — it keeps the
    // work moving — so only cancelling is toned as one.
    if (task.canReassign) items.push({ label: "Reassign", onSelect: () => setDetailTask(task) });
    /*
     * Delete asks nothing but "are you sure", so it acts from the menu behind a confirmation
     * rather than opening the panel the way Reassign and Cancel do. Last in the list and toned as
     * a danger: it is the one entry here that takes the task off every list in the studio.
     */
    /*
     * Correcting what the task says, for whoever wrote it down - the giver, or a Super Admin.
     * `canEdit` is the server's own answer, from the same function the write path refuses with,
     * so the menu cannot offer an Edit that would then be turned down. The receiver is not among
     * them: they act on a task through the verbs above, not by rewriting what they were asked.
     */
    if (task.canEdit) items.push({ label: "Edit Task", onSelect: () => setFormTask({ task, mode: "edit" }) });
    /*
     * Duplicating is a create that starts from this task, which is what the studio does with
     * anything recurring. Offered to anybody who may raise a task at all rather than only to the
     * giver - the copy is theirs, and it takes nothing away from the original. Only on a task
     * written by hand: one raised from a speak-up or a feedback issue says `canDuplicate: false`.
     */
    if (canWrite && task.canDuplicate) items.push({ label: "Duplicate Task", onSelect: () => setFormTask({ task, mode: "duplicate" }) });
    // The two that end a task come last, Cancel then Delete: View, Edit Task, Cancel Task, Delete
    // Task is the order the studio reads Tasks Given in.
    if (task.canCancel) items.push({ label: "Cancel Task", tone: "danger", onSelect: () => setDetailTask(task) });
    if (task.canDelete) items.push({ label: "Delete Task", tone: "danger", onSelect: () => setPendingDelete(task) });
    return items;
  }, [act, canWrite]);

  const columns = useMemo(() => buildTableColumns({
    fields: taskTableFields,
    statusStyles: taskStatusStyles,
    // The ⋮ is `taskActionItems` - the Board card offers the same.
    renderActions: canWrite ? (task) => <OptionsMenu ariaLabel={`Actions for ${task.taskCode || "task"}`} items={taskActionItems(task)} /> : undefined,
  }).map((column) => (column.accessorKey === "dueOn" ? {
    ...column,
    // A due day that has passed on work still owed reads in red with how late it is, under every
    // tab - not only under Overdue.
    cell: ({ row }) => {
      const late = daysOverdue(row.original, view?.id);
      if (!late) return column.cell({ getValue: () => row.original.dueOn });
      return <span className="font-medium text-red-600" title={`${late} ${late === 1 ? "day" : "days"} past its due date`}>{displayValue(row.original.dueOn, "date")} · {late} {late === 1 ? "day" : "days"} late</span>;
    },
  } : column)), [canWrite, taskActionItems, view?.id]);

  const updatedText = lastUpdated ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(lastUpdated) : "—";

  function openInfoPanel(task) {
    setInfoTask(task);
    setInfoPanelState("expanded");
  }

  const toggleInfoPanel = () => setInfoPanelState((current) => current === "expanded" ? "collapsed" : "expanded");

  /**
   * The open task, re-read from the server.
   *
   * For the changes that are not one of the four verbs - a file attached or removed - where the
   * panel has no updated record handed back to it and the list behind it does not change. Read
   * through the task's own endpoint rather than from `tasks`, which carries the row as the list
   * fetched it and would put back the attachments the panel has just changed.
   */
  async function refreshDetail() {
    if (!detailTask) return;
    try {
      const result = await getTask(detailTask.id);
      if (result?.data) {
        setDetailTask(result.data);
        if (infoTask?.id === result.data.id) setInfoTask(result.data);
      }
    } catch (refreshError) {
      showError(errorMessage(refreshError, "Unable to re-read that task."));
    }
  }

  /**
   * A task that has just changed: the list behind it is re-read, and the panel either follows it or
   * gets out of the way.
   *
   * **A verb that ends the task closes the panel.** Completing, rolling back and cancelling all
   * leave a record with nothing anybody can do to it — the footer empties, and the reader is left
   * looking at a finished task with no way on but the ×, which is what made the confirmation
   * dialogs feel like they had not worked. The list underneath is where they were going, and it has
   * just been refreshed with the answer.
   *
   * **Start keeps it open**, because that verb does not finish anything: the task is now in
   * progress, Mark Complete has appeared in the same footer, and it is quite often the next thing
   * pressed.
   */
  /**
   * Deleting the task the confirmation names.
   *
   * Everything showing that task goes with it: the panel if it is open on it, the info panel's
   * snapshot beside the table, and the row itself once the list is re-read. A soft delete on the
   * server, so nothing here promises the record is gone for good - it says the task was deleted,
   * which is what the reader did.
   */
  async function confirmDelete() {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try {
      await deleteTask(pendingDelete.id);
      const code = pendingDelete.taskCode || "That task";
      setDetailTask((current) => current?.id === pendingDelete.id ? null : current);
      setInfoTask((current) => current?.id === pendingDelete.id ? null : current);
      setPendingDelete(null);
      showSuccess(`${code} deleted.`);
      await load();
    } catch (deleteError) {
      showError(errorMessage(deleteError, "Unable to delete that task."));
    } finally {
      setDeleting(false);
    }
  }

  async function afterChange(updated, message) {
    if (updated) {
      setDetailTask(taskIsClosed(updated) ? null : updated);
      if (infoTask?.id === updated.id) setInfoTask(updated);
    }
    showSuccess(message);
    await load();
  }

  return (
    <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
      {/* Which list you are reading is the dropdown beside the heading, the way Client Gifts picks
          its gift and CRD Documents its vertical, and no longer a tab bar. The two questions the
          screen asks are not the same shape: the view is one of three named lists and reads as a
          setting on the page, while the status is a filter across whichever list is open. Giving
          each a tab bar, stacked one above the other, made the top of the page two near-identical
          rows and left the reader working out which was which before either could be used. With the
          views out of the row, the statuses take it and read as the only filter here. */}
      <ModulePageHeader
        title="Tasks"
        // The divider only where the view switch sits beside the title, not when it wraps under it.
        titleAddon={<div className="sm:border-l sm:border-slate-200 sm:pl-3"><DropdownMenu ariaLabel="Task view" items={views.map((entry) => ({ label: entry.label, value: entry.id }))} value={view?.id} onChange={setActiveView} sorted={false} /></div>}
        // The Dashboard's cards are its filters, so it carries no status tabs.
        tabs={view?.dashboard || layout === "board" ? undefined : statusFilters.map((filter) => ({ id: filter.id, label: filter.label, count: statusCounts[filter.id] || 0 }))}
        tabValue={shownFilter}
        onTabChange={setStatusFilter}
        tabsAriaLabel="Filter tasks by status"
        /*
         * "Assign Task" in words on every screen - the header sizes its buttons compactly on a phone,
         * and it never shrinks or wraps; on the narrowest phone it drops below the title rather than
         * squeezing. No `aria-label`: `globals.css` squares every header button that carries one into
         * a 36px icon button (`.module-page-header-actions button[aria-label]`).
         */
        actions={<>
          {!view?.dashboard && <TableBoardSwitch value={layout} onChange={setLayout} />}
          {canWrite && <Button type="button" variant="primary" onClick={() => setAssigning(true)} className="shrink-0 whitespace-nowrap">Assign Task</Button>}
        </>}
      />

      <FloatingNotice notice={notice} onClose={clearNotice} />

      {/* A row double-clicked on the Dashboard opens that task here, through the bell's own link. */}
      {view?.dashboard ? <TaskDashboard onOpen={(row) => router.replace(`/hrm/tasks?task=${row.id}`, { scroll: false })} onError={showError} /> : onBoard ? <KanbanBoard
        rows={boardRows}
        columns={boardColumns}
        statusOf={boardStatusOf}
        // Under each open column: how many of its tasks are past their due day. A finished column has none to chase.
        columnAmount={(rows, column) => (CLOSED_TASK_COLUMNS.includes(column.value) ? null : columnCount(rows, (task) => Boolean(overdueFlag(task, column)), "Overdue"))}
        cardFlag={overdueFlag}
        card={{ title: (task) => task.title, subtitle: (task) => `${task.taskCode} · ${task.assignedToName}`, meta: (task) => [task.priorityLabel, task.dueOn ? `Due ${String(task.dueOn).slice(0, 10)}` : ""].filter(Boolean).join(" · ") }}
        onOpen={setDetailTask}
        // The card's ⋮ is the row's ⋮.
        cardActions={taskActionItems}
        canDropAt={canDropAt}
        onDrop={dropTask}
        loading={loading}
        noun="tasks"
        ariaLabel="Tasks board"
      /> : <DataTableShell className="min-h-0 flex-1" footer={<TableFooter spread className="z-30">
        <span>Last updated: {updatedText}</span>
        <span>Total rows: {infiniteStats.total}</span>
      </TableFooter>}>
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-1">
            <DataTable
              // Keyed on both, so switching view or status draws a fresh table rather than
              // scrolling the previous one's rows.
              key={`${view?.id}-${shownFilter}`}
              columns={columns}
              data={visibleTasks}
              density={density}
              loading={loading}
              loadingMessage="Loading tasks..."
              emptyMessage={shownFilter === ALL_STATUSES ? (view?.emptyMessage || "No tasks yet.") : "No tasks with that status."}
              noMatchMessage="No matching tasks found."
              selectedRowId={infoTask?.id}
              onRowClick={openInfoPanel}
              onRowDoubleClick={setDetailTask}
              defaultColumnVisibility={defaultVisibility}
              onVisibleRowsChange={setInfiniteStats}
              ariaLabel="Tasks table"
              // One DataTable serving three logically different tables, so the column order each is
              // remembered under is named rather than taken from the shared aria label.
              columnOrderKey="hrm-tasks"
              features={{
                filtering: true,
                sorting: true,
                columnVisibility: true,
                columnResize: true,
                infiniteScroll: { pageSize: 50 },
                csvExport: { enabled: true, fileName: "tasks", onResult: (exported) => showNotice(exported ? "Tasks CSV export downloaded." : "No rows available to export.") },
                selection: bulk.selection,
              }}
            />
          </div>
          <DataTableInfoPanel
            title="Info"
            entity={infoTask}
            sections={taskInfoSections}
            emptyText="Select a task to view details."
            state={infoPanelState}
            onToggle={toggleInfoPanel}
          />
        </div>
      </DataTableShell>}

      {/* Opened by the row menu, by a double-click and by the bell's link, so it takes `canWrite`
          as a prop rather than relying on the control that opened it having been hidden. */}
      {detailTask && <TaskDetailPanel
        task={detailTask}
        canWrite={canWrite}
        // The same list Assign Task picks from, already loaded for this page — reassigning is
        // giving the task to somebody else, so it chooses from exactly the same people.
        assignableUsers={options.users}
        onClose={() => setDetailTask(null)}
        onChanged={afterChange}
        onError={showError}
        onNotice={showSuccess}
        onRefresh={refreshDetail}
        onDelete={setPendingDelete}
      />}

      {/* One confirmation for both ways in - the row menu and the panel's own button - so the
          question is worded once and the delete happens in one place. */}
      {pendingDelete && <ConfirmDialog
        title={`Delete ${pendingDelete.taskCode || "this task"}?`}
        message={`"${pendingDelete.title}" is removed from My Tasks, Tasks Given and All Tasks, for ${pendingDelete.assignedToName} as well as for you. Its history is kept, so it can be brought back.`}
        confirmLabel="Delete Task"
        busyLabel="Deleting..."
        loading={deleting}
        // Above the detail panel, since it can be opened from the panel's own footer.
        layer="dialogOverPanel"
        onCancel={() => { if (!deleting) setPendingDelete(null); }}
        onConfirm={() => void confirmDelete()}
      />}

      {(assigning || formTask) && <TaskFormPanel
        /*
         * Keyed by what it is open on, so switching from one task to another remounts it. The form
         * seeds its values once on mount rather than syncing them, which is what keeps an edit from
         * overwriting what has been typed - and that only holds if a different task is a different
         * mount.
         */
        key={formTask ? `${formTask.mode}-${formTask.task.id}` : "new-task"}
        task={formTask?.task || null}
        mode={formTask?.mode || "create"}
        users={options.users}
        taskTypes={options.taskTypes}
        taskTypesAskingForDetails={options.taskTypesAskingForDetails}
        priorities={options.priorities}
        departments={options.departments}
        branches={options.branches}
        onClose={() => { setAssigning(false); setFormTask(null); }}
        onCreated={async (created, message) => {
          setAssigning(false);
          setFormTask(null);
          showSuccess(message);
          await load();
        }}
      />}
    </section>
  );
}
