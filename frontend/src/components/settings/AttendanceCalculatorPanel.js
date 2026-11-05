"use client";

import { useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import TextField from "@/components/shared/TextField";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Tabs from "@/components/ui/Tabs";
import { MONTH_NAMES } from "@/lib/payrollRecovery.mjs";
import { getPayPeriod, savePayPeriod } from "@/services/hrm/attendance.service";

/**
 * Settings → Employee → Payroll rules → Attendance calculator: the studio's pay cycle, as two days of the month.
 *
 * - **Start Date** - the day the pay cycle turns over: 25 is "the 25th of one month to the 24th of
 *   the next" - the day before it is the cycle's last, so two months never share a day (the payroll's
 *   `payPeriodFor`); 1 is the calendar month, the 1st to its last day. Only this is typed.
 * - **End Date** - beside it, read only: worked out from Start Date (`endDayText`), so the two can
 *   never disagree.
 * - **Payable Date (Following Month)** - the day of the month after the cycle ends that its salary
 *   is paid out: 10 is the 10th. Beneath it, how many days' salary that holds back - from the end of
 *   the latest cycle to its payday (`holdDays`): 25 Sep to 10 Oct is 15.
 *
 * Above them, the pay cycle's kind as the shared tab bar: **Monthly**, which is what these two fields
 * are, then Weekly, Daily and Hourly - shown so the studio can see where this is going, and disabled
 * until each has its own settings (`CYCLE_TABS`).
 *
 * Both 1 to 31, the same every month, a day past a short month's end meaning its last day. Saved with
 * **Save**, after a confirmation saying the month it starts from: like every Payroll rules change, the
 * new days apply from the current month's payroll on, while earlier months keep the days they had (the
 * server's `payroll-register/settingsVersions`). Administrators only, as the Settings entry is; the
 * server checks as well.
 */

const DEFAULT_CYCLE_DAY = 25;

/** The cycle's last day, from its first: the day before it in the next month, or the month's last day. */
const endDayText = (day) => (day === 1 ? "Last day" : String(day - 1));
const DEFAULT_PAYBACK_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The pay cycle's kinds. Only Monthly works yet; the others are shown, and disabled. */
const CYCLE_TABS = [
  { id: "monthly", label: "Monthly" },
  { id: "weekly", label: "Weekly", disabled: true, title: "Coming soon" },
  { id: "daily", label: "Daily", disabled: true, title: "Coming soon" },
  { id: "hourly", label: "Hourly", disabled: true, title: "Coming soon" },
];

const ordinal = (day) => {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  return `${day}${{ 1: "st", 2: "nd", 3: "rd" }[day % 10] || "th"}`;
};
/**
 * What one pay cycle covers, as the payroll reads it: from the cycle day to the day before it in the
 * next month - 25 is 25 Sep to 24 Oct - or, on the 1st, the calendar month.
 */
const cycleText = (day) => (day === 1
  ? "Each pay cycle runs from the 1st to the last day of the month."
  : `Each pay cycle runs from the ${ordinal(day)} of one month to the ${ordinal(day - 1)} of the next.`);
const errorMessage = (error, fallback) => error?.data?.message || error?.message || fallback;

/** A whole day of the month, 1 to 31, from what was typed - or null. */
const dayOf = (text) => {
  const value = String(text ?? "").trim();
  if (!/^\d{1,2}$/.test(value)) return null;
  const day = Number(value);
  return day >= 1 && day <= 31 ? day : null;
};

/** That day in a month, at UTC midnight - a short month's last day where it has no such day. */
const dayInMonth = (year, monthIndex, day) => new Date(Date.UTC(year, monthIndex, Math.min(day, new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate())));

/**
 * How many days' salary is held: from the end of the latest pay cycle (its cycle day, on or before
 * today) to the payable day of the month after. 25 and 10 on 29 Sep: 25 Sep to 10 Oct, 15 days.
 */
function holdDays(cycleDay, paybackDay, today = new Date()) {
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  let end = dayInMonth(today.getFullYear(), today.getMonth(), cycleDay);
  if (end.getTime() > todayUtc) end = dayInMonth(today.getFullYear(), today.getMonth() - 1, cycleDay);
  const payable = dayInMonth(end.getUTCFullYear(), end.getUTCMonth() + 1, paybackDay);
  return Math.round((payable - end) / DAY_MS);
}

export default function AttendanceCalculatorPanel({ canWrite = false, onNotice, onError }) {
  // What is saved, and what is in the two boxes while being typed.
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState({ cycleDay: "", paybackDay: "" });
  const [loadError, setLoadError] = useState("");
  // Only Monthly can be chosen; the state is here so the others need only be switched on.
  const [cycle, setCycle] = useState("monthly");
  const [confirming, setConfirming] = useState(false);
  const { busy, run } = useSubmitOnce();
  // The month a change starts from - the server's answer is the studio's month in India.
  // The month a change starts from: the payroll month whose cycle is running, as the server says -
  // this calendar month only until it has.
  const [changesFrom, setChangesFrom] = useState(null);
  const thisMonth = changesFrom ? `${MONTH_NAMES[changesFrom.month - 1]} ${changesFrom.year}` : `${MONTH_NAMES[new Date().getMonth()]} ${new Date().getFullYear()}`;

  useEffect(() => {
    let cancelled = false;
    getPayPeriod()
      .then((response) => {
        if (cancelled) return;
        const values = { cycleDay: response?.data?.cycleDay || DEFAULT_CYCLE_DAY, paybackDay: response?.data?.paybackDay || DEFAULT_PAYBACK_DAY };
        setSaved(values);
        setDraft({ cycleDay: String(values.cycleDay), paybackDay: String(values.paybackDay) });
        setChangesFrom(response?.data?.changesFrom || null);
      })
      .catch((error) => { if (!cancelled) setLoadError(errorMessage(error, "Unable to load the pay cycle.")); });
    return () => { cancelled = true; };
  }, []);

  const cycleDay = dayOf(draft.cycleDay);
  const paybackDay = dayOf(draft.paybackDay);

  const changed = Boolean(saved) && cycleDay != null && paybackDay != null && (cycleDay !== saved.cycleDay || paybackDay !== saved.paybackDay);

  /** Saves both days together, once confirmed; a refusal keeps what was typed and says why. */
  const save = async () => {
    try {
      const response = await savePayPeriod({ cycleDay, paybackDay });
      const next = { cycleDay: response?.data?.cycleDay || cycleDay, paybackDay: response?.data?.paybackDay || paybackDay };
      const from = response?.data?.effectiveFrom;
      setSaved(next);
      setDraft({ cycleDay: String(next.cycleDay), paybackDay: String(next.paybackDay) });
      setConfirming(false);
      onNotice?.(`Pay cycle saved. It applies from the ${from ? `${MONTH_NAMES[from.month - 1]} ${from.year}` : thisMonth} payroll on; earlier months keep their days.`);
    } catch (error) {
      setConfirming(false);
      onError?.(errorMessage(error, "Unable to save the pay cycle."));
    }
  };
  // Enter in a box asks to save, as the button does.
  const saveOnEnter = (event) => { if (event.key === "Enter") { event.preventDefault(); if (changed) setConfirming(true); } };

  if (loadError) return <p className="text-xs text-rose-600 sm:text-sm">{loadError}</p>;
  if (!saved) return <p className="text-xs text-slate-500 sm:text-sm">Loading...</p>;

  const shownCycle = cycleDay ?? saved.cycleDay;
  const shownPayback = paybackDay ?? saved.paybackDay;
  const held = holdDays(shownCycle, shownPayback);

  return <div className="space-y-5">
    <Tabs ariaLabel="Pay cycle" tabs={CYCLE_TABS} value={cycle} onChange={setCycle} className="border-b border-slate-200" />
    {cycle === "monthly" && <div className="max-w-md space-y-5">
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <TextField
        label="Start Date"
        inputMode="numeric"
        maxLength={2}
        value={draft.cycleDay}
        readOnly={!canWrite}
        placeholder="25"
        helperText={cycleText(shownCycle)}
        error={draft.cycleDay !== "" && cycleDay == null ? "Enter a day from 1 to 31." : ""}
        onChange={(event) => setDraft((current) => ({ ...current, cycleDay: event.target.value.replace(/\D/g, "") }))}
        onKeyDown={saveOnEnter}
      />
      {/* Worked out from Start Date, never typed. */}
      <TextField label="End Date" value={endDayText(shownCycle)} readOnly />
      </div>
    </div>
    <div>
      <TextField
        label="Payable Date (Following Month)"
        inputMode="numeric"
        maxLength={2}
        value={draft.paybackDay}
        readOnly={!canWrite}
        placeholder="10"
        error={draft.paybackDay !== "" && paybackDay == null ? "Enter a day from 1 to 31." : ""}
        onChange={(event) => setDraft((current) => ({ ...current, paybackDay: event.target.value.replace(/\D/g, "") }))}
        onKeyDown={saveOnEnter}
      />
      <p className="mt-1.5 text-xs text-slate-500 sm:text-sm">{held} {held === 1 ? "day" : "days"} salary will be on hold</p>
    </div>
    {canWrite && <div className="flex justify-end">
      <Button type="button" variant="primary" disabled={!changed} onClick={() => setConfirming(true)}>Save</Button>
    </div>}
    </div>}
    {confirming && <ConfirmDialog
      open
      layer="dialogOverPanel"
      title="Change the pay cycle?"
      message={`The new days apply from the ${thisMonth} payroll on, in every branch. Earlier months keep the days they had, and the first month under a new cycle starts the day after the month before it ended - no day is skipped or counted twice.`}
      confirmLabel="Save pay cycle"
      busyLabel="Saving..."
      tone="primary"
      loading={busy}
      onCancel={() => setConfirming(false)}
      onConfirm={() => run(save)}
    />}
  </div>;
}
