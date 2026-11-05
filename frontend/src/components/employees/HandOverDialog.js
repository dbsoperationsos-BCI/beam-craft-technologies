"use client";

import { useEffect, useMemo, useState } from "react";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import useFormErrors from "@/components/shared/useFormErrors";
import Dialog from "@/components/ui/Dialog";
import { getEmployeeDirectory } from "@/services/hrm/employees.service";

/*
 * Offboarding someone who still holds work: everything still pending under their name, and who
 * takes it over. The chosen person gets all of it, in the same save as the offboarding itself
 * (`backend/src/modules/hrm/separations/handover.js`). Finished work keeps the leaver's name.
 */
const GROUPS = [
  ["tasks", "Open tasks"],
  ["leads", "CRM leads"],
  ["projects", "Projects (Pre Production, Production, Post Production roles)"],
  ["productions", "Production shoots (coordinator, team or crew)"],
  ["candidates", "Interview candidates"],
  ["assignmentRules", "Lead and candidate assignment rules"],
  ["approvals", "Alternative and approver for colleagues"],
];

export default function HandOverDialog({ employee, pending, saving = false, error = "", onConfirm, onClose }) {
  const [employees, setEmployees] = useState([]);
  const [receiver, setReceiver] = useState(pending?.suggested?.id ? String(pending.suggested.id) : "");
  const [loadError, setLoadError] = useState("");
  const fields = useFormErrors();

  function confirm() {
    if (!fields.check({ receiver: receiver ? "" : "Choose who takes the work over." })) return;
    onConfirm(Number(receiver));
  }

  useEffect(() => {
    let live = true;
    getEmployeeDirectory()
      .then((answer) => { if (live) setEmployees(Array.isArray(answer?.data) ? answer.data : []); })
      .catch(() => { if (live) setLoadError("The employee list could not be loaded."); });
    return () => { live = false; };
  }, []);

  // Anybody working here except the person leaving.
  const options = useMemo(() => employees
    .filter((person) => person.id !== employee.id)
    .map((person) => ({ value: String(person.id), label: person.employeeId ? `${person.employeeName} · ${person.employeeId}` : person.employeeName })), [employees, employee.id]);

  return <Dialog
    title="Reassign pending work"
    description={`${employee.employeeName} still has pending work. Choose who takes it over - they get all of it.`}
    // Opened from the offboarding form, a full-screen panel: on the default dialog layer it sat
    // behind the form it was asking about.
    layer="dialogOverPanel"
    onClose={onClose}
    busy={saving}
    size="md"
    footer={<>
      <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Back</Button>
      <Button type="button" variant="primary" onClick={confirm} disabled={saving}>
        {saving ? "Saving…" : "Reassign and complete offboarding"}
      </Button>
    </>}
  >
    <div className="space-y-4 text-sm">
      <div className="space-y-3">
        {GROUPS.filter(([key]) => pending?.[key]?.count).map(([key, title]) => {
          const group = pending[key];
          const more = group.count - group.items.length;
          return <section key={key} className="rounded-lg border border-slate-200 px-3 py-2">
            <h3 className="font-semibold text-slate-800">{title} <span className="font-normal text-slate-500">({group.count})</span></h3>
            <ul className="mt-1 space-y-0.5 text-[13px] text-slate-600">
              {group.items.map((item) => <li key={item} className="break-words">{item}</li>)}
              {more > 0 && <li className="text-slate-400">and {more} more</li>}
            </ul>
          </section>;
        })}
      </div>

      <Dropdown
        mode="input"
        label="Reassign to"
        helperText="The employee who takes over all of this pending work."
        required
        placeholder="Choose an employee"
        menuZIndexClassName="z-[200]"
        value={receiver}
        onChange={(value) => { setReceiver(value); fields.clear("receiver"); }}
        options={options}
        error={fields.errors.receiver}
      />
      <p className="text-[13px] text-slate-500">
        Only pending work moves. Completed tasks, converted leads, delivered projects and finished shoots keep {employee.employeeName}&apos;s name.
      </p>

      {(error || loadError) && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{error || loadError}</p>}
    </div>
  </Dialog>;
}
