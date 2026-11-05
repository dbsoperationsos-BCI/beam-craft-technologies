"use client";

import { useCallback, useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import { clientStorageStatusSteps, emptyValues } from "@/constants/formPanelConfig";
import { dropUnansweredYesNo } from "@/constants/yesNoField";

/**
 * The three steps along the storage flow that ask for details, plus the sale. Which fields are
 * asked for is the step's business, so this only picks the step and posts what was filled in.
 */
export default function ClientStorageStatusDialog({ record, nextStatus, options, saving, error, onClose, onSubmit }) {
  const step = clientStorageStatusSteps[nextStatus];
  const [form, setForm] = useState(() => emptyValues(step.sections, record));
  const update = useCallback((field, value) => setForm((current) => ({ ...current, [field]: value })), []);

  function submit(event) {
    event.preventDefault();
    // A check nobody answered is left out rather than sent as the empty string the form holds for it -
    // see `dropUnansweredYesNo`.
    onSubmit({ nextStatus, details: dropUnansweredYesNo(step.sections, form) });
  }

  return <SchemaFormPanel
    title={`Move to ${nextStatus}`}
    description={step.description}
    sections={step.sections}
    values={form}
    onChange={update}
    context={{ record, options }}
    sidebarAriaLabel="Status form sections"
    closeAriaLabel="Close status form"
    onClose={onClose}
    onSubmit={submit}
    error={error}
    saving={saving}
    submitLabel="Confirm Status Change"
    savingLabel="Saving..."
  />;
}
