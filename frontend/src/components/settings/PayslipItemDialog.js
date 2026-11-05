"use client";

import { useState } from "react";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import RadioGroupField from "@/components/shared/RadioGroupField";
import RepeatableTextList from "@/components/shared/RepeatableTextList";
import TextField from "@/components/shared/TextField";
import useFormErrors from "@/components/shared/useFormErrors";
import Dialog from "@/components/ui/Dialog";
import { PAYSLIP_INPUT_TYPES } from "@/lib/payslipTemplate.mjs";

/*
 * Settings → Payroll rules → Edit Payslip → Add: a popup laid out the way Add Speak-up is - what is
 * being added chosen first, a line saying where it shows, then the details for it. Personal and PF
 * details take a label and what is typed into them (a Dropdown its options too); Earnings and
 * Deductions a label, numbers only.
 *
 * Opened over Settings, a form panel itself, so it sits a layer above it (`dialogOverPanel`); the
 * Input type list opens above the popup on its own.
 */

export const PAYSLIP_ITEM_GROUPS = [
  // Personal and PF details are one group, Payslip Info, as Edit Payslip and Edit Employee show them;
  // an item added to it is kept with the personal details.
  { value: "PERSONAL", label: "Payslip Info" },
  { value: "EARNING", label: "Earnings" },
  { value: "DEDUCTION", label: "Deductions" },
];
// As many as the server takes.
const MAX_OPTIONS = 30;
const INPUT_TYPES = PAYSLIP_INPUT_TYPES.map(({ value, label }) => ({ value, label }));
const isColumnGroup = (group) => group === "EARNING" || group === "DEDUCTION";

export default function PayslipItemDialog({ onClose, onSubmit, saving = false }) {
  const [values, setValues] = useState({ group: "PERSONAL", label: "", inputType: "TEXT", options: [] });
  const [error, setError] = useState("");
  const fields = useFormErrors();
  const update = (name, value) => { setValues((current) => ({ ...current, [name]: value })); setError(""); fields.clear(name); };

  const columns = isColumnGroup(values.group);
  const dropdown = !columns && values.inputType === "DROPDOWN";

  function submit(event) {
    event?.preventDefault?.();
    const label = values.label.trim();
    const options = [...new Set((values.options || []).map((option) => option.trim()).filter(Boolean))];
    setError("");
    if (!fields.check({
      group: values.group ? "" : "Choose where it is added.",
      label: label ? "" : "Enter the label.",
      inputType: !columns && !values.inputType ? "Choose the input type." : "",
      options: dropdown && options.length < 2 ? "Give the dropdown at least two options." : "",
    })) return;
    // A refusal from the server is shown here, on the popup it is about.
    Promise.resolve(onSubmit({ group: values.group, label, inputType: columns ? "NUMBER" : values.inputType, ...(dropdown ? { options } : {}) }))
      .catch((requestError) => setError(requestError?.data?.message || requestError?.message || "Unable to add this."));
  }

  return <Dialog
    title="Add to the payslip"
    layer="dialogOverPanel"
    busy={saving}
    onClose={onClose}
    onSubmit={submit}
    footer={<>
      <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Discard</Button>
      <Button type="submit" variant="primary" busy={saving} busyLabel="Adding...">Add</Button>
    </>}
  >
    <div className="flex flex-col gap-4">
      <RadioGroupField
        label="Add to"
        required
        options={PAYSLIP_ITEM_GROUPS}
        value={values.group}
        onChange={(value) => update("group", value)}
        error={fields.errors.group}
        helperText="Payslip Info is asked in Edit Employee; Earnings and Deductions are payroll columns."
        controlClassName="px-0 py-0"
      />
      <TextField
        label="Label"
        required
        maxLength={60}
        placeholder={columns ? "Travel allowance, Late fine..." : "Blood group, PF joining date..."}
        value={values.label}
        onChange={(event) => update("label", event.target.value)}
        error={fields.errors.label}
        helperText="The name printed on the payslip beside this value."
      />
      {/* What is typed into it - only for Payslip Info; Earnings and Deductions are numbers. */}
      {!columns && <Dropdown
        label="Input type"
        required
        ariaLabel="Input type"
        options={INPUT_TYPES}
        value={values.inputType}
        onChange={(value) => update("inputType", value)}
        error={fields.errors.inputType}
        helperText="What kind of answer Edit Employee asks for, such as a date or a list."
        sorted={false}
        searchable={false}
      />}
      {/* A Dropdown's choices, typed one to a box - the list Edit Employee offers for it. */}
      {dropdown && <RepeatableTextList
        label="Options"
        required
        max={MAX_OPTIONS}
        rowLabel={(index) => `Option ${index + 1}`}
        addAriaLabel="Add another option"
        placeholder="A+, Married, Hindi..."
        value={values.options}
        onChange={(next) => update("options", next)}
        error={fields.errors.options}
      />}
      {(error || fields.summary) && <p role="alert" className="text-sm text-red-600">{error || fields.summary}</p>}
    </div>
  </Dialog>;
}
