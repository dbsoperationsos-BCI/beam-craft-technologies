"use client";

import { useState } from "react";
import ErrorOutlineOutlinedIcon from "@mui/icons-material/ErrorOutlineOutlined";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";
import TextAreaField from "@/components/shared/TextAreaField";
import TimeField from "@/components/shared/TimeField";
import Dialog from "@/components/ui/Dialog";
import { clockMinutes, formatTotalMinutes, isoDate } from "@/lib/attendanceTime.mjs";

/**
 * Asking to be away: leave, a permission, on-duty, or attendance from outside the office.
 *
 * Shared rather than living on the attendance screen, because the studio Schedule raises leave from
 * a calendar day as well. One dialog means one set of rules, one approver flow, and one place a
 * refusal has to be worded — two forms asking for the same thing would agree until the first time
 * either was changed.
 *
 * `prefill` seeds the fields: `{ fromDate, toDate }` from a calendar day, or a whole rejected
 * request when somebody applies again, in which case `supersedesId` travels with it and the title
 * says so.
 */

export default function QuickActionDialog({ action, settings, prefill, busy, onClose, onSubmit }) {
  const today = isoDate(new Date());
  const [form, setForm] = useState(() => ({
    fromDate: prefill?.fromDate || today,
    toDate: prefill?.toDate || today,
    fromTime: prefill?.fromTime || "",
    toTime: prefill?.toTime || "",
    reason: prefill?.reason || "",
  }));
  const isLeave = action === "LEAVE";
  const isPermission = action === "PERMISSION";
  /*
   * Keyed on `supersedesId`, not on `prefill` being present.
   *
   * A prefill only seeds the fields — the calendar passes one to start on today's date — while
   * re-applying is specifically raising a replacement for a request that was rejected. Titling on
   * the prefill made every seeded form announce itself as "Apply again", which is a claim about
   * what the person is doing rather than a convenience about what is already typed in.
   */
  const title = prefill?.supersedesId ? "Apply again" : isLeave ? "Apply for leave" : isPermission ? "Request Permission" : action === "OUTSIDE_LOCATION" ? "Request outside attendance" : "Mark on-duty / travel";

  const problem = validate();
  const canSubmit = !problem && Boolean(form.reason.trim()) && !busy;

  function validate() {
    if (isPermission) {
      if (!form.fromDate) return "Choose the date.";
      if (!form.fromTime || !form.toTime) return "Enter both times.";
      if (form.toTime <= form.fromTime) return "The To time must be later than the From time.";
      /*
       * The limit has to be known before a request can be let through, not merely consulted if it
       * happens to be there. `settings?.maxPermissionMinutes && ...` skipped the check whenever the
       * rules had not loaded - which is how a three-hour-three-minute permission got as far as a
       * Raise request button that looked enabled and a refusal that only arrived from the server.
       */
      const limit = Number(settings?.maxPermissionMinutes);
      if (!Number.isFinite(limit) || limit <= 0) {
        return "The attendance rules have not loaded, so this cannot be checked against the permission limit yet. Close this and try again in a moment.";
      }
      const minutes = clockMinutes(form.toTime) - clockMinutes(form.fromTime);
      if (minutes > limit) {
        // Says the limit, what was actually asked for, and both ways out of it - a bare "too long"
        // leaves the person to work out by how much.
        return `A permission cannot be longer than ${formatTotalMinutes(limit)}, and this one is ${formatTotalMinutes(minutes)}. Shorten it, or apply for leave instead.`;
      }
      return "";
    }
    if (!form.fromDate || !form.toDate) return "Choose both dates.";
    if (form.toDate < form.fromDate) return "The To date cannot be earlier than the From date.";
    return "";
  }

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submit(event) {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      type: action,
      fromDate: form.fromDate,
      // A permission covers one day, so both ends of the range are the date that was chosen.
      toDate: isPermission ? form.fromDate : form.toDate,
      fromTime: isPermission ? form.fromTime : null,
      toTime: isPermission ? form.toTime : null,
      reason: form.reason.trim(),
      supersedesId: prefill?.supersedesId || null,
    });
  }

  const duration = isPermission && form.fromTime && form.toTime && form.toTime > form.fromTime
    ? formatTotalMinutes(clockMinutes(form.toTime) - clockMinutes(form.fromTime))
    : "";
  const days = !isPermission && form.fromDate && form.toDate && form.toDate >= form.fromDate
    ? Math.round((new Date(form.toDate) - new Date(form.fromDate)) / 86400000) + 1
    : null;

  return <Dialog
    title={title}
    description={prefill ? "This re-raises a rejected request. The original and its refusal are kept." : undefined}
    onClose={onClose}
    busy={busy}
    onSubmit={submit}
    footer={<>
      <Button type="button" size="lg" onClick={onClose} className="font-semibold">Cancel</Button>
      <Button type="submit" variant="primary" size="lg" disabled={!canSubmit} className="font-semibold">{busy ? "Raising..." : "Raise request"}</Button>
    </>}
  >
    <div className="space-y-4 pb-2">
      {isPermission ? <>
        <DateField label="Date" required value={form.fromDate} onChange={(value) => update("fromDate", value)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <TimeField label="From time" required value={form.fromTime} onChange={(event) => update("fromTime", event.target.value)} />
          <TimeField label="To time" required value={form.toTime} onChange={(event) => update("toTime", event.target.value)} />
        </div>
      </> : <div className="grid gap-3 sm:grid-cols-2">
        <DateField label="From date" required value={form.fromDate} onChange={(value) => update("fromDate", value)} />
        <DateField label="To date" required value={form.toDate} onChange={(value) => update("toDate", value)} />
      </div>}
      <TextAreaField label="Reason" required rows={4} value={form.reason} onChange={(event) => update("reason", event.target.value)} placeholder="Enter reason" />
      {/*
        * The span and the refusal are shown together rather than one replacing the other. Losing
        * "Duration: 3h 3m" the moment it became a problem took away the number the message is
        * about, which is the one thing the person needs in order to fix it.
        */}
      {duration || days
        ? <p className="text-xs font-medium text-slate-600">{isPermission ? `Duration: ${duration}` : `${days} day${days === 1 ? "" : "s"}`}</p>
        : null}
      {problem
        ? <p role="alert" className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
          <ErrorOutlineOutlinedIcon sx={{ fontSize: 16 }} className="mt-px shrink-0" />
          <span>{problem}</span>
        </p>
        : null}
    </div>
  </Dialog>;
}
