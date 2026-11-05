"use client";

import { useState } from "react";
import Dialog from "@/components/ui/Dialog";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import TextAreaField from "@/components/shared/TextAreaField";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import useFormErrors from "@/components/shared/useFormErrors";
import { AUTO, NEEDS_REMARKS, departmentStatusOptions, departmentStatusOutcome } from "@/lib/departmentStatuses.mjs";

/**
 * Update status - a project's overall Pre Production or Production status, for one project (its row's
 * ⋮) or every ticked one. Hold and Rejected ask their remarks. Only the projects' status changes:
 * every shoot keeps its own, and the dialog says so.
 *
 * `department` is "preProduction" or "production"; `title` names what is being changed, `count` how
 * many projects, and `bulk` whether this is the ticked projects rather than one row - which is what
 * adds Yet to Start and Production's Completed (`BULK_ONLY_STATUSES`). `onSave({ status, remarks })`
 * does the write - status null for Automatic. `initialStatus` starts the choice on one status - the
 * board's card dropped on that status's column - and the rest of the dialog asks as it always does.
 */
export default function DepartmentStatusDialog({ department, title, count, bulk = false, initialStatus = "", onSave, onClose }) {
  const [status, setStatus] = useState(initialStatus);
  const [remarks, setRemarks] = useState("");
  const fields = useFormErrors();
  const { busy, run } = useSubmitOnce();
  const name = department === "production" ? "Production" : "Pre Production";

  function save() {
    if (!fields.check({
      status: status ? "" : "Choose the status.",
      remarks: NEEDS_REMARKS.has(status) && !remarks.trim() ? "Write the remarks." : "",
    })) return;
    void run(() => onSave({ status: status === AUTO ? null : status, remarks: NEEDS_REMARKS.has(status) ? remarks.trim() : null }));
  }

  return <Dialog
    title={title || "Update status"}
    description={`${count.toLocaleString()} project${count === 1 ? "" : "s"}`}
    onClose={busy ? undefined : onClose}
    footer={<>
      <Button type="button" className="max-sm:flex-1" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button type="button" variant="primary" className="max-sm:flex-1" busy={busy} busyLabel="Updating..." onClick={save}>Update</Button>
    </>}
  >
    <div className="flex flex-col gap-3">
      <Dropdown label={`${name} Status`} required helperText="The project's overall status here; each shoot keeps its own." value={status} onChange={(value) => { setStatus(value || ""); fields.clear("status"); }} options={departmentStatusOptions(department, bulk)} placeholder="Select status" searchable={false} sorted={false} error={fields.errors.status} />
      {NEEDS_REMARKS.has(status) && <TextAreaField label="Remarks" required helperText="Why the project is on hold or rejected, saved with the status." value={remarks} onChange={(event) => { setRemarks(event.target.value); fields.clear("remarks"); }} error={fields.errors.remarks} />}
      {status && <p className="text-sm text-slate-600">
        {departmentStatusOutcome(status, name)}
      </p>}
    </div>
  </Dialog>;
}
