"use client";

import { useState } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import TextAreaField from "@/components/shared/TextAreaField";

export default function EmployeeActionDialog({ employee, onCancel, onConfirm, loading }) {
  if (!employee) return null;
  return <ConfirmDialog
    title="Delete employee?"
    message="This will permanently delete this employee record. This action cannot be undone."
    confirmLabel="Delete"
    busyLabel="Deleting..."
    loading={loading}
    onCancel={onCancel}
    onConfirm={onConfirm}
  />;
}

/**
 * Putting somebody in the InActive tab back to work.
 *
 * Two different sentences for two different rows, because the consequence is not the same. Somebody
 * Relieved, Fired or Absconded has an offboarding on record and this **removes** it - that is what
 * reactivating is, the departure taken back rather than a second chapter added beside it - so the
 * warning is earned and the button is the danger one. Somebody on `Long Leave` has no separation
 * behind them at all: nothing is destroyed, the status simply changes, and a red button promising
 * that it cannot be undone would be a lie about a change that is one click to make again.
 *
 * Both reopen the login the departure closed, which is worth saying out loud: it is the half of
 * this nobody can see from the repository.
 */
export function ReactivateEmployeeDialog({ employee, onCancel, onConfirm, loading }) {
  /*
   * Asked for here rather than assumed, and required: this deletes the offboarding it reverses, so
   * the reason is the only thing that will say afterwards why somebody who had left is at work
   * again. `ConfirmDialog` takes `children` for exactly this - the confirmation that also collects
   * something - so it is the same dialog every other irreversible question in the app uses.
   */
  const [reason, setReason] = useState("");
  if (!employee) return null;
  const offboarded = ["Relieved", "Absconded", "Fired"].includes(employee.employmentStatus);
  const name = employee.employeeName || "this employee";
  return <ConfirmDialog
    title="Move back to Active?"
    message={offboarded
      ? `This removes ${name}'s offboarding record, puts them back on the status they held before it, and reopens their login. The offboarding cannot be recovered.`
      : `This puts ${name} back on the status they held before, and reopens their login. They can be named on forms again.`}
    confirmLabel="Move to Active"
    busyLabel="Moving..."
    tone={offboarded ? "danger" : "primary"}
    loading={loading}
    confirmDisabled={!reason.trim()}
    onCancel={onCancel}
    onConfirm={() => onConfirm(reason.trim())}
  >
    <TextAreaField
      label="Reason"
      required
      value={reason}
      onChange={(event) => setReason(event.target.value)}
      placeholder="Why is this employee coming back? Rejoined, offboarded by mistake, returning from leave..."
    />
  </ConfirmDialog>;
}
