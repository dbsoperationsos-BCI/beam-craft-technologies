/**
 * What a request's status means on screen: which tab it is found under, and what may still be done
 * to it.
 *
 * A pure module, so both the Requests screens and the tests read the same rules. It lives here
 * rather than in `components/hrm/attendanceRequests.js` because that file is a client component -
 * it carries the tables and the dialogs - and a rule nobody can test on its own is a rule that
 * drifts from the server's. The server's own lists are in
 * `backend/src/modules/hrm/attendance/service.js` (`MAY_REVERT`, `MAY_DELETE`, `RAISER_MAY_EDIT`)
 * and the two have to agree: the buttons here only hide what the server refuses anyway.
 */

/**
 * The tabs a request list is filtered by.
 *
 * No Upcoming tab: an approved request is Approved, whether its dates have arrived or not. The
 * server still says "Upcoming" for one that has not started (`displayStatus`), because that is what
 * decides what may still be done to it - but on screen it reads, and is filed, as Approved.
 *
 * **Send Back** is the raiser's: it is the one status that asks something of them, so it gets a tab
 * rather than sitting unfound among everything else.
 */
export const statusTabs = ["All", "Pending", "Send Back", "Approved", "Rejected"];

/** A request's status as the screens show it: the server's "Upcoming" is shown as Approved. */
export const shownStatus = (request) => (request?.displayStatus === "Upcoming" ? "Approved" : request?.displayStatus);

/*
 * The statuses each tab holds, where that is more than its own name.
 *
 * Reverted, Deleted and Cancelled are deliberately in none of them: they are not queues anybody
 * works through, and a Rejected tab that also held them made "how many were refused" unanswerable.
 * They are found under All, each saying what it is.
 */
const TAB_STATUSES = { Rejected: ["Rejected"] };

/** Whether a request belongs under a status tab. */
export const inStatusTab = (request, tab) => tab === "All" || (TAB_STATUSES[tab] || [tab]).includes(shownStatus(request));

/** The list a row's actions are chosen for: the approver's queue, or one's own requests. */
export const REQUEST_VIEW_APPROVALS = "approvals";
export const OWN_ACTIONS = "own";

/*
 * What the raiser may still do, by status - the same two lists the server keeps, for the same
 * reason: a reverted request is theirs to edit or delete, but there is nothing left to revert it out
 * of. `DELETED` is terminal and `CANCELLED` is the old flow's, so both offer View alone.
 */
const MAY_EDIT = ["PENDING", "SENT_BACK", "APPROVED", "REJECTED", "REVERTED"];
const MAY_REVERT = ["PENDING", "SENT_BACK", "APPROVED", "REJECTED"];
// The kinds attendance raises itself (the server's `SYSTEM_REQUEST_TYPES`): decided, never changed by the raiser.
const SYSTEM_RAISED = ["COMP_OFF_CREDIT"];

/*
 * The two types whose approval has already written onto the day - a checkout
 * (`applyCorrection`) or the day's status (`applyCorrectionStatus`) - which nothing deletes. The
 * server refuses to edit, revert or delete an approved one (`frozenByItsOwnApproval`), so the row
 * offers View alone rather than three buttons that all come back with the same refusal.
 */
const FROZEN_ONCE_APPROVED = ["CORRECTION", "INCORRECT_LOGIN"];
const frozen = (request) => request?.status === "APPROVED"
  && FROZEN_ONCE_APPROVED.includes(String(request?.type || "").toUpperCase());

/** A request this login can still answer: what "Waiting for me" counts. */
export const awaitsMe = (request) => Boolean(request?.canDecide) && ["PENDING", "REJECTED"].includes(request?.status);

/**
 * Whether this login has anything in the approval queue at all: requests still waiting on them, and
 * open ones they have already answered. It keeps the "Waiting for me" tab reachable for somebody
 * with something in their queue; the tab itself lists only `awaitsMe` - what still needs their
 * answer - so its rows match its count. An answered request is read in All and its status tab.
 *
 * Only while it is still being asked of somebody. A sent-back, reverted or deleted request is with
 * the raiser, and a queue holding rows nobody can answer is a queue people stop reading - which is
 * the same rule the server's own queue applies (`visibilityFilter(user, "team")`).
 */
export const inMyQueue = (request) => ["PENDING", "REJECTED"].includes(request?.status)
  && (Boolean(request?.canDecide) || ["APPROVED", "REJECTED"].includes(request?.myDecision));

/**
 * The actions offered on one row, for whichever side is reading it.
 *
 * Hiding a button is never the protection - the server decides every one of these again - but a
 * button that is always refused is worse than no button, so the two lists above are kept in step
 * with the server's.
 */
/**
 * Whether this approver may send the request back to its raiser: they may still decide it, have not
 * refused it, and somebody raised it by hand - a comp-off credit attendance raised has nobody to send
 * it back to. The row's Send back and the bulk Update's both read this.
 */
export function maySendBack(request) {
  return ["PENDING", "REJECTED"].includes(request?.status) && request.myDecision !== "REJECTED"
    && Boolean(request.canDecide) && !SYSTEM_RAISED.includes(request.type);
}

export function requestActionItems(view, request, { onView, onEdit, onRevert, onDelete, onDecide, onSendBack }) {
  const items = [];
  if (view === REQUEST_VIEW_APPROVALS) {
    // Answerable while the raiser has not taken it away. An approver who approved sees nothing to
    // press - their approval cannot become a rejection - and the row says "You approved" instead.
    if (!["PENDING", "REJECTED"].includes(request?.status)) return items;
    if (request.myDecision === "REJECTED") {
      // The one reversal allowed: they may change their mind towards yes.
      if (request.canDecide) items.push({ label: "Approve", onSelect: () => onDecide("approve") });
      return items;
    }
    if (request.canDecide) {
      items.push({ label: "Approve", onSelect: () => onDecide("approve") });
      items.push({ label: "Reject", tone: "danger", onSelect: () => onDecide("reject") });
      // A comp-off credit was raised by attendance, so there is nobody to send it back to.
      if (maySendBack(request)) items.push({ label: "Send back", onSelect: onSendBack });
    }
    return items;
  }
  // The raiser's own four. View is always offered: a deleted request is still theirs to read.
  items.push({ label: "View", onSelect: onView });
  // Raised by attendance for a day worked: theirs to read, never to edit, revert or delete.
  if (SYSTEM_RAISED.includes(request?.type)) return items;
  if (frozen(request) || !MAY_EDIT.includes(request?.status)) return items;
  items.push({ label: "Edit", onSelect: onEdit });
  if (MAY_REVERT.includes(request.status)) items.push({ label: "Revert back", onSelect: onRevert });
  items.push({ label: "Delete", tone: "danger", onSelect: onDelete });
  return items;
}

/**
 * What Edit seeds the request form with: the request as it stands.
 *
 * It replaced `reapplyPrefill`, which seeded a *new* request pointing back at the refused one
 * (`supersedesId`) and so left two rows describing one ask. An edit changes the row itself, so
 * nothing points anywhere.
 */
export function editPrefill(request) {
  return {
    type: request?.type,
    fromDate: request?.fromDate,
    toDate: request?.toDate,
    fromTime: request?.fromTime,
    toTime: request?.toTime,
    workedDate: request?.workedDate,
    requestedStatus: request?.requestedStatus,
    reason: request?.reason,
  };
}

/** Every status the server can send back, and the dot each is painted with in a table. */
export const attendanceStatusStyles = {
  Absent: "bg-red-500",
  Approved: "bg-emerald-500",
  // A break in the Self Dashboard's Break Summary: still running, or over.
  "On break": "bg-amber-500",
  Completed: "bg-emerald-500",
  Cancelled: "bg-slate-400",
  "Early exit": "bg-amber-500",
  "Half day": "bg-amber-500",
  Holiday: "bg-slate-400",
  Late: "bg-amber-500",
  // A day an approved correction made a plain attended day.
  Present: "bg-emerald-500",
  "Not logged out": "bg-red-500",
  // A Super Admin's unmarked day - checking in and out is not compulsory for them, so not a fault.
  "Not required": "bg-slate-400",
  "On leave": "bg-blue-500",
  "On time": "bg-emerald-500",
  Pending: "bg-amber-500",
  Permitted: "bg-blue-500",
  Rejected: "bg-red-500",
  /*
   * The three the lifecycle added.
   *
   * Send Back asks something of the raiser, as Pending asks something of an approver, so it is the
   * same amber. Reverted is back with them and asking nothing yet - the quiet of a cancelled row.
   * Deleted is an ending and reads as one.
   */
  "Send Back": "bg-amber-500",
  Reverted: "bg-slate-400",
  Deleted: "bg-red-500",
  Upcoming: "bg-blue-500",
  "Weekly off": "bg-slate-400",
  // Today, before the shift starts, with no login yet - not an absence yet.
  "Yet to log in": "bg-slate-300",
};
