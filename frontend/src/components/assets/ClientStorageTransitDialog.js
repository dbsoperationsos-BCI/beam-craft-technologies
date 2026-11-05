"use client";

import { useCallback, useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import { clientStorageTransitSections, emptyValues } from "@/constants/formPanelConfig";

/** Recording how a hard disc is travelling before it leaves for the client. */
export default function ClientStorageTransitDialog({ record, options, saving, error, onClose, onSubmit }) {
  const [form, setForm] = useState(() => emptyValues(clientStorageTransitSections, record));
  const update = useCallback((field, value) => setForm((current) => ({ ...current, [field]: value })), []);

  function submit(event) {
    event.preventDefault();
    onSubmit({ nextStatus: "In Transit", details: form });
  }

  return <SchemaFormPanel
    title="Move to In Transit"
    description="Record how this hard disc is travelling before it leaves."
    sections={clientStorageTransitSections}
    values={form}
    onChange={update}
    context={{ record, options }}
    sidebarAriaLabel="Transit form sections"
    closeAriaLabel="Close transit form"
    onClose={onClose}
    onSubmit={submit}
    error={error}
    saving={saving}
    submitLabel="Confirm Status Change"
    savingLabel="Saving..."
  />;
}
