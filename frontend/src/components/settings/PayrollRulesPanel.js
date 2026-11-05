"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import HelpTip from "@/components/shared/HelpTip";
import Loader from "@/components/shared/Loader";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import AttendanceCalculatorPanel from "@/components/settings/AttendanceCalculatorPanel";
import EditPayslipPanel from "@/components/settings/EditPayslipPanel";
import PayslipGenerationPanel from "@/components/settings/PayslipGenerationPanel";
import NoticeHoldPanel from "@/components/settings/NoticeHoldPanel";
import PayrollStartPanel from "@/components/settings/PayrollStartPanel";
import PayslipTemplatePanel from "@/components/settings/PayslipTemplatePanel";
import { MONTH_NAMES } from "@/lib/payrollRecovery.mjs";
import { LOP_DIVISOR_OPTIONS, ROUNDING_OPTIONS } from "@/lib/payrollRegister.mjs";
import { getPayrollRules, savePayrollRules } from "@/services/hrm/payrollRegister.service";

/**
 * Settings → Employee → **Payroll rules**: everything Payroll → Main Page works its figures out by,
 * in one place - two blocks, each on its own access:
 *
 * - **Attendance calculator** - the pay cycle (the day it turns over, which sets the days Generate
 *   reads attendance over) and the payable day of the following month. An administrator's alone, as
 *   its endpoints check (`isAdministrator`); saved with its own Save, from the current month on.
 * - **Salary calculation** - what a day's pay is for the loss-of-pay deduction (the base salary over
 *   the pay cycle's working days, its calendar days, or a fixed 30) and how the net salary is rounded
 *   for payment. `HRM / Payroll Register`: Read shows the rules, Read / Write changes them - without
 *   it the fields read as values and there is no Save. The rules are every branch's, so the server
 *   takes a change only from somebody who reaches every branch. A change applies from the current
 *   month on - this month's payroll and later ones; earlier months keep the rules they had, generated
 *   or not, and a paid month the rules it was paid under - which the Save says before it is made.
 * - **Payroll starts from** - the first payroll month the Main Page keeps; earlier ones are never made
 *   or paid out as payslips (`PayrollStartPanel`), on the same `HRM / Payroll Register`.
 * - **Generate payslips on** - how many days after a month's payable date its payslip is generated
 *   (`PayslipGenerationPanel`), on the same `HRM / Payroll Register`.
 * - **Hold salary during notice** - whether new resignations hold salary to the full and final
 *   settlement (`NoticeHoldPanel`), on the same `HRM / Payroll Register`.
 * - **Edit Payslip** - details added to the payslip: Personal and PF details asked for in Edit
 *   Employee → Payslip Details, Earnings and Deductions columns on the Main Page (`EditPayslipPanel`),
 *   on the same `HRM / Payroll Register`.
 * - **Payslip template** - the payslip as it will print, with Download sample PDF (`PayslipTemplatePanel`),
 *   on the same permission - read again after every change in Edit Payslip, so it shows what was just done.
 */
export default function PayrollRulesPanel({ canManagePayCycle = false, canReadRules = false, canWrite = false, onNotice, onError }) {
  // Bumped by every change in Edit Payslip, so the preview below it is read again.
  const [previewKey, setPreviewKey] = useState(0);
  const payslipChanged = useCallback((message) => { setPreviewKey((key) => key + 1); onNotice?.(message); }, [onNotice]);
  return <div className="space-y-8">
    {canManagePayCycle && <section aria-labelledby="payroll-rules-pay-cycle">
      <h3 id="payroll-rules-pay-cycle" className="mb-3 flex items-center text-sm font-semibold text-slate-900">Attendance calculator<HelpTip text="The pay cycle each payroll month reads attendance over, and when it is paid. A change applies from this month’s payroll on." /></h3>
      <AttendanceCalculatorPanel canWrite onNotice={onNotice} onError={onError} />
    </section>}
    {/* A rule between the two, so the calculator's Monthly / Weekly tabs read as its own and not the page's. */}
    {canReadRules && <section aria-labelledby="payroll-rules-salary" className={canManagePayCycle ? "border-t border-slate-200 pt-6" : ""}>
      <h3 id="payroll-rules-salary" className="mb-3 flex items-center text-sm font-semibold text-slate-900">Salary calculation<HelpTip text={`How the loss of pay and the rounding are worked out. A change applies from this month’s payroll on; earlier months keep the rules they had.${canWrite ? " Changes here are saved with Save, after a check." : ""}`} /></h3>
      <SalaryRules canWrite={canWrite} onNotice={onNotice} onError={onError} />
    </section>}
    {canReadRules && <section aria-labelledby="payroll-rules-start" className="border-t border-slate-200 pt-6">
      <h3 id="payroll-rules-start" className="mb-3 text-sm font-semibold text-slate-900">Payroll start</h3>
      <PayrollStartPanel canWrite={canWrite} onNotice={onNotice} onError={onError} />
    </section>}
    {canReadRules && <section aria-label="Payslip generation" className="border-t border-slate-200 pt-6">
      <PayslipGenerationPanel canWrite={canWrite} onNotice={onNotice} onError={onError} />
    </section>}
    {canReadRules && <section aria-label="Hold salary during notice" className="border-t border-slate-200 pt-6">
      <NoticeHoldPanel canWrite={canWrite} onNotice={onNotice} onError={onError} />
    </section>}
    {canReadRules && <section aria-labelledby="payroll-rules-edit-payslip" className="border-t border-slate-200 pt-6">
      <EditPayslipPanel canWrite={canWrite} onNotice={payslipChanged} onError={onError} />
    </section>}
    {canReadRules && <section aria-labelledby="payroll-rules-payslip-template" className="border-t border-slate-200 pt-6">
      <h3 id="payroll-rules-payslip-template" className="mb-3 flex items-center text-sm font-semibold text-slate-900">Payslip template<HelpTip text="The payslip as it will print, with what Edit Payslip turned on or added." /></h3>
      <PayslipTemplatePanel key={previewKey} onNotice={onNotice} onError={onError} />
    </section>}
  </div>;
}

/** The loss-of-pay day rate and the rounding, saved together behind a confirmation. */
function SalaryRules({ canWrite = false, onNotice, onError }) {
  // The month a change starts from - the server's answer is the studio's month in India; this is the
  // same month on any device set to it, for saying so before the Save.
  // The month a change starts from: the payroll month whose cycle is running, as the server says -
  // this calendar month only until it has.
  const [changesFrom, setChangesFrom] = useState(null);
  const thisMonth = changesFrom ? `${MONTH_NAMES[changesFrom.month - 1]} ${changesFrom.year}` : `${MONTH_NAMES[new Date().getMonth()]} ${new Date().getFullYear()}`;
  const [rules, setRules] = useState(null);
  const [saved, setSaved] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const { busy, run } = useSubmitOnce();

  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      setLoadError("");
      getPayrollRules()
        .then((response) => {
          if (!live) return;
          const { changesFrom: from = null, ...loaded } = response?.data || {};
          setRules(response?.data ? loaded : null);
          setSaved(response?.data ? loaded : null);
          setChangesFrom(from);
        })
        .catch((error) => { if (live) setLoadError(error?.message || "Unable to load the payroll rules."); });
    }, 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [reloadToken]);

  if (loadError) {
    return <div className="flex flex-wrap items-center gap-3">
      <p role="alert" className="text-sm text-red-600">{loadError}</p>
      <Button type="button" variant="secondary" onClick={() => setReloadToken((value) => value + 1)}>Try again</Button>
    </div>;
  }
  if (!rules) return <Loader label="Loading the payroll rules..." />;
  const changed = saved && (rules.lopDivisor !== saved.lopDivisor || rules.rounding !== saved.rounding);

  async function save() {
    try {
      const response = await savePayrollRules(rules);
      setSaved(response?.data || rules);
      setRules(response?.data || rules);
      setConfirming(false);
      const from = response?.data?.effectiveFrom;
      onNotice?.(`Payroll rules saved. They apply from ${from ? `${MONTH_NAMES[from.month - 1]} ${from.year}` : thisMonth} on; earlier months keep their rules.`);
    } catch (error) {
      setConfirming(false);
      onError?.(error?.data?.message || error?.message || "Unable to save the payroll rules.");
    }
  }

  return <div className="space-y-4">
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Dropdown label="A day's pay is the base salary over" ariaLabel="Loss-of-pay day rate" options={LOP_DIVISOR_OPTIONS} value={rules.lopDivisor} readOnly={!canWrite} onChange={(value) => setRules((current) => ({ ...current, lopDivisor: value }))} sorted={false} searchable={false} helperText="Sets a day's pay. The loss-of-pay (LOP) deduction is a day's pay times the month's total leaves." />
      <Dropdown label="Round the net salary to" ariaLabel="Salary rounding" options={ROUNDING_OPTIONS} value={rules.rounding} readOnly={!canWrite} onChange={(value) => setRules((current) => ({ ...current, rounding: value }))} sorted={false} searchable={false} helperText="Only the net salary is rounded; every other figure is kept to the paisa." />
    </div>
    {canWrite && <div className="flex justify-end">
      <Button type="button" variant="primary" disabled={!changed} onClick={() => setConfirming(true)}>Save</Button>
    </div>}
    {confirming && <ConfirmDialog
      open
      layer="dialogOverPanel"
      title="Change the payroll rules?"
      message={`The new rules apply from the ${thisMonth} payroll on, in every branch. Earlier months - generated or not - keep the rules they had, and paid months never change.`}
      confirmLabel="Save rules"
      busyLabel="Saving..."
      tone="primary"
      loading={busy}
      onCancel={() => setConfirming(false)}
      onConfirm={() => run(save)}
    />}
  </div>;
}
