"use client";

import { useMemo, useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import RecordViewPanel from "@/components/data-table/RecordViewPanel";
import { scheduledPaymentInfoSections } from "@/constants/accountsConfig";
import DateField from "@/components/shared/DateField";
import Dropdown from "@/components/shared/Dropdown";
import TextAreaField from "@/components/shared/TextAreaField";
import TextField from "@/components/shared/TextField";
import useFormErrors from "@/components/shared/useFormErrors";
import { formatAmount } from "@/components/data-table/tableCells";
import PreProductionSummaryGroup from "@/components/project-management/PreProductionSummaryGroup";
import ProjectHoldBadge from "@/components/project-management/ProjectHoldBadge";
import CashEntryFormPanel from "./CashEntryFormPanel";
import { formatDay } from "@/lib/productionSteps.mjs";
import { paymentStatusAction, pendingAfter, statusChoices } from "@/lib/scheduledPayments.mjs";
import { dueDateText } from "@/lib/paymentSchedule.mjs";
import {
  clearScheduledPayment, partPayScheduledPayment, setScheduledPaymentHold,
} from "@/services/accounts/scheduled-payments.service";

const SECTIONS = [
  { id: "payment", title: "Payment", fields: [{ name: "summary", type: "custom", colSpan: 2 }] },
  { id: "status", title: "Status", fields: [{ name: "statusControl", type: "custom", colSpan: 2 }] },
];
const todayKey = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
const START = { choice: "AUTO", remarks: "", paidAmount: "", pendingDueDate: "" };

/**
 * One scheduled payment on Accounts Manager, as a cash entry is: a double click (or ⋮ View) reads it
 * - its project, and what is due, when and why - and ⋮ **Record** opens it to work (`recording`): a
 * Status at the bottom - Clear, Partially paid, On Hold (or Take off hold).
 *
 * Clear and Partially paid end in Cash Received, opened over this with the project and the amount
 * filled in; that records the money, linked to this payment. Partially paid first asks the Paid
 * Amount, shows the Pending Amount it leaves and needs the date that rest is due - it becomes a
 * payment of its own, Due. Beside the title, the project's own badge: on hold, and Overdue or Due
 * (Overdue when it has both), as every panel on the project shows it.
 *
 * `cashOptions` are Cash Received's dropdowns. `onChanged(payment, message)` hands the payment back.
 */
export default function ScheduledPaymentPanel({ payment, recording = false, canWrite, cashOptions, zIndexClassName, onClose, onChanged }) {
  const [value, setValue] = useState(START);
  const [problem, setProblem] = useState("");
  const fields = useFormErrors();
  const [saving, setSaving] = useState(false);
  const [cashForm, setCashForm] = useState(null);
  const working = recording && canWrite;
  const choices = working ? statusChoices(payment, { canRecordCash: Boolean(cashOptions) }) : [];
  const sections = choices.length ? SECTIONS : SECTIONS.slice(0, 1);

  const summaryRows = useMemo(() => [
    ["Event ID", payment.eventId],
    ["Client Name", payment.clientName],
    ["Category", payment.category],
    ["Due Date", dueDateText(payment, formatDay, "With the final settlement")],
    ["Amount", formatAmount(payment.amount)],
    ["Received", formatAmount(payment.received)],
    ["Pending", formatAmount(payment.pending)],
    ["Status", payment.status],
    ["Remarks", payment.remarks],
    ...(payment.holdAt ? [["Hold Remarks", [payment.holdRemarks, payment.holdBy && `by ${payment.holdBy}`].filter(Boolean).join(" - ")]] : []),
    ...((payment.receipts || []).length ? [["Receipts", payment.receipts.map((entry) => `${entry.entryId} · ${formatAmount(entry.amount)} · ${formatDay(entry.entryDate)}`).join("; ")]] : []),
  ], [payment]);

  const set = (patch) => {
    setValue((current) => ({ ...current, ...patch }));
    setProblem("");
    Object.keys(patch).forEach(fields.clear);
  };
  const pending = pendingAfter(payment, value.paidAmount);

  const context = {
    renderers: {
      summary: () => <PreProductionSummaryGroup rows={summaryRows} />,
      statusControl: () => <div className="flex flex-col gap-3 md:max-w-xl">
        <Dropdown label="Status" required helperText="Where this payment stands; Clear and Partially paid open Cash Received." value={value.choice} onChange={(choice) => set({ choice: choice || "AUTO" })} options={choices} searchable={false} sorted={false} error={fields.errors.choice} />
        {value.choice === "HOLD" && <TextAreaField label="Remarks" required helperText="Why the payment is on hold, shown as its Hold Remarks." value={value.remarks} onChange={(event) => set({ remarks: event.target.value })} error={fields.errors.remarks} />}
        {value.choice === "PARTIAL" && <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Paid Amount" required helperText="The amount the client has paid now, recorded in Cash Received." type="number" min="0" step="0.01" inputMode="decimal" value={value.paidAmount} onChange={(event) => set({ paidAmount: event.target.value })} error={fields.errors.paidAmount} />
          <TextField label="Pending Amount" readOnly helperText="Worked out for you: what is still owed after this payment." value={value.paidAmount ? String(pending) : ""} note={`Of ${formatAmount(payment.pending)} pending`} />
          <DateField label="Pending Amount Due Date" required helperText="When the client is to pay the rest." value={value.pendingDueDate} minDate={todayKey()} onChange={(key) => set({ pendingDueDate: key || "" })} error={fields.errors.pendingDueDate} />
        </div>}
        {(value.choice === "CLEAR" || value.choice === "PARTIAL") && <p className="text-xs text-slate-500">Saving opens Cash Received with this project and the amount filled in; the payment changes once that is recorded.</p>}
        {problem && <p role="alert" className="text-sm text-red-600">{problem}</p>}
      </div>,
    },
  };

  async function run(task, message) {
    setSaving(true);
    try {
      const response = await task();
      onChanged?.(response?.data, message);
      return true;
    } catch (error) {
      setProblem(error.message || "Unable to update this payment.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    const { action, problem: why, field } = paymentStatusAction(payment, value, todayKey());
    if (!fields.check(why ? { [field]: why } : {})) return;
    if (action === "none") { onClose(); return; }
    if (action === "hold") { if (await run(() => setScheduledPaymentHold(payment.id, { hold: true, remarks: value.remarks }), "Payment put on hold.")) onClose(); return; }
    if (action === "release") { if (await run(() => setScheduledPaymentHold(payment.id, { hold: false }), "Payment taken off hold.")) onClose(); return; }
    const amount = action === "clear" ? payment.pending : Number(value.paidAmount);
    setCashForm({ action, amount });
  }

  async function recordCash(entry) {
    const recorded = cashForm.action === "clear"
      ? await clearScheduledPayment(payment.id, entry)
      : await partPayScheduledPayment(payment.id, { paidAmount: cashForm.amount, pendingDueDate: value.pendingDueDate, entry });
    const entryId = recorded?.entry?.entryId || "";
    onChanged?.(recorded?.data, cashForm.action === "clear" ? `Payment cleared${entryId ? ` - ${entryId} recorded` : ""}.` : `Part payment recorded${entryId ? ` (${entryId})` : ""}; the rest is due ${formatDay(value.pendingDueDate)}.`);
    setCashForm(null);
    onClose();
  }

  const badge = <ProjectHoldBadge status={payment.projectStatus} holds={payment.holds} paymentsDue={payment.paymentsDue} />;

  // Read, not worked: the usual read-only view - the project, and what is due, when and why.
  if (!working) {
    return <RecordViewPanel
      title={`${payment.eventId || "Project"} — ${payment.category}`}
      titleAddon={badge}
      entity={payment}
      sections={scheduledPaymentInfoSections}
      sidebarAriaLabel="Scheduled payment sections"
      onClose={onClose}
    />;
  }

  return <>
    <SchemaFormPanel
      title={`${payment.eventId || "Project"} — ${payment.category}`}
      titleAddon={badge}
      description={[payment.clientName, payment.branch].filter(Boolean).join(" · ") || undefined}
      sections={sections}
      values={value}
      onChange={() => {}}
      context={context}
      sidebarAriaLabel="Scheduled payment sections"
      closeAriaLabel="Close scheduled payment"
      // Above a project's own form, when it is opened from that form's Payments tab.
      zIndexClassName={zIndexClassName}
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      submitLabel={choices.length ? "Save" : undefined}
      readOnly={!choices.length}
    />
    {cashForm && <CashEntryFormPanel
      preset={{
        entryType: "Received",
        project: { id: payment.projectId, eventId: payment.eventId, clientName: payment.clientName, sourceBranch: payment.branch },
        values: { amount: String(cashForm.amount) },
        amountFixed: true,
      }}
      options={cashOptions}
      onClose={() => setCashForm(null)}
      onRecord={recordCash}
      submitLabel={cashForm.action === "clear" ? "Record & Clear" : "Record Part Payment"}
      zIndexClassName="z-[130]"
    />}
  </>;
}
