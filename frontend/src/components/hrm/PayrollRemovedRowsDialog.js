"use client";

import Button from "@/components/shared/Button";
import Dialog from "@/components/ui/Dialog";
import { formatDateTime } from "@/lib/formatDateTime.mjs";

/*
 * HRM → Payroll → Main Page → Removed rows: the month's rows taken off it, with who removed them, when
 * and why. A removed row stays removed - the month's update does not add the employee back - until it
 * is restored here, when the month's next update reads it again.
 *
 * Restore is offered on Read / Write (`canWrite`) alone.
 */
export default function PayrollRemovedRowsDialog({ month, rows = [], canWrite = false, busyId = null, onRestore, onClose }) {
  return <Dialog
    title={`Removed rows - ${month}`}
    description="Taken off this month's payroll. They stay off until you restore them, even when the month is updated."
    onClose={onClose}
    footer={<Button type="button" variant="secondary" onClick={onClose}>Close</Button>}
  >
    {rows.length
      ? <ul className="divide-y divide-slate-100">
        {rows.map((row) => <li key={row.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 text-sm">
            <p className="font-medium text-slate-800">{row.employeeName}{row.employeeCode ? <span className="font-normal text-slate-500"> ({row.employeeCode})</span> : null}</p>
            <p className="text-xs text-slate-500">Removed {formatDateTime(row.removedAt)}{row.removedBy ? ` by ${row.removedBy}` : ""}</p>
            {row.reason && <p className="mt-1 text-xs text-slate-600">{row.reason}</p>}
          </div>
          {canWrite && <Button type="button" size="sm" className="shrink-0 self-start" busy={busyId === row.id} busyLabel="Restoring..." disabled={Boolean(busyId)} onClick={() => onRestore?.(row)}>Restore</Button>}
        </li>)}
      </ul>
      : <p className="py-6 text-center text-sm text-slate-500">No rows have been removed from this month.</p>}
  </Dialog>;
}
