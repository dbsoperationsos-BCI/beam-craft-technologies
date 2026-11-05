"use client";

import { useEffect, useRef, useState } from "react";
import Button from "@/components/shared/Button";
import CheckboxGroupField from "@/components/shared/CheckboxGroupField";
import DateField from "@/components/shared/DateField";
import Dropdown from "@/components/shared/Dropdown";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import RadioGroupField from "@/components/shared/RadioGroupField";
import TextField from "@/components/shared/TextField";
import TimeField from "@/components/shared/TimeField";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import HelpTip from "@/components/shared/HelpTip";
import useFormErrors from "@/components/shared/useFormErrors";
import { errorMessage } from "@/components/hrm/attendanceRequests";
import { isBlankText } from "@/lib/formErrors.mjs";
import { formatDate } from "@/lib/preProductionFormat";
import { saveAttendanceSettings } from "@/services/hrm/attendance.service";

/*
 * The studio's attendance rules - the working day. Each branch's office
 * location is not set here for now; any already recorded are kept and still measured against.
 *
 * It was the Rules section of Employee Attendance, then the account menu's Rules; it is Settings →
 * Employee → Attendance Rules now (`settings/AttendanceRulesSettingsPanel`), an administrator's
 * alone, since the rules are the studio's rather than one person's attendance.
 */

/** What a "month" is for Casual Leave and the Permissions limit - the calendar month, or Payroll rules' pay cycle. */
const PERIOD_OPTIONS = [
  { value: "CALENDAR_MONTH", label: "Calendar month" },
  { value: "PAY_CYCLE", label: "Pay cycle" },
];

/**
 * The fields each section saves - its own, and nothing another section shows - and the name its
 * notice says. A section's Save sends these alone; the server reads the rest as they are stored.
 */
const SECTIONS = {
  workingDay: { name: "Working day", fields: ["shiftStart", "shiftEnd", "lateGraceMinutes", "dailyTargetMinutes", "halfDayMinMinutes", "earlyExitGraceMinutes", "weeklyOffDays", "attendanceStartDate"] },
  casualLeave: { name: "Casual Leave", fields: ["casualLeavePerMonth", "casualLeaveMonthlyCarry", "casualLeaveYearCarryMax", "casualLeavePeriod"] },
  permissions: { name: "Permissions", fields: ["maxPermissionMinutes", "permissionsPerPeriod", "permissionPeriod"] },
  compOff: { name: "Comp-Off", fields: ["compOffExpiryDays"] },
  penalty: { name: "Irregularity penalty", fields: ["irregularityPenaltyDays"] },
};

/** Extra loss-of-pay days for a day still Absent: none, or whole and half days up to 3. */
const PENALTY_OPTIONS = [
  { value: "0", label: "No penalty" },
  ...[0.5, 1, 1.5, 2, 2.5, 3].map((daysOf) => ({ value: String(daysOf), label: `${daysOf} ${daysOf === 1 ? "day" : "days"} of LOP` })),
];

/** Whether a field reads the same on the form as saved: "15" typed is 15 stored, and ticked days in any order. */
function sameValue(first, second) {
  if (Array.isArray(first) || Array.isArray(second)) {
    const listed = (value) => [...(value || [])].map(String).sort().join(",");
    return listed(first) === listed(second);
  }
  // "0.5" chosen is 0.50 stored.
  const [a, b] = [String(first ?? ""), String(second ?? "")];
  if (a !== "" && b !== "" && Number.isFinite(Number(a)) && Number.isFinite(Number(b))) return Number(a) === Number(b);
  return a === b;
}

/** The seven days, `{ value, label }`, Sunday first as `Date.getDay()` numbers them. */
const weekdayOptions = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
  .map((label, value) => ({ value, label }));

/**
 * The working-day rules, for whoever holds HRM / Attendance Approval.
 *
 * Without this the settings row could only be changed through the API, and the numbers that decide
 * whether everybody in the studio was late would be as unreachable as the hardcoded ones they
 * replaced.
 */
/**
 * `readOnly` for everybody without `HRM / Attendance Rules` at Read / Write: the same rules, shown as values, with nothing to
 * press - every employee is judged by them, so every employee may read them, but only an
 * holder of that permission changes them (the server refuses anybody else as well).
 */
export default function AttendanceRulesPanel({ settings, onSaved, onNotice, onError, readOnly = false }) {
  const [form, setForm] = useState(() => ({ ...settings }));
  // The section being saved, and the one whose save is waiting on a confirmation.
  const [saving, setSaving] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const savedRef = useRef(settings);
  const justSaved = useRef(null);

  /*
   * The rules as stored, read again after a save. Each section saves on its own, so the reload must
   * not throw away what is being typed in another: a field changed there and not saved keeps its
   * edit, and the section just saved takes what the server stored.
   */
  useEffect(() => {
    const before = savedRef.current;
    const ownFields = justSaved.current ? SECTIONS[justSaved.current].fields : [];
    savedRef.current = settings;
    justSaved.current = null;
    setForm((current) => {
      const next = { ...settings };
      for (const key of Object.keys(current)) {
        if (!ownFields.includes(key) && !sameValue(current[key], before?.[key])) next[key] = current[key];
      }
      return next;
    });
  }, [settings]);

  const fields = useFormErrors();
  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    fields.clear(key);
  };
  // The shift times, marked under their own boxes when Save is pressed.
  const shiftProblems = () => ({
    shiftStart: isBlankText(form.shiftStart) ? "Enter the shift start." : "",
    shiftEnd: isBlankText(form.shiftEnd)
      ? "Enter the shift end."
      : !isBlankText(form.shiftStart) && form.shiftEnd <= form.shiftStart ? "Make the shift end later than the shift start." : "",
  });
  /*
   * The band, checked here as well as on the server so the refusal arrives while somebody is still
   * looking at the field. A day from "Half day from" up to the full day is half a day; below it is
   * too short to credit and reads as an absence, and a day that reaches the full day is a full day.
   */
  const halfDayProblem = Number(form.halfDayMinMinutes) > 0 && Number(form.halfDayMinMinutes) >= Number(form.dailyTargetMinutes)
    ? "Half day from must be less than the full day."
    : "";
  // Casual Leave is counted in whole and half days, as the server holds it.
  const halfDaysProblem = (value, max) => {
    const number = Number(value);
    if (String(value ?? "").trim() === "" || !Number.isFinite(number) || number < 0 || number > max) return `Enter 0 to ${max} days.`;
    return Number.isInteger(number * 2) ? "" : "Use whole or half days, like 1 or 1.5.";
  };
  const perMonthProblem = halfDaysProblem(form.casualLeavePerMonth ?? 0, 31);
  // How many permissions a period allows, in whole numbers; 0 is no limit.
  const permissionsValue = Number(form.permissionsPerPeriod ?? 0);
  const permissionsProblem = String(form.permissionsPerPeriod ?? 0).trim() === "" || !Number.isInteger(permissionsValue) || permissionsValue < 0 || permissionsValue > 31
    ? "Enter a whole number from 0 to 31."
    : "";
  const permissionsByPayCycle = form.permissionPeriod === "PAY_CYCLE";
  // Comp-off expiry, in whole days.
  const expiryValue = Number(form.compOffExpiryDays ?? 0);
  const compOffExpiryProblem = String(form.compOffExpiryDays ?? 0).trim() === "" || !Number.isInteger(expiryValue) || expiryValue < 0 || expiryValue > 366
    ? "Enter whole days from 0 to 366."
    : "";
  const yearCarryProblem = halfDaysProblem(form.casualLeaveYearCarryMax ?? 0, 366);
  const casualLeaveOn = Number(form.casualLeavePerMonth) > 0;
  // The words for the period Casual Leave is counted by, so every line under it says the same thing.
  const byPayCycle = form.casualLeavePeriod === "PAY_CYCLE";
  const period = byPayCycle
    ? { next: "the next pay cycle", buildUp: "cycle by cycle", each: "Each pay cycle's", end: "the end of the cycle" }
    : { next: "the next month", buildUp: "month by month", each: "Each month's", end: "the end of the month" };
  /*
   * The day the leave year turns, named rather than described: on the pay cycle it is the first day of
   * January's payroll cycle, which falls in the November before - "January's payroll" alone read as January.
   */
  const yearStart = settings?.casualLeaveYearStarts?.[byPayCycle ? "PAY_CYCLE" : "CALENDAR_MONTH"];
  const yearTurns = !yearStart
    ? byPayCycle ? "When January's payroll cycle starts" : "On 1 January"
    : byPayCycle
      ? `On ${formatDate(yearStart.startsOn)} - when January ${yearStart.year}'s payroll cycle starts`
      : `On ${formatDate(yearStart.startsOn)}`;

  /*
   * Moving "Attendance starts on" re-counts everybody's past days at once - an earlier date brings
   * Absent and Late back, a later one stops counting them - so a change to it is confirmed first.
   */
  const startChanged = (form.attendanceStartDate || "") !== (settings?.attendanceStartDate || "");
  /*
   * So does the Casual Leave policy: every balance is worked out from it, from each person's joining
   * month, so a change re-counts them all - and fewer days can turn leave already approved into Loss
   * of Pay. Confirmed first, like the start date.
   */
  const casualChanged = Number(form.casualLeavePerMonth ?? 0) !== Number(settings?.casualLeavePerMonth ?? 0)
    || (form.casualLeaveMonthlyCarry !== false) !== (settings?.casualLeaveMonthlyCarry !== false)
    || Number(form.casualLeaveYearCarryMax ?? 0) !== Number(settings?.casualLeaveYearCarryMax ?? 0)
    || (form.casualLeavePeriod || "CALENDAR_MONTH") !== (settings?.casualLeavePeriod || "CALENDAR_MONTH");
  // What stops each section's Save, and whether it has anything to save.
  const problems = {
    workingDay: halfDayProblem,
    casualLeave: perMonthProblem || yearCarryProblem,
    permissions: permissionsProblem,
    compOff: compOffExpiryProblem,
    penalty: "",
  };
  const changed = (section) => SECTIONS[section].fields.some((key) => !sameValue(form[key], settings?.[key]));
  const needsConfirming = { workingDay: startChanged, casualLeave: casualChanged };
  const requestSave = (section) => {
    if (section === "workingDay" && !fields.check(shiftProblems())) return;
    if (needsConfirming[section]) setConfirming(section); else save(section);
  };

  /** What a section sends: its own fields, in the types the server reads. */
  const payloads = {
    workingDay: () => ({
      shiftStart: form.shiftStart,
      shiftEnd: form.shiftEnd,
      lateGraceMinutes: Number(form.lateGraceMinutes),
      dailyTargetMinutes: Number(form.dailyTargetMinutes),
      weeklyOffDays: form.weeklyOffDays || [],
      halfDayMinMinutes: Number(form.halfDayMinMinutes),
        /*
         * The radius, the GPS accuracy ceiling and the enforcement flag are deliberately absent.
         *
         * They are no longer on this form, so this save has no business claiming a value for them.
         * The server's settings schema treats them as optional, so leaving them out keeps whatever
         * is stored rather than overwriting it — which is what a form that does not show a field
         * should do. Office locations below still record where each branch is, and the geofence
         * goes on measuring against the stored radius.
         */
      earlyExitGraceMinutes: Number(form.earlyExitGraceMinutes),
      // Blank clears it, so every recorded day counts again.
      attendanceStartDate: form.attendanceStartDate || null,
    }),
    casualLeave: () => ({
      casualLeavePerMonth: Number(form.casualLeavePerMonth ?? 0),
      casualLeaveMonthlyCarry: form.casualLeaveMonthlyCarry !== false,
      casualLeaveYearCarryMax: Number(form.casualLeaveYearCarryMax ?? 0),
      casualLeavePeriod: form.casualLeavePeriod || "CALENDAR_MONTH",
    }),
    permissions: () => ({
      maxPermissionMinutes: Number(form.maxPermissionMinutes),
      permissionsPerPeriod: Number(form.permissionsPerPeriod ?? 0),
      permissionPeriod: form.permissionPeriod || "CALENDAR_MONTH",
    }),
    compOff: () => ({ compOffExpiryDays: Number(form.compOffExpiryDays ?? 0) }),
    penalty: () => ({ irregularityPenaltyDays: Number(form.irregularityPenaltyDays ?? 0) }),
  };

  async function save(section) {
    setConfirming(null);
    if (problems[section] || saving) return;
    setSaving(section);
    try {
      await saveAttendanceSettings(payloads[section]());
      justSaved.current = section;
      await onSaved?.();
      onNotice?.(`${SECTIONS[section].name} saved.`);
    } catch (error) {
      onError?.(errorMessage(error, `Unable to save ${SECTIONS[section].name}.`));
    } finally {
      setSaving(null);
    }
  }

  // Each section's own Save, at its foot: on while it has something to save and nothing wrong with it.
  const saveButton = (section) => !readOnly && <div className="mt-4 flex justify-end">
    <Button type="button" variant="primary" onClick={() => requestSave(section)} disabled={Boolean(saving) || !changed(section) || Boolean(problems[section])} className="font-semibold">
      {saving === section ? "Saving..." : "Save"}
    </Button>
  </div>;

  return <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-3 sm:p-4 lg:p-5">
    <div className="w-full space-y-4">
      <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="flex items-center text-base font-semibold text-slate-950">Working day<HelpTip text="Every attendance status and every hours target in this module is decided by these numbers." /></h2>
        {readOnly && <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">These are the studio&rsquo;s attendance rules. Changing them needs the Attendance Rules permission.</p>}
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <TimeField label="Shift start" required value={form.shiftStart || ""} disabled={readOnly} onChange={(event) => update("shiftStart", event.target.value)} error={fields.errors.shiftStart} helperText="A login after this, plus the late grace, is marked Late." />
          <TimeField label="Shift end" required value={form.shiftEnd || ""} disabled={readOnly} onChange={(event) => update("shiftEnd", event.target.value)} error={fields.errors.shiftEnd} helperText="Leaving before this, less the early exit grace, is an early exit." />
          <TextField label="Late grace (minutes)" type="number" min={0} max={240} value={form.lateGraceMinutes ?? ""} readOnly={readOnly} onChange={(event) => update("lateGraceMinutes", event.target.value)} helperText="Minutes after the shift start a login still counts as on time." />
          <TextField label="Full day (minutes)" type="number" min={30} max={1440} value={form.dailyTargetMinutes ?? ""} readOnly={readOnly} onChange={(event) => update("dailyTargetMinutes", event.target.value)} helperText="Minutes worked that make a full day and set every hours target." />
          <TextField label="Half day from (minutes)" type="number" min={0} max={1440} value={form.halfDayMinMinutes ?? ""} readOnly={readOnly} onChange={(event) => update("halfDayMinMinutes", event.target.value)} error={halfDayProblem} helperText="From here up to the full day is a half day; less is absent." />
          <TextField label="Early exit grace (minutes)" type="number" min={0} max={240} value={form.earlyExitGraceMinutes ?? ""} readOnly={readOnly} onChange={(event) => update("earlyExitGraceMinutes", event.target.value)} helperText="Minutes before the shift end someone may leave without an early exit." />
        </div>
        <div className="mt-4">
          <CheckboxGroupField
            label="Weekly off"
            helperText="Days nobody is expected in; working one can earn a comp-off."
            options={weekdayOptions}
            value={form.weeklyOffDays || []}
            disabled={readOnly}
            onChange={(next) => update("weeklyOffDays", next)}
          />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DateField label="Attendance starts on" helperText="Nothing before this date counts for anyone: no Absent, no Late, no hours short, and no regularization. Staff who joined later count from their joining date. Leave it blank to count every day." placeholder="Not set: every day counts" value={form.attendanceStartDate || ""} readOnly={readOnly} onChange={(next) => update("attendanceStartDate", next || "")} />
        </div>
        {saveButton("workingDay")}
      </section>

      {/*
        Irregularity penalty: a working day still Absent - no login and no leave, too few hours, or a
        login never logged out - costs these extra days of loss of pay on top of the day itself, in
        payroll's Irregularity Penalty column. Getting it approved (a leave or a correction) clears the
        day and the penalty with it. A permission is never an irregularity.
      */}
      <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="flex items-center text-base font-semibold text-slate-950">Irregularity penalty<HelpTip text="A working day left Absent without an approved leave or correction costs these extra days of loss of pay, on top of the day itself. Permissions are not affected." /></h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Dropdown
            label="Penalty for each absent day"
            ariaLabel="Penalty for each absent day"
            options={PENALTY_OPTIONS}
            value={String(Number(form.irregularityPenaltyDays ?? 0))}
            readOnly={readOnly}
            onChange={(value) => update("irregularityPenaltyDays", value)}
            sorted={false}
            searchable={false}
            helperText="Extra loss-of-pay days payroll adds for each day still Absent."
          />
        </div>
        {saveButton("penalty")}
      </section>

      {/*
        Casual Leave: every approved Leave is Casual Leave. Each month credits these days; leave takes
        from the balance, and a day beyond it is Loss of Pay in payroll. 0 a month is no Casual Leave
        - every approved leave paid, as before.
      */}
      <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="flex items-center text-base font-semibold text-slate-950">Casual Leave<HelpTip text="Every approved leave takes from the Casual Leave balance, credited at the start of every month from the month each person joined. Leave beyond the balance is Loss of Pay." /></h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <TextField label="Casual leave per month (days)" type="number" min={0} max={31} step={0.5} value={form.casualLeavePerMonth ?? 0} readOnly={readOnly} onChange={(event) => update("casualLeavePerMonth", event.target.value)} error={perMonthProblem} helperText="0 turns Casual Leave off: every approved leave is paid." />
        </div>
        {/* The period and the two carry rules only mean something while Casual Leave is on, so they are shown only then. */}
        {casualLeaveOn && <>
          <div className="mt-4">
            <RadioGroupField
              label="Count Casual Leave by"
              helperText={form.casualLeavePeriod === "PAY_CYCLE"
                ? "Each pay cycle in Payroll rules credits the days - October's payroll is 25 Aug to 24 Sep with the cycle on the 25th - and a leave counts in the payroll that pays it. The year turns with January's payroll."
                : "Each month from the 1st to its last day credits the days. The year turns on 1 January."}
              value={form.casualLeavePeriod || "CALENDAR_MONTH"}
              disabled={readOnly}
              options={PERIOD_OPTIONS}
              onChange={(next) => update("casualLeavePeriod", next)}
            />
          </div>
          <div className="mt-4">
            <ToggleSwitch
              label={`Carry unused leave to ${period.next}`}
              helperText={form.casualLeaveMonthlyCarry !== false
                ? `Unused days build up ${period.buildUp} through the year.`
                : `${period.each} unused days lapse at ${period.end} - nothing carries into the next year.`}
              checked={form.casualLeaveMonthlyCarry !== false}
              disabled={readOnly}
              onCheckedChange={(checked) => update("casualLeaveMonthlyCarry", checked)}
            />
          </div>
          {/* Nothing reaches a new year when each month's leave lapses, so it is asked only with carry on. */}
          {form.casualLeaveMonthlyCarry !== false && <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <TextField label="Days carried into the next year" type="number" min={0} max={366} step={0.5} value={form.casualLeaveYearCarryMax ?? 0} readOnly={readOnly} onChange={(event) => update("casualLeaveYearCarryMax", event.target.value)} error={yearCarryProblem} helperText={`${yearTurns}, at most this many unused days carry over. 0 means all unused days lapse.`} />
          </div>}
        </>}
        {saveButton("casualLeave")}
      </section>

      {/*
        Permissions: how long one may be, and how many a month - or pay cycle - allows. A request past
        the limit is refused; 0 is no limit.
      */}
      <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="flex items-center text-base font-semibold text-slate-950">Permissions<HelpTip text="A permission is a few hours away on a working day. Set how long one can be and how many each employee may take." /></h2>
        {/* Always shown, first - as Casual Leave's - so the period is chosen before the number counted in it. */}
        <div className="mt-4">
          <RadioGroupField
            label="Count permissions by"
            helperText={permissionsByPayCycle
              ? "Each pay cycle in Payroll rules starts a fresh count - October's payroll is 25 Aug to 24 Sep with the cycle on the 25th - and a permission counts in the cycle its date falls in."
              : "Each month from the 1st to its last day starts a fresh count."}
            value={form.permissionPeriod || "CALENDAR_MONTH"}
            disabled={readOnly}
            options={PERIOD_OPTIONS}
            onChange={(next) => update("permissionPeriod", next)}
          />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <TextField label="Longest permission (minutes)" type="number" min={15} max={720} value={form.maxPermissionMinutes ?? ""} readOnly={readOnly} onChange={(event) => update("maxPermissionMinutes", event.target.value)} helperText="The most minutes one permission request may ask for, from 15." />
          <TextField label={`Permissions allowed per ${permissionsByPayCycle ? "pay cycle" : "month"}`} type="number" min={0} max={31} step={1} value={form.permissionsPerPeriod ?? 0} readOnly={readOnly} onChange={(event) => update("permissionsPerPeriod", event.target.value)} error={permissionsProblem}
            helperText={permissionsValue > 0 ? `A permission past ${permissionsValue} in a ${permissionsByPayCycle ? "pay cycle" : "month"} is refused. Pending, sent back and approved ones count.` : "0: no limit."} />
        </div>
        {saveButton("permissions")}
      </section>

      {/*
        Comp-Off: a full day's work on a weekly off or a declared holiday earns one working day off,
        which has to be taken within this many days of the day worked. 0 never expires.
      */}
      <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="flex items-center text-base font-semibold text-slate-950">Comp-Off<HelpTip text="A full day’s work on a weekly off or a declared holiday earns one working day off. Set how long it can be used." /></h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <TextField label="Comp-off expires after (days)" type="number" min={0} max={366} step={1} value={form.compOffExpiryDays ?? 0} readOnly={readOnly} onChange={(event) => update("compOffExpiryDays", event.target.value)} error={compOffExpiryProblem}
            helperText={expiryValue > 0 ? `The day off has to be taken within ${expiryValue} ${expiryValue === 1 ? "day" : "days"} of the day worked.` : "0: a comp-off never expires."} />
        </div>
        {saveButton("compOff")}
      </section>

      {/* The two saves that re-count everybody's past are confirmed first: the start date, and Casual Leave. */}
      {confirming && <ConfirmDialog
        title={confirming === "workingDay"
          ? form.attendanceStartDate ? `Count attendance from ${formatDate(form.attendanceStartDate)}?` : "Count attendance on every day?"
          : "Re-count Casual Leave for everyone?"}
        message={confirming === "workingDay"
          ? form.attendanceStartDate
            ? "Every employee's days before this date stop counting: no Absent, no Late, no hours short. Nothing is deleted - moving the date earlier counts those days again."
            : "Every recorded day counts again for every employee, including days before the old start date. You can set a start date again at any time."
          : "Every employee's Casual Leave balance is re-counted from when they joined under the new rules, so leave already approved may now be Loss of Pay - or no longer be. Payroll rows already paid or frozen do not change; changing the rules back restores the old balances."}
        confirmLabel={confirming === "workingDay" ? "Change start date" : "Save Casual Leave rules"}
        busyLabel="Saving..."
        loading={saving === confirming}
        tone="primary"
        onCancel={() => setConfirming(null)}
        onConfirm={() => save(confirming)}
      />}

      {/*
        The holiday calendar is not here any more.
        
        It was a date-and-name list on this screen, which put a *company-declared* holiday among
        the rules that judge one person's day. It is neither an attendance decision nor HR's: the
        studio deciding it is closed on the 20th is a studio setting, so it is declared on a
        calendar in Settings → Holidays, behind ADMIN / System Settings, and shows for everybody on
        the topbar Calendar. What a holiday *does* here is unchanged — a declared day is still
        taken out of every hours target and still reads as Holiday rather than as an absence.
      */}
    </div>
  </div>;
}
