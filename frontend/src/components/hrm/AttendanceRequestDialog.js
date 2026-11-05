"use client";

import { useState } from "react";
import ErrorOutlineOutlinedIcon from "@mui/icons-material/ErrorOutlineOutlined";
import Button from "@/components/shared/Button";
import CasualLeaveBalance from "@/components/hrm/CasualLeaveBalance";
import PermissionAllowance from "@/components/hrm/PermissionAllowance";
import CompOffWorkedDayPicker from "@/components/hrm/CompOffWorkedDayPicker";
import DateField from "@/components/shared/DateField";
import TextAreaField from "@/components/shared/TextAreaField";
import TimeField from "@/components/shared/TimeField";
import useFormErrors from "@/components/shared/useFormErrors";
import Dialog from "@/components/ui/Dialog";
import RadioGroupField from "@/components/shared/RadioGroupField";
import { LEAVE_TYPE_OPTIONS, compOffDayOffHelp, compOffDayOffOutOfWindow, compOffExpiresOn, dayAfter } from "@/constants/attendanceRequestConfig";
import { clockMinutes, formatTotalMinutes, isoDate, lastWorkedDay } from "@/lib/attendanceTime.mjs";
import { isBlankText } from "@/lib/formErrors.mjs";

/**
 * Asking to be away: leave, a permission, a comp-off, on-duty, or attendance from outside the office.
 *
 * Shared rather than living on the attendance screen, because the studio Schedule raises leave from
 * a calendar day as well. One dialog means one set of rules, one approver flow, and one place a
 * refusal has to be worded — two forms asking for the same thing would agree until the first time
 * either was changed. HRM → Request raises through a full form instead (`AttendanceRequestFormPanel`),
 * and that form checks and sends with `requestFormProblems` and `requestPayload` below, so the rule
 * of one set of refusals still holds.
 *
 * `prefill` seeds the fields: `{ fromDate, toDate }` from a calendar day, or a whole request being
 * edited, in which case `editing` travels with it and the title and the button say so.
 */

export default function QuickActionDialog({ action, settings, prefill, busy, editing = false, onClose, onSubmit }) {
  const today = isoDate(new Date());
  // A refusal from the server belongs on the form it is about - the overlap check and the comp-off
  // claim are the server's to make - rather than dropped, which left the dialog open and silent.
  const [error, setError] = useState("");
  const fields = useFormErrors();
  const [form, setForm] = useState(() => ({
    fromDate: prefill?.fromDate || today,
    toDate: prefill?.toDate || today,
    fromTime: prefill?.fromTime || "",
    toTime: prefill?.toTime || "",
    workedDate: prefill?.workedDate || "",
    // The second half day, where two halves buy the day off between them; "" on a whole-day claim.
    workedPairDate: prefill?.workedPairDate || "",
    // Casual Leave or Loss of Pay - asked, never assumed, on a new leave.
    leaveType: prefill?.leaveType || "",
    reason: prefill?.reason || "",
  }));
  /**
   * A comp-off chosen: both worked days at once, and a Day Off already typed is cleared when the new
   * choice no longer allows it. Switching from a pair to a single day moves both ends of the window,
   * so the old date could be before the day worked or past its expiry - and the reader would have
   * found that out only when the server refused it.
   */
  const pickWorkedDays = (chosen) => setForm((current) => {
    const next = { ...current, workedDate: chosen.workedDate, workedPairDate: chosen.workedPairDate };
    return compOffDayOffOutOfWindow(next, settings) ? { ...next, fromDate: "" } : next;
  });

  const isLeave = action === "LEAVE";
  const isPermission = action === "PERMISSION";
  /*
   * A comp-off asks for two days: the holiday or weekly off that was worked, and the working day
   * taken off in return. The server checks the first really was a day off and that attendance shows
   * them there, and that it has not been claimed already - none of which the browser can know.
   */
  const isCompOff = action === "COMP_OFF";
  // Outside attendance is about one day already marked, so it asks for that day alone.
  const isOneDay = action === "OUTSIDE_LOCATION";
  const isOnDuty = action === "ON_DUTY";
  /*
   * Keyed on `editing`, not on `prefill` being present.
   *
   * A prefill only seeds the fields — the calendar passes one to start on today's date — while an
   * edit is changing a request that already exists. Titling on the prefill made every seeded form
   * announce itself as something other than what it was, which is a claim about what the person is
   * doing rather than a convenience about what is already typed in.
   */
  const title = editing ? "Edit Request" : isLeave ? "Apply for leave" : isPermission ? "Request Permission" : isCompOff ? "Request comp-off" : action === "OUTSIDE_LOCATION" ? "Request outside attendance" : "Mark on-duty / travel";

  // The one thing no box can fix: the rules the permission is checked against have not arrived.
  const rulesProblem = requestRulesProblem(action, settings);

  function update(key, value) {
    fields.clear(key);
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submit(event) {
    event.preventDefault();
    if (busy || rulesProblem) return;
    setError("");
    if (!fields.check(requestFormProblems(action, form, { settings, today }))) return;
    Promise.resolve(onSubmit(requestPayload(action, form)))
      .catch((requestError) => {
        if (!fields.fromServer(requestError)) setError(requestError?.data?.message || requestError?.message || "Unable to save this request.");
      });
  }

  const duration = requestDurationLabel(action, form);

  return <Dialog
    title={title}
    description={editing ? "Saving clears every approval given so far, and all the approvers are asked again." : undefined}
    onClose={onClose}
    busy={busy}
    onSubmit={submit}
    footer={<>
      <Button type="button" size="lg" onClick={onClose} className="font-semibold">Cancel</Button>
      <Button type="submit" variant="primary" size="lg" disabled={busy || Boolean(rulesProblem)} className="font-semibold">{busy ? "Saving..." : editing ? "Save changes" : "Raise request"}</Button>
    </>}
  >
    <div className="space-y-4 pb-2">
      {isPermission ? <>
        <DateField label="Date" required helperText="The working day you need the permission on." value={form.fromDate} onChange={(value) => update("fromDate", value)} error={fields.errors.fromDate} />
        <div className="grid gap-3 sm:grid-cols-2">
          <TimeField label="From time" helperText="When you will step out." required twelveHour value={form.fromTime} onChange={(event) => update("fromTime", event.target.value)} error={fields.errors.fromTime} />
          <TimeField label="To time" helperText="When you will be back; it must fit the longest permission allowed." required twelveHour value={form.toTime} onChange={(event) => update("toTime", event.target.value)} error={fields.errors.toTime} />
        </div>
      </> : isCompOff ? <>
        <CompOffWorkedDayPicker value={form.workedDate} pairValue={form.workedPairDate} onChange={pickWorkedDays} disabled={busy} error={fields.errors.workedDate} helperText="Pick the weekly off or holiday you worked that this comp-off repays." />
        {/* The day off comes after the **later** day worked, and no later than the **earlier** one's
            expiry: on a pair, the first half is the credit that runs out first. The helper text names
            both dates, because which end came from which is not guessable. */}
        <DateField label="Day off" required helperText={compOffDayOffHelp(form, settings)} minDate={dayAfter(lastWorkedDay(form))} maxDate={compOffExpiresOn(form.workedDate, settings)} value={form.fromDate} onChange={(value) => update("fromDate", value)} error={fields.errors.fromDate} />
        <p className="text-xs text-slate-500">Listed are the weekly offs and declared holidays your attendance shows you worked a full day on. Each day worked can be claimed once.</p>
      </> : isOneDay ? <DateField label="Date" required helperText="The day this request is for." value={form.fromDate} onChange={(value) => update("fromDate", value)} error={fields.errors.fromDate} />
      : <>
      <div className="grid gap-3 sm:grid-cols-2">
        {/* On duty / travel is marked ahead or on the day, so its calendars start at today. A leave's
            do not - leave can be applied for a day already gone. */}
        <DateField label="From date" required helperText="The first day of the request." minDate={isOnDuty ? today : ""} value={form.fromDate} onChange={(value) => update("fromDate", value)} error={fields.errors.fromDate} />
        <DateField label="To date" required helperText="The last day of the request; the same as From for one day." minDate={isOnDuty ? (form.fromDate > today ? form.fromDate : today) : ""} value={form.toDate} onChange={(value) => update("toDate", value)} error={fields.errors.toDate} />
      </div>
      {/* Under the dates: what the leave is, then what it comes to - its working days, the Casual Leave
          available, and what that means for the type chosen. */}
      {isLeave && <RadioGroupField label="Leave Type" required helperText="Casual Leave uses your balance; Loss of Pay is deducted from salary." options={LEAVE_TYPE_OPTIONS} value={form.leaveType} onChange={(value) => update("leaveType", value)} disabled={busy} error={fields.errors.leaveType} />}
      {isLeave && <CasualLeaveBalance fromDate={form.fromDate} toDate={form.toDate} leaveType={form.leaveType} excludeRequestId={editing ? prefill?.id : null} />}
      </>}
      <TextAreaField label="Reason" required rows={4} helperText="Shown to your approvers when they decide on the request." value={form.reason} onChange={(event) => update("reason", event.target.value)} placeholder="Enter reason" error={fields.errors.reason} />
      {/*
        * The span stays beside the To time's refusal rather than being replaced by it. Losing
        * "Duration: 3h 3m" the moment it became a problem took away the number the message is
        * about, which is the one thing the person needs in order to fix it.
        */}
      {duration ? <p className="text-xs font-medium text-slate-600">{duration}</p> : null}

      {/* How many of the period's permissions are used, against Attendance Rules' limit. */}
      {isPermission && <PermissionAllowance date={form.fromDate} excludeRequestId={editing ? prefill?.id : null} />}
      {/* The server's refusal, the rules not loaded, or how many boxes are marked - each box says its own. */}
      {error || rulesProblem || fields.summary
        ? <p role="alert" className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
          <ErrorOutlineOutlinedIcon sx={{ fontSize: 16 }} className="mt-px shrink-0" />
          <span>{error || rulesProblem || fields.summary}</span>
        </p>
        : null}
    </div>
  </Dialog>;
}

/**
 * What is wrong with a request form as it stands, field by field - `{ fromDate: "Choose the date." }`,
 * "" for a field that is fine - for `useFormErrors` to put under each box.
 *
 * Shared by this dialog and HRM → Request's Raise Request form, so the two refuse the same things in
 * the same words. `today` is the local ISO day. The server checks every one of these again, and the
 * ones the browser cannot know - whether a worked day has a check-in, whether it was claimed.
 */
export function requestFormProblems(action, form, { settings, today }) {
  const problems = { reason: isBlankText(form.reason) ? "Enter the reason." : "" };
  if (action === "PERMISSION") {
    if (!form.fromDate) problems.fromDate = "Choose the date.";
    if (!form.fromTime) problems.fromTime = "Enter the From time.";
    if (!form.toTime) problems.toTime = "Enter the To time.";
    else if (form.fromTime && form.toTime <= form.fromTime) problems.toTime = "The To time must be later than the From time.";
    else if (form.fromTime) {
      // An unloaded limit is `requestRulesProblem`'s to say; it is not a fault in either box.
      const limit = Number(settings?.maxPermissionMinutes);
      const minutes = clockMinutes(form.toTime) - clockMinutes(form.fromTime);
      if (Number.isFinite(limit) && limit > 0 && minutes > limit) {
        // Says the limit, what was actually asked for, and both ways out of it - a bare "too long"
        // leaves the person to work out by how much.
        problems.toTime = `A permission cannot be longer than ${formatTotalMinutes(limit)}, and this one is ${formatTotalMinutes(minutes)}. Shorten it, or apply for leave instead.`;
      }
    }
    return problems;
  }
  if (action === "COMP_OFF") {
    const lastWorked = lastWorkedDay(form);
    if (!form.workedDate) problems.workedDate = "Choose the weekly off or holiday you worked.";
    else if (lastWorked >= today) problems.workedDate = "The day you worked has to be over before it can be claimed.";
    const expiresOn = compOffExpiresOn(form.workedDate, settings);
    if (!form.fromDate) problems.fromDate = "Choose the day you want off.";
    else if (lastWorked && form.fromDate <= lastWorked) problems.fromDate = "The day off has to be after the day you worked.";
    else if (expiresOn && form.fromDate > expiresOn) problems.fromDate = `This comp-off has to be taken by ${expiresOn} - it expires ${settings.compOffExpiryDays} days after the day worked.`;
    return problems;
  }
  if (action === "OUTSIDE_LOCATION") {
    if (!form.fromDate) problems.fromDate = "Choose the date.";
    return problems;
  }
  if (action === "INCORRECT_LOGIN") {
    if (!form.fromDate) problems.fromDate = "Choose the date.";
    else if (today && form.fromDate > today) problems.fromDate = "That day has not happened yet.";
    if (!form.requestedStatus) problems.requestedStatus = "Choose what the day should read as.";
    return problems;
  }
  // Not the choices by name: the Raise Request form offers Comp-Off as well, this dialog CL and LOP.
  if (action === "LEAVE" && !form.leaveType) problems.leaveType = "Choose the leave type.";
  if (!form.fromDate) problems.fromDate = "Choose the From date.";
  else if (action === "ON_DUTY" && today && form.fromDate < today) problems.fromDate = "On duty / travel cannot start on a day that has already passed.";
  if (!form.toDate) problems.toDate = "Choose the To date.";
  else if (form.fromDate && form.toDate < form.fromDate) problems.toDate = "The To date cannot be earlier than the From date.";
  return problems;
}

/**
 * Why a request cannot be checked yet, or "" - not a fault in any box, so said on its own.
 *
 * The permission limit has to be known before a request can be let through, not merely consulted if
 * it happens to be there. Skipping the check whenever the rules had not loaded is how a
 * three-hour-three-minute permission got as far as the server before it was refused.
 */
export function requestRulesProblem(action, settings) {
  if (action !== "PERMISSION") return "";
  const limit = Number(settings?.maxPermissionMinutes);
  return Number.isFinite(limit) && limit > 0
    ? ""
    : "The attendance rules have not loaded, so this cannot be checked against the permission limit yet. Close this and try again in a moment.";
}

/** "Duration: 1h 30m" for a permission, "3 days" for a span of days, "" until there is one to state. */
export function requestDurationLabel(action, form) {
  if (action === "PERMISSION") {
    return form.fromTime && form.toTime && form.toTime > form.fromTime
      ? `Duration: ${formatTotalMinutes(clockMinutes(form.toTime) - clockMinutes(form.fromTime))}`
      : "";
  }
  // A leave's days are said under its type, as working days (`CasualLeaveBalance`) - not its span here.
  if (action === "LEAVE" || action === "COMP_OFF" || action === "OUTSIDE_LOCATION" || action === "INCORRECT_LOGIN" || !form.fromDate || !form.toDate || form.toDate < form.fromDate) return "";
  const days = Math.round((new Date(form.toDate) - new Date(form.fromDate)) / 86400000) + 1;
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** The request as `POST /requests` takes it. */
export function requestPayload(action, form) {
  const isPermission = action === "PERMISSION";
  const isCompOff = action === "COMP_OFF";
  const isIncorrectLogin = action === "INCORRECT_LOGIN";
  return {
    type: action,
    fromDate: form.fromDate,
    // A permission, a comp-off, outside attendance and an Incorrect Login each cover one day, so both
    // ends are that date.
    toDate: isPermission || isCompOff || isIncorrectLogin || action === "OUTSIDE_LOCATION" ? form.fromDate : form.toDate,
    fromTime: isPermission ? form.fromTime : null,
    toTime: isPermission ? form.toTime : null,
    workedDate: isCompOff ? form.workedDate : null,
    workedPairDate: isCompOff ? form.workedPairDate || null : null,
    leaveType: action === "LEAVE" ? form.leaveType : null,
    // What the day should read as. Its current status is not sent: the server reads the day itself.
    requestedStatus: isIncorrectLogin ? form.requestedStatus : null,
    reason: form.reason.trim(),
  };
}
