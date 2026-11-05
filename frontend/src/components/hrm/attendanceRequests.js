"use client";

import { useState } from "react";
import { buildTableColumns, defaultVisibilityFor } from "@/components/data-table/tableCells";
import { attendanceRequestInfoSections } from "@/constants/infoPanelConfig";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import RecordSummaryCard from "@/components/shared/RecordSummaryCard";
import TextAreaField from "@/components/shared/TextAreaField";
import useFormErrors from "@/components/shared/useFormErrors";
import Dialog from "@/components/ui/Dialog";
import { shownStatus, attendanceStatusStyles, REQUEST_VIEW_APPROVALS } from "@/lib/attendanceRequestStatus.mjs";

/**
 * The attendance request tables - leave, permission, comp-off and the approver's queue - and the
 * approve / reject dialog, shared by Employee Attendance and HRM → Request.
 *
 * Two screens show the same requests, so they read them one way: the same columns, the same
 * "2 of 3 approved", the same actions offered on the same statuses. Two copies would agree until the
 * first time either was changed.
 */

export const REQUEST_VIEW_LEAVE = "leave";
export const REQUEST_VIEW_PERMISSION = "permission";
export const REQUEST_VIEW_COMP_OFF = "comp-off";
export { REQUEST_VIEW_APPROVALS, OWN_ACTIONS } from "@/lib/attendanceRequestStatus.mjs";

/*
 * The tabs, and which one a request is found under, come from `lib/attendanceRequestStatus` - pure
 * rules, tested on their own, shared with nothing else in this file.
 */
export { statusTabs, inStatusTab } from "@/lib/attendanceRequestStatus.mjs";
export { shownStatus };

export const requestTypeLabels = { LEAVE: "Leave", PERMISSION: "Permission", ON_DUTY: "On duty / travel", COMP_OFF: "Comp-off", CORRECTION: "Checkout correction", OUTSIDE_LOCATION: "Outside attendance", INCORRECT_LOGIN: "Attendance Regularization", COMP_OFF_CREDIT: "Comp-Off Credit" };

/** Which request types each list holds. The approvals queue holds every type. */
export const requestViewTypes = {
  [REQUEST_VIEW_LEAVE]: ["LEAVE", "ON_DUTY"],
  [REQUEST_VIEW_PERMISSION]: ["PERMISSION"],
  // The comp-offs taken and the weekly offs / holidays worked that earn them, side by side.
  [REQUEST_VIEW_COMP_OFF]: ["COMP_OFF", "COMP_OFF_CREDIT"],
};

const trailingColumns = [
  { id: "reason", header: "Reason", accessorKey: "reason" },
  { id: "status", header: "Status", accessorKey: "status" },
  { id: "approvals", header: "Approvals", accessorKey: "approvals" },
  { id: "appliedOn", header: "Applied On", accessorKey: "appliedOn" },
];

const whoColumns = [
  { id: "employeeName", header: "Employee Name", accessorKey: "employeeName" },
  { id: "employeeId", header: "Employee ID", accessorKey: "employeeId" },
];

export const requestTableConfig = {
  [REQUEST_VIEW_LEAVE]: {
    ariaLabel: "Leave requests table",
    emptyMessage: "No leave requests found.",
    noMatchMessage: "No matching leave requests found.",
    columns: [
      ...whoColumns,
      { id: "leaveType", header: "Leave Type", accessorKey: "leaveType" },
      { id: "fromDate", header: "From Date", accessorKey: "fromDate" },
      { id: "toDate", header: "To Date", accessorKey: "toDate" },
      { id: "days", header: "Days", accessorKey: "days" },
      ...trailingColumns,
      { id: "remarks", header: "Remarks", accessorKey: "remarks" },
    ],
  },
  [REQUEST_VIEW_PERMISSION]: {
    ariaLabel: "Permission requests table",
    emptyMessage: "No permission requests found.",
    noMatchMessage: "No matching permission requests found.",
    columns: [
      ...whoColumns,
      { id: "date", header: "Date", accessorKey: "date" },
      { id: "fromTime", header: "From Time", accessorKey: "fromTime" },
      { id: "toTime", header: "To Time", accessorKey: "toTime" },
      { id: "duration", header: "Duration", accessorKey: "duration" },
      ...trailingColumns,
      { id: "remarks", header: "Remarks", accessorKey: "remarks" },
    ],
  },
  [REQUEST_VIEW_COMP_OFF]: {
    ariaLabel: "Comp-off requests table",
    emptyMessage: "No comp-off requests found.",
    noMatchMessage: "No matching comp-off requests found.",
    columns: [
      ...whoColumns,
      { id: "requestType", header: "Request", accessorKey: "requestType" },
      { id: "workedOn", header: "Worked On", accessorKey: "workedOn" },
      { id: "dayOff", header: "Day Off", accessorKey: "dayOff" },
      { id: "creditStatus", header: "Credit", accessorKey: "creditStatus" },
      ...trailingColumns,
      { id: "remarks", header: "Remarks", accessorKey: "remarks" },
    ],
  },
  [REQUEST_VIEW_APPROVALS]: {
    ariaLabel: "Attendance approvals table",
    emptyMessage: "Nothing is waiting for your approval.",
    noMatchMessage: "No matching requests found.",
    columns: [
      ...whoColumns,
      { id: "requestType", header: "Request", accessorKey: "requestType" },
      { id: "period", header: "Period", accessorKey: "period" },
      { id: "duration", header: "Duration", accessorKey: "duration" },
      ...trailingColumns,
      { id: "remarks", header: "Remarks", accessorKey: "remarks" },
    ],
  },
};

/* The dot each status is painted with lives in `lib/attendanceRequestStatus` with the other status
 * rules, so a status added there cannot arrive without a colour. */
export { attendanceStatusStyles };

/** A request's kind as listed: a leave with what it is - "Leave (CL)", "Leave (LOP)" - anything else its label. */
export function requestTypeLabel(request) {
  // A comp-off is taken as a Leave Type now, and reads as one.
  if (request?.type === "COMP_OFF") return "Leave (Comp-Off)";
  const label = requestTypeLabels[request?.type] || request?.type || "";
  return request?.type === "LEAVE" && request.leaveType ? `${label} (${request.leaveType})` : label;
}

/** Turns whatever the API threw into the one sentence worth showing. */
export const errorMessage = (error, fallback) => error?.data?.message || error?.message || fallback;

/**
 * A permission's stored "14:05" as "2:05 pm" - the 12-hour clock the form asks it in. The wall-clock
 * time as written, never through a timezone; anything unreadable is shown as it is.
 */
export function clockDisplay(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ""));
  if (!match) return value || "";
  const hours = Number(match[1]);
  return `${hours % 12 || 12}:${match[2]} ${hours < 12 ? "am" : "pm"}`;
}

export function dateDisplay(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

export function fieldsForColumns(columns) {
  return columns.map((column) => [column.accessorKey, column.header, column.accessorKey === "status" ? "status" : undefined, 190, 130]);
}

/*
 * A status here is drawn by `TableCellValue`, the same as a status in every other module's table.
 *
 * This used to override the status cell with a coloured pill of its own, which made attendance the
 * one screen in the app where a status did not look like a status - the shared cell is a coloured
 * dot beside the label, and `attendanceStatusStyles` above is already the per-module colour map it
 * expects. The override was all that stood between the two, so removing it is the whole change.
 */
export function attendanceColumns(fields, rows, renderActions) {
  return buildTableColumns({ fields, statusStyles: attendanceStatusStyles, renderActions });
}

export function attendanceVisibility(fields, includeActions = false) {
  const visibility = defaultVisibilityFor(fields);
  if (!includeActions) delete visibility.actions;
  return visibility;
}

/**
 * "2 of 3 approved": how far through its approvers a request is, and never who.
 *
 * The request tables do not say which approver approved or rejected - the studio's rule is that a
 * decision is the studio's answer, not one named person's. This cell used to name them ("Approved by
 * …", "waiting on …"), and a "Decided By" column beside it did too; both are gone, and the count is
 * what is left. A count cannot be read backwards into a name, where "waiting on Priya" on a leave
 * with three approvers said exactly who the other two were who had said yes.
 */
function approvalSummary(request) {
  const total = request.approvalsTotal || 0;
  if (!total) return "-";
  return `${request.approvalsApproved || 0} of ${total} approved`;
}

/**
 * The worked day or days one comp-off claim is paid for by, as a reader needs it: one day where its
 * approvers granted a whole day, and both where they granted half a day each and the two halves
 * bought the day off between them.
 */
const compOffWorkedDates = (request) => {
  const days = [request.workedDate, request.workedPairDate].filter(Boolean).map(dateDisplay);
  if (!days.length) return "-";
  // `dateDisplay` throughout, not the picker's own formatter, so a date reads the same here as in
  // every other cell on the row.
  return days.length === 1 ? days[0] : days.join(" and ");
};

/** The Period fields each kind of request has; a leave and an on-duty share the span of days. */
const PERIOD_FIELDS = {
  PERMISSION: ["permissionDate", "fromTime", "toTime", "durationLabel"],
  COMP_OFF: ["workedDate", "dayOff"],
  // A weekly off or holiday worked, as the approver decides it: the day, the hours, and its credit.
  COMP_OFF_CREDIT: ["workedDate", "creditDayKind", "creditLoginAt", "creditLogoutAt", "creditWorked", "creditStatus", "creditExpiresOn"],
  DEFAULT: ["fromDate", "toDate", "daysLabel"],
};

const APPROVER_DECISIONS = {
  APPROVED: { label: "Approved", tone: "bg-emerald-50 text-emerald-700" },
  REJECTED: { label: "Rejected", tone: "bg-red-50 text-red-700" },
  PENDING: { label: "Pending", tone: "bg-amber-50 text-amber-700" },
};

const decidedOn = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/**
 * The request details' own formatters, for `DataTableInfoPanel` and `RecordViewPanel`.
 *
 * `approverProgress` draws the server's `approvers` - every person asked, in slot order - one line
 * each: who, whether they have approved, rejected or not answered yet, when, and what they said.
 * On a leave every one of them has to approve, so this is what tells somebody whose Pending request
 * has been waiting three days that two have said yes and whose answer it is still waiting on.
 */
export const attendanceRequestFormatters = {
  approverProgress: (approvers) => {
    if (!Array.isArray(approvers) || !approvers.length) return "—";
    return <ul className="mt-1 space-y-1.5">
      {approvers.map((approver, index) => {
        const decision = APPROVER_DECISIONS[approver.decision] || APPROVER_DECISIONS.PENDING;
        return <li key={approver.approverEmployeeId ?? index} className="rounded-md border border-slate-200 px-2.5 py-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate font-medium text-slate-800">{approver.approverName || "Approver"}</span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${decision.tone}`}>{decision.label}</span>
          </div>
          {approver.decidedAt && <p className="text-xs text-slate-500">{decidedOn.format(new Date(approver.decidedAt))}</p>}
          {approver.remarks && <p className="whitespace-pre-wrap text-xs text-slate-600">{approver.remarks}</p>}
        </li>;
      })}
    </ul>;
  },
};

/**
 * `attendanceRequestInfoSections` with the Period narrowed to this request's kind.
 *
 * The info panel shows every field it is given, dash and all, so one list for four kinds put a
 * column of dashes - From Time, Worked, Day Off - under every leave. Narrowed here, each kind reads
 * as only what it has.
 */
export function attendanceRequestSections(request) {
  const keep = new Set(PERIOD_FIELDS[request?.type] || PERIOD_FIELDS.DEFAULT);
  return attendanceRequestInfoSections.map((section) => (section.title === "Period"
    ? { ...section, fields: section.fields.filter(([key]) => keep.has(key)) }
    : section));
}

/**
 * A request as `attendanceRequestInfoSections` reads it, for the info panel and the full view.
 *
 * Each kind's period under its own names: a permission's day is its Date, a comp-off's is its Day
 * Off - the server sends both as `fromDate`, and a comp-off repeats it in `toDate` as well.
 */
export function attendanceRequestForInfo(request) {
  if (!request) return null;
  const isPermission = request.type === "PERMISSION";
  const isCompOff = request.type === "COMP_OFF";
  const credit = request.type === "COMP_OFF_CREDIT" ? request.compOffCredit || {} : null;
  // One day, like a permission's, read under Date rather than as a one-day span.
  const isIncorrectLogin = request.type === "INCORRECT_LOGIN";
  const singleDay = isPermission || isIncorrectLogin;
  return {
    ...request,
    // Approved, never Upcoming - the same reading as the table and its tabs.
    displayStatus: shownStatus(request),
    typeLabel: requestTypeLabel(request),
    // Both days where two half days bought the day off between them: the field names what the day
    // off actually cost, so a claim against two days never reads as a claim against one.
    workedDate: isCompOff ? compOffWorkedDates(request) : credit ? request.workedDate : "",
    creditDayKind: credit?.dayKind || "",
    creditLoginAt: credit?.loginAt || "",
    creditLogoutAt: credit?.logoutAt || "",
    creditWorked: credit?.workedLabel || "",
    creditStatus: credit?.creditStatus || "",
    creditExpiresOn: credit?.expiresOn || "",
    dayOff: isCompOff ? request.fromDate : "",
    permissionDate: singleDay ? request.fromDate : "",
    fromDate: singleDay || isCompOff || credit ? "" : request.fromDate,
    toDate: singleDay || isCompOff || credit ? "" : request.toDate,
    daysLabel: singleDay || isCompOff || credit || request.days == null ? "" : `${request.days} day${request.days === 1 ? "" : "s"}`,
    currentStatus: isIncorrectLogin ? request.currentStatus || "" : "",
    requestedStatus: isIncorrectLogin ? request.requestedStatus || "" : "",
    fromTime: isPermission ? clockDisplay(request.fromTime) : "",
    toTime: isPermission ? clockDisplay(request.toTime) : "",
    durationLabel: isPermission ? request.durationLabel : "",
    approvalsSummary: approvalSummary(request) === "-" ? "" : approvalSummary(request),
  };
}

/** One request as the table for `view` shows it. */
export function requestRow(request, view) {
  const shared = {
    id: request.id,
    raw: request,
    employeeName: request.employeeName || "-",
    employeeId: request.employeeCode || "-",
    reason: request.reason || "-",
    status: shownStatus(request),
    appliedOn: dateDisplay(request.createdAt),
    remarks: request.decisionRemarks || "-",
    /*
     * How far through its approvers the request is, as a count and never a name.
     *
     * A leave goes to everybody named on the record and needs all of them, so "Pending" alone does
     * not say whether it is waiting on three people or on one.
     */
    approvals: approvalSummary(request),
  };
  if (view === REQUEST_VIEW_PERMISSION) {
    return {
      ...shared,
      date: dateDisplay(request.fromDate),
      fromTime: clockDisplay(request.fromTime) || "-",
      toTime: clockDisplay(request.toTime) || "-",
      duration: request.durationLabel || "-",
    };
  }
  if (view === REQUEST_VIEW_COMP_OFF) {
    const isCredit = request.type === "COMP_OFF_CREDIT";
    return {
      ...shared,
      requestType: requestTypeLabel(request),
      workedOn: isCredit ? dateDisplay(request.workedDate) : compOffWorkedDates(request),
      // A credit is the day worked, not a day off: it has none.
      dayOff: isCredit ? "-" : dateDisplay(request.fromDate),
      creditStatus: isCredit ? request.compOffCredit?.creditStatus || "-" : "-",
    };
  }
  if (view === REQUEST_VIEW_APPROVALS) {
    const period = request.type === "PERMISSION"
      ? `${dateDisplay(request.fromDate)} ${clockDisplay(request.fromTime)} - ${clockDisplay(request.toTime)}`
      : request.type === "COMP_OFF"
        ? `${dateDisplay(request.fromDate)} (for ${compOffWorkedDates(request)})`
        : request.type === "COMP_OFF_CREDIT"
        ? `Worked ${dateDisplay(request.workedDate)}`
        : request.fromDate === request.toDate ? dateDisplay(request.fromDate) : `${dateDisplay(request.fromDate)} - ${dateDisplay(request.toDate)}`;
    return {
      ...shared,
      requestType: requestTypeLabel(request),
      period,
      duration: request.type === "PERMISSION" ? request.durationLabel || "-" : request.type === "COMP_OFF_CREDIT" ? request.compOffCredit?.workedLabel || "-" : request.days == null ? "-" : `${request.days} day${request.days === 1 ? "" : "s"}`,
    };
  }
  return {
    ...shared,
    leaveType: requestTypeLabel(request),
    fromDate: dateDisplay(request.fromDate),
    toDate: dateDisplay(request.toDate),
    // Null means the stored dates do not describe a span. The old screen clamped that to 1 and
    // showed a backwards leave as a single day.
    days: request.days == null ? "-" : request.days,
  };
}

/*
 * What a row offers each side - the raiser's View / Edit / Revert back / Delete, the approver's
 * Approve / Reject / Send back - comes from `lib/attendanceRequestStatus`, where it is tested
 * against the lists the server keeps.
 */
export { requestActionItems, awaitsMe, maySendBack, inMyQueue, editPrefill } from "@/lib/attendanceRequestStatus.mjs";

/**
 * Answering somebody else's request: approve, reject, or send it back to be fixed.
 *
 * Approving asks for nothing more. Rejecting and sending back each ask for the reason, required,
 * since it is what the raiser is told - and they are different answers: a rejection ends the ask,
 * sending it back returns it, every answer cleared, for the raiser to correct and resubmit. The
 * server holds all three to the same rules.
 */
const DECISION_COPY = {
  approve: { title: "Approve request", action: "Approve", tone: "primary" },
  reject: {
    title: "Reject request", action: "Reject", tone: "danger",
    label: "Reason for rejection", placeholder: "Say why this is being rejected",
    helper: "The raiser is told this reason; a rejection ends the request.",
  },
  "send-back": {
    title: "Send request back", action: "Send back", tone: "primary",
    label: "What needs fixing",
    helper: "The raiser is told this, so they can correct and resend it.",
    // The one answer that is useless without a reason: the raiser is being asked to change
    // something, and has to be told what.
    placeholder: "Say why it is going back - the dates, the reason, what to change",
    note: "Every approval given so far is cleared. It goes back to the raiser to correct and send again.",
  },
};

/**
 * The approver's answer to one request (`request`), or - with `count` and no `request` - to the
 * ticked ones together, where one remark is given to every one of them.
 */
/**
 * The amounts a comp-off credit may be granted: 0, 0.5, 1 … up to the days worked.
 *
 * A day worked on a weekly off or a holiday used to be worth exactly one day off, and approving it
 * was a yes. The studio grants **an amount** instead - half a day for a short day, and one figure for
 * a run of days worked back to back. The run's length is what the list goes up to, so a two-day run
 * offers up to 2 and a single day up to 1.
 *
 * `null` for every other kind of request, where approving carries no number.
 */
const HALF = 0.5;

function grantChoicesFor(request) {
  const credit = request?.raw?.type === "COMP_OFF_CREDIT" ? request.raw : null;
  if (!credit) return null;
  const from = String(credit.workedDate || "").slice(0, 10);
  const to = String(credit.workedToDate || credit.workedDate || "").slice(0, 10);
  if (!from) return null;
  const days = Math.max(1, Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86400000) + 1);
  const choices = [];
  for (let amount = 0; amount <= days + 1e-9; amount += HALF) choices.push(Number(amount.toFixed(1)));
  return { choices, days };
}

const grantLabel = (amount) => (amount === 0 ? "Nothing" : `${amount} ${amount === 1 ? "day" : "days"}`);

export function DecisionDialog({ decision, request = null, count = 0, busy, onClose, onConfirm }) {
  const [remarks, setRemarks] = useState("");
  const copy = DECISION_COPY[decision] || DECISION_COPY.approve;
  const needsReason = Boolean(copy.label);
  /*
   * Only on approving a credit. Rejecting one carries no amount - refusing the ask and granting
   * nothing are different answers, and the history keeps them apart - and a bulk answer has no single
   * run to measure, so the picker is absent there rather than guessing one.
   */
  const grant = decision === "approve" && request ? grantChoicesFor(request) : null;
  // Opens on the whole run, which is what approving has always meant: the approver lowers it if the
  // day was short, rather than having to set the common answer every time.
  const [granted, setGranted] = useState(null);
  const chosen = granted === null ? grant?.days ?? null : granted;
  const fields = useFormErrors();
  // The reason is asked for on the press, under its own box.
  const submit = () => {
    if (busy || !fields.check({ remarks: needsReason && !remarks.trim() ? `Enter ${copy.label.toLowerCase()}.` : "" })) return;
    onConfirm(needsReason ? remarks.trim() : "", grant ? chosen : undefined);
  };
  // A regularization is a change to one day's status, so the approver is shown both ends of it -
  // the reason alone does not say what the day reads as now or what it would become.
  const regularization = request?.raw?.type === "INCORRECT_LOGIN" ? request.raw : null;
  return <Dialog
    title={request ? copy.title : `${copy.action} ${count} request${count === 1 ? "" : "s"}`}
    description={request
      ? `${request.requestType} for ${request.employeeName} — ${request.period}`
      : `The same ${needsReason ? "reason is" : "answer is"} given to every selected request.`}
    onClose={onClose}
    busy={busy}
    onSubmit={(event) => { event.preventDefault(); submit(); }}
    footer={<>
      <Button type="button" size="lg" onClick={onClose} className="font-semibold">Cancel</Button>
      <Button type="submit" variant={copy.tone} size="lg" disabled={busy} className="font-semibold disabled:bg-slate-300">
        {busy ? "Saving..." : copy.action}
      </Button>
    </>}
  >
    <div className="space-y-3 pb-2">
      {regularization && <RecordSummaryCard rows={[
        ["Current Status", regularization.currentStatus],
        ["Change To", regularization.requestedStatus],
      ]} />}
      {request && <p className="text-sm text-slate-700">{request.reason}</p>}
      {/*
        * **How much this is worth**, asked of the approver rather than assumed.
        *
        * Radios, not a dropdown: there are three options for a day and seven for a long run, all of
        * them worth seeing at once, and the answer is the point of the dialog rather than a detail
        * inside it. "Nothing" is spelled out, because `0` beside the other numbers reads as a missing
        * value rather than as a decision somebody made.
        */}
      {grant && <div>
        <p className="text-sm font-medium text-slate-800">
          How many days does this earn?
          {grant.days > 1 && <span className="font-normal text-slate-500"> {grant.days} days were worked.</span>}
        </p>
        <div role="radiogroup" aria-label="Days granted" className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
          {grant.choices.map((amount) => <label key={amount} className={`flex items-center gap-1.5 text-sm ${busy ? "cursor-default opacity-60" : "cursor-pointer"}`}>
            <input
              type="radio"
              name="grantedDays"
              className="h-4 w-4"
              value={amount}
              checked={chosen === amount}
              disabled={busy}
              onChange={() => setGranted(amount)}
            />
            <span className={chosen === amount ? "font-medium text-slate-900" : "text-slate-700"}>{grantLabel(amount)}</span>
          </label>)}
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          {chosen === 0
            ? "Approved, but earning nothing - the day is answered and adds no comp-off."
            : `${request.employeeName || "They"} get ${grantLabel(chosen)} off to take later.`}
          {" Every approver answers, and the lowest amount is what is granted."}
        </p>
      </div>}
      {copy.note && <p className="text-sm text-slate-500">{copy.note}</p>}
      {needsReason && <TextAreaField
        label={copy.label}
        helperText={copy.helper}
        required
        rows={3}
        value={remarks}
        onChange={(event) => { setRemarks(event.target.value); fields.clear("remarks"); }}
        error={fields.errors.remarks}
        placeholder={copy.placeholder}
      />}
    </div>
  </Dialog>;
}

/** The two answers Update offers over a selection. */
const BULK_DECISIONS = [{ value: "approve", label: "Approve" }, { value: "reject", label: "Reject" }, { value: "send-back", label: "Send back" }];

/**
 * Update over the ticked requests: the answer chosen from a drop-down - Approve, Reject or Send back -
 * and for a rejection or a send-back the one reason every one of them is given. `counts` is how many of the ticks each
 * answer would reach - an answer none of them can take is not offered. `onConfirm(verb, remarks)`.
 */
export function BulkDecisionDialog({ counts, busy, onClose, onConfirm }) {
  const options = BULK_DECISIONS.filter((option) => counts[option.value] > 0);
  const [verb, setVerb] = useState(options.length === 1 ? options[0].value : "");
  const [remarks, setRemarks] = useState("");
  const fields = useFormErrors();
  const copy = DECISION_COPY[verb];
  // Reject and Send back each ask a reason, which every request answered is given.
  const needsReason = Boolean(copy?.label);
  const count = counts[verb] || 0;
  const submit = () => {
    if (busy || !fields.check({
      decision: verb ? "" : "Choose Approve, Reject or Send back.",
      remarks: needsReason && !remarks.trim() ? `Enter ${copy.label.toLowerCase()}.` : "",
    })) return;
    onConfirm(verb, needsReason ? remarks.trim() : "");
  };
  return <Dialog
    title="Update requests"
    description={verb
      ? `${copy.action} ${count} request${count === 1 ? "" : "s"}${needsReason ? " - the same reason is given to every one." : "."}`
      : "Choose the answer to give every selected request waiting for you."}
    onClose={onClose}
    busy={busy}
    onSubmit={(event) => { event.preventDefault(); submit(); }}
    footer={<>
      <Button type="button" size="lg" onClick={onClose} className="font-semibold">Cancel</Button>
      <Button type="submit" variant={copy?.tone || "primary"} size="lg" disabled={busy} className="font-semibold disabled:bg-slate-300">
        {busy ? "Saving..." : copy ? `${copy.action} ${count}` : "Update"}
      </Button>
    </>}
  >
    <div className="space-y-3 pb-2">
      <Dropdown
        label="Decision"
        ariaLabel="Approve, reject or send back the selected requests"
        required
        sorted={false}
        placeholder="Approve, Reject or Send back"
        value={verb}
        options={options}
        onChange={(next) => { setVerb(next); fields.clear("decision"); }}
        disabled={busy}
        error={fields.errors.decision}
      />
      {copy?.note && <p className="text-sm text-slate-500">{copy.note}</p>}
      {needsReason && <TextAreaField
        label={copy.label}
        required
        rows={3}
        value={remarks}
        onChange={(event) => { setRemarks(event.target.value); fields.clear("remarks"); }}
        error={fields.errors.remarks}
        placeholder={copy.placeholder}
      />}
    </div>
  </Dialog>;
}
