"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DataTable from "@/components/data-table/DataTable";
import DataTableInfoPanel from "@/components/data-table/DataTableInfoPanel";
import DataTableShell from "@/components/data-table/DataTableShell";
import KanbanBoard from "@/components/data-table/KanbanBoard";
import { columnCount, columnSumText, daysSince } from "@/lib/kanbanSummary.mjs";
import TableBoardSwitch, { useTableBoardLayout } from "@/components/data-table/TableBoardSwitch";
import RecordViewPanel from "@/components/data-table/RecordViewPanel";
import useTableSelection from "@/components/data-table/useTableSelection";
import AttendanceRequestDialog from "@/components/hrm/AttendanceRequestDialog";
import AttendanceRequestFormPanel from "@/components/hrm/AttendanceRequestFormPanel";
import { refreshStoredNotifications } from "@/components/app-shell/useStoredNotifications";
import {
  BulkDecisionDialog,
  DecisionDialog,
  REQUEST_VIEW_APPROVALS,
  attendanceStatusStyles,
  attendanceColumns,
  attendanceRequestFormatters,
  attendanceRequestForInfo,
  attendanceRequestSections,
  attendanceVisibility,
  errorMessage,
  fieldsForColumns,
  awaitsMe,
  maySendBack,
  editPrefill,
  inMyQueue,
  inStatusTab,
  OWN_ACTIONS,
  requestActionItems,
  requestRow,
  requestTableConfig,
  requestTypeLabel,
  statusTabs,
} from "@/components/hrm/attendanceRequests";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import { usePermissions } from "@/components/auth/PermissionsProvider";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import OptionsMenu from "@/components/ui/OptionsMenu";
import {
  approveAttendanceRequest,
  createAttendanceRequest,
  deleteAttendanceRequest,
  editAttendanceRequest,
  getAttendanceRequests,
  getAttendanceSettings,
  rejectAttendanceRequest,
  revertAttendanceRequest,
  sendBackAttendanceRequest,
} from "@/services/hrm/attendance.service";

/**
 * HRM → Request: leave, permission and comp-off requests in one place.
 *
 * Every kind in one list - leave, on-duty, permission and comp-off together, told apart by the
 * **Request** column, which the table's filter row narrows to one kind. There was a Leave /
 * Permission / Comp-off switch above the tabs; it split one list into three that each had to be
 * opened to be read. **All / Pending / Approved / Rejected** (cancelled ones included) are this
 * person's own requests by status, and **Waiting for me** beside them is the queue this login
 * answers: the requests whose employee names them as an approver on their Login Credentials - the
 * three Leave Approvers for a leave or a comp-off, the Permission Approver for a permission - or
 * everybody's, for an Attendance Approval holder. It replaced a My requests / Waiting for me switch
 * that sat above the same tabs and said twice what Pending already says.
 *
 * Raise Request, and withdrawing or cancelling one's own, are open to anybody who can open the page:
 * asking for leave is something every employee does, and the server holds all three to the caller's
 * own record. Approving and rejecting somebody else's needs Read / Write.
 *
 * The tables, the actions and the approve / reject dialog are the ones Employee Attendance uses,
 * from `attendanceRequests.js`, and every action is decided again by the server.
 */

/**
 * The approver's three answers: which call each one sends, and what the page says afterwards.
 *
 * `send-back` takes the same required remark as a rejection and says something different by it -
 * the request is returned to be fixed rather than refused.
 */
const DECISIONS = {
  approve: { send: approveAttendanceRequest, said: "Request approved." },
  reject: { send: rejectAttendanceRequest, said: "Request rejected." },
  "send-back": { send: sendBackAttendanceRequest, said: "Request sent back to be fixed." },
};
/** The tab holding the approver's queue, beside the status tabs. */
const WAITING_TAB = "Waiting for me";
/** The kinds the Raise Request form asks between; it opens on the first. On-duty is raised from the Login dialog. */
const FORM_TYPES = ["LEAVE", "PERMISSION", "COMP_OFF"];
/** Every tab draws the queue's layout: it has the Request column the kinds are told apart by. */
const TABLE_VIEW = REQUEST_VIEW_APPROVALS;
/** One's own tabs leave out who raised it - always the reader. */
const WHO_COLUMNS = new Set(["employeeName", "employeeId"]);
/*
 * The Board's drop targets, and the row's own ⋮ entry each one runs: dropping a card on a column is
 * offered only where that row's menu carries the entry, and runs it - the same remark dialog for an
 * approver's answer, the same "are you sure" for the raiser's Revert back and Delete.
 */
const DROP_ACTIONS = { Approved: "Approve", Rejected: "Reject", "Send Back": "Send back", Reverted: "Revert back", Deleted: "Delete" };
/** The Board's card: what the request is, whose, and when. */
// Under Pending, a request raised over this many days ago is tagged with how long it has waited, and
// the column's figure counts exactly those cards.
const PENDING_WAIT_DAYS = 2;
const waitingFlag = (row, column) => {
  if (column.value !== "Pending") return "";
  const days = daysSince(row.raw?.createdAt);
  return days !== null && days > PENDING_WAIT_DAYS ? `Waiting ${days} days` : "";
};
const BOARD_CARD = {
  title: (row) => row.requestType,
  subtitle: (row) => [row.employeeName, row.employeeId].filter((part) => part && part !== "-").join(" · "),
  meta: (row) => [row.period, row.duration].filter((part) => part && part !== "-").join(" · "),
};
/** A row this login can still answer, and so may tick for a bulk Approve / Reject. */
const decidableRow = (row) => awaitsMe(row?.raw);
const plural = (count) => `${count} request${count === 1 ? "" : "s"}`;
/** What a bulk answer is called while it runs and once it is done. */
const BULK_WORDS = {
  approve: { doing: "Approving", done: "approved" },
  reject: { doing: "Rejecting", done: "rejected" },
  "send-back": { doing: "Sending back", done: "sent back" },
};
/** Said on a bulk answer before it is pressed: how many of the ticks it will leave alone. */
const skippedTitle = (skipped) => (skipped > 0 ? `${plural(skipped)} ticked will be skipped - not waiting for your answer` : undefined);

/**
 * `title` and `leadingAccessory` let another screen show this one under its own heading: Employee
 * Attendance opens it as its Request section, with its section switch beside this page's own
 * controls, so the page keeps one header rather than stacking two.
 */
export default function AttendanceRequestsPage({ title = "Leave or Comp-Off Request", leadingAccessory = null }) {
  // An administrator does not raise requests of their own, so Raise Request is not offered to them
  // at all - left out, as the account menu leaves it out. Held off while the permissions load, so it
  // never shows for a moment to somebody it is about to be taken from.
  const { isAdministrator, isSuperAdmin, loading: permissionsLoading } = usePermissions();
  const mayRaise = !permissionsLoading && !isAdministrator;
  // Read on `HRM / Requests` is all any of this page asks: it shows the lists, raises, withdraws and
  // cancels one's own, and - for the approvers named on a request - approves and rejects it. Who may
  // decide is each request's own `canDecide`, which the server works out and checks again.
  // A status tab over one's own requests, or `WAITING_TAB` for the approver's queue.
  const [status, setStatus] = useState("All");
  /*
   * Table or Board. The Board stands the statuses up as columns, so on it the status tabs give way
   * to All and Waiting for me - the two lists - and each shows every status at once.
   */
  const [layout, setLayout] = useTableBoardLayout("hrm-attendance-requests");
  const onBoard = layout === "board";
  const [settings, setSettings] = useState(null);
  const [ownRequests, setOwnRequests] = useState([]);
  const [teamRequests, setTeamRequests] = useState([]);
  // Whether this login holds `HRM / All Requests`, and so is sent every request: their status tabs are the
  // studio's rather than their own.
  const [seesAll, setSeesAll] = useState(false);
  // Whether this login is named as anybody's Leave or Permission Approver (from the server).
  const [isApprover, setIsApprover] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState(null);
  /*
   * Bulk answers. `bulkUpdate` is the ticked requests Update was opened over - the ones each answer
   * reaches, and how many were ticked; `bulkProgress` is how far a bulk answer has got, said on its button.
   */
  const [bulkUpdate, setBulkUpdate] = useState(null);
  const [bulkProgress, setBulkProgress] = useState(null);
  /**
   * The dialog for raising a request: `{ action, prefill, editingId }`, or null. With an `editingId`
   * it is the same form over an existing request, which saves with `PATCH` instead of creating.
   */
  const [raising, setRaising] = useState(null);
  /** The raiser's own "are you sure": `{ verb: "revert" | "delete", request }`, or null. */
  const [confirming, setConfirming] = useState(null);
  /*
   * The request read beside the table (one click) and in full (double click), held by id and looked
   * up in the lists each render, so a request approved or withdrawn while open reads as it now is.
   */
  const [selectedId, setSelectedId] = useState(null);
  const [viewingId, setViewingId] = useState(null);
  const [infoPanelState, setInfoPanelState] = useState("collapsed");
  const { notice, showNotice, showError, clearNotice } = useNotice();

  /** Both lists, answered with the team list so the first load can choose where the page opens. */
  const load = useCallback(() => {
    setLoading(true);
    return Promise.all([getAttendanceRequests({ scope: "own" }), getAttendanceRequests({ scope: "team" })])
      .then(([own, team]) => {
        setOwnRequests(own?.data || []);
        setTeamRequests(team?.data || []);
        setSeesAll(Boolean(team?.seesAll));
        setIsApprover(Boolean(team?.isApprover));
        return { rows: team?.data || [], seesAll: Boolean(team?.seesAll) };
      })
      .catch((error) => { showError(errorMessage(error, "Unable to load the requests.")); return null; })
      .finally(() => setLoading(false));
  }, [showError]);

  useEffect(() => {
    /*
     * Which tab the page opens on: "Waiting for me" when something is waiting for this person's
     * answer, All of their own otherwise. Opening every login on the approver's queue left somebody
     * who had just raised a leave looking at an empty table. Only here, on the first load - a reload
     * after a decision leaves the reader where they are.
     */
    // Somebody who sees everybody's requests (`seesAll`) and is also an approver opens there too.
    load().then((team) => {
      if (!team) return;
      if (team.rows.some(awaitsMe)) setStatus(WAITING_TAB);
    });
    // Only the permission limit is read from it, which the raise dialog checks before sending.
    getAttendanceSettings().then((response) => setSettings(response?.data || null)).catch(() => setSettings(null));
  }, [load]);

  // Never for an administrator, who has no such tab.
  /*
   * Waiting for me is for an approver: somebody named as a Leave or Permission Approver on anyone's
   * record, whether or not anything is waiting yet - and whether or not they also see everybody's
   * requests, since being an approver is its own job. Somebody named on nobody's has nothing that
   * could wait on them, so they have no such tab - unless something is in their queue anyway (named
   * once and since replaced), which stays reachable. The tab lists only what waits on them.
   */
  const showsWaiting = isApprover || teamRequests.some(inMyQueue);
  const waiting = status === WAITING_TAB && showsWaiting;
  /*
   * An administrator's All, Pending, Approved and Rejected are over everybody's requests - the server
   * sends them all (`seesAll`) - where anybody else's are over their own. Seeing is not deciding:
   * Approve and Reject still appear only on a request they are a named approver on.
   */
  const allView = seesAll && !waiting;
  const queueView = waiting || allView;
  /*
   * Only what still needs this person's answer - the same rule the tab's count uses, so the number
   * and the rows agree. A request they have already answered leaves this list; it is still in All
   * and in whichever status tab it is now in (Pending while other approvers have yet to answer).
   */
  const waitingList = teamRequests.filter(awaitsMe);
  const awaitingCount = waitingList.length;
  // Everybody's: the team list (everybody else's, for an administrator) and their own, newest first.
  const everyone = [...teamRequests, ...ownRequests.filter((own) => !teamRequests.some((other) => other.id === own.id))]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const filtered = waiting ? waitingList : (allView ? everyone : ownRequests).filter((request) => onBoard || inStatusTab(request, status));
  const rows = filtered.map((request) => requestRow(request, TABLE_VIEW));
  const queueConfig = requestTableConfig[TABLE_VIEW];
  const config = waiting
    ? { ...queueConfig, emptyMessage: "No requests are waiting for you." }
    : allView
      ? { ...queueConfig, ariaLabel: "All requests table", emptyMessage: "No requests here.", noMatchMessage: "No matching requests found." }
      : {
        ...queueConfig,
        ariaLabel: "My requests table",
        emptyMessage: "You have not raised any requests yet.",
        noMatchMessage: "No matching requests found.",
        columns: queueConfig.columns.filter((column) => !WHO_COLUMNS.has(column.id)),
      };
  const fields = fieldsForColumns(config.columns);
  /*
   * Ticked rows can be exported by anybody who may tick them, and deleted - outright, from the
   * database - by a Super Admin alone. That is a different act from a row's own Delete, which marks
   * one's own request Deleted and keeps it, and which is unchanged. The server asks again.
   */
  const selection = useTableSelection({
    prefix: "/api/hrm/attendance/requests",
    rows,
    rowId: (row) => String(row.id),
    noun: "request",
    canDelete: isSuperAdmin,
    deleteMessage: "These requests will be permanently deleted for everyone, with their approvals and history, and cannot be brought back. Approved leave, on-duty and comp-off will stop counting in attendance; a corrected day keeps its corrected status.",
    onDeleted: () => load(),
  });

  /*
   * Bulk Approve and Reject, for a role holding `ADMIN / Table Select All` (a Super Admin always
   * does) - on any tab, over the ticked requests this login can still answer. The rest of a selection
   * (one's own, one already answered, one they are not named on) is skipped and said so: only the
   * named approvers decide a request, in bulk as one at a time. Each is sent through the same call
   * the row's own ⋮ uses, so the server decides every one again; one refused does not stop the
   * others, and stays ticked so the approver can see which. A rejection's one reason goes on all.
   */
  const ticked = selection.selectedIds;
  const tickedRows = rows.filter((row) => ticked.has(String(row.id)));
  const decidableTicked = tickedRows.filter(decidableRow).map((row) => row.raw);
  // An approver who rejected may change their mind towards yes, never reject twice.
  const rejectableTicked = decidableTicked.filter((request) => request.myDecision !== "REJECTED");
  // Send back as the row's own menu offers it (`maySendBack`): not a comp-off credit attendance raised.
  const sendBackTicked = decidableTicked.filter(maySendBack);
  const offersBulk = Boolean(selection.selection) && rows.some(decidableRow);

  async function decideTicked(verb, requests, remarks = "", skipped = 0) {
    if (busy || !requests.length) return;
    setBusy(true);
    setBulkProgress({ verb, done: 0, total: requests.length });
    const refused = [];
    let firstError = "";
    for (const [index, request] of requests.entries()) {
      try {
        await DECISIONS[verb].send(request.id, remarks);
      } catch (error) {
        refused.push(String(request.id));
        firstError ||= errorMessage(error, "");
      }
      setBulkProgress({ verb, done: index + 1, total: requests.length });
    }
    setBulkUpdate(null);
    selection.selection.onChange(new Set(refused));
    await load();
    refreshStoredNotifications();
    setBulkProgress(null);
    setBusy(false);
    const word = BULK_WORDS[verb].done;
    const done = requests.length - refused.length;
    const skippedNote = skipped ? ` ${plural(skipped)} skipped - not waiting for your answer.` : "";
    if (!refused.length) showNotice(`${plural(done)} ${word}.${skippedNote}`, "success");
    else showError(`${done} of ${plural(requests.length)} ${word}. ${refused.length} could not be${firstError ? ` - ${firstError}` : "."} They are still ticked.${skippedNote}`);
  }

  // One Update over the selection: Approve or Reject is chosen in its dialog (`BulkDecisionDialog`).
  const bulkActions = !offersBulk ? [] : [{
    id: "update",
    variant: "primary",
    label: bulkProgress ? `${BULK_WORDS[bulkProgress.verb].doing} ${bulkProgress.done} of ${bulkProgress.total}…` : `Update${decidableTicked.length ? ` (${decidableTicked.length})` : ""}`,
    disabled: busy || !decidableTicked.length,
    title: decidableTicked.length ? skippedTitle(tickedRows.length - decidableTicked.length) : "None of the ticked requests are waiting for your answer",
    onClick: () => setBulkUpdate({ approve: decidableTicked, reject: rejectableTicked, "send-back": sendBackTicked, ticked: tickedRows.length }),
  }];
  const bulkKey = bulkActions.map((action) => `${action.label}|${action.disabled}`).join(";");
  /*
   * The table's selection - only for `ADMIN / Table Select All` - with the bulk answers added.
   * Memoised on what it draws, since `DataTable` rebuilds its columns whenever this changes.
   */
  const tableSelection = useMemo(() => {
    if (!selection.selection) return undefined;
    return { ...selection.selection, actions: bulkActions };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.selection, bulkKey]);

  async function act(work, fallback) {
    if (busy) return;
    setBusy(true);
    try {
      const message = await work();
      await load();
      // Deciding a request takes its notice off this approver's bell; read it now, not in a minute.
      refreshStoredNotifications();
      if (message) showNotice(message, "success");
    } catch (error) {
      showError(errorMessage(error, fallback));
    } finally {
      setBusy(false);
      setDecision(null);
    }
  }

  /*
   * The Raise Request form's save. Not `act`: a refusal belongs on the form, which stays open and
   * shows it, so it is thrown back to the form rather than turned into a notice behind it.
   */
  async function raiseRequest(payload) {
    if (busy) return;
    const editingId = raising?.editingId ?? null;
    setBusy(true);
    try {
      if (editingId) await editAttendanceRequest(editingId, payload);
      else await createAttendanceRequest(payload);
      setRaising(null);
      // Shown where it landed: All of one's own.
      setStatus("All");
      setSelectedId(null);
      await load();
      /*
       * An edit clears every answer on the server, so the approvers are being asked again - said
       * here rather than left for somebody to discover that their approved leave is pending.
       */
      showNotice(
        editingId
          ? "Request updated. Your approvers have been asked again."
          : "Request raised. Your approvers can now see it.",
        "success",
      );
    } finally {
      setBusy(false);
    }
  }

  /** Revert back and Delete, each after the question `confirming` holds. */
  function confirmOwnVerb() {
    const { verb, request } = confirming || {};
    if (!request) return;
    setConfirming(null);
    if (verb === "revert") {
      act(() => revertAttendanceRequest(request.id).then(() => "Request reverted. It is back with you."), "Unable to revert this request.");
      return;
    }
    act(() => deleteAttendanceRequest(request.id).then(() => "Request deleted. It stays in your list, marked Deleted."), "Unable to delete this request.");
  }

  function rowActionItems(row) {
    // Approve, Reject and Send back appear where the request says this login may decide it
    // (`canDecide`, in `requestActionItems`); View, Edit, Revert back and Delete on one's own.
    const request = row.raw;
    // An administrator's own requests sit among everybody's, and keep their own actions there.
    const mine = ownRequests.some((own) => own.id === request.id);
    return requestActionItems(queueView && !(allView && mine) ? REQUEST_VIEW_APPROVALS : OWN_ACTIONS, request, {
      onDecide: (choice) => setDecision({ decision: choice, request: row }),
      onSendBack: () => setDecision({ decision: "send-back", request: row }),
      onView: () => setViewingId(request.id),
      // The same form the request was raised on, over the same row: one form that knows how to ask
      // for a leave, not a second one that has to be kept in step with it.
      onEdit: () => setRaising({ action: request.type, prefill: editPrefill(request), editingId: request.id }),
      onRevert: () => setConfirming({ verb: "revert", request }),
      onDelete: () => setConfirming({ verb: "delete", request }),
    });
  }

  /** The row's own ⋮ entry that moves it to a Board column, if its menu carries one. */
  const dropItem = (row, to) => (DROP_ACTIONS[to] ? rowActionItems(row).find((item) => item.label === DROP_ACTIONS[to]) : null);

  function renderActions(row) {
    const items = rowActionItems(row);
    // Nothing to do on it - an approved leave, say - still holds the ⋮'s 32px square, so its row is
    // as tall as a pending one beside it. An empty cell let the row shrink, and the table's rows
    // changed height as requests were approved.
    if (!items.length) return <span aria-hidden="true" className="inline-block h-8 w-8" />;
    return <OptionsMenu ariaLabel={`Actions for ${row.employeeName || "request"}`} items={items} />;
  }

  /*
   * Every row's actions are behind the ⋮ pinned to its right end, as on every other module table:
   * Approve and Reject in "Waiting for me", Withdraw, Cancel and Apply again on one's own.
   */
  const baseColumns = attendanceColumns(fields, rows, renderActions);
  /*
   * Where this login stands on each request, as an answer rather than as buttons: "Approval pending"
   * where it is still theirs to give, "✓ You approved" where they have and the others have not, each
   * with how many other approvers are still to answer. Approve and Reject are in the row's ⋮, and the
   * server checks again either way.
   */
  const decideColumn = {
    id: "decide",
    header: "Decide",
    exportable: false,
    enableSorting: false,
    enableColumnFilter: false,
    size: 190,
    minSize: 190,
    accessorFn: () => "",
    cell: ({ row }) => {
      const request = row.original.raw || {};
      // Everybody still to answer, this login included while it has not.
      const remaining = Math.max(0, (request.approvalsTotal || 0) - (request.approvalsApproved || 0));
      // Still this login's to answer: said as an answer-in-waiting, in amber, the others counted after it.
      if (request.canDecide && request.status === "PENDING") {
        const others = Math.max(0, remaining - 1);
        return <span className="flex flex-col leading-tight" title="Approve or reject from the ⋮ at the end of the row">
          <span className="inline-flex w-fit items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">● Approval pending</span>
          <span className="mt-0.5 text-xs text-slate-500">{others > 0 ? `Waiting on you and ${others} more` : "Waiting on you"}</span>
        </span>;
      }
      // Answered by this login, and waiting on the others.
      if (request.myDecision === "APPROVED") {
        return <span className="flex flex-col leading-tight">
          <span className="inline-flex w-fit items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">✓ You approved</span>
          {remaining > 0 && <span className="mt-0.5 text-xs text-slate-500">Waiting on {remaining} more</span>}
        </span>;
      }
      return null;
    },
  };
  // Ahead of the ⋮, which stays the last column.
  const columns = waiting || allView
    ? [...baseColumns.filter((column) => column.id !== "actions"), decideColumn, ...baseColumns.filter((column) => column.id === "actions")]
    : baseColumns;
  const findRequest = (id) => (id == null ? null : ownRequests.find((request) => request.id === id) || teamRequests.find((request) => request.id === id) || null);
  const selectedRequest = findRequest(selectedId);
  const viewingRequest = findRequest(viewingId);
  const visibility = attendanceVisibility(fields, true);

  /*
   * All, Pending, Approved and Rejected, then Waiting for me. For an administrator the four count and
   * list everybody's requests; for anybody else the four are their own. Waiting for me - for anybody
   * named as an approver, administrator or not - is the queue of requests they are named on.
   */
  const byStatus = seesAll ? everyone : ownRequests;
  /*
   * The Board's columns: the status tabs, in their order, then any status a request holds that no
   * tab files - Reverted, Deleted, Cancelled, found under All - so every request in the list has a
   * column and none drops off the Board.
   */
  const tabStatuses = statusTabs.filter((tab) => tab !== "All");
  const boardStatuses = [...tabStatuses, ...new Set(rows.map((row) => row.status).filter((value) => value && !tabStatuses.includes(value)))];
  const boardColumns = boardStatuses.map((value) => ({ value, className: `${attendanceStatusStyles[value] || "bg-slate-400"} text-white` }));
  const tabs = [
    ...statusTabs.filter((tab) => !onBoard || tab === "All").map((tab) => ({ id: tab, label: tab, count: byStatus.filter((request) => inStatusTab(request, tab)).length })),
    ...(showsWaiting ? [{ id: WAITING_TAB, label: WAITING_TAB, count: awaitingCount }] : []),
  ];

  return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
    <ModulePageHeader
      title={title}
      // Only when shown inside another screen, which puts its own switch here.
      titleAccessory={leadingAccessory ? <div className="flex min-w-0 flex-wrap items-center gap-2 sm:border-l sm:border-slate-200 sm:pl-3">
        {leadingAccessory}
      </div> : null}
      tabs={tabs}
      // On the Board a status tab is a column, so one remembered from the table reads as All there.
      tabValue={onBoard && status !== WAITING_TAB ? "All" : status}
      onTabChange={(value) => { setStatus(value); setSelectedId(null); }}
      tabsAriaLabel="Request status filters"
      // One button for every kind: the form asks which kind first, opening on Leave. For everybody who can open the
      // page - raising one's own request needs no more than that - and on every tab, since an
      // approver raises their own requests too. It opens on the kind being looked at.
      actions={<>
        <TableBoardSwitch value={layout} onChange={setLayout} />
        {mayRaise && <Button type="button" variant="primary" onClick={() => setRaising({ action: FORM_TYPES[0], prefill: null })}>Raise Request</Button>}
      </>}
    />
    <div className="flex min-h-0 flex-1 bg-white">
      {onBoard ? <KanbanBoard
        rows={rows}
        columns={boardColumns}
        statusOf={(row) => row.status}
        // Under Pending: how many have waited over 2 days since raised (`createdAt`); under Approved: the
        // hours its permissions take, from the server's `durationMinutes` (a leave carries none). Nothing elsewhere.
        columnAmount={(rows, column) => (column.value === "Pending" ? columnCount(rows, (row) => Boolean(waitingFlag(row, column)), `Waiting ${PENDING_WAIT_DAYS}+ days`, `Cards in this column waiting more than ${PENDING_WAIT_DAYS} days`)
          : column.value === "Approved" ? columnSumText(rows, (row) => (Number(row.raw?.durationMinutes) || 0) / 60, "Permission", (hours) => `${Math.round(hours * 10) / 10} h`)
          : null)}
        card={BOARD_CARD}
        getRowId={(row) => String(row.id)}
        cardFlag={waitingFlag}
        onOpen={(row) => setViewingId(row.id)}
        // The card's ⋮ is the row's ⋮.
        cardActions={rowActionItems}
        canDropAt={(row, to) => Boolean(dropItem(row, to))}
        onDrop={(row, to) => dropItem(row, to)?.onSelect()}
        loading={loading}
        noun="requests"
        ariaLabel={waiting ? "Requests waiting for me board" : "Requests board"}
      /> : <DataTableShell className="min-h-0 flex-1 rounded-none border-0">
        {/* The shell stacks its children, so the table and the panel beside it need a row of their
            own - without it the info panel lands under the table instead of next to it. */}
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-1">
            <DataTable
              columns={columns}
              data={rows}
              loading={loading}
              emptyMessage={config.emptyMessage}
              noMatchMessage={config.noMatchMessage}
              ariaLabel={config.ariaLabel}
              getRowId={(row) => String(row.id)}
              selectedRowId={selectedId == null ? undefined : String(selectedId)}
              // One click reads the request beside the table; a double click reads it in full. Both are
              // read-only - deciding, withdrawing and cancelling are the ⋮ menu's.
              onRowClick={(row) => { setSelectedId(row.id); setInfoPanelState("expanded"); }}
              onRowDoubleClick={(row) => setViewingId(row.id)}
              defaultColumnVisibility={visibility}
              tableClassName="min-w-full"
              features={{ filtering: true, sorting: true, columnVisibility: true, csvExport: { enabled: true, fileName: `requests-${waiting ? "to-approve" : allView ? "all" : "mine"}` }, selection: tableSelection }}
            />
          </div>
          <DataTableInfoPanel
            title="Request Details"
            entity={attendanceRequestForInfo(selectedRequest)}
            sections={attendanceRequestSections(selectedRequest)}
            formatters={attendanceRequestFormatters}
            emptyText="Select a request to see its details."
            state={infoPanelState}
            onToggle={() => setInfoPanelState((current) => current === "expanded" ? "collapsed" : "expanded")}
          />
        </div>
      </DataTableShell>}
    </div>
    {viewingRequest && <RecordViewPanel
      title={`${requestTypeLabel(viewingRequest) || "Request"} — ${viewingRequest.employeeName || "Employee"}`}
      entity={attendanceRequestForInfo(viewingRequest)}
      sections={attendanceRequestSections(viewingRequest)}
      formatters={attendanceRequestFormatters}
      sidebarAriaLabel="Request sections"
      onClose={() => setViewingId(null)}
    />}
    {decision && <DecisionDialog
      decision={decision.decision}
      request={decision.request}
      busy={busy}
      onClose={() => setDecision(null)}
      /*
       * `grantedDays` is the comp-off credit's amount, and only that dialog sends one - every other
       * answer passes `undefined`, which the service leaves out of the body so the server's column is
       * untouched rather than stamped with a nought.
       */
      onConfirm={(remarks, grantedDays) => act(
        () => DECISIONS[decision.decision].send(decision.request.id, remarks, grantedDays).then(() => DECISIONS[decision.decision].said),
        "Unable to record this decision.",
      )}
    />}
    {bulkUpdate && <BulkDecisionDialog
      counts={{ approve: bulkUpdate.approve.length, reject: bulkUpdate.reject.length, "send-back": bulkUpdate["send-back"].length }}
      busy={busy}
      onClose={() => setBulkUpdate(null)}
      onConfirm={(verb, remarks) => decideTicked(verb, bulkUpdate[verb], remarks, bulkUpdate.ticked - bulkUpdate[verb].length)}
    />}
    {confirming && <ConfirmDialog
      title={confirming.verb === "revert" ? "Revert this request?" : "Delete this request?"}
      /*
       * What each one actually does, since neither word says it on its own: reverting is not a
       * refusal and deleting removes nothing. Nobody should have to press one to find out.
       */
      message={confirming.verb === "revert"
        ? "It leaves the approvers' queues and comes back to you, with every approval cleared. You can edit it and send it again."
        : "It will show as Deleted in your list and counts for nothing. This cannot be brought back - raise a fresh request instead."}
      confirmLabel={confirming.verb === "revert" ? "Revert back" : "Delete"}
      busyLabel="Saving..."
      tone={confirming.verb === "revert" ? "primary" : "danger"}
      loading={busy}
      onCancel={() => setConfirming(null)}
      onConfirm={confirmOwnVerb}
    />}
    {/* On-duty, corrections and regularizations have no place in this form's kinds - each is raised
        from the day it is about - so one of those being *edited* opens that screen's own dialog,
        which knows what to ask for. Either way the save is `raiseRequest`. */}
    {raising && (FORM_TYPES.includes(raising.action)
      ? <AttendanceRequestFormPanel
        initialType={raising.action}
        editing={Boolean(raising.editingId)}
        prefill={raising.prefill ? { ...raising.prefill, type: raising.action } : null}
        settings={settings}
        busy={busy}
        onClose={() => setRaising(null)}
        onSubmit={raiseRequest}
      />
      : <AttendanceRequestDialog
        action={raising.action}
        editing={Boolean(raising.editingId)}
        settings={settings}
        busy={busy}
        prefill={raising.prefill}
        onClose={() => setRaising(null)}
        // The same save as the form panel's, so editing a correction or an on-duty request changes
        // the row rather than quietly raising a second one beside it.
        onSubmit={raiseRequest}
      />)}
    <FloatingNotice notice={notice} onClose={clearNotice} />
  </section>;
}
