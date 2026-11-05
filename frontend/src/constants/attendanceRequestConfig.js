/**
 * HRM → Request's Raise Request form, as data: the kind first, then the dates that kind asks for,
 * the reason, and who it will go to.
 *
 * The kind leads because it decides the rest of the form - a leave is a span of days, a permission
 * a date and two times, a comp-off the holiday worked and the day taken back - the same way the
 * payment request form asks its kind before its fields (`paymentRequestConfig`). Every field below
 * says which kinds ask for it through `when`.
 *
 * The approvers are shown, not chosen. They are set per employee by HR on Login Credentials and the
 * server routes the request to them; the form only says who that will be, so nobody raises a leave
 * without knowing whose queue it lands in.
 */

// A relative path, not the `@/` alias: this file is loaded directly by the Node test runner, which
// resolves no alias (`formPanelConfig.js` imports from `lib` the same way).
import { dayLabel, lastWorkedDay } from "../lib/attendanceTime.mjs";

export const RAISE_REQUEST_TYPES = [
  { value: "LEAVE", label: "Leave", description: "One or more days away." },
  { value: "PERMISSION", label: "Permission", description: "A few hours out of one working day." },
  // Stored as INCORRECT_LOGIN, which every request already raised keeps; shown as Correction. It
  // corrects any day's attendance status, an Incorrect login among them.
  { value: "INCORRECT_LOGIN", label: "Attendance Regularization", description: "Ask for a day's attendance status to be regularized." },
];

/*
 * A comp-off is raised as a Leave whose Leave Type is Comp-Off - not as a Request Type of its own - and
 * is still sent and stored as COMP_OFF, so the server's rules, the ledger, payroll and every request
 * already raised read it exactly as before. This is the one place that says which a form is.
 */
export const COMP_OFF_DESCRIPTION = "A working day off, for a weekly off or holiday you worked a full day on that your approvers have approved.";
export function requestTypeOf(values) {
  return values?.type === "LEAVE" && values?.leaveType === "COMP_OFF" ? "COMP_OFF" : values?.type;
}
/** A comp-off request opened again in the form reads as Leave, with Comp-Off as its Leave Type. */
export function formTypeFields(type, leaveType) {
  return type === "COMP_OFF" ? { type: "LEAVE", leaveType: "COMP_OFF" } : { type, leaveType: leaveType || "" };
}

const isType = (...types) => (values) => types.includes(requestTypeOf(values));

/**
 * The last day a comp-off earned on `workedDate` can be taken - Attendance Rules' Comp-off expiry, in
 * days after the day worked - or "" where it never expires. The server's `compOffExpiresOn`, so the
 * calendar stops where the server would refuse.
 */
export function compOffExpiresOn(workedDate, settings) {
  const days = Number(settings?.compOffExpiryDays);
  if (!workedDate || !Number.isInteger(days) || days <= 0) return "";
  const date = new Date(`${workedDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * What a leave is: Casual Leave takes from the balance (a day beyond it is Loss of Pay), Loss of Pay is
 * unpaid and never touches it. Asked on every leave, with nothing chosen for the person.
 */
export const LEAVE_TYPE_OPTIONS = [
  { value: "CL", label: "Casual Leave (CL)" },
  { value: "LOP", label: "Loss of Pay (LOP)" },
];
/** The Raise Request form's Leave Types: the two above, and Comp-Off - a day off taken back. */
export const RAISE_LEAVE_TYPE_OPTIONS = [...LEAVE_TYPE_OPTIONS, { value: "COMP_OFF", label: "Comp-Off" }];

/** The ISO day after `day`, or "" for none. Calendar arithmetic in UTC, so no timezone moves the day. */
/**
 * What the Day Off field says about its own window, naming the dates rather than the rule.
 *
 * Two different days govern the two ends, which is genuinely hard to hold in the head: the day off
 * has to come **after the later** day worked, and be taken **by the earlier** one's expiry, because
 * that is the credit that lapses first. Said as "before it expires" the reader is left to work out
 * which of her two days each end came from, and only finds out she guessed wrong on submit.
 */
export function compOffDayOffHelp(values, settings) {
  const last = lastWorkedDay(values);
  if (!last) return "The day you take off for the day you worked, before it expires.";
  const paired = Boolean(values.workedDate && values.workedPairDate);
  const expiresOn = compOffExpiresOn(values.workedDate, settings);
  const after = `after ${dayLabel(last)}${paired ? " (the later day you worked)" : ""}`;
  if (!expiresOn) return `Any working day ${after}.`;
  return `Any working day ${after}, and by ${dayLabel(expiresOn)}${paired ? " (the expiry of your earlier day)" : ""}.`;
}

/**
 * Whether a Day Off already chosen falls outside the window the chosen worked days allow - so picking
 * a different comp-off can clear it instead of leaving a date that is now impossible sitting in the
 * field until the server refuses it.
 */
export function compOffDayOffOutOfWindow(values, settings) {
  const chosen = values.fromDate;
  if (!chosen) return false;
  const last = lastWorkedDay(values);
  const expiresOn = compOffExpiresOn(values.workedDate, settings);
  return Boolean((last && chosen <= last) || (expiresOn && chosen > expiresOn));
}

export function dayAfter(day) {
  if (!day) return "";
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export const raiseRequestLeadFields = [
  {
    name: "type",
    label: "Request Type",
    helperText: "Choose what you are asking for; the dates below change to match.",
    type: "radio",
    required: true,
    colSpan: 2,
    options: RAISE_REQUEST_TYPES,
    // Re-applying re-raises the refused request, which the server holds to the same kind.
    props: (values, context) => ({ controlClassName: "px-0 py-0", disabled: Boolean(context?.reapplying) }),
    // The times, the worked day and the corrected status belong to one kind each, so a switch
    // cannot carry them into another.
    clears: ["fromTime", "toTime", "workedDate", "workedPairDate", "requestedStatus", "leaveType"],
  },
];

export const raiseRequestSections = [
  {
    id: "dates",
    title: "Date",
    fields: [
      // Chosen from the weekly offs and declared holidays attendance shows were worked a full day and not yet
      // claimed, each with its day and hours (`CompOffWorkedDayPicker`), rather than typed as a date.
      // A custom field is not required-checked by the panel; `requestFormProblems` asks for it.
      {
        name: "fromDate",
        label: (values) => (values.type === "PERMISSION" || values.type === "INCORRECT_LOGIN" ? "Date" : requestTypeOf(values) === "COMP_OFF" ? "Day Off" : "From Date"),
        type: "date",
        required: true,
        helperText: (values, context) => (values.type === "PERMISSION" ? "The working day you need the hours out on."
          : values.type === "INCORRECT_LOGIN" ? "The day whose attendance status needs correcting; today or earlier."
            // Names the two dates rather than saying "after the day worked": on a pair they are
            // different days, and which end came from which is not guessable.
            : requestTypeOf(values) === "COMP_OFF" ? compOffDayOffHelp(values, context?.settings)
              : "The first day of your leave."),
        // A comp-off's day off is after the day worked, so the earliest the calendar offers is the next
        // day, and the latest its expiry. A Correction is about a day that has happened, so the latest is today.
        props: (values, context) => ({
          // After the **last** day worked, and no later than the **first** one's expiry: where two
          // half days buy the day off between them, the earlier half is the credit that lapses first.
          minDate: requestTypeOf(values) === "COMP_OFF" ? dayAfter(lastWorkedDay(values)) : "",
          maxDate: values.type === "INCORRECT_LOGIN" ? context?.today || "" : requestTypeOf(values) === "COMP_OFF" ? compOffExpiresOn(values.workedDate, context?.settings) : "",
        }),
      },
      {
        name: "toDate",
        label: "To Date",
        helperText: "The last day of your leave; same as From Date for one day.",
        type: "date",
        required: true,
        when: isType("LEAVE"),
        props: (values) => ({ minDate: values.fromDate || "" }),
      },
      // Under a leave's dates, as always; Comp-Off then asks right here for the day worked.
      // What a leave is: Casual Leave, Loss of Pay, or a Comp-Off taken back. `requestFormProblems` asks for it.
      { name: "leaveType", label: "Leave Type", type: "radio", required: true, colSpan: 2, options: RAISE_LEAVE_TYPE_OPTIONS, when: (values) => values.type === "LEAVE", clears: ["workedDate", "workedPairDate"], props: () => ({ controlClassName: "px-0 py-0" }), helperText: "Casual Leave uses your balance, Loss of Pay is unpaid, Comp-Off repays a worked day." },
      { name: "workedDate", type: "custom", colSpan: 2, when: isType("COMP_OFF"), helperText: "Pick the weekly off or holiday you worked that this comp-off repays." },
      // Hour, minute and AM / PM rather than the browser's own box, which shows 24-hour on many machines.
      { name: "fromTime", label: "From Time", type: "time", required: true, when: isType("PERMISSION"), props: { twelveHour: true }, helperText: "The time you will step out on that day." },
      { name: "toTime", label: "To Time", type: "time", required: true, when: isType("PERMISSION"), props: { twelveHour: true }, helperText: "The time your permission ends and you are back at work." },
      // The span ("3 days", "Duration: 1h 30m") and, for a comp-off, what the server will check.
      { name: "periodSummary", type: "custom", colSpan: 2 },
    ],
  },
  {
    // The day as the server reads it, and what it should read as instead: one date, one status each.
    id: "attendanceCorrection",
    title: "Attendance Regularization",
    when: isType("INCORRECT_LOGIN"),
    fields: [{ name: "attendanceCorrection", type: "custom", colSpan: 2 }],
  },
  {
    id: "reason",
    title: "Reason",
    fields: [
      { name: "reason", label: "Reason", type: "textarea", required: true, colSpan: 2, props: { rows: 4, placeholder: "Why you need this." }, helperText: "Why you need this; your approvers read it before deciding." },
    ],
  },
  {
    id: "approvers",
    title: "Approvers",
    fields: [{ name: "approvers", type: "custom", colSpan: 2 }],
  },
];
