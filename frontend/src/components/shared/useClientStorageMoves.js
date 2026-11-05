"use client";

import { avatarOf } from "@/lib/employeeAvatar.mjs";
import { useState } from "react";
import Button from "./Button";
import Dropdown from "./Dropdown";
import useFormErrors from "./useFormErrors";
import Dialog from "@/components/ui/Dialog";
import ClientStorageStatusDialog from "@/components/assets/ClientStorageStatusDialog";
import ClientStorageTransitDialog from "@/components/assets/ClientStorageTransitDialog";
import { changeClientStorageStatus } from "@/services/assets/assets.service";

/**
 * Moving a hard disc along the Client Storage flow, wherever a record is shown.
 *
 * Which moves a record can make is decided by the API and carried on the record itself as
 * `nextStatuses`, so a menu built from `movesFor` can only ever offer something the server would
 * accept. Three steps collect their own fields in the shared status dialog first; "Assigned" and
 * "In Transit" have dialogs of their own, and anything else applies straight away.
 *
 * Kept in one place so the Client Storage register and Pre Production's General panel move a record
 * the same way. `saveStatus` is the call that makes the move: the register's own by default, under
 * `ASSET / Client Storage`; Pre Production passes its own route, under `PROJECT / Pre Production`.
 */
const detailSteps = ["Hand In", "Footage Backup Done", "HDD Out"];
const assignedStatus = "Assigned";
const transitStatus = "In Transit";

/**
 * The shell both small dialogs below share. There is still no shared confirmation dialog in
 * `components/`, so this at least keeps them from drifting apart.
 */
function SmallDialog({ title, description, error, saving, confirmLabel, confirmVariant = "primary", onClose, onSubmit, children }) {
  return <Dialog
    title={title}
    description={description}
    layer="dialogOverPanel"
    busy={saving}
    onClose={onClose}
    footer={<>
      <Button className="max-sm:flex-1" type="button" onClick={onClose} disabled={saving}>Cancel</Button>
      <Button className="max-sm:flex-1" type="button" variant={confirmVariant} disabled={saving} onClick={onSubmit}>{saving ? "Saving..." : confirmLabel}</Button>
    </>}
  >
    {children}
    {/* Shown here rather than only on the page, which the overlay covers while this is open. */}
    {error && <p role="alert" className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
  </Dialog>;
}

/** Post production naming the person who will carry the disc out to the client. */
function AssignDialog({ record, employees, error, saving, onClose, onConfirm }) {
  const [assignedToId, setAssignedToId] = useState("");
  const fields = useFormErrors();
  function submit() {
    if (!fields.check({ assignedToId: assignedToId ? "" : "Choose who it is assigned to." })) return;
    onConfirm(assignedToId);
  }
  return <SmallDialog title={`Assign ${record.storageId}`} description="Choose the person this hard disc is handed to. They then move it to In Transit and on to Delivered." error={error} saving={saving} confirmLabel="Assign" onClose={onClose} onSubmit={submit}>
    {/* The dialog stacks at z-[140], so the menu has to open above that to be clickable. */}
    <Dropdown searchable required className="mt-4" menuZIndexClassName="z-[150]" label="Assigned To" value={assignedToId} onChange={(value) => { setAssignedToId(value); fields.clear("assignedToId"); }} error={fields.errors.assignedToId} placeholder="Select employee" options={employees.map((employee) => ({ value: String(employee.id), label: `${employee.employeeName} (${employee.employeeId || "—"})`, avatar: avatarOf(employee) }))} />
  </SmallDialog>;
}

/**
 * `options` is the Client Storage options payload the step dialogs read; `employees` the people a
 * disc can be assigned to; `onMoved(record)` runs after a move succeeds, to reload whatever shows it.
 *
 * Returns `movesFor(record)` — `{ label, onSelect }` items for a menu or a row of buttons — and
 * `dialogs`, which the caller renders once.
 */
export default function useClientStorageMoves({ options = {}, employees = [], onMoved, saveStatus = changeClientStorageStatus }) {
  const [statusChange, setStatusChange] = useState(null);
  const [assignRecord, setAssignRecord] = useState(null);
  const [transitRecord, setTransitRecord] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  /**
   * Whichever dialog is open is closed on success only, so a rejected move leaves the answers on
   * screen to correct rather than discarding them.
   */
  async function changeStatus(record, payload) {
    setSaving(true);
    setError("");
    try {
      await saveStatus(record.id, payload);
      setStatusChange(null);
      setAssignRecord(null);
      setTransitRecord(null);
      await onMoved?.(record);
    } catch (requestError) {
      setError(requestError.message || "Unable to change the status.");
    } finally {
      setSaving(false);
    }
  }

  function movesFor(record) {
    // Each dialog opens on a clean slate, so a message left over from an earlier failure is not
    // mistaken for something wrong with the record just opened.
    const open = (setter, value = record) => { setError(""); setter(value); };
    return (record?.nextStatuses || []).map((next) => ({
      label: next === assignedStatus ? "Assign to a person" : `Move to ${next}`,
      onSelect: () => {
        if (detailSteps.includes(next)) return open(setStatusChange, { record, nextStatus: next });
        if (next === assignedStatus) return open(setAssignRecord);
        if (next === transitStatus) return open(setTransitRecord);
        return changeStatus(record, { nextStatus: next });
      },
    }));
  }

  const dialogs = <>
    {statusChange && <ClientStorageStatusDialog record={statusChange.record} nextStatus={statusChange.nextStatus} options={options} saving={saving} error={error} onClose={() => setStatusChange(null)} onSubmit={(payload) => changeStatus(statusChange.record, payload)} />}
    {assignRecord && <AssignDialog record={assignRecord} employees={employees} error={error} saving={saving} onClose={() => setAssignRecord(null)} onConfirm={(assignedToId) => changeStatus(assignRecord, { nextStatus: assignedStatus, assignedToId })} />}
    {transitRecord && <ClientStorageTransitDialog record={transitRecord} options={options} saving={saving} error={error} onClose={() => setTransitRecord(null)} onSubmit={(payload) => changeStatus(transitRecord, payload)} />}
  </>;

  return { movesFor, dialogs, saving, error };
}
