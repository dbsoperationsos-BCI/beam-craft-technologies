"use client";

import { useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import SimpleTable from "@/components/data-table/SimpleTable";
import { TableCellValue } from "@/components/data-table/tableCells";
import Loader from "@/components/shared/Loader";
import RecordSummaryCard from "@/components/shared/RecordSummaryCard";
import { dayCount, monthLabel, recoveryDate, rupees } from "@/lib/payrollRecovery.mjs";
import { getPayrollAdvanceHistory } from "@/services/hrm/payrollAdvance.service";
import { getPayrollPolicyBreachHistory } from "@/services/hrm/payrollPolicyBreach.service";
import { getPayrollRecoveryHistory } from "@/services/hrm/payrollRecovery.service";

/**
 * The payment history of an advance, a recovery or a policy breach (`kind`): how much has come back and what is left,
 * then each month of its run - what it was to take, and what the payroll did with it. **Deducted**
 * once that month's Main Page row is Paid (with the payment date and mode), **Due** while it is
 * Pending or not generated yet, **On Hold**, and **Skipped** where it was skipped.
 *
 * Asked of the server whenever the record shown - or its last change (`version`) - changes, since
 * what decides it is the payroll, which moves on another page.
 */
const statusStyles = { Deducted: "bg-emerald-500", Due: "bg-amber-500", "On Hold": "bg-violet-500", Skipped: "bg-orange-400" };
const loaders = { advance: getPayrollAdvanceHistory, recovery: getPayrollRecoveryHistory, "policy-breach": getPayrollPolicyBreachHistory };

// Four columns, so it fits the panel beside the table: the payment date and mode share one.
const columns = [
  { key: "month", label: "Month", render: (row) => monthLabel(row.month) },
  { key: "amount", label: "Amount", render: (row) => (row.status === "Skipped" ? `${rupees(row.amount)} not taken` : rupees(row.amount)) },
  { key: "status", label: "Status", render: (row) => <TableCellValue value={row.status} type="status" statusStyles={statusStyles} /> },
  { key: "paidOn", label: "Paid", render: (row) => (row.paidOn ? [recoveryDate(row.paidOn), row.paymentMode].filter(Boolean).join(" · ") : "-") },
];
// An LOP policy breach takes days, not money: each month's share is its loss-of-pay days.
const lopColumns = columns.map((column) => (column.key === "amount"
  ? { key: "amount", label: "LOP Days", render: (row) => (row.status === "Skipped" ? `${dayCount(row.amount)} not taken` : dayCount(row.amount)) }
  : column));

/** `hideTitle` where something round it already says Payment History - the full-screen view's tab. */
export default function PayrollPaymentHistory({ kind, id, version = "", className = "", hideTitle = false }) {
  // `{ key, data }` once answered, `{ key, error }` once refused - kept by the record it answers for,
  // so another record never shows this one's months while its own are asked for.
  const [answer, setAnswer] = useState(null);
  // Bumped by Try again, which asks afresh.
  const [attempt, setAttempt] = useState(0);
  const key = `${kind}:${id}:${version}:${attempt}`;

  useEffect(() => {
    let live = true;
    loaders[kind](id)
      .then((response) => { if (live) setAnswer({ key, data: response?.data || null }); })
      .catch((error) => { if (live) setAnswer({ key, error: error?.data?.message || error?.message || "Unable to load the payment history." }); });
    return () => { live = false; };
  }, [kind, id, key]);

  const current = answer?.key === key ? answer : null;
  const lop = current?.data?.deductBy === "LOP";
  const figure = (value) => (lop ? dayCount(value) : rupees(value));
  return <section className={`space-y-3 ${className}`} aria-label="Payment history">
    {!hideTitle && <h3 className="text-sm font-semibold text-slate-900">Payment History</h3>}
    {!current && <Loader label="Loading the payment history..." />}
    {current?.error && <div className="flex flex-wrap items-center gap-2">
      <p role="alert" className="text-xs text-red-600 sm:text-sm">{current.error}</p>
      <Button type="button" size="sm" onClick={() => setAttempt((value) => value + 1)}>Try again</Button>
    </div>}
    {current?.data && <>
      <RecordSummaryCard
        columnsClassName="grid-cols-2"
        rows={[
          ["Total", lop ? dayCount(current.data.totalDays) : rupees(kind === "advance" ? current.data.amount : current.data.totalAmount)],
          ["Deducted So Far", figure(current.data.recovered)],
          ["Balance", figure(current.data.balance)],
          kind === "advance"
            ? ["Given On", recoveryDate(current.data.givenOn) || "-"]
            : ["Instalments Deducted", `${current.data.instalmentsDeducted} of ${current.data.months}`],
        ]}
        note="Deducted: that month's payroll on the Main Page is Paid. Due: still to be deducted - its payroll is Pending, or not made yet. On Hold: held there. Skipped: left out on the Main Page."
      />
      <SimpleTable variant="form" columns={lop ? lopColumns : columns} rows={current.data.history} rowKey={(row) => row.month} emptyMessage="No months yet." ariaLabel="Payment history by month" />
    </>}
  </section>;
}
