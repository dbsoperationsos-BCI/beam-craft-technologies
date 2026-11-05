"use client";

import { useState } from "react";
import Button from "@/components/shared/Button";
import TextField from "@/components/shared/TextField";
import Dialog from "@/components/ui/Dialog";
import { addGroupToDepartment, removeGroupFromDepartment } from "@/services/hrm/whatsapp-groups.service";

/**
 * One department's WhatsApp groups, added and taken away — the ⋮'s Edit.
 *
 * Both halves in one place, because they are one question: which groups does this department have.
 * Each change is saved as it is made rather than gathered behind a Save, since each is one row
 * written and a half-finished list is not a thing worth keeping.
 *
 * **Adding is attach-or-create.** A group's name is unique, because it is one group on WhatsApp, so
 * typing a name the studio already uses means "this department too" rather than a second group of
 * that name. Typing a new one names it for the first time.
 *
 * **Removing takes the group out from under this department and keeps the group.** It may serve
 * other departments, and even where it does not it is still a group the studio named and may be
 * adding people to by hand - a group under no department is simply one onboarding no longer adds
 * anybody to.
 *
 * Nobody is added to or taken out of the group on WhatsApp by any of this. That happens when an
 * employee is onboarded or relieved.
 */
export default function DepartmentGroupsEditDialog({ department, onClose, onChanged, onError }) {
  const [name, setName] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const groups = department.groups || [];

  async function add() {
    if (!name.trim()) { setProblem("Type the WhatsApp group's name."); return; }
    setBusy(true);
    try {
      const result = await addGroupToDepartment(department.id, name.trim());
      setName("");
      setProblem("");
      onChanged?.(result?.data, `"${name.trim()}" added to ${department.departmentName}.`);
    } catch (error) {
      setProblem(error?.message || "Unable to add that group.");
    } finally {
      setBusy(false);
    }
  }

  async function take(group) {
    setBusy(true);
    try {
      const result = await removeGroupFromDepartment(department.id, group.id);
      onChanged?.(result?.data, `"${group.name}" is no longer under ${department.departmentName}. The group itself is kept.`);
    } catch (error) {
      onError?.(error?.message || "Unable to take that group out of the department.");
    } finally {
      setBusy(false);
    }
  }

  return <Dialog
    /*
     * Opened from inside the Settings panel, so it has to clear it. `Dialog` defaults to the page's
     * dialog layer (100), which is *under* the form panel (110) - the dialog opened and was painted
     * behind the thing that asked for it, so Edit appeared to do nothing. Every other dialog opened
     * from a settings panel passes this (`EditPayslipPanel`, `PayrollRulesPanel`).
     */
    layer="dialogOverPanel"
    title={`${department.departmentName} — WhatsApp groups`}
    description="Onboarding adds a new employee in this department to every group listed here. Nobody is added or removed on WhatsApp by changing this list."
    busy={busy}
    onClose={onClose}
    onSubmit={(event) => { event.preventDefault(); void add(); }}
    footer={<Button className="max-sm:flex-1" type="button" onClick={onClose} disabled={busy}>Done</Button>}
  >
    <div className="flex flex-wrap items-end gap-2">
      <TextField
        label="Add a group"
        className="min-w-0 flex-1"
        value={name}
        onChange={(event) => { setName(event.target.value); setProblem(""); }}
        placeholder="e.g. Production Team"
        maxLength={200}
        error={problem}
        helperText="Type it exactly as it reads in WhatsApp. A group the studio already uses is put under this department too."
      />
      <Button className="max-sm:w-full" variant="primary" disabled={busy || !name.trim()}>{busy ? "Adding..." : "Add"}</Button>
    </div>

    {groups.length === 0
      ? <p className="mt-3 rounded-lg border border-dashed border-slate-300 px-4 py-5 text-center text-sm text-slate-500">
        No groups under {department.departmentName} yet, so onboarding adds nobody to anything for it.
      </p>
      : <ul className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200">
        {groups.map((group) => <li key={group.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
          <span className="min-w-0 flex-1 break-words text-sm text-slate-800">{group.name}</span>
          <Button type="button" variant="plain" size="sm" className="text-red-600" disabled={busy} onClick={() => void take(group)}>Remove</Button>
        </li>)}
      </ul>}
  </Dialog>;
}
