"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import { requestDurationLabel, requestFormProblems, requestPayload, requestRulesProblem } from "@/components/hrm/AttendanceRequestDialog";
import CasualLeaveBalance from "@/components/hrm/CasualLeaveBalance";
import PermissionAllowance from "@/components/hrm/PermissionAllowance";
import CompOffWorkedDayPicker from "@/components/hrm/CompOffWorkedDayPicker";
import Dropdown from "@/components/shared/Dropdown";
import TextField from "@/components/shared/TextField";
import useFormErrors from "@/components/shared/useFormErrors";
import { COMP_OFF_DESCRIPTION, RAISE_REQUEST_TYPES, compOffDayOffOutOfWindow, formTypeFields, raiseRequestLeadFields, raiseRequestSections, requestTypeOf } from "@/constants/attendanceRequestConfig";
import { isoDate } from "@/lib/attendanceTime.mjs";
import { deleteAttendanceRequest, getCorrectionDay, getMyAttendanceApprovers } from "@/services/hrm/attendance.service";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

// What a kind of request is called inside a sentence - Comp-Off is a Leave Type now, not a Request Type.
const typeNoun = (type) => (type === "COMP_OFF" ? "comp-off" : RAISE_REQUEST_TYPES.find((option) => option.value === type)?.label.toLowerCase() || "");

/**
 * HRM → Request's one **Raise Request** form: the kind of request, its dates, the reason, and who it
 * goes to.
 *
 * One form rather than a button per kind, with the kind as its first question - the payment request
 * form's shape (`PaymentRequestFormPanel`). The fields each kind asks for live in
 * `attendanceRequestConfig`; the checks and the payload are `AttendanceRequestDialog`'s, which the
 * attendance screen and the Schedule still raise through, so a request is refused for the same
 * reasons in the same words wherever it is raised.
 *
 * The Approvers section is read from the server (`GET /requests/approvers`) - the same people the
 * request will be routed to - and is read-only: HR sets them on Login Credentials. With nobody set
 * for the chosen kind the form says so and will not send, since the server would refuse it anyway.
 *
 * `prefill` seeds the fields, and with `editing` it is this form over a request that already exists
 * (`editPrefill`): the same questions, saved with `PATCH`, which clears every approval given so far.
 * The kind is held either way - the server refuses an edit that changes what kind of request it is.
 */
/**
 * Who the request goes to, in words.
 *
 * A permission goes to the Permission Approver and nobody else - with none set it cannot be raised.
 * An attendance regularization goes to the Attendance Regularization Approver, or - with none set -
 * to the Permission Approver standing in (`regularizationRole`, from the server); with neither it
 * cannot be raised (`PERMISSION_APPROVER_ONLY`). Any other non-leave kind with no Permission Approver
 * falls to the Leave Approvers (`approversFor`), and more than one name there is that fallback and is
 * said as such. Every person listed has to approve, whatever the kind.
 */
// The kinds the server routes to one named approver alone, with nobody to fall back to (`approvals.js`).
const PERMISSION_APPROVER_ONLY = ["PERMISSION", "INCORRECT_LOGIN"];
function approverSentence(leaveKind, count, regularizationRole = null) {
  if (leaveKind) return count > 1 ? `Goes to all ${count} of your Leave Approvers, and every one of them has to approve it.` : "Goes to your Leave Approver.";
  if (regularizationRole === "REGULARIZATION_APPROVER") return "Goes to your Attendance Regularization Approver.";
  if (regularizationRole === "PERMISSION_APPROVER") return "No Attendance Regularization Approver is set for you, so it goes to your Permission Approver.";
  if (count > 1) return `No Permission Approver is set for you, so it goes to your ${count} Leave Approvers, and every one of them has to approve it.`;
  return "Goes to your Permission Approver.";
}

export default function AttendanceRequestFormPanel({ initialType = "LEAVE", prefill = null, settings, busy, editing = false, onClose, onSubmit }) {
  const [today] = useState(() => isoDate(new Date()));
  const [values, setValues] = useState(() => ({
    // A comp-off - raised before, or asked for by name - opens as Leave with Comp-Off chosen.
    ...formTypeFields(prefill?.type || initialType, prefill?.leaveType),
    fromDate: prefill?.fromDate || today,
    toDate: prefill?.toDate || today,
    fromTime: prefill?.fromTime || "",
    toTime: prefill?.toTime || "",
    workedDate: prefill?.workedDate || "",
    // The second half day, where two halves buy the day off between them; "" on a whole-day claim.
    workedPairDate: prefill?.workedPairDate || "",
    requestedStatus: prefill?.requestedStatus || "",
    reason: prefill?.reason || "",
  }));
  /*
   * A Correction's day, as the server reads it (`GET /requests/correction-day`): its current status by
   * the same classification the dashboard uses, and what it may be changed to - every correctable
   * status but that one. Shown and never typed: the server reads the day again when the request is
   * raised and at the final approval, so what is shown here is only ever a preview of what it checks.
   */
  const [dayStatus, setDayStatus] = useState({ date: "", currentStatus: "", options: [], message: "", loading: false, error: "" });
  const [approvers, setApprovers] = useState(null);
  const [approversError, setApproversError] = useState("");
  const [error, setError] = useState("");
  /*
   * A request already on that day - a leave, comp-off or permission, pending or approved - which the
   * server refuses this one beside (`REQUEST_CLASH`): asked about in a pop-up that names it, with the
   * choice to delete it and raise this one, or to leave both as they are. A rejected one never blocks.
   */
  const [clash, setClash] = useState(null);
  const [replacing, setReplacing] = useState(false);
  const fields = useFormErrors();
  const clearField = fields.clear;

  useEffect(() => {
    let live = true;
    getMyAttendanceApprovers()
      .then((response) => { if (live) setApprovers(response?.data || {}); })
      .catch((requestError) => { if (live) setApproversError(requestError?.data?.message || requestError?.message || "Unable to read your approvers."); });
    return () => { live = false; };
  }, []);

  const correcting = values.type === "INCORRECT_LOGIN";
  useEffect(() => {
    if (!correcting || !values.fromDate) return undefined;
    let live = true;
    const date = values.fromDate;
    // Deferred, like every other load on this screen: state is not set straight from an effect body.
    const timer = window.setTimeout(() => {
      setDayStatus({ date, currentStatus: "", options: [], message: "", loading: true, error: "" });
      getCorrectionDay(date)
        .then((response) => {
          if (!live) return;
          const day = response?.data || {};
          setDayStatus({ date, currentStatus: day.currentStatus || "", options: day.options || [], message: day.message || "", loading: false, error: "" });
        })
        .catch((requestError) => { if (live) setDayStatus({ date, currentStatus: "", options: [], message: "", loading: false, error: requestError?.data?.message || requestError?.message || "Unable to read that day's attendance." }); });
    }, 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [correcting, values.fromDate]);

  const change = useCallback((name, value) => {
    // A status chosen for one day is not a choice for another: a new date asks again.
    setValues((current) => ({ ...current, [name]: value, ...(name === "fromDate" && value !== current.fromDate ? { requestedStatus: "" } : {}) }));
    clearField(name);
    setError("");
  }, [clearField]);

  /**
   * A comp-off chosen: both worked days in one write, and a Day Off already chosen cleared when the
   * new choice no longer allows it - switching between a pair and a single day moves both ends of
   * that window, and the old date would otherwise sit there until the server refused it.
   */
  const pickWorkedDays = useCallback((chosen) => {
    setValues((current) => {
      const next = { ...current, workedDate: chosen.workedDate, workedPairDate: chosen.workedPairDate };
      return compOffDayOffOutOfWindow(next, settings) ? { ...next, fromDate: "" } : next;
    });
    clearField("workedDate");
    setError("");
  }, [clearField, settings]);

  // What is being asked for: a Leave with Comp-Off chosen is a comp-off, sent and checked as one.
  const type = requestTypeOf(values);
  // Held still between renders, so the memo below it is not rebuilt each time for a fresh empty list.
  const approversForType = useMemo(() => approvers?.[type] || [], [approvers, type]);
  const everyoneMustApprove = type === "LEAVE" || type === "COMP_OFF";
  // For a regularization: whether its approver is the one named for it, or the Permission Approver.
  const regularizationRole = type === "INCORRECT_LOGIN" ? approvers?.regularizationApproverRole || null : null;

  const context = useMemo(() => ({
    today,
    // The studio's rules, for the fields that follow them - a comp-off's day off stops at its expiry.
    settings,
    renderers: {
      attendanceCorrection: ({ error: correctionError }) => {
        // Another date's answer is never shown for this one: until this date's arrives, it is read.
        const current = dayStatus.date === values.fromDate ? dayStatus : { currentStatus: "", options: [], message: "", loading: true, error: "" };
        const shown = current.loading ? "Reading the day..." : current.currentStatus;
        const correctable = Boolean(current.currentStatus);
        return <div className="space-y-2">
          <p className="text-xs text-slate-500 sm:text-sm">Select a date to view its current attendance status and request its regularization.</p>
          <div className="grid gap-4 md:grid-cols-2">
            <TextField label="Current Status" helperText="What the day is marked as now, read from your attendance." readOnly value={shown} />
            {/* Searchable, like every picker here; the day's own status is never offered back. */}
            <Dropdown
              label="Change To"
              helperText="The status the day should be corrected to once approved."
              ariaLabel="Change the day's status to"
              required
              sorted={false}
              placeholder="Search status..."
              value={values.requestedStatus}
              options={current.options.map((status) => ({ label: status, value: status }))}
              onChange={(status) => change("requestedStatus", status)}
              disabled={busy || !correctable}
              error={correctionError || fields.errors.requestedStatus}
            />
          </div>
          {current.error && <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{current.error}</p>}
          {/*
            * What the server says about this day, when it has something to say.
            *
            * Two different sentences in one place, because both are the same answer - what the day
            * is and what that means for the request. Where the day cannot be corrected at all (one
            * still logged in, one attendance is not owed for) it explains what locks Change To.
            * Where it **can** but the calendar says the day was off - a holiday, a weekly off, which
            * a studio does shoot on - it says to raise it only if the day was actually worked, and
            * that the approver will see the day was off. Announced either way: it arrives after the
            * date is picked, which a reader looking at the Change To list would not otherwise catch.
            */}
          {!current.loading && !current.error && current.message && <p role="status" aria-live="polite" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {current.message}
          </p>}
          {!current.loading && !current.error && !current.message && !correctable && <p role="status" aria-live="polite" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            That day has no attendance status to correct.
          </p>}
        </div>;
      },
      // One choice sets both worked days: a day off paid for by two halves is picked once, not twice.
      workedDate: ({ field, error: workedDateError }) => <CompOffWorkedDayPicker value={values.workedDate} pairValue={values.workedPairDate} onChange={pickWorkedDays} disabled={busy} error={workedDateError} helperText={field?.helperText} />,
      periodSummary: () => {
        const span = requestDurationLabel(type, values);
        return <div className="space-y-1 text-xs text-slate-500 sm:text-sm">
          {span && <p className="font-medium text-slate-700">{span}</p>}
          {type === "COMP_OFF" && <p>Listed are the weekly offs and declared holidays you worked a full day on that your approvers have approved. Each can be used once.</p>}
          {type === "LEAVE" && <CasualLeaveBalance fromDate={values.fromDate} toDate={values.toDate} leaveType={values.leaveType} excludeRequestId={editing ? prefill?.id : null} />}
          {type === "PERMISSION" && <PermissionAllowance date={values.fromDate} excludeRequestId={editing ? prefill?.id : null} />}
        </div>;
      },
      approvers: () => {
        if (approversError) return <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{approversError}</p>;
        if (!approvers) return <p className="text-sm text-slate-500">Loading your approvers...</p>;
        if (!approversForType.length) {
          return <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {type === "INCORRECT_LOGIN"
              ? <>Neither an Attendance Regularization Approver nor a Permission Approver is set for you, so attendance regularization requests cannot be raised yet. Ask HR to set your Attendance Regularization Approver.</>
              : PERMISSION_APPROVER_ONLY.includes(type)
              ? <>Only your Permission Approver can decide {typeNoun(type) || "this"} requests, and none is set for you yet. Ask HR to set your Permission Approver.</>
              : <>Nobody is set to approve your {typeNoun(type) || "request"} requests yet. Ask HR to set your approvers on your Employee Preference.</>}
          </p>;
        }
        return <div className="space-y-2">
          <p className="text-xs text-slate-500 sm:text-sm">{approverSentence(everyoneMustApprove, approversForType.length, regularizationRole)}</p>
          <ol className="flex flex-col gap-1">
            {approversForType.map((person, index) => <li key={person.id} className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{index + 1}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm text-slate-800">{person.employeeName || "Unnamed employee"}</span>
                {person.employeeCode && <span className="block truncate text-xs text-slate-500">{person.employeeCode}</span>}
              </span>
            </li>)}
          </ol>
          <p className="text-xs text-slate-500">Approvers are set by HR on your Employee Preference.</p>
        </div>;
      },
    },
  }), [approvers, approversError, approversForType, busy, change, dayStatus, editing, everyoneMustApprove, fields.errors.requestedStatus, pickWorkedDays, prefill?.id, regularizationRole, settings, today, type, values]);

  function submit(event) {
    event.preventDefault();
    // The same checks the attendance screen's dialog makes, each under its own box, then the ones
    // only this form can: that the day was read, and that somebody is there to answer it.
    setError("");
    if (!fields.check(requestFormProblems(type, values, { settings, today }))) return;
    const rulesProblem = requestRulesProblem(type, settings);
    if (rulesProblem) { setError(rulesProblem); return; }
    // Said before sending rather than after the server refuses: only an Incorrect login is correctable.
    if (correcting && (dayStatus.loading || dayStatus.date !== values.fromDate)) {
      setError("Still reading that day's attendance. Try again in a moment.");
      return;
    }
    if (correcting && !dayStatus.currentStatus) {
      setError(dayStatus.message || "That day has no attendance status to correct.");
      return;
    }
    if (approvers && !approversForType.length) {
      setError(type === "INCORRECT_LOGIN"
        ? "Neither an Attendance Regularization Approver nor a Permission Approver is set for you, so attendance regularization requests cannot be raised yet. Ask HR to set your Attendance Regularization Approver."
        : PERMISSION_APPROVER_ONLY.includes(type)
        ? "No Permission Approver is set for you, and only they can decide this request. Ask HR to set your Permission Approver."
        : "Nobody is set to approve this kind of request yet. Ask HR to set your approvers.");
      return;
    }
    // A refusal from the server is shown here, on the form it is about, rather than in a notice on
    // the page underneath - the overlap check and the comp-off claim are the server's to make.
    send(requestPayload(type, values));
  }

  function send(payload) {
    return Promise.resolve(onSubmit(payload))
      .catch((requestError) => {
        if (requestError?.data?.code === "REQUEST_CLASH" && requestError.data.clash) {
          setClash({ ...requestError.data.clash, message: requestError.data.message, payload });
          return;
        }
        if (!fields.fromServer(requestError)) setError(requestError?.data?.message || requestError?.message || "Unable to save this request.");
      });
  }

  // Delete the request in the way, then raise this one as it was sent.
  async function replaceClash() {
    if (!clash || replacing) return;
    setReplacing(true);
    try {
      await deleteAttendanceRequest(clash.id);
      const { payload } = clash;
      setClash(null);
      await send(payload);
    } catch (deleteError) {
      setClash(null);
      setError(deleteError?.data?.message || deleteError?.message || "Unable to delete that request.");
    } finally {
      setReplacing(false);
    }
  }

  const clashWords = { LEAVE: "Leave", COMP_OFF: "Comp-off", PERMISSION: "Permission" };
  const day = (iso) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
  const clock = (value) => { const [hours, minutes] = String(value).split(":").map(Number); return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "am" : "pm"}`; };
  const clashDays = clash ? (clash.fromDate === clash.toDate ? day(clash.fromDate) : `${day(clash.fromDate)} to ${day(clash.toDate)}`) : "";
  return <>
  <SchemaFormPanel
    title={editing ? "Edit Request" : "Raise Request"}
    description={editing
      // What saving costs, said before it is saved: an approval of the old dates is not an approval
      // of the new ones, so every one given so far is cleared.
      ? "Saving clears every approval given so far, and all the approvers are asked again."
      : type === "COMP_OFF" ? COMP_OFF_DESCRIPTION : RAISE_REQUEST_TYPES.find((option) => option.value === type)?.description || "Choose what you are asking for."}
    sections={raiseRequestSections}
    leadFields={raiseRequestLeadFields}
    values={values}
    onChange={change}
    errors={fields.errors}
    context={context}
    sidebarAriaLabel="Request form sections"
    closeAriaLabel="Close request form"
    onClose={onClose}
    onSubmit={submit}
    error={error || fields.summary}
    saving={busy}
    submitLabel={editing ? "Save changes" : "Raise Request"}
    savingLabel="Saving..."
  />
  {clash && <ConfirmDialog
    layer="dialogOverPanel"
    title="That day already has a request"
    message={clash.message}
    confirmLabel="Delete it and raise this one"
    busyLabel="Deleting..."
    cancelLabel="Keep it"
    primaryAction="cancel"
    loading={replacing}
    onCancel={() => setClash(null)}
    onConfirm={replaceClash}
  >
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-slate-500">Request</dt><dd className="text-slate-900">{clashWords[clash.type] || clash.type}</dd>
      <dt className="text-slate-500">Status</dt><dd className="text-slate-900">{clash.status === "APPROVED" ? "Approved" : "Pending approval"}</dd>
      <dt className="text-slate-500">{clash.fromDate === clash.toDate ? "Date" : "Dates"}</dt><dd className="text-slate-900">{clashDays}{clash.fromTime && clash.toTime ? `, ${clock(clash.fromTime)} to ${clock(clash.toTime)}` : ""}</dd>
    </dl>
  </ConfirmDialog>}
  </>;
}
