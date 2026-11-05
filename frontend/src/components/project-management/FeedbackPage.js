"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DataTable from "@/components/data-table/DataTable";
import DataTableShell from "@/components/data-table/DataTableShell";
import KanbanBoard from "@/components/data-table/KanbanBoard";
import TableBoardSwitch, { useTableBoardLayout } from "@/components/data-table/TableBoardSwitch";
import DataTableInfoPanel from "@/components/data-table/DataTableInfoPanel";
import RecordViewPanel from "@/components/data-table/RecordViewPanel";
import TableFooter from "@/components/data-table/TableFooter";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import { useModuleAccess, useRouteAccess } from "@/components/auth/PermissionsProvider";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import useCompactView from "@/components/shared/useCompactView";
import useStickyTab from "@/components/shared/useStickyTab";
import TextAreaField from "@/components/shared/TextAreaField";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { feedbackRecordFor } from "@/lib/feedbackRecord.mjs";
import { countFeedbackGroups, groupFeedbackRows, groupedFeedbackOf } from "@/lib/feedbackGroups.mjs";
import { DEFAULT_FEEDBACK_STATUS, FEEDBACK_ISSUE_OUTCOMES, FEEDBACK_STATUSES, feedbackStatusOf } from "@/constants/feedbackConfig";
import { sortableValue } from "@/components/data-table/tableCells";
import FeedbackFormPanel from "@/components/project-management/FeedbackFormPanel";
import FeedbackBulkDialog from "@/components/project-management/FeedbackBulkDialog";
import useTableSelection from "@/components/data-table/useTableSelection";
import FeedbackMessageDialog from "@/components/project-management/FeedbackMessageDialog";
import { feedbackTemplateKey } from "@/lib/feedbackMessage.mjs";
import { columnCount, daysSince } from "@/lib/kanbanSummary.mjs";
import { createProjectFeedback, createProjectFeedbackMany, getPendingFeedbackProjects, getProjectFeedback, setFeedbackIssueStatus } from "@/services/project-management/feedback.service";

// Rows per Give Feedback request over a selection - the server takes at most 500 at a time.
const FEEDBACK_BATCH = 500;

/*
 * Project Management → Customer Issues and Feedback: the projects waiting for their New Project
 * Feedback, and the reviews given on each.
 *
 * **Every project created in Bookings & Converted (Create Project) waits on Yet to be done**
 * (`GET /feedback/pending`) until its New Project Feedback is given, and **so does every shoot
 * Production completes**, for a Shoot Completion Feedback of its own - each a row, with its Shoot ID -
 * and once Production has completed all of a project's shoots, each has its feedback and the project
 * is Delivered - under Projects → Completed - **the project waits again** for its Overall Feedback.
 * Such a row has no review; a writer's Give Feedback in its ⋮ menu opens the form for that project
 * or shoot - there is no page-level Add Feedback and nothing to pick - and the saved feedback
 * replaces the row. Give
 * Feedback is offered only to somebody holding PROJECT / Feedback at Read & Write - absent, not
 * disabled, for a reader - and the server checks the same permission again when it is saved.
 *
 * Feedback was once asked for in further stages - Production Completion, then Project Completed
 * Feedback. Those were removed; the feedback they left is still listed, its stage in the Feedback
 * Stage column.
 *
 * The list holds the reader's own feedback, or everybody's with the `PROJECT / View All Feedback`
 * action permission. The server decides which rows come back; the page only says which it is.
 *
 * A row is read back two ways, the way every table here does: a click shows it in the info panel
 * beside the table, a double-click (or View in its ⋮ menu) opens it in full (`RecordViewPanel`). Both
 * draw the whole project's feedback (`feedbackRecordFor`). Neither edits - feedback, once given, is read.
 *
 * The status bar in the header splits the list by where each feedback has got to - Yet to be done,
 * Issues, Issues sorted, Completed, Rejected - with a count on each, and remembers the tab chosen.
 * The bar opens on Yet to be done. A feedback is filed by its review the moment it is given -
 * Excellent and Good are Completed, Average and Poor are Issues (the server's `STATUS_FOR_REVIEW`) -
 * and the bar moves to where it went, with the message to send the client open over it
 * (`FeedbackMessageDialog`): a thank-you asking for a review and a follow, or word that the team will
 * sort the issues out.
 *
 * An Average or Poor review is given to somebody as a task, and answered by them from their Tasks. A
 * feedback under Issues with no tasks is moved on from its ⋮ menu - Issues sorted, or Rejected - by a
 * writer, after a confirmation, and leaves the Issues tab for the one it went to.
 */
const feedbackColumns = [
  // DBS-FB-00001-01 - the project's Feedback ID and this feedback's version - given when saved; none while waiting.
  { id: "feedbackCode", label: "Feedback ID" },
  // How many of the project's feedbacks the tab holds, on its row; the ones folded under it are blank.
  { id: "versionCount", label: "Versions", type: "number", width: 110 },
  // Which of the project's feedbacks the row is: New Project Feedback, or a later stage given before those were removed.
  { id: "stageLabel", label: "Feedback Stage" },
  { id: "projectName", label: "Project" },
  { id: "eventId", label: "Event ID" },
  // A Shoot Completion Feedback's shoot; a project's own feedback has none.
  { id: "shootCode", label: "Shoot ID" },
  // The project's main event date, as the project screens label it.
  { id: "eventDate", label: "Event Date", type: "date" },
  { id: "review", label: "Review" },
  { id: "feedback", label: "Feedback", width: 320 },
  { id: "givenBy", label: "Given By" },
  { id: "createdAt", label: "Given On", type: "date" },
  // Only on Issues sorted and Rejected - the remark given when it was moved there.
  { id: "issueRemarks", label: "Remarks", width: 280, outcomeOnly: true },
  { id: "actions", label: "Actions", fixed: true, sortable: false, filterable: false },
];

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });
const updatedFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

const REMARKS_MAX_LENGTH = 1000;

/*
 * The Board: a column per status, in the bar's order, each holding what that tab would - a
 * project's feedbacks folded into one card on every column but Yet to be done. A card opens the
 * feedback, as a double-click does. The only status a person moves a feedback to is from Issues - to
 * Issues sorted or Rejected, from its ⋮ - so those are the only drops, and they open the same
 * confirmation with its remarks. A review files itself on Completed or Issues when it is given, so
 * Yet to be done takes no drop to either.
 */
const BOARD_COLUMNS = FEEDBACK_STATUSES.map((label) => ({ value: label, label }));
const BOARD_CARD = {
  title: (row) => row.projectName || row.eventId || "Feedback",
  subtitle: (row) => [row.feedbackCode || row.eventId, row.shootCode, row.givenBy].filter(Boolean).join(" · "),
  meta: (row) => [row.stageLabel, row.review && !row.pending ? row.review : ""].filter(Boolean).join(" · "),
};

// The columns still waiting on somebody: feedback not given yet, and issues not yet answered.
const OPEN_FEEDBACK_COLUMNS = [DEFAULT_FEEDBACK_STATUS, "Issues"];

// Only a project or shoot still waiting for feedback can be ticked - a feedback given is not given again.
const waitingRow = (row) => Boolean(row?.pending);
// The board's trend counts a feedback by the day it was given; one still waiting, by its shoot's date (else the event date).
const feedbackDateOf = (row) => {
  const time = new Date(row.createdAt || row.shootDate || row.eventDate || "").getTime();
  return Number.isNaN(time) ? null : time;
};
// One rule for the tag and the count: more than 7 days by the board's own date, on the open columns only.
const WAITING_DAYS = 7;
const feedbackFlag = (row, column) => {
  if (!OPEN_FEEDBACK_COLUMNS.includes(column.value)) return "";
  const days = daysSince(feedbackDateOf(row));
  return days !== null && days > WAITING_DAYS ? `Waiting ${days} days` : "";
};
const feedbackColumnFigure = (rows, column) => (OPEN_FEEDBACK_COLUMNS.includes(column.value)
  ? columnCount(rows, (row) => Boolean(feedbackFlag(row, column)), `Waiting ${WAITING_DAYS}+ days`, `Cards in this column waiting more than ${WAITING_DAYS} days`) : null);

/** The rows a tab shows: one per project where its feedbacks are folded together (`shownRows`). */
const tabCount = (onTab, label) => (label === DEFAULT_FEEDBACK_STATUS ? onTab.length : countFeedbackGroups(onTab));

function displayValue(row, column) {
  // A project still waiting says so where its review would be, rather than leaving a bare dash.
  if (row.pending && column.id === "review") return "Not given yet";
  const value = row[column.id];
  if (column.type === "date") {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? dateFormat.format(date) : "-";
  }
  // Blank on a row folded under its project's, as a quotation's earlier versions are: the count is the row's above.
  if (column.type === "number") return value ?? "";
  return value || "-";
}

export default function FeedbackPage() {
  // PROJECT / Feedback. Giving feedback is a write; without it the list is read-only and a waiting
  // project offers no Give Feedback.
  const { canWrite } = useRouteAccess();
  const { canRead: viewsAll } = useModuleAccess("PROJECT", "View All Feedback");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [tableStats, setTableStats] = useState({ total: 0 });
  // The waiting project whose Give Feedback form is open.
  const [adding, setAdding] = useState(null);
  // The ticked rows' Give Feedback dialog, while it is open.
  const [givingMany, setGivingMany] = useState(false);
  // `{ done, of }` while the ticked rows are being saved, for the popup to count up.
  const [givingProgress, setGivingProgress] = useState(null);
  // The feedback just given, while the message to its client is open.
  const [answering, setAnswering] = useState(null);
  // A feedback under Issues being moved on: `{ row, status, remarks, error }` while its dialog is open.
  const [resolving, setResolving] = useState(null);
  const [resolvingBusy, setResolvingBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [infoRow, setInfoRow] = useState(null);
  const [infoPanelState, setInfoPanelState] = useState("collapsed");
  const [viewing, setViewing] = useState(null);
  const { notice, showNotice, showError, clearNotice } = useNotice();
  const { density } = useCompactView();
  const [status, setStatus] = useStickyTab("project-feedback", DEFAULT_FEEDBACK_STATUS, FEEDBACK_STATUSES);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      // Settled apart, so a waiting list that fails to load never hides the feedback already given.
      const [given, waiting] = await Promise.allSettled([getProjectFeedback(), getPendingFeedbackProjects()]);
      const listOf = (result) => (result.status === "fulfilled" && Array.isArray(result.value?.data) ? result.value.data : []);
      // The projects still waiting for feedback first, then the feedback already given.
      setRows([...listOf(waiting), ...listOf(given)]);
      if (given.status === "rejected") showError(given.reason?.message || "Unable to load feedback.");
      else if (waiting.status === "rejected") showError(waiting.reason?.message || "Unable to load the projects waiting for feedback.");
      else setLastUpdated(new Date());
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadRows(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadRows]);

  /*
   * Saves one review. The row the server answers with goes to the top of the table straight away; a
   * refusal is thrown back to the form, which shows it beside what it is about.
   */
  const addFeedback = useCallback(async (body) => {
    setSaving(true);
    try {
      const response = await createProjectFeedback(body);
      const saved = response?.data;
      // The feedback replaces its waiting row - the project's, or that shoot's.
      if (saved) setRows((current) => [saved, ...current.filter((row) => row.id !== saved.id && !(row.pending && row.projectKey && row.projectKey === saved.projectKey && row.stage === saved.stage && (row.shootKey || null) === (saved.shootKey || null)))]);
      setLastUpdated(new Date());
      setAdding(null);
      // Filed by its review, so the bar moves to where it went, and the client's message opens.
      if (saved?.status) setStatus(saved.status);
      // The waiting row the info panel may be showing has just been replaced.
      setInfoRow(null);
      // Only a feedback filed as Completed or Issues has a message to answer it with.
      if (feedbackTemplateKey(saved?.status)) setAnswering(saved);
      showNotice(`${saved?.stageLabel || "Feedback"} saved for ${saved?.shootCode || saved?.eventId || "the project"}. Filed as ${saved?.status || "given"}.`);
    } finally {
      setSaving(false);
    }
  }, [showNotice, setStatus]);

  /*
   * Moves the feedback being confirmed on from Issues. The server's answer replaces the row, so it
   * leaves the Issues tab for the one it went to; a refusal (it had already moved) is said, and the
   * list reloaded to show where it is.
   */
  async function resolveIssue() {
    if (!resolving) return;
    const remarks = resolving.remarks.trim();
    // A rejection must say why - said under the box before anything is sent.
    if (resolving.status === "Rejected" && !remarks) {
      setResolving((current) => ({ ...current, error: "Enter the remarks." }));
      return;
    }
    setResolvingBusy(true);
    try {
      const response = await setFeedbackIssueStatus(resolving.row.id, resolving.status, remarks);
      const saved = response?.data;
      if (saved) setRows((current) => current.map((row) => (row.id === saved.id ? saved : row)));
      setInfoRow((current) => (current?.id === resolving.row.id ? null : current));
      showNotice(`${resolving.row.feedbackCode || "The feedback"} moved to ${resolving.status}.`);
      setResolving(null);
    } catch (error) {
      // Already moved by somebody else: close and reload to show where it went. A refused remark is
      // said under the box; any other failure keeps the dialog open, to try again.
      if (error.status === 409) {
        showError(error.message || "Unable to change the feedback's status.");
        setResolving(null);
        void loadRows();
      } else if (error.status === 400) {
        setResolving((current) => current && { ...current, error: error.message || "Check the remarks." });
      } else {
        showError(error.message || "Unable to change the feedback's status.");
      }
    } finally {
      setResolvingBusy(false);
    }
  }

  const statusTabs = useMemo(() => FEEDBACK_STATUSES.map((label) => ({
    id: label,
    label,
    // No count until the list has loaded: a row of zeros while it is still on its way reads as data.
    count: loading ? undefined : tabCount(rows.filter((row) => feedbackStatusOf(row) === label), label),
  })), [rows, loading]);
  // A row read in the info panel belongs to the tab it was chosen on.
  const chooseStatus = useCallback((next) => { setStatus(next); setInfoRow(null); }, [setStatus]);
  /*
   * The tab's rows, a project's feedbacks folded into one row as the Quotations register folds a
   * chain: the highest version shown with how many there are, the rest under its chevron. Not on Yet
   * to be done - a project's waiting rows are feedback still to give, not versions of one given.
   */
  const shownRows = useMemo(() => {
    const onTab = rows.filter((row) => feedbackStatusOf(row) === status);
    return status === DEFAULT_FEEDBACK_STATUS ? onTab : groupFeedbackRows(onTab);
  }, [rows, status]);

  /*
   * Tick boxes, with select-all, on every tab. On Yet to be done they are for somebody who may give
   * feedback: the ticked projects and shoots take one review and feedback together (Give Feedback in
   * the header). On Issues, Issues sorted, Completed and Rejected the ticked rows are exported - a
   * read, so anybody who can see the tab may tick. Nothing is deleted here.
   */
  const onWaitingTab = status === DEFAULT_FEEDBACK_STATUS;
  const bulk = useTableSelection({
    rows: shownRows,
    rowId: (row) => String(row.id),
    noun: "item",
    canDelete: false,
    canSelectRow: onWaitingTab ? waitingRow : undefined,
    showError,
  });
  const ticked = bulk.selectedRows;
  const bulkSelection = !onWaitingTab || canWrite ? bulk.selection : undefined;
  const giveActions = useMemo(() => [{ id: "give-feedback", label: `Give Feedback (${ticked.length})`, variant: "primary", onClick: () => setGivingMany(true) }], [ticked.length]);
  // Give Feedback alone over the ticked waiting rows - no Export there; the table's own Export stays.
  // Elsewhere the selection's own Export over the ticked rows.
  const selection = useMemo(() => {
    if (!bulkSelection) return undefined;
    return onWaitingTab ? { ...bulkSelection, actions: giveActions, exportable: false } : bulkSelection;
  }, [bulkSelection, giveActions, onWaitingTab]);

  /*
   * Gives the one review and feedback to each ticked row - in batches of `FEEDBACK_BATCH` rows, one
   * request each (`createProjectFeedbackMany`), rather than one request per row: three thousand
   * rows took ten minutes that way. The server still checks every row on its own (already given, a
   * shoot not completed, an Overall Feedback not yet due) and gives each its own version and, for
   * Average or Poor, its own task. What went in leaves the list; what was refused stays ticked, and
   * the popup stays open with what was typed and the first reason, to try again.
   */
  async function giveManyFeedback(common) {
    setSaving(true);
    const saved = [];
    const refused = [];
    try {
      const waitingId = (row) => (row.shootKey ? `shoot:${row.shootKey}:${row.stage}` : `project:${row.projectKey}:${row.stage}`);
      const byId = new Map(ticked.map((row) => [waitingId({ ...row, stage: row.stage || "NEW_PROJECT" }), row]));
      for (let start = 0; start < ticked.length; start += FEEDBACK_BATCH) {
        const batch = ticked.slice(start, start + FEEDBACK_BATCH);
        setGivingProgress({ done: Math.min(start + batch.length, ticked.length), of: ticked.length });
        try {
          const response = await createProjectFeedbackMany({
            ...common,
            items: batch.map((row) => ({ projectId: row.projectKey, stage: row.stage || "NEW_PROJECT", ...(row.shootKey ? { shootId: row.shootKey } : {}) })),
          });
          for (const feedback of response?.data?.saved || []) saved.push({ waiting: byId.get(waitingId(feedback)), feedback });
          for (const item of response?.data?.refused || []) {
            const row = byId.get(waitingId({ projectKey: item.projectId, shootKey: item.shootId, stage: item.stage }));
            if (row) refused.push({ row, message: item.message });
          }
        } catch (error) {
          // The whole batch was refused (signed out, a field the server would not take): each row stays ticked.
          const message = error?.data?.message || error?.message || "Unable to save.";
          for (const row of batch) refused.push({ row, message });
        }
      }
      if (saved.length) {
        const gone = new Set(saved.map(({ waiting }) => waiting?.id).filter(Boolean));
        setRows((current) => [...saved.map(({ feedback }) => feedback), ...current.filter((row) => !gone.has(row.id))]);
        setLastUpdated(new Date());
        setInfoRow(null);
      }
      bulkSelection?.onChange(new Set(refused.map(({ row }) => String(row.id))));
      const done = `Feedback given for ${saved.length} of ${saved.length + refused.length}.`;
      if (!refused.length) { setGivingMany(false); showNotice(done); return; }
      // Thrown back to the popup, which keeps what was typed and says why, for the rows still ticked.
      throw new Error(`${done} ${refused.length} not saved and still ticked - ${refused[0].row.shootCode || refused[0].row.eventId || "one"}: ${refused[0].message}`);
    } finally {
      setSaving(false);
      setGivingProgress(null);
    }
  }

  // A row's ⋮, for the table and for a Board card alike.
  const feedbackActions = useCallback((row) => [
    ...(row.pending && canWrite ? [{ label: "Give Feedback", onSelect: () => setAdding(row) }] : []),
    // Under Issues, a writer moves it on: Issues sorted, or Rejected.
    // Only for a feedback with no tasks (given before reviews were assigned): one with tasks is
    // answered by the people they were given to, from their Tasks.
    ...(!row.pending && canWrite && row.status === "Issues" && !row.hasIssues
      ? FEEDBACK_ISSUE_OUTCOMES.map((status) => ({ label: status, tone: status === "Rejected" ? "danger" : undefined, onSelect: () => setResolving({ row, status, remarks: "", error: "" }) }))
      : []),
    { label: "View", onSelect: () => setViewing(row) },
  ], [canWrite]);

  // Yet to be done is the projects waiting for feedback, which have no Feedback ID, so the column is
  // left off that tab rather than shown as a column of dashes.
  // Remarks only on the two tabs a feedback is moved to from Issues.
  const columns = useMemo(() => feedbackColumns.filter((column) => !(status === DEFAULT_FEEDBACK_STATUS && ["feedbackCode", "versionCount"].includes(column.id))
    && !(column.outcomeOnly && !FEEDBACK_ISSUE_OUTCOMES.includes(status))).map((column) => ({
    ...column,
    header: column.label,
    accessorFn: (row) => displayValue(row, column),
    cell: column.id === "actions"
      ? ({ row }) => <OptionsMenu ariaLabel={`Actions for ${row.original.feedbackCode || row.original.eventId || "feedback"}`} items={feedbackActions(row.original)} />
      : ({ row }) => displayValue(row.original, column),
    exportValue: (row) => displayValue(row, column),
    // A date column sorts by the date itself, not by its "14 Sept 2026" text; an empty one sorts first.
    ...(column.type === "date" ? { sortingFn: (first, second) => (Number(sortableValue(first.original[column.id], "date")) || 0) - (Number(sortableValue(second.original[column.id], "date")) || 0) } : {}),
    ...(column.type === "number" ? { sortingFn: (first, second) => (Number(first.original[column.id]) || 0) - (Number(second.original[column.id]) || 0) } : {}),
    width: column.id === "actions" ? 56 : column.width || 160,
    minWidth: column.id === "actions" ? 56 : Math.min(130, column.width || 130),
  })), [feedbackActions, status]);

  const [layout, setLayout] = useTableBoardLayout("project-feedback");
  const onBoard = layout === "board";
  const boardRows = useMemo(() => FEEDBACK_STATUSES.flatMap((label) => {
    const onTab = rows.filter((row) => feedbackStatusOf(row) === label);
    return label === DEFAULT_FEEDBACK_STATUS ? onTab : groupFeedbackRows(onTab);
  }), [rows]);
  // The ⋮'s own rule for moving a feedback on from Issues.
  const canDropAt = useCallback((row, to) => canWrite && FEEDBACK_ISSUE_OUTCOMES.includes(to) && !row.pending && row.status === "Issues" && !row.hasIssues, [canWrite]);
  const dropFeedback = useCallback((row, to) => setResolving({ row, status: to, remarks: "", error: "" }), []);

  const updatedText = lastUpdated ? updatedFormat.format(lastUpdated) : "-";
  // The row's whole project - every stage of its feedback - for the info panel and View.
  const infoRecord = useMemo(() => feedbackRecordFor(infoRow, rows), [infoRow, rows]);
  const viewRecord = useMemo(() => feedbackRecordFor(viewing, rows), [viewing, rows]);

  return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
    <ModulePageHeader
      title="Customer Issues and Feedback"
      // The Board stands every feedback under its status, so the status bar steps aside while it shows.
      tabs={onBoard ? undefined : statusTabs}
      tabValue={status}
      onTabChange={chooseStatus}
      tabsAriaLabel="Feedback status"
      actions={<TableBoardSwitch value={layout} onChange={setLayout} />}
    />
    <FloatingNotice notice={notice} onClose={clearNotice} />
    {onBoard ? <KanbanBoard
      rows={boardRows}
      columns={BOARD_COLUMNS}
      statusOf={feedbackStatusOf}
      // How many have sat 7+ days on Yet to be done or Issues, by the board's own date (given on, else shoot or event date); the rest are answered.
      columnAmount={feedbackColumnFigure}
      cardFlag={feedbackFlag}
      dateOf={feedbackDateOf}
      card={BOARD_CARD}
      onOpen={setViewing}
      // The card's ⋮ is the row's ⋮.
      cardActions={feedbackActions}
      canDropAt={canDropAt}
      onDrop={dropFeedback}
      loading={loading}
      noun="feedback"
      ariaLabel="Feedback board"
    /> : <div className="min-h-0 flex-1">
      <DataTableShell className="h-full min-h-0" footer={<TableFooter spread><span>Last updated: {updatedText}</span><span>Total rows: {tableStats.total}</span></TableFooter>}>
        {/* The shell stacks its children, so the table and the panel beside it need a row of their
            own - without it the info panel lands under the table instead of next to it. */}
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-1">
            <DataTable
              columns={columns}
              data={shownRows}
              density={density}
              loading={loading}
              loadingMessage="Loading feedback..."
              emptyMessage={rows.length ? `No feedback is marked ${status}.` : viewsAll
                ? "No projects are waiting for feedback, and none has been given yet. A project appears here once it is created in Bookings & Converted."
                : "No projects are waiting for feedback, and you have not given any yet. A project appears here once it is created in Bookings & Converted."}
              noMatchMessage="No feedback found."
              onVisibleRowsChange={setTableStats}
              selectedRowId={infoRow?.id}
              onRowClick={(row) => { setInfoRow(row); setInfoPanelState("expanded"); }}
              onRowDoubleClick={setViewing}
              ariaLabel="Feedback table"
              features={{ selection, filtering: true, sorting: true, columnVisibility: true, expandable: { label: "this project's other feedback", canExpand: (row) => groupedFeedbackOf(row).length > 0, getSubRows: groupedFeedbackOf }, infiniteScroll: { pageSize: 50 }, csvExport: { enabled: true, fileName: "project-feedback", onResult: (exported) => showNotice(exported ? "Feedback CSV export downloaded." : "No feedback available to export.") } }}
            />
          </div>
          <DataTableInfoPanel
            title="Feedback"
            entity={infoRecord.entity}
            sections={infoRecord.sections}
            emptyText="Select a row to view the feedback and its project."
            state={infoPanelState}
            onToggle={() => setInfoPanelState((current) => current === "expanded" ? "collapsed" : "expanded")}
          />
        </div>
      </DataTableShell>
    </div>}
    {viewing && <RecordViewPanel
      title={viewing.feedbackCode ? `Feedback - ${viewing.feedbackCode}` : viewing.eventId ? `Feedback - ${viewing.eventId}` : "Feedback"}
      description={viewing.projectName || ""}
      entity={viewRecord.entity}
      sections={viewRecord.sections}
      sidebarAriaLabel="Feedback sections"
      onClose={() => setViewing(null)}
    />}
    {adding && canWrite && <FeedbackFormPanel project={adding} busy={saving} onClose={() => setAdding(null)} onSubmit={addFeedback} />}
    {givingMany && canWrite && <FeedbackBulkDialog count={ticked.length} busy={saving} progress={givingProgress} onClose={() => setGivingMany(false)} onSubmit={giveManyFeedback} />}
    {answering && <FeedbackMessageDialog feedback={answering} onClose={() => setAnswering(null)} />}
    {resolving && canWrite && <ConfirmDialog
      title={`Move to ${resolving.status}?`}
      message={resolving.status === "Rejected"
        ? `${resolving.row.feedbackCode || "This feedback"} leaves Issues for Rejected. It cannot be moved back.`
        : `${resolving.row.feedbackCode || "This feedback"} leaves Issues for Issues sorted - the team has sorted it out. It cannot be moved back.`}
      confirmLabel={resolving.status === "Rejected" ? "Reject" : "Mark as Issues sorted"}
      busyLabel="Saving..."
      tone={resolving.status === "Rejected" ? "danger" : "primary"}
      loading={resolvingBusy}
      onCancel={() => { if (!resolvingBusy) setResolving(null); }}
      onConfirm={() => void resolveIssue()}
    >
      <TextAreaField
        label="Remarks"
        required={resolving.status === "Rejected"}
        helperText="Saved on the feedback; say why when rejecting it."
        placeholder={resolving.status === "Rejected" ? "Why is this feedback being rejected?" : "How was it sorted out? (optional)"}
        value={resolving.remarks}
        maxLength={REMARKS_MAX_LENGTH}
        disabled={resolvingBusy}
        error={resolving.error}
        onChange={(event) => { const remarks = event.target.value; setResolving((current) => ({ ...current, remarks, error: "" })); }}
      />
    </ConfirmDialog>}
  </section>;
}
