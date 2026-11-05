"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import HelpTip from "@/components/shared/HelpTip";
import Loader from "@/components/shared/Loader";
import TextField from "@/components/shared/TextField";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dialog from "@/components/ui/Dialog";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { layers } from "@/constants/layers";
import PayslipItemDialog from "@/components/settings/PayslipItemDialog";
import {
  createPayrollComponent,
  getPayrollComponents,
  removePayrollComponent,
  updatePayrollComponent,
} from "@/services/hrm/payrollRegister.service";
import {
  createPayslipField,
  getBuiltInPayslipItems,
  getPayslipFields,
  removePayslipField,
  setBuiltInPayslipItem,
  updatePayslipField,
} from "@/services/hrm/payslipFields.service";

/**
 * Settings → Payroll rules → **Edit Payslip**: everything the payslip carries, in three groups -
 * Payslip Info (the personal details, then the PF details), Earnings and Deductions - each item with
 * an on/off and a ⋮ of Edit and Delete.
 *
 * It starts with Salary, LOP Deduction, Salary Advance and Recovery alone; everything else is added
 * here - one of the payslip's own items (Emp Code, PAN, Incentive...) by typing its name.
 *
 * **On** prints it on the payslip; off leaves it off (the payslip, its sample and its preview). Its
 * ⋮ holds **Edit** - a new name, printed on the payslip in its place - and **Delete**.
 * **Delete** takes it off the payslip and off this list - deleted items are not listed here: one the
 * payslip always had (from the employee record or the payroll row) is kept off; one added here is
 * removed for good, with what was typed into it - except an Earnings or Deductions column a paid month holds, which is turned off
 * instead. Add opens a popup laid out like Add Speak-up (`PayslipItemDialog`).
 *
 * Added Personal and PF details are asked for in Edit Employee → Payslip Details while on; added
 * Earnings and Deductions are columns on Payroll → Main Page, which keeps them whether or not the
 * payslip prints them. `HRM / Payroll Register`: Read lists them, Read / Write changes them; the
 * server takes a change only from somebody who reaches every branch.
 */

// Payslip Info holds the personal details and then the PF details, as Edit Employee → Payslip Details does.
const GROUPS = [
  { value: "INFO", members: ["PERSONAL", "PF"], label: "Payslip Info", where: "Edit Employee → Payslip Details → Payslip Info" },
  { value: "EARNING", members: ["EARNING"], label: "Earnings", where: "Payroll → Main Page, under Earnings" },
  { value: "DEDUCTION", members: ["DEDUCTION"], label: "Deductions", where: "Payroll → Main Page, under Deductions" },
];
const groupOf = (value) => GROUPS.find((entry) => entry.members.includes(value));
const isColumnGroup = (group) => group === "EARNING" || group === "DEDUCTION";
const messageOf = (error, fallback) => error?.data?.message || error?.message || fallback;

export default function EditPayslipPanel({ canWrite = false, onNotice, onError }) {
  // Every item, as `{ key, kind: "builtIn" | "field" | "column", group, id, label, name, shown, deleted, used, paidAmounts }` -
  // `name` what it is called now, `label` a built-in item's own (what the server knows it by).
  const [items, setItems] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(null);
  // `{ item, name, error }` while an item is being renamed.
  const [renaming, setRenaming] = useState(null);
  const { busy, run } = useSubmitOnce();

  const load = useCallback(() => Promise.all([getBuiltInPayslipItems(), getPayslipFields(), getPayrollComponents()])
    .then(([builtIns, fields, columns]) => {
      setItems([
        ...(builtIns?.data || []).map((item) => ({ key: `built-in-${item.label}`, kind: "builtIn", group: item.group, label: item.label, name: item.name || item.label, shown: item.shown, deleted: item.deleted, deletable: item.deletable !== false })),
        // An archived detail or column (from before this screen had toggles) reads as off.
        ...(fields?.data || []).map((field) => ({ key: `field-${field.id}`, kind: "field", group: field.section, id: field.id, label: field.label, name: field.label, shown: field.shownOnPayslip && !field.archived, used: field.answers })),
        ...(columns?.data || []).map((column) => ({ key: `column-${column.id}`, kind: "column", group: column.kind, id: column.id, label: column.name, name: column.name, shown: column.shownOnPayslip && !column.archived, used: column.amounts, paidAmounts: column.paidAmounts })),
      ]);
      setLoadError("");
    })
    .catch((error) => setLoadError(messageOf(error, "Unable to load the payslip's items."))), []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, reloadToken]);

  if (loadError) {
    return <div className="flex flex-wrap items-center gap-3">
      <p role="alert" className="text-sm text-red-600">{loadError}</p>
      <Button type="button" variant="secondary" onClick={() => setReloadToken((value) => value + 1)}>Try again</Button>
    </div>;
  }
  if (!items) return <Loader label="Loading the payslip's items..." />;

  // A refusal is thrown back to the Add panel, which shows it on the form.
  async function add({ group: value, label, inputType, options }) {
    const group = groupOf(value);
    // One of the payslip's own items, by its name, comes back as itself - with what was typed into it.
    const own = items.find((item) => item.kind === "builtIn" && item.deleted && item.group === value
      && [item.label, item.name].some((name) => name.toLowerCase() === label.toLowerCase()));
    if (own) await setBuiltInPayslipItem(own.label, { deleted: false });
    else if (isColumnGroup(value)) await createPayrollComponent({ name: label, kind: value });
    else await createPayslipField({ section: value, label, inputType, options });
    onNotice?.(`"${own ? own.name : label}" added - it shows in ${group.where}.`);
    setAdding(false);
    await load();
  }

  async function setShown(item, shown) {
    try {
      if (item.kind === "builtIn") await setBuiltInPayslipItem(item.label, { shown });
      // Turning one back on also brings back one archived before this screen had toggles.
      else if (item.kind === "field") await updatePayslipField(item.id, { shownOnPayslip: shown, ...(shown ? { archived: false } : {}) });
      else await updatePayrollComponent(item.id, { shownOnPayslip: shown, ...(shown ? { archived: false } : {}) });
      onNotice?.(shown ? `"${item.name}" is on the payslip.` : `"${item.name}" is left off the payslip.`);
      await load();
    } catch (error) {
      onError?.(messageOf(error, "Unable to change this."));
    }
  }

  // A refusal - a name already on the payslip - stays in the dialog, on the field it is about.
  async function rename() {
    const { item } = renaming;
    const name = renaming.name.trim();
    if (!name) { setRenaming((current) => ({ ...current, error: "Enter a name." })); return; }
    if (name === item.name) { setRenaming(null); return; }
    try {
      if (item.kind === "builtIn") await setBuiltInPayslipItem(item.label, { name });
      else if (item.kind === "field") await updatePayslipField(item.id, { label: name });
      else await updatePayrollComponent(item.id, { name });
      onNotice?.(`"${item.name}" is now "${name}".`);
      setRenaming(null);
      await load();
    } catch (error) {
      setRenaming((current) => current && { ...current, error: messageOf(error, "Unable to rename this.") });
    }
  }

  async function remove() {
    const item = deleting;
    try {
      if (item.kind === "builtIn") {
        await setBuiltInPayslipItem(item.label, { deleted: true });
        onNotice?.(`"${item.name}" deleted from the payslip.`);
      } else {
        const response = item.kind === "field" ? await removePayslipField(item.id) : await removePayrollComponent(item.id);
        const cleared = response?.data?.cleared || 0;
        onNotice?.(cleared ? `"${item.name}" deleted, with ${cleared} ${cleared === 1 ? "entry" : "entries"} typed into it.` : `"${item.name}" deleted.`);
      }
      setDeleting(null);
      await load();
    } catch (error) {
      setDeleting(null);
      onError?.(messageOf(error, "Unable to delete this."));
    }
  }

  // An Earnings or Deductions column a paid month holds cannot be deleted - it is turned off instead.
  const deleteBlocked = deleting?.paidAmounts > 0;

  return <div className="space-y-4">
    {/* The section's heading, with Add at its right. */}
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 id="payroll-rules-edit-payslip" className="flex items-center text-sm font-semibold text-slate-900">Edit Payslip<HelpTip text="Everything the payslip carries. Turn an item off to leave it off the payslip." /></h3>
      </div>
      {canWrite && <Button type="button" variant="primary" onClick={() => setAdding(true)} className="shrink-0">Add</Button>}
    </div>
    {/* Two flowing columns: each group sits straight below the one above it, with no gap beside a long one. */}
    <div className="columns-1 gap-4 sm:columns-2">
      {GROUPS.map((group) => {
        const ofGroup = group.members.flatMap((member) => items.filter((item) => item.group === member && !item.deleted));
        return <div key={group.value} className="mb-4 min-w-0 break-inside-avoid">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{group.label}</p>
          {ofGroup.length === 0
            ? <p className="text-xs text-slate-500 sm:text-sm">Nothing here.</p>
            : <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
              {ofGroup.map((item) => <li key={item.key} className="flex min-h-11 items-center gap-2 px-3 py-1.5">
                <span className={`min-w-0 flex-1 truncate text-sm ${item.shown ? "text-slate-800" : "text-slate-500"}`} title={item.name}>{item.name}</span>
                <ToggleSwitch
                  ariaLabel={`Show ${item.name} on the payslip`}
                  checked={item.shown}
                  disabled={!canWrite || busy}
                  onCheckedChange={(checked) => run(() => setShown(item, checked))}
                />
                {canWrite && <OptionsMenu
                  ariaLabel={`Actions for ${item.name}`}
                  menuZIndexClassName={layers.menuOverPanel}
                  items={[
                    { label: "Edit", onSelect: () => setRenaming({ item, name: item.name, error: "" }) },
                    // Salary, LOP Deduction, Salary Advance and Recovery are never deleted - the server refuses it too.
                    ...(item.deletable === false ? [] : [{ label: "Delete", tone: "danger", onSelect: () => setDeleting(item) }]),
                  ]}
                />}
              </li>)}
            </ul>}
        </div>;
      })}
    </div>

    {adding && <PayslipItemDialog saving={busy} onClose={() => { if (!busy) setAdding(false); }} onSubmit={(draft) => run(() => add(draft))} />}

    {renaming && <Dialog
      title={`Rename "${renaming.item.name}"`}
      layer="dialogOverPanel"
      busy={busy}
      onClose={() => { if (!busy) setRenaming(null); }}
      onSubmit={(event) => { event?.preventDefault?.(); void run(rename); }}
      footer={<>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => setRenaming(null)}>Cancel</Button>
        <Button type="submit" variant="primary" busy={busy} busyLabel="Saving...">Save</Button>
      </>}
    >
      <TextField
        label="Name"
        required
        maxLength={60}
        value={renaming.name}
        error={renaming.error}
        helperText="The name the payslip prints for this line from now on, in place of the old one."
        onChange={(event) => setRenaming((current) => ({ ...current, name: event.target.value, error: "" }))}
      />
    </Dialog>}

    {deleting && (deleteBlocked ? <ConfirmDialog
      open
      layer="dialogOverPanel"
      title={`"${deleting.name}" can't be deleted`}
      message={`It is on ${deleting.paidAmounts} paid payroll ${deleting.paidAmounts === 1 ? "row" : "rows"}, and deleting it would change pay already settled. Turn it off instead: the payslip leaves it off and the paid months keep it.`}
      confirmLabel={deleting.shown ? "Turn off instead" : "Close"}
      busyLabel="Turning off..."
      tone="primary"
      loading={busy}
      onCancel={() => setDeleting(null)}
      onConfirm={() => (deleting.shown ? run(async () => { const item = deleting; setDeleting(null); await setShown(item, false); }) : setDeleting(null))}
    /> : <ConfirmDialog
      open
      layer="dialogOverPanel"
      title={`Delete "${deleting.name}"?`}
      message={deleting.kind === "builtIn"
        ? "It is taken off the payslip and off this list."
        : deleting.used
          ? `What has been typed into it - ${deleting.used} ${deleting.used === 1 ? "entry" : "entries"} - goes with it${deleting.kind === "column" ? ", and those months' totals change" : ""}. This can't be undone.`
          : "Nothing has been typed into it yet. This can't be undone."}
      confirmLabel="Delete"
      busyLabel="Deleting..."
      tone="danger"
      loading={busy}
      onCancel={() => setDeleting(null)}
      onConfirm={() => run(remove)}
    />)}
  </div>;
}
