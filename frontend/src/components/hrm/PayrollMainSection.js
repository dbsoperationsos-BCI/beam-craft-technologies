"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DataTable from "@/components/data-table/DataTable";
import DataTableShell from "@/components/data-table/DataTableShell";
import EditableCell from "@/components/data-table/EditableCell";
import KanbanBoard from "@/components/data-table/KanbanBoard";
import { columnTotal } from "@/lib/kanbanSummary.mjs";
import TableBoardSwitch, { useTableBoardLayout } from "@/components/data-table/TableBoardSwitch";
import TableFooter from "@/components/data-table/TableFooter";
import useTableSelection from "@/components/data-table/useTableSelection";
import { TableCellValue } from "@/components/data-table/tableCells";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";
import Dropdown from "@/components/shared/Dropdown";
import MonthField from "@/components/shared/MonthField";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import RecordSummaryCard from "@/components/shared/RecordSummaryCard";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import TextAreaField from "@/components/shared/TextAreaField";
import TextField from "@/components/shared/TextField";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import useUnsavedGuard from "@/components/shared/useUnsavedGuard";
import PayrollDeductionCell from "@/components/hrm/PayrollDeductionCell";
import PayrollRemovedRowsDialog from "@/components/hrm/PayrollRemovedRowsDialog";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dialog from "@/components/ui/Dialog";
import { MONTH_NAMES, REGISTER_YEARS, monthLabel, recoveryDate, rupees } from "@/lib/payrollRecovery.mjs";
import { PAYMENT_STATUSES, amountToPay, heldForNotice, noticeHoldOf, shownEmployeeName, shownPaymentStatus, divisorText, formComponentAmounts, payrollFigures, payrollFormErrors, payrollFormFor, payrollPayload } from "@/lib/payrollRegister.mjs";
import {
  getPayrollOptions,
  getPayrollRegister,
  markPayrollPaid,
  restorePayrollEntry,
  skipPayrollDeduction,
  syncPayroll,
  undoPayrollDeductionSkip,
  updatePayrollEntry,
} from "@/services/hrm/payrollRegister.service";

/*
 * HRM → Payroll → **Main Page**: the payroll register - one employee's pay for one month per row,
 * the studio's payroll sheet. A month is chosen in the header, and **it brings itself up to date as it
 * opens** - there is no Generate or Refresh (`syncPayroll`): for the month still being paid (until its
 * payable date passes) and every month after it, every working employee is given a row and every row
 * not paid or frozen is read again - the base salary, the loss-of-pay days over the pay cycle, the
 * cycle's days, the advance, the recovery and the policy breach due - so a change to attendance, Attendance Rules or
 * Payroll rules reaches them; a Base Salary or Attendance Leaves typed by hand stays as typed. A month
 * has no payroll until its pay cycle has ended - November's appears on 25 Oct, after its 25 Sep -
 * 24 Oct cycle - and says so in the empty table with the day it is made. An earlier month is left as
 * it was - filled in once, where it had no rows. At the right of the tabs,
 * the month's pay cycle and the day it is paid out, both from Settings → Payroll rules → Attendance
 * calculator. Each row's ⋮ edits what is typed (incentive, leaves,
 * deductions, remarks and the payment) or removes it. The totals, loss of pay and net and rounded salary are the server's, worked out under
 * Settings → Payroll rules; the form previews them as they are typed. The extra columns Settings →
 * Payroll rules adds sit in their section - an earning after Incentive, a deduction after Other
 * Deductions - typed in place like the rest, and counted in the totals. **Comp-Off Taken**, after
 * Casual Leave Taken, counts the approved comp-off days off - shown only, never in a total.
 *
 * **Policy Breach Deduction** is what Payroll → Policy Breach takes this month - a fine over months,
 * apart from the typed Policy Breach Leaves, which are loss-of-pay days.
 *
 * **Referral Bonus** is the other way round - an earning, after Incentive: the referral instalments
 * HRM → Employee Referral has due this month to this employee for a hire they introduced, with the
 * **Referral ID**s beside it. Brought in on generate and refresh, never typed, and counted only
 * where both they and the person they referred are still working. Paying the month is what records
 * those instalments as paid on the referral register, which is why that screen has no Mark paid.
 *
 * **Skip** beside a Salary Advance, Recovery Deduction or Policy Breach Deduction leaves that month's
 * deduction out: the advance comes off the next month instead, a recovery's or policy breach's run
 * ends a month later. A skipped cell says so (Skipped) with Undo. Each needs Payroll Advance, Payroll
 * Recovery or Payroll Policy Breach Read / Write beside this page's (`canSkipAdvance`,
 * `canSkipRecovery`, `canSkipPolicyBreach`), and a paid month offers none.
 *
 * **Freeze** (first in the Payment columns, before Payment Status) settles a row before it is paid: its figures stay as they are - no edit,
 * no update, no advance, recovery or skip reaching it, and the rules it was frozen under - until it
 * is unfrozen, while its payment can still be recorded. A switch in the cell for Read / Write.
 *
 * **Tick boxes** (with `ADMIN / Table Select All`, as on every register) offer Export, and for Read /
 * Write **Mark Paid** - the ticked rows paid with one payment mode, date and account - and Delete;
 * a paid row has no box, being settled.
 *
 * `HRM / Payroll Register`: Read shows the register; Read / Write brings it up to date on opening and adds the ⋮. Without
 * write those controls are absent, not disabled. A paid row's figures are settled - its form offers
 * only its payment - until it is set back to Pending. The server checks all of it again.
 */

const TABS = ["All", ...PAYMENT_STATUSES];
const statusStyles = { Pending: "bg-amber-500", Paid: "bg-emerald-500", "On Hold": "bg-slate-400" };
// The Board's columns: the payment statuses, in the tabs' order and colours.
const BOARD_COLUMNS = PAYMENT_STATUSES.map((status) => ({ value: status, label: status, className: `${statusStyles[status] || "bg-slate-400"} text-white` }));
const boardStatusOf = shownPaymentStatus;
// The board's trend counts a payroll row by its pay period's first day, else the 1st of its payroll month.
const payPeriodOf = (row) => {
  const time = row.periodFrom ? new Date(`${String(row.periodFrom).slice(0, 10)}T00:00:00`).getTime() : new Date(Number(row.year), Number(row.month) - 1, 1).getTime();
  return Number.isNaN(time) ? null : time;
};
const days = (value) => String(Number(value) || 0);

const columns = [
  { id: "month", label: "Month", value: (row) => MONTH_NAMES[row.month - 1] || "-" },
  { id: "year", label: "Year", value: (row) => String(row.year) },
  { id: "employeeCode", label: "Employee ID", value: (row) => row.employeeCode || "-" },
  { id: "employeeName", label: "Name", value: shownEmployeeName },
  { id: "branch", label: "Branch", value: (row) => row.branch || "-" },
  { id: "baseSalary", label: "Salary", value: (row) => rupees(row.baseSalary) },
  { id: "incentive", label: "Incentive", value: (row) => rupees(row.incentive) },
  // What HRM → Employee Referral owes this employee this month for a hire they introduced, with the
  // referrals it is for beside it. Brought in like Salary Advance is, never typed here.
  { id: "referralBonus", label: "Referral Bonus", value: (row) => rupees(row.referralBonus) },
  { id: "referralIds", label: "Referral ID", value: (row) => (row.referralIds || []).join(", ") || "-" },
  { id: "totalEarned", label: "Total Earned Salary", value: (row) => rupees(row.totalEarned) },
  // Every day away over the cycle - absences, half days as half, and approved leave.
  { id: "attendanceLeaves", label: "Attendance Leaves", value: (row) => days(row.attendanceLeaves) },
  // The leave Casual Leave covered (Settings → Attendance Rules) - paid, so Total Leaves takes it off.
  { id: "casualLeaveDays", label: "Casual Leave Taken", value: (row) => days(row.casualLeaveDays) },
  // The approved comp-off days off - paid like any working day, so shown only: Total Leaves never
  // counts them.
  { id: "compOffTakenDays", label: "Comp-Off Taken", value: (row) => days(row.compOffTakenDays) },
  // The pay cycle's days before the employee joined - unpaid, so Total Leaves adds them.
  { id: "daysBeforeJoining", label: "Before Joining", value: (row) => days(row.daysBeforeJoining) },
  // And after the relieving date - a leaver is paid up to their last day.
  { id: "daysAfterRelieving", label: "After Relieving", value: (row) => days(row.daysAfterRelieving) },
  { id: "policyBreachLeaves", label: "Policy Breach Leaves", value: (row) => days(row.policyBreachLeaves) },
  // Payroll → Policy Breach's LOP breaches, this month's share - brought in, apart from the typed leaves above.
  { id: "policyBreachLopDays", label: "Policy Breach LOP Days", value: (row) => days(row.policyBreachLopDays) },
  // Attendance Rules' irregularity penalty: extra loss of pay for each day still Absent, brought in.
  { id: "irregularityPenaltyDays", label: "Irregularity Penalty", value: (row) => days(row.irregularityPenaltyDays) },
  { id: "totalLeaves", label: "Total Leaves", value: (row) => days(row.totalLeaves) },
  { id: "lopDeduction", label: "LOP Deduction", value: (row) => rupees(row.lopDeduction) },
  { id: "salaryAdvance", label: "Salary Advance", value: (row) => rupees(row.salaryAdvance) },
  { id: "advanceIds", label: "Advance ID", value: (row) => (row.advanceIds || []).join(", ") || "-" },
  { id: "recoveryDeduction", label: "Recovery Deduction", value: (row) => rupees(row.recoveryDeduction) },
  { id: "recoveryIds", label: "Recovery ID", value: (row) => (row.recoveryIds || []).join(", ") || "-" },
  { id: "policyBreachDeduction", label: "Policy Breach Deduction", value: (row) => rupees(row.policyBreachDeduction) },
  { id: "policyBreachIds", label: "Policy Breach ID", value: (row) => (row.policyBreachIds || []).join(", ") || "-" },
  { id: "otherDeductions", label: "Other Deductions", value: (row) => rupees(row.otherDeductions) },
  { id: "remarks", label: "Remarks", value: (row) => row.remarks || "-" },
  { id: "totalDeductions", label: "Total Deductions", value: (row) => rupees(row.totalDeductions) },
  // Approved late changes to earlier, closed months, paid or taken back here.
  { id: "netSalary", label: "Net Salary", value: (row) => rupees(row.netSalary) },
  { id: "roundedSalary", label: "Rounded Salary", value: (row) => rupees(row.roundedSalary) },
  // Payroll rules → Hold salary during notice: a leaver's held month, or the full and final that pays them.
  { id: "noticeHold", label: "Final Settlement", value: (row) => noticeHoldOf(row, rupees)?.status || "-" },
  { id: "frozen", label: "Hold", value: (row) => (row.frozen ? "On hold" : "-") },
  // The branch the pay is booked to, chosen per row from every branch of the organisation.
  { id: "paymentStatus", label: "Payment Status", value: shownPaymentStatus },
  { id: "paymentMode", label: "Payment Mode", value: (row) => row.paymentMode || "-" },
  { id: "paymentFrom", label: "Payment From", value: (row) => row.paymentFrom || "-" },
  { id: "paymentDate", label: "Payment Date", value: (row) => recoveryDate(row.paymentDate) || "-" },
  { id: "paymentRemarks", label: "Payment Remarks", value: (row) => row.paymentRemarks || "-" },
];
/*
 * The columns' order, in the sheet's sections: who it is, what was earned, what comes off, what is
 * paid out, and how it was paid. Every column above sits in exactly one section; the month and year,
 * hidden to start, sit with the employee. The sections only order the columns - no band is drawn
 * over them.
 */
const COLUMN_GROUPS = [
  { id: "group-employee", columns: ["month", "year", "employeeCode", "employeeName", "branch"] },
  { id: "group-earnings", columns: ["baseSalary", "incentive", "referralBonus", "referralIds", "totalEarned"] },
  { id: "group-deductions", columns: ["attendanceLeaves", "casualLeaveDays", "compOffTakenDays", "daysBeforeJoining", "daysAfterRelieving", "policyBreachLeaves", "policyBreachLopDays", "irregularityPenaltyDays", "totalLeaves", "lopDeduction", "salaryAdvance", "advanceIds", "recoveryDeduction", "recoveryIds", "policyBreachDeduction", "policyBreachIds", "otherDeductions", "remarks", "totalDeductions"] },
  { id: "group-salary", columns: ["netSalary", "roundedSalary", "noticeHold"] },
  { id: "group-payment", columns: ["frozen", "paymentStatus", "paymentMode", "paymentFrom", "paymentDate", "paymentRemarks"] },
];
/** Where the month's extra columns go: an earning after Incentive, a deduction after Other Deductions. */
const EXTRA_SLOTS = { "group-earnings": { kind: "EARNING", after: "referralIds" }, "group-deductions": { kind: "DEDUCTION", after: "otherDeductions" } };
const extraId = (column) => `extra-${column.id}`;
/** A section's columns, with the month's extra columns of its kind in their slot. */
function sectionColumns(group, extraColumns) {
  const slot = EXTRA_SLOTS[group.id];
  if (!slot) return group.columns;
  const extras = extraColumns.filter((column) => column.kind === slot.kind).map(extraId);
  const at = group.columns.indexOf(slot.after) + 1;
  return [...group.columns.slice(0, at), ...extras, ...group.columns.slice(at)];
}
const COMPONENT_FIELD = "component:";
/*
 * The cells edited in place, as on the studio's sheet: what each saves as, and whether it is a figure
 * - settled once the month is Paid - or part of the payment, which stays editable. The worked-out
 * columns, the salary advance (Payroll → Advance Salary's), the recovery deduction (Payroll →
 * Recovery's), the policy breach deduction (Payroll → Policy Breach's) and the employee's own
 * details are not.
 */
const EDITABLE = {
  baseSalary: { type: "number", step: "0.01", figure: true },
  incentive: { type: "number", step: "0.01", figure: true },
  attendanceLeaves: { type: "number", step: "0.5", figure: true },
  policyBreachLeaves: { type: "number", step: "0.5", figure: true },
  otherDeductions: { type: "number", step: "0.01", figure: true },
  remarks: { type: "text", figure: true },
  paymentStatus: { type: "select" },
  paymentMode: { type: "select", field: "paymentModeId", clearable: true },
  paymentFrom: { type: "select", clearable: true },
  paymentDate: { type: "date" },
  paymentRemarks: { type: "text" },
};
/** Settled - paid, or frozen: its figures stay as they are. */
const settledRow = (row) => row.paymentStatus === "Paid" || Boolean(row.frozen);
/** Why a settled row's figure does not open, said on hover. */
const settledNote = (row) => (row.frozen ? "On hold - switch off Hold to edit" : "Paid - set it back to Pending to edit");
const frozenStyles = { "On hold": "bg-sky-500" };
const holdStyles = { "Held for notice": "bg-amber-500", "Final settlement": "bg-violet-500", Settled: "bg-emerald-500" };
/**
 * A paid row is settled, and a month held for notice is paid by its final settlement: nothing to tick
 * either for. Module level, so the table's columns stay put.
 */
const unpaidRow = (row) => row.paymentStatus !== "Paid" && !heldForNotice(row);
// Mark Paid's rows per request - the server's cap, each row checked and saved on its own.
const MARK_PAID_CHUNK = 100;
/** What the header box says - and why a paid row has none. */
const selectHeaderLabel = (checked) => (checked ? "Clear the selection" : "Select every unpaid row shown (paid rows are settled, and held months are paid with the final settlement)");
/** Up to `limit` names, then how many more: "Kavya, Arun and 3 more". */
const someNames = (names, limit) => (names.length > limit ? `${names.slice(0, limit).join(", ")} and ${names.length - limit} more` : names.join(", "));
const NUMBER_FIELDS = new Set(["baseSalary", "incentive", "attendanceLeaves", "policyBreachLeaves", "otherDeductions"]);
/**
 * The cells a month may skip: what each skips, and where the row says what is due and what was
 * skipped - and, for a run over months, what it is called in running text (`run`).
 */
const SKIPPABLE = {
  salaryAdvance: { kind: "advance", noun: "salary advance", ids: "advanceIds", skipped: "skippedAdvanceIds" },
  recoveryDeduction: { kind: "recovery", noun: "recovery instalment", ids: "recoveryIds", skipped: "skippedRecoveryIds", run: "recovery" },
  policyBreachDeduction: { kind: "policy-breach", noun: "policy breach instalment", ids: "policyBreachIds", skipped: "skippedPolicyBreachIds", run: "policy breach" },
};
/** The cell a Skip's `kind` is about. */
const skippableField = (kind) => Object.keys(SKIPPABLE).find((field) => SKIPPABLE[field].kind === kind);

// Salary Advance, Recovery Deduction and Policy Breach Deduction hold the amount with Skip, or Skipped and Undo beside it.
const WIDTHS = { noticeHold: 170, salaryAdvance: 210, recoveryDeduction: 210, policyBreachDeduction: 210, frozen: 130, month: 110, year: 90, employeeCode: 120, employeeName: 180, branch: 160, remarks: 220, paymentStatus: 150, paymentMode: 170, paymentFrom: 240, paymentDate: 170, paymentRemarks: 220, advanceIds: 170, recoveryIds: 170, policyBreachIds: 170 };

// The month and year are the header's, so the columns start hidden; the column menu brings them back.
const DEFAULT_VISIBILITY = { month: false, year: false };

/** Today as `YYYY-MM-DD`, the payment date a row marked Paid starts on. */
const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

/** This month, as the register opens on. */
const thisMonth = () => ({ year: String(new Date().getFullYear()), month: String(new Date().getMonth() + 1) });

export default function PayrollMainSection({ titleAccessory = null, canWrite: mayWrite = false, canSkipAdvance: maySkipAdvance = false, canSkipRecovery: maySkipRecovery = false, canSkipPolicyBreach: maySkipPolicyBreach = false }) {
  const [period, setPeriod] = useState(thisMonth);
  /*
   * A month past its payable date is locked: only somebody holding HRM / Payroll After Payday (the Super
   * Admin) may still change it, and the server refuses everybody else. `{ locked, payableOn, canEdit }`
   * from the month's list; for a reader who may not change it, the month shows as read only.
   */
  const [lock, setLock] = useState(null);
  const canWrite = mayWrite && lock?.canEdit !== false;
  const canSkipAdvance = maySkipAdvance && lock?.canEdit !== false;
  const canSkipRecovery = maySkipRecovery && lock?.canEdit !== false;
  const canSkipPolicyBreach = maySkipPolicyBreach && lock?.canEdit !== false;
  const [rows, setRows] = useState([]);
  const [rules, setRules] = useState(null);
  // The extra columns this month shows: `[{ id, name, kind, archived }]`.
  const [extraColumns, setExtraColumns] = useState([]);
  // The month's pay cycle `{ from, to, generated }` and the day it is paid out, as the server reads them.
  const [schedule, setSchedule] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [activeTab, setActiveTab] = useState("All");
  const [tableStats, setTableStats] = useState({ total: 0 });
  const [options, setOptions] = useState({ paymentModes: [], accounts: [], branches: [] });
  // What bringing the month up to date did, as it opened: `{ earlier, added, refreshed }`, `{ failed: true }`
  // where it could not, or null before it has answered (and for somebody who may only read).
  const [synced, setSynced] = useState(null);
  // Whether the load running now is bringing the month up to date - the slow part - for its message.
  const [syncing, setSyncing] = useState(false);
  // The latest load: a month left before its answer came back never paints its rows over the next one's.
  const loadRef = useRef(0);
  // `{ row, initial }` while a row's form is open.
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(null);
  const [formError, setFormError] = useState("");
  const [tried, setTried] = useState(false);
  // The month's removed rows, and the late changes to closed months, each behind its own button.
  const [removedRows, setRemovedRows] = useState([]);
  const [showRemoved, setShowRemoved] = useState(false);
  const [decidingId, setDecidingId] = useState(null);
  // A row being marked Paid from its status cell, waiting on the confirmation: `{ row, payload, resolve, reject }`.
  const [payingCell, setPayingCell] = useState(null);
  // The row whose Freeze switch is being saved, so a second press waits for the first.
  const [freezingId, setFreezingId] = useState(null);
  // `{ row, kind, undo }` while a Skip, or its Undo, asks first - and a refusal said in that dialog.
  const [skipping, setSkipping] = useState(null);
  const [skipError, setSkipError] = useState("");
  // `{ rows, form, error }` while Mark Paid over the ticked rows asks for the payment.
  const [payingMany, setPayingMany] = useState(null);
  const { notice, showNotice, showError, clearNotice } = useNotice();
  const { busy, run } = useSubmitOnce();

  /*
   * A failed load is said, with a way to try again - and the table says so too. Rows from another month
   * never linger under it. Opening a month (`sync`) brings it up to date first, for somebody who may
   * write - in place of Generate and Refresh; a reload after a save does not need to. A month that could
   * not be brought up to date still shows what it holds, and says so.
   */
  const load = useCallback(({ sync = false } = {}) => {
    const ticket = loadRef.current + 1;
    loadRef.current = ticket;
    const current = () => loadRef.current === ticket;
    setLoading(true);
    setLoadFailed(false);
    setRows([]);
    setSchedule(null);
    setLock(null);
    const month = { year: Number(period.year), month: Number(period.month) };
    const label = `${MONTH_NAMES[month.month - 1]} ${month.year}`;
    if (sync) setSynced(null);
    // The register's own permission decides whether opening it brings it up to date; a locked month the
    // reader may not change is left alone by the server.
    setSyncing(sync && mayWrite);
    const updated = sync && mayWrite
      ? syncPayroll(month).then((response) => {
        if (!current()) return;
        const result = response?.data || null;
        setSynced(result);
        // Said only where it changed who is on the month - re-reading the open rows is every opening's.
        if (result?.added) showNotice(`${label}: ${result.added} ${result.added === 1 ? "employee" : "employees"} added. Paid and on-hold rows were left as they were.`, "info");
      }).catch((error) => {
        if (!current()) return;
        setSynced({ failed: true });
        showNotice(error?.data?.message || error?.message || "Unable to bring the payroll up to date - showing it as it was.", "error", { label: "Try again", onSelect: () => setReloadToken((value) => value + 1) });
      })
      : Promise.resolve();
    return updated.then(() => (current() ? getPayrollRegister({ year: period.year, month: period.month }) : null))
      .then((response) => {
        if (!response || !current()) return;
        setRows(response?.data?.rows || []);
        setLock(response?.lock || null);
        setRules(response?.data?.rules || null);
        setExtraColumns(response?.data?.components || []);
        setRemovedRows(response?.data?.removed || []);
        // `opensOn`: the pay cycle has not ended, so the month shows no payroll until that day.
        setSchedule(response?.data?.period ? { period: response.data.period, payableOn: response.data.payableOn, opensOn: response.data.opensOn || null, startsFrom: response.data.beforeStart ? response.data.startsFrom : null } : null);
      })
      .catch((error) => {
        if (!current()) return;
        setLoadFailed(true);
        showNotice(error?.message || "Unable to load the payroll.", "error", { label: "Try again", onSelect: () => setReloadToken((value) => value + 1) });
      })
      .finally(() => {
        if (!current()) return;
        setLoading(false);
        setSyncing(false);
      });
  }, [mayWrite, period, showNotice]);

  // Deferred a tick, like every first load here: setting state straight from an effect body is a
  // cascading render. Opening a month - or reloading the page - brings it up to date.
  useEffect(() => {
    const timer = window.setTimeout(() => void load({ sync: true }), 0);
    return () => window.clearTimeout(timer);
  }, [load, reloadToken]);

  // The payment modes and paying accounts the form offers - asked for only by somebody who may use it.
  useEffect(() => {
    if (!canWrite) return undefined;
    let live = true;
    const timer = window.setTimeout(() => {
      getPayrollOptions()
        .then((response) => { if (live) setOptions({ paymentModes: [], accounts: [], branches: [], ...(response?.data || {}) }); })
        .catch((error) => { if (live) showError(error?.message || "Unable to load the payment options."); });
    }, 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [canWrite, showError]);

  const openEdit = useCallback((row) => {
    const initial = payrollFormFor(row, extraColumns);
    setForm(initial);
    setFormError("");
    setTried(false);
    setEditing({ row, initial });
  }, [extraColumns]);

  const paid = editing?.row.paymentStatus === "Paid";
  // Frozen in the table: settled like a paid row, until it is unfrozen there.
  const frozenRow = Boolean(editing?.row.frozen);
  const figuresLocked = (paid && form?.paymentStatus === "Paid") || frozenRow;
  const fieldErrors = tried && form ? payrollFormErrors(form) : {};
  // A paid row is previewed under the rules it was paid under; anything else under the rules now.
  const previewRules = figuresLocked ? editing.row.rules : rules;
  const preview = editing && form && previewRules ? payrollFigures({ ...editing.row, ...form, componentAmounts: formComponentAmounts(form) }, previewRules, extraColumns) : null;
  const dirty = Boolean(editing) && JSON.stringify(form) !== JSON.stringify(editing.initial);
  const { guard: guardClose, confirmProps: closeConfirmProps } = useUnsavedGuard(dirty, {
    title: "Close without saving?",
    message: "What was typed here is discarded.",
    confirmLabel: "Discard changes",
    cancelLabel: "Keep editing",
  });
  const requestClose = () => { if (!busy) guardClose(() => setEditing(null)); };
  const set = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const setComponent = (id, value) => setForm((current) => ({ ...current, components: { ...current.components, [id]: value } }));
  // The form's extra columns of one kind, placed where the table places them.
  const extraFields = (kind) => extraColumns.filter((extra) => extra.kind === kind).map((extra) => <TextField
    key={extra.id}
    label={extra.name}
    helperText={extra.kind === "EARNING" ? "Added to this month's earnings for this employee." : "Taken off this month's salary for this employee."}
    type="number"
    min={0}
    step="0.01"
    inputMode="decimal"
    prefix="₹"
    value={form.components?.[String(extra.id)] ?? "0"}
    readOnly={figuresLocked}
    error={fieldErrors[`${COMPONENT_FIELD}${extra.id}`] || ""}
    onChange={(event) => setComponent(String(extra.id), event.target.value)}
  />);
  // Marking it Paid starts the payment date on today, the usual answer.
  const setStatus = (value) => setForm((current) => ({ ...current, paymentStatus: value, paymentDate: value === "Paid" && !current.paymentDate ? todayIso() : current.paymentDate }));

  /** Writes one row's change and puts the server's answer - its worked-out figures with it - in place. */
  const writeRow = useCallback(async (row, payload) => {
    const response = await updatePayrollEntry(row.id, payload);
    const updated = response?.data;
    if (updated) setRows((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
  }, []);

  /*
   * One cell's write: only that field is sent, and only that row is replaced with the server's answer.
   * A refusal goes back to the cell, which shows it and keeps what was typed. Marking a row Paid in
   * its cell settles its figures, so it asks first - with the mode it was paid by already chosen - and
   * starts the payment date on today when it has none; answered No, the cell goes back quietly.
   */
  const saveCell = useCallback(async (row, field, raw) => {
    let value = raw;
    // An extra column is sent by its id, among the row's other extra columns.
    if (field.startsWith(COMPONENT_FIELD)) {
      value = raw === "" ? 0 : Number(raw);
      if (!Number.isFinite(value) || value < 0) throw new Error("Enter 0 or more.");
      return writeRow(row, { components: { [field.slice(COMPONENT_FIELD.length)]: value } });
    }
    if (NUMBER_FIELDS.has(field)) {
      value = raw === "" ? 0 : Number(raw);
      if (!Number.isFinite(value) || value < 0) throw new Error("Enter 0 or more.");
    } else if (field === "paymentModeId" || field === "costCentreBranchId") value = raw ? Number(raw) : null;
    else if (typeof raw === "string") value = raw.trim() || null;
    const payload = { [field]: value };
    if (field === "paymentStatus" && value === "Paid" && row.paymentStatus !== "Paid") {
      if (!row.paymentModeId) throw new Error("Choose the payment mode first.");
      if (!row.paymentDate) payload.paymentDate = todayIso();
      return new Promise((resolve, reject) => setPayingCell({ row, payload, resolve, reject }));
    }
    return writeRow(row, payload);
  }, [writeRow]);

  /** Freezes or unfreezes one row from its switch, saying what that means - one write at a time per row. */
  const toggleFreeze = useCallback(async (row, next) => {
    setFreezingId(row.id);
    try {
      await writeRow(row, { frozen: next });
      showNotice(next
        ? `On hold - ${row.employeeName}'s ${MONTH_NAMES[row.month - 1]} figures are locked.`
        : `Released - updates reach ${row.employeeName}'s ${MONTH_NAMES[row.month - 1]} row again.`, "success");
    } catch (error) {
      showError(error?.data?.message || error?.message || "Unable to change this row.");
    } finally {
      setFreezingId(null);
    }
  }, [writeRow, showNotice, showError]);

  async function confirmPaidCell() {
    const { row, payload, resolve, reject } = payingCell;
    try {
      await writeRow(row, payload);
      resolve();
    } catch (error) {
      reject(error);
    } finally {
      setPayingCell(null);
    }
  }

  /*
   * Hands a Base Salary or Attendance Leaves typed by hand back to attendance and the salary on record,
   * then brings the month up to date so the calculated figures show at once.
   */
  async function handBackTypedFigures() {
    try {
      await updatePayrollEntry(editing.row.id, { useCalculated: true });
      showNotice(`${editing.row.employeeName}'s ${MONTH_NAMES[editing.row.month - 1]} row follows attendance and the salary on record again.`, "success");
      setEditing(null);
      await load({ sync: true });
    } catch (error) {
      setFormError(error?.data?.message || error?.message || "Unable to go back to the calculated figures.");
    }
  }

  async function save() {
    setTried(true);
    setFormError("");
    if (Object.keys(payrollFormErrors(form)).length) return;
    try {
      await updatePayrollEntry(editing.row.id, payrollPayload(form, { paid: paid || frozenRow, force: frozenRow }));
      showNotice(`${editing.row.employeeName}'s ${MONTH_NAMES[editing.row.month - 1]} payroll saved.`, "success");
      setEditing(null);
      await load();
    } catch (error) {
      setFormError(error?.data?.message || error?.message || "Unable to save this row.");
    }
  }

  /** What a Skip or its Undo is about, in one noun: "salary advance", or "all 3 recovery instalments". */
  function skipNoun({ row, kind, undo }) {
    const spec = SKIPPABLE[skippableField(kind)];
    const count = (row[undo ? spec.skipped : spec.ids] || []).length;
    return count > 1 ? `all ${count} ${spec.noun}s` : spec.noun;
  }

  /** What a Skip or its Undo says first: what leaves the month, and where it goes - all of the cell. */
  function skipMessage({ row, kind, undo }) {
    const month = `${MONTH_NAMES[row.month - 1]} ${row.year}`;
    if (kind === "advance") {
      return undo
        ? `${(row.skippedAdvanceIds || []).join(", ")} is deducted from the ${month} salary again, and leaves the later month it moved to.`
        : `${rupees(row.salaryAdvance)} (${(row.advanceIds || []).join(", ")}) is not deducted from the ${month} salary - it comes off the next month's instead. Undo puts it back.`;
    }
    const field = skippableField(kind);
    const spec = SKIPPABLE[field];
    return undo
      ? `${(row[spec.skipped] || []).join(", ")} is deducted from the ${month} salary again, and the ${spec.run} ends a month sooner.`
      : `${rupees(row[field])} (${(row[spec.ids] || []).join(", ")}) is not deducted from the ${month} salary. The ${spec.run} runs one month longer - same instalment, its end date a month later. Undo puts it back.`;
  }

  async function confirmSkip() {
    const { row, kind, undo } = skipping;
    try {
      const response = undo ? await undoPayrollDeductionSkip(row.id, kind) : await skipPayrollDeduction(row.id, kind);
      const items = response?.data?.items || [];
      const month = `${MONTH_NAMES[row.month - 1]} ${row.year}`;
      showNotice(undo
        ? `${items.map((item) => item.id).join(", ")} back in ${row.employeeName}'s ${month} payroll.`
        : kind === "advance"
          ? `Skipped in ${month}: ${items.map((item) => `${item.id} now comes off ${monthLabel(item.takenIn)}`).join("; ")}.`
          : `Skipped in ${month}: ${items.map((item) => `${item.id} now ends ${recoveryDate(item.endDate)}`).join("; ")}.`, "success");
      setSkipping(null);
      await load();
    } catch (error) {
      // Said in the dialog, which stays open: nothing was changed, and it can be tried again.
      setSkipError(error?.data?.message || error?.message || "Could not change this deduction - nothing was changed. Try again.");
    }
  }


  async function restoreRow(row) {
    setDecidingId(row.id);
    try {
      await restorePayrollEntry(row.id);
      showNotice(`${row.employeeName}'s row is back on ${monthName} ${period.year}.`, "success");
      setShowRemoved(false);
      await load({ sync: true });
    } catch (error) {
      showError(error?.data?.message || error?.message || "Unable to restore this row.");
    } finally {
      setDecidingId(null);
    }
  }




  const modeOptions = useMemo(() => options.paymentModes.map((mode) => ({ value: String(mode.id), label: mode.name })), [options.paymentModes]);
  const accountOptions = useMemo(() => options.accounts.map((label) => ({ value: label, label })), [options.accounts]);
  // Every branch of the organisation, for Cost Centre.
  const branchOptions = useMemo(() => options.branches.map((branch) => ({ value: String(branch.id), label: branch.name })), [options.branches]);

  const tableColumns = useMemo(() => {
    const leaves = Object.fromEntries(columns.map((column) => [column.id, {
      id: column.id,
      header: column.label,
      accessorFn: column.value,
      cell: ({ row }) => {
        const entry = row.original;
        // Freeze: a switch, which a paid row - settled already - does not offer.
        if (column.id === "frozen") {
          // Read only: the same status mark the Payment Status column uses, so a settled row reads alike.
          if (!canWrite) return entry.frozen ? <TableCellValue value="On hold" type="status" statusStyles={frozenStyles} /> : "-";
          const paidRow = entry.paymentStatus === "Paid";
          return <ToggleSwitch
            size="sm"
            ariaLabel={`Hold ${entry.employeeName}'s row`}
            checked={Boolean(entry.frozen)}
            // One write at a time: a second press while the first is out would read a stale state.
            disabled={paidRow || freezingId === entry.id}
            title={paidRow
              ? (entry.frozen ? "On hold and paid - its figures are settled." : "Paid - its figures are settled already.")
              : entry.frozen ? "On hold: its figures stay as they are. Switch off to release." : "Hold: keep this row's figures as they are."}
            // The switch alone: the column is headed Hold, and its name and hover say the rest.
            onCheckedChange={(next) => { void toggleFreeze(entry, next); }}
          />;
        }
        // Salary Advance, Recovery and Policy Breach Deduction: the amount, Skip or Skipped / Undo beside it.
        const skippable = SKIPPABLE[column.id];
        if (skippable) {
          const may = ({ advance: canSkipAdvance, recovery: canSkipRecovery, "policy-breach": canSkipPolicyBreach })[skippable.kind] && !settledRow(entry);
          const skippedIds = entry[skippable.skipped] || [];
          return <PayrollDeductionCell
            amount={column.value(entry)}
            hasAmount={Number(entry[column.id]) > 0}
            skipped={skippedIds.length > 0}
            skippedNote={skippedIds.length ? `${skippedIds.join(", ")} skipped this month - ${skippable.kind === "advance" ? "deducted from a later month instead" : `the ${skippable.run} ends a month later`}.${entry.paymentStatus === "Paid" ? " The month is paid, so the skip is final." : ""}` : ""}
            canSkip={may}
            label={`${entry.employeeName}'s ${skippable.noun}`}
            onSkip={() => { setSkipError(""); setSkipping({ row: entry, kind: skippable.kind, undo: false }); }}
            onUndo={() => { setSkipError(""); setSkipping({ row: entry, kind: skippable.kind, undo: true }); }}
          />;
        }
        const spec = canWrite ? EDITABLE[column.id] : null;
        if (column.id === "noticeHold") {
          const hold = noticeHoldOf(entry, rupees);
          return hold ? <span title={hold.detail}><TableCellValue value={hold.status} type="status" statusStyles={holdStyles} /></span> : "-";
        }
        if (!spec) {
          return column.id === "paymentStatus"
            ? <TableCellValue value={shownPaymentStatus(entry)} type="status" statusStyles={statusStyles} />
            : column.value(entry);
        }
        const field = spec.field || column.id;
        const choices = column.id === "paymentStatus" ? PAYMENT_STATUSES.map((status) => ({ value: status, label: status }))
          : column.id === "paymentMode" ? modeOptions
            : column.id === "paymentFrom" ? accountOptions : [];
        return <EditableCell
          type={spec.type}
          value={entry[field]}
          display={column.value(entry)}
          options={choices}
          step={spec.step}
          min={spec.type === "number" ? 0 : undefined}
          clearable={spec.clearable}
          // A paid month's figures are settled; its payment can still be corrected.
          readOnly={spec.figure && settledRow(entry)}
          readOnlyNote={spec.figure && settledRow(entry) ? settledNote(entry) : ""}
          ariaLabel={`${column.label} for ${entry.employeeName}`}
          onSave={(next) => saveCell(entry, field, next)}
        />;
      },
      exportValue: column.value,
      width: WIDTHS[column.id] || 140,
      minWidth: 90,
    }]));
    // The month's extra columns: an amount, typed in place like Incentive, settled once Paid.
    for (const extra of extraColumns) {
      const amountOf = (entry) => entry.componentAmounts?.[extra.id] ?? 0;
      const shown = (entry) => rupees(amountOf(entry));
      leaves[extraId(extra)] = {
        id: extraId(extra),
        // An archived column still on a month that holds an amount for it says so.
        header: extra.archived ? `${extra.name} (archived)` : extra.name,
        accessorFn: shown,
        cell: ({ row }) => (canWrite
          ? <EditableCell
            type="number"
            value={amountOf(row.original)}
            display={shown(row.original)}
            step="0.01"
            min={0}
            readOnly={settledRow(row.original)}
            readOnlyNote={settledRow(row.original) ? settledNote(row.original) : ""}
            ariaLabel={`${extra.name} for ${row.original.employeeName}`}
            onSave={(next) => saveCell(row.original, `${COMPONENT_FIELD}${extra.id}`, next)}
          />
          : shown(row.original)),
        exportValue: shown,
        width: 140,
        minWidth: 90,
      };
    }
    return COLUMN_GROUPS.flatMap((group) => sectionColumns(group, extraColumns).map((id) => leaves[id]));
  }, [canWrite, canSkipAdvance, canSkipRecovery, canSkipPolicyBreach, saveCell, toggleFreeze, freezingId, modeOptions, accountOptions, extraColumns]);

  const tabCounts = useMemo(() => Object.fromEntries(TABS.map((tab) => [tab, tab === "All" ? rows.length : rows.filter((row) => shownPaymentStatus(row) === tab).length])), [rows]);
  const visibleRows = useMemo(() => (activeTab === "All" ? rows : rows.filter((row) => shownPaymentStatus(row) === activeTab)), [activeTab, rows]);

  /*
   * The Board: the month's rows in a column per payment status, in the tabs' order - so the status
   * tabs give way while it is shown. A card opens the row's form, as a double click does, for
   * somebody who may write. Dropping a card on another status is the Payment Status cell's own
   * write - `saveCell` - so Paid asks first with the same confirmation, and a refusal (no payment
   * mode yet, a locked month) is said here as the cell would say it. Without write, or once the
   * month is locked, nothing is dragged.
   */
  const [layout, setLayout] = useTableBoardLayout("hrm-payroll-main");
  const onBoard = layout === "board";
  // A month held for the notice is Pending on record and stays held, so Pending is no move for it.
  const canDropAt = useCallback((row, to) => canWrite && shownPaymentStatus(row) !== to && !(heldForNotice(row) && to === "Pending"), [canWrite]);
  const dropRow = useCallback((row, to) => {
    saveCell(row, "paymentStatus", to).catch((error) => {
      if (error?.cancelled) return;
      showError(error?.data?.message || error?.message || "Unable to change this row.");
    });
  }, [saveCell, showError]);
  // The house selection: tick boxes for unpaid rows, for Mark Paid alone - no Export or Delete over it.
  const bulk = useTableSelection({
    prefix: "/api/hrm/payroll-register",
    rows: visibleRows,
    rowId: (row) => String(row.id),
    noun: "payroll row",
    canDelete: false,
    canSelectRow: unpaidRow,
    showSuccess: (message) => showNotice(message, "success"),
    showError,
  });
  const bulkSelection = bulk.selection;
  const openPayMany = useCallback(() => {
    setPayingMany({ rows: bulk.selectedRows, form: { paymentModeId: "", paymentDate: todayIso(), paymentFrom: "", paymentRemarks: "" }, error: "", tried: false });
  }, [bulk.selectedRows]);
  // Mark Paid, counted, for somebody who may write - the selection's only action.
  const tickedCount = bulk.selectedRows.length;
  const payActions = useMemo(() => (canWrite ? [{ id: "mark-paid", label: `Mark Paid (${tickedCount})`, variant: "primary", onClick: openPayMany }] : undefined), [canWrite, openPayMany, tickedCount]);
  const selection = useMemo(() => (bulkSelection ? { ...bulkSelection, actions: payActions, headerLabel: selectHeaderLabel, exportable: false } : undefined), [bulkSelection, payActions]);
  const setPayMany = (field, value) => setPayingMany((current) => ({ ...current, form: { ...current.form, [field]: value }, error: "" }));

  async function confirmPayMany() {
    setPayingMany((current) => ({ ...current, tried: true }));
    const { rows: picked, form } = payingMany;
    if (!form.paymentModeId || !form.paymentDate) return;
    const paidIds = [];
    const missed = [];
    try {
      // A hundred at a time; what each answer says is gathered, so a later failure never hides what went.
      for (let at = 0; at < picked.length; at += MARK_PAID_CHUNK) {
        const response = await markPayrollPaid({
          ids: picked.slice(at, at + MARK_PAID_CHUNK).map((row) => row.id),
          paymentModeId: Number(form.paymentModeId),
          paymentDate: form.paymentDate,
          paymentFrom: form.paymentFrom || null,
          paymentRemarks: form.paymentRemarks.trim() || null,
        });
        paidIds.push(...(response?.data?.paidIds || []));
        missed.push(...(response?.data?.missed || []));
      }
      const nameOf = (id) => picked.find((row) => row.id === id)?.employeeName || `Row ${id}`;
      setPayingMany(null);
      // The paid ones lose their tick; a refused one keeps it, so Mark Paid again retries just those.
      bulkSelection?.onChange(new Set(missed.map((entry) => String(entry.id))));
      if (missed.length) {
        showError(`${paidIds.length} marked Paid, ${missed.length} not: ${someNames(missed.map((entry) => `${nameOf(entry.id)} (${entry.message.replace(/\.$/, "")})`), 3)}. Those stay ticked.`);
      } else {
        showNotice(`${paidIds.length} ${paidIds.length === 1 ? "row" : "rows"} marked Paid.`, "success");
      }
      await load();
    } catch (error) {
      const reason = error?.data?.message || error?.message || "Could not finish marking these rows Paid.";
      if (paidIds.length) {
        // Part went: say so, keep the rest ticked, and show the month as it now stands.
        setPayingMany(null);
        bulkSelection?.onChange(new Set(picked.filter((row) => !paidIds.includes(row.id)).map((row) => String(row.id))));
        showError(`${paidIds.length} marked Paid before it stopped: ${reason} The rest stay ticked.`);
        await load();
      } else {
        setPayingMany((current) => ({ ...current, error: reason }));
      }
    }
  }

  // The total of the rows on screen - the tab's, not the month's - so it never reads as more than shown.
  const shownTotal = useMemo(() => visibleRows.reduce((sum, row) => sum + (Number(row.roundedSalary) || 0), 0), [visibleRows]);
  const monthName = MONTH_NAMES[Number(period.month) - 1];

  return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
    <ModulePageHeader
      title="Payroll"
      titleAccessory={titleAccessory}
      tabs={onBoard ? undefined : TABS.map((tab) => ({ id: tab, label: tab, count: tabCounts[tab] || 0 }))}
      tabValue={activeTab}
      onTabChange={setActiveTab}
      tabsAriaLabel="Payment status filters"
      // Which days this month covers and when it is paid - from Payroll rules, stated for the month
      // chosen, at the right of the status tabs.
      tabsAside={schedule && <p className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500 sm:text-sm">
        <span>Pay cycle <span className="whitespace-nowrap font-medium text-slate-700">{recoveryDate(schedule.period.from)} – {recoveryDate(schedule.period.to)}</span>{schedule.period.generated ? "" : " (as set in Payroll rules)"}</span>
        {schedule.payableOn && <span>Payable on <span className="font-medium text-slate-700">{recoveryDate(schedule.payableOn)}</span></span>}
        {/* What opening it did: kept up to date, or - an earlier month - left as it was. */}
        <span aria-live="polite" className={synced?.earlier || synced?.failed || lock?.locked ? "text-amber-700" : ""}>{schedule.startsFrom
          ? `Before payroll starts (${MONTH_NAMES[schedule.startsFrom.month - 1]} ${schedule.startsFrom.year})`
          : schedule.opensOn
          ? `Made from ${recoveryDate(schedule.opensOn)}, after the pay cycle ends`
          : lock?.locked ? (lock.canEdit ? "Locked after its payable date - only a Super Admin can change it" : "Locked after its payable date")
          : !canWrite ? "Updated when somebody who can edit payroll opens it"
          : synced?.failed ? "Not updated - showing stored figures"
            : synced?.earlier ? "Earlier month - not updated"
              : synced?.ahead ? "Fills in nearer its pay cycle"
                : synced ? "Up to date" : ""}</span>
      </p>}
      actions={<>
        <TableBoardSwitch value={layout} onChange={setLayout} />
        {removedRows.length > 0 && <Button type="button" size="sm" variant="secondary" onClick={() => setShowRemoved(true)}>Removed rows ({removedRows.length})</Button>}
        {/* One picker for the payroll month: the year between arrows over a grid of the twelve months. */}
        <MonthField
          hideLabel
          label="Payroll month"
          value={{ year: Number(period.year), month: Number(period.month) }}
          onChange={({ year, month }) => setPeriod({ year: String(year), month: String(month) })}
          minYear={REGISTER_YEARS.first}
          maxYear={new Date().getFullYear() + REGISTER_YEARS.ahead}
          className="min-w-40"
        />
      </>}
    />
    <FloatingNotice notice={notice} onClose={clearNotice} />
    {/* The board fills the row and scrolls sideways inside its own rail; the page never does. */}
    <div className={onBoard ? "flex min-h-0 min-w-0 flex-1" : "min-h-0 flex-1"}>
      {onBoard ? <KanbanBoard
        rows={rows}
        columns={BOARD_COLUMNS}
        statusOf={boardStatusOf}
        // The month's pay in each column - the figure each card shows.
        columnAmount={(rows) => columnTotal(rows, (row) => row.roundedSalary, "Net pay")}
        dateOf={payPeriodOf}
        card={{ title: shownEmployeeName, subtitle: (row) => [row.employeeCode, row.branch].filter(Boolean).join(" · "), meta: (row) => `${MONTH_NAMES[row.month - 1] || ""} ${row.year} · ${rupees(row.roundedSalary)}` }}
        getRowId={(row) => String(row.id)}
        onOpen={canWrite ? openEdit : undefined}
        // What the card's ⋮ calls opening it.
        openLabel="Edit"
        canDropAt={canDropAt}
        onDrop={dropRow}
        loading={loading}
        noun="payroll rows"
        ariaLabel="Payroll board"
      /> : <DataTableShell
        className="h-full min-h-0"
        footer={<TableFooter spread>
          <span>{monthName} {period.year} · {activeTab === "All" ? "Rounded total" : `${activeTab} rounded total`} {rupees(shownTotal)}</span>
          <span>Total rows: {tableStats.total}</span>
        </TableFooter>}
      >
        <div className="flex min-h-0 min-w-0 flex-1">
          <DataTable
            columns={tableColumns}
            data={visibleRows}
            loading={loading}
            loadingMessage={syncing ? "Bringing the payroll up to date..." : "Loading the payroll..."}
            emptyMessage={loadFailed
              ? `Could not load the payroll for ${monthName} ${period.year}. Use Try again on the message above.`
              // A month whose pay cycle has not ended has no payroll yet: said with the day it is made.
              : schedule?.startsFrom
                ? `Payroll starts from ${MONTH_NAMES[schedule.startsFrom.month - 1]} ${schedule.startsFrom.year} - ${monthName} ${period.year} is before it, so it is not made. Settings → Payroll rules sets the start.`
              : schedule?.opensOn
                ? `${monthName} ${period.year}'s payroll is made after its pay cycle ends on ${recoveryDate(schedule.period.to)} - from ${recoveryDate(schedule.opensOn)}.`
                : !canWrite || synced?.ahead ? `No payroll for ${monthName} ${period.year} yet.` : `No payroll for ${monthName} ${period.year} - no working employees in this month.`}
            noMatchMessage="No rows match the current filters."
            onVisibleRowsChange={setTableStats}
            onRowDoubleClick={canWrite ? (row) => openEdit(row) : undefined}
            getRowId={(row) => String(row.id)}
            ariaLabel="Payroll"
            defaultColumnVisibility={DEFAULT_VISIBILITY}
            features={{ filtering: true, sorting: true, columnVisibility: true, csvExport: { enabled: true, fileName: `payroll-${period.year}-${String(period.month).padStart(2, "0")}`, onResult: (exported) => showNotice(exported ? "Payroll CSV export downloaded." : "No payroll to export.") }, selection }}
          />
        </div>
      </DataTableShell>}
    </div>


    {editing && form && <Dialog
      title={`${editing.row.employeeName} · ${MONTH_NAMES[editing.row.month - 1]} ${editing.row.year}`}
      description={`Pay cycle ${recoveryDate(editing.row.periodFrom)} – ${recoveryDate(editing.row.periodTo)} · Salary ${rupees(editing.row.baseSalary)}`}
      onClose={requestClose}
      size="lg"
      footer={<>
        <Button type="button" variant="secondary" onClick={requestClose} disabled={busy}>Cancel</Button>
        <Button type="button" variant="primary" busy={busy} busyLabel="Saving..." onClick={() => run(save)}>Save</Button>
      </>}
    >
      {formError && <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>}
      {/* Red while the month is held - it will not be paid on its payday - violet once it is the settlement. */}
      {noticeHoldOf(editing.row, rupees) && <p className={`mb-4 rounded-md border px-3 py-2 text-sm ${heldForNotice(editing.row) ? "border-red-200 bg-red-50 text-red-700" : "border-violet-200 bg-violet-50 text-violet-800"}`}>{({
        held: editing.row.noticeHold.settlesIn
          ? `Salary is held during this employee's notice period. This month is not paid on its own payday - it is paid with their final settlement in ${editing.row.noticeHold.settlesIn.label}, on ${recoveryDate(editing.row.noticeHold.settlesIn.payableOn)}.`
          : "Salary is held during this employee's notice period. This month is paid with their final settlement, not on its own.",
        settlement: `This is the employee's final settlement. Marking it Paid also pays the months held during the notice. ${noticeHoldOf(editing.row, rupees).detail}.`,
        settled: `${noticeHoldOf(editing.row, rupees).detail}. Set that month back to Pending to reopen this one.`,
      })[editing.row.noticeHold.state]}</p>}
      {figuresLocked && <p className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">{frozenRow
        ? "This row is on hold, so its figures are settled and it keeps the rules it was put on hold under - nothing changed elsewhere reaches it. Its payment can still be recorded here. Switch off Hold to change or remove it."
        : "This month is paid, so its figures are settled and it keeps the rules it was paid under. Set the status back to Pending to change or remove it."}</p>}
      <h3 className="mb-3 text-sm font-semibold text-slate-900">Figures</h3>
      {(editing.row.baseSalaryTyped || editing.row.attendanceLeavesTyped) && !figuresLocked && <div className="mb-4 flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between">
        <span>{[editing.row.baseSalaryTyped && "Salary", editing.row.attendanceLeavesTyped && "Attendance Leaves"].filter(Boolean).join(" and ")} {editing.row.baseSalaryTyped && editing.row.attendanceLeavesTyped ? "were" : "was"} typed by hand, so the month&rsquo;s updates leave {editing.row.baseSalaryTyped && editing.row.attendanceLeavesTyped ? "them" : "it"} as typed.</span>
        {/* An earlier month is not updated any more, so going back would change nothing there. */}
        {!synced?.earlier && <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => run(handBackTypedFigures)} className="shrink-0">Use the calculated figures again</Button>}
      </div>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Incentive" helperText="Extra pay this month, added to the total earned." type="number" min={0} step="0.01" inputMode="decimal" prefix="₹" value={form.incentive} readOnly={figuresLocked} error={fieldErrors.incentive || ""} onChange={(event) => set("incentive", event.target.value)} />
        {extraFields("EARNING")}
        <TextField label="Attendance Leaves" helperText="Leave days from attendance; they count toward the loss-of-pay deduction." type="number" min={0} step="0.5" inputMode="decimal" value={form.attendanceLeaves} readOnly={figuresLocked} error={fieldErrors.attendanceLeaves || ""} onChange={(event) => set("attendanceLeaves", event.target.value)} />
        <TextField label="Policy Breach Leaves" helperText="Extra leave days for a policy breach, deducted as loss of pay." type="number" min={0} step="0.5" inputMode="decimal" value={form.policyBreachLeaves} readOnly={figuresLocked} error={fieldErrors.policyBreachLeaves || ""} onChange={(event) => set("policyBreachLeaves", event.target.value)} />
        <TextField label="Salary Advance" helperText="From Advance Salary; change it there or skip it in the table." value={rupees(editing.row.salaryAdvance)} readOnly />
        <TextField label="Other Deductions" helperText="Any other amount taken off this month's salary." type="number" min={0} step="0.01" inputMode="decimal" prefix="₹" value={form.otherDeductions} readOnly={figuresLocked} error={fieldErrors.otherDeductions || ""} onChange={(event) => set("otherDeductions", event.target.value)} />
        {extraFields("DEDUCTION")}
        <TextField label="Recovery Deduction" helperText="This month's instalment from Payroll → Recovery." value={rupees(editing.row.recoveryDeduction)} readOnly />
        <TextField label="Policy Breach Deduction" helperText="This month's instalment from Payroll → Policy Breach." value={rupees(editing.row.policyBreachDeduction)} readOnly />
        <TextField label="Policy Breach LOP Days" helperText="Loss-of-pay days this month from a policy breach taken as days." value={days(editing.row.policyBreachLopDays)} readOnly />
        <TextAreaField className="sm:col-span-2" label="Remarks" helperText="A note on this month's figures, kept on the payroll row." rows={2} value={form.remarks} readOnly={figuresLocked} onChange={(event) => set("remarks", event.target.value)} />
      </div>
      {preview && <RecordSummaryCard
        className="mt-4"
        columnsClassName="grid-cols-2 sm:grid-cols-3"
        note={`A day's pay is the salary over ${divisorText(editing.row, previewRules)}: ${rupees(preview.dayRate)}.${preview.netSalary < 0 ? " The deductions are more than the earnings." : ""}`}
        rows={[
          ["Total Earned", rupees(preview.totalEarned)],
          ["Total Leaves", String(preview.totalLeaves)],
          ["LOP Deduction", rupees(preview.lopDeduction)],
          ["Total Deductions", rupees(preview.totalDeductions)],
          ["Net Salary", rupees(preview.netSalary)],
          ["Rounded Salary", rupees(preview.roundedSalary)],
        ]}
      />}
      <h3 className="mb-3 mt-6 text-sm font-semibold text-slate-900">Payment</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Dropdown label="Payment Status" required helperText="Paid settles this month's figures; Pending keeps them open to change." ariaLabel="Payment status" options={PAYMENT_STATUSES.map((value) => ({ value, label: value }))} value={form.paymentStatus} error={fieldErrors.paymentStatus || ""} onChange={setStatus} sorted={false} searchable={false} />
        <Dropdown label="Cost Centre" helperText="The branch this salary is booked to in the accounts." ariaLabel="Cost centre" placeholder="Choose the branch it is booked to" options={branchOptions} value={form.costCentreBranchId} onChange={(value) => set("costCentreBranchId", value)} clearable sorted={false} />
        <Dropdown label="Payment Mode" required={form.paymentStatus === "Paid"} helperText="How the salary was paid; needed once it is marked Paid." ariaLabel="Payment mode" placeholder="Choose how it was paid" options={modeOptions} value={form.paymentModeId} error={fieldErrors.paymentModeId || ""} onChange={(value) => set("paymentModeId", value)} clearable sorted={false} />
        <Dropdown className="sm:col-span-2" label="Payment From" ariaLabel="Payment from" placeholder="The account it was paid from" options={accountOptions} value={form.paymentFrom} helperText="The studio account the salary was paid out of." onChange={(value) => set("paymentFrom", value)} clearable sorted={false} />
        <DateField label="Payment Date" required={form.paymentStatus === "Paid"} helperText="The day the salary was paid; needed once it is marked Paid." value={form.paymentDate} error={fieldErrors.paymentDate || ""} onChange={(value) => set("paymentDate", value)} />
        <TextAreaField className="sm:col-span-2" label="Payment Remarks" rows={2} value={form.paymentRemarks} helperText="A note on the payment, such as a transfer reference." onChange={(event) => set("paymentRemarks", event.target.value)} />
      </div>
      {!paid && form.paymentStatus === "Paid" && <p className="mt-3 text-xs text-slate-500 sm:text-sm">Saved as Paid, this month&rsquo;s figures are settled under today&rsquo;s payroll rules.</p>}
    </Dialog>}
    {editing && <ConfirmDialog {...closeConfirmProps} />}

    {payingMany && <Dialog
      title={`Mark ${payingMany.rows.length} ${payingMany.rows.length === 1 ? "row" : "rows"} Paid?`}
      description="One payment for all of them. Paid rows are settled - set one back to Pending to change it."
      onClose={() => { if (!busy) setPayingMany(null); }}
      footer={<>
        <Button type="button" variant="secondary" onClick={() => setPayingMany(null)} disabled={busy}>Cancel</Button>
        <Button type="button" variant="primary" busy={busy} busyLabel="Saving..." onClick={() => run(confirmPayMany)}>Mark Paid</Button>
      </>}
    >
      {payingMany.error && <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{payingMany.error}</p>}
      <RecordSummaryCard
        columnsClassName="grid-cols-2"
        rows={[
          ["Rows", String(payingMany.rows.length)],
          ["Total to pay", rupees(payingMany.rows.reduce((sum, row) => sum + amountToPay(row), 0))],
        ]}
        note={someNames(payingMany.rows.map((row) => row.employeeName), 5)}
      />
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Dropdown label="Payment Mode" required ariaLabel="Payment mode" helperText="How these salaries were paid; the same for every row chosen." placeholder="Choose how it was paid" options={modeOptions} value={payingMany.form.paymentModeId} error={payingMany.tried && !payingMany.form.paymentModeId ? "Choose the payment mode." : ""} onChange={(value) => setPayMany("paymentModeId", value)} sorted={false} />
        <DateField label="Payment Date" required maxDate={todayIso()} helperText="The day they were paid; it cannot be a future day." value={payingMany.form.paymentDate} error={payingMany.tried && !payingMany.form.paymentDate ? "Choose the payment date." : ""} onChange={(value) => setPayMany("paymentDate", value || "")} />
        <Dropdown className="sm:col-span-2" label="Payment From" ariaLabel="Payment from" placeholder="The account it was paid from" options={accountOptions} value={payingMany.form.paymentFrom} helperText="The studio account these salaries were paid out of." onChange={(value) => setPayMany("paymentFrom", value)} clearable sorted={false} />
        <TextAreaField className="sm:col-span-2" label="Payment Remarks" rows={2} value={payingMany.form.paymentRemarks} helperText="A note saved on every row marked Paid, such as a reference." onChange={(event) => setPayMany("paymentRemarks", event.target.value)} />
      </div>
    </Dialog>}

    {skipping && <ConfirmDialog
      open
      title={`${skipping.undo ? "Undo the skip of" : "Skip"} ${skipping.row.employeeName}'s ${skipNoun(skipping)} for ${MONTH_NAMES[skipping.row.month - 1]} ${skipping.row.year}?`}
      message={skipMessage(skipping)}
      confirmLabel={skipping.undo ? "Undo skip" : skipping.kind === "advance" ? "Skip advance" : "Skip instalment"}
      busyLabel={skipping.undo ? "Undoing..." : "Skipping..."}
      tone="primary"
      loading={busy}
      onCancel={() => setSkipping(null)}
      onConfirm={() => run(confirmSkip)}
    >
      {skipError && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{skipError}</p>}
    </ConfirmDialog>}

    {payingCell && <ConfirmDialog
      open
      title={`Mark ${payingCell.row.employeeName}'s ${MONTH_NAMES[payingCell.row.month - 1]} as Paid?`}
      message={`${rupees(amountToPay(payingCell.row))}${payingCell.payload.paymentDate ? `, paid today` : ""}.${payingCell.row.noticeHold?.state === "settlement" ? " This is the final settlement, so the months held during the notice are paid with it." : ""} Its figures are settled once it is Paid; set it back to Pending to change them.`}
      confirmLabel="Mark Paid"
      busyLabel="Saving..."
      tone="primary"
      loading={busy}
      onCancel={() => { payingCell.reject({ cancelled: true }); setPayingCell(null); }}
      onConfirm={() => run(confirmPaidCell)}
    />}



    {showRemoved && <PayrollRemovedRowsDialog
      month={`${monthName} ${period.year}`}
      rows={removedRows}
      canWrite={canWrite}
      busyId={decidingId}
      onRestore={(row) => run(() => restoreRow(row))}
      onClose={() => setShowRemoved(false)}
    />}

  </section>;
}
