"use client";

import { useState } from "react";
import Dialog from "@/components/ui/Dialog";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import useFormErrors from "@/components/shared/useFormErrors";
// The server's `projectStatuses`: the only statuses a project may be given now.
import { PROJECT_STATUSES } from "@/lib/projectStatuses.mjs";

const OPTIONS = PROJECT_STATUSES.map((status) => ({ value: status, label: status }));

/**
 * Projects → Update status: one Project Status for every ticked project, like the CRM's bulk Update
 * Details, or for one project from its row's ⋮ (`project`, named in place of the count). Only the
 * projects' own status changes - never a shoot, never a department's status - and the dialog says so
 * before it is pressed.
 * `onSave(status)` does the write; the dialog closes once it has. `initialStatus` starts the choice on
 * one status - a card dropped on that column of the Board - still to be confirmed with Update.
 */
export default function ProjectBulkStatusDialog({ count, project, initialStatus = "", onSave, onClose }) {
  const [status, setStatus] = useState(initialStatus);
  const { busy, run } = useSubmitOnce();
  const fields = useFormErrors();
  function save() {
    if (!fields.check({ status: status ? "" : "Choose the status." })) return;
    void run(() => onSave(status));
  }
  return <Dialog
    title="Update status"
    description={project ? `${project.whatsappGroupName || project.eventId || "This project"} - now ${project.projectStatus || "Yet to Start"}` : `${count.toLocaleString()} selected project${count === 1 ? "" : "s"}`}
    onClose={busy ? undefined : onClose}
    footer={<>
      <Button type="button" className="max-sm:flex-1" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button type="button" variant="primary" className="max-sm:flex-1" busy={busy} busyLabel="Updating..." onClick={save}>Update</Button>
    </>}
  >
    <div className="flex flex-col gap-3">
      <Dropdown label="Project Status" required helperText="The project's own status; its shoots and departments stay unchanged." value={status} onChange={(value) => { setStatus(value || ""); fields.clear("status"); }} options={OPTIONS} placeholder="Select status" searchable={false} sorted={false} error={fields.errors.status} />
      {status && status !== "Yet to Start" && <p className="text-sm text-slate-600">Only the project&apos;s status changes. Its shoots, and its Pre Production, Production and Accounts statuses, stay as they are.</p>}
      {status === "Yet to Start" && <p className="text-sm text-amber-800">A started project set back to Yet to Start is offered Start again.</p>}
    </div>
  </Dialog>;
}
