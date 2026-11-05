"use client";

import { useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import { assetRequestSections, emptyValues } from "@/constants/formPanelConfig";

/**
 * Asking for an asset that does not exist yet. The category tree the page already loaded is passed
 * through as context, which is what the category and sub category lists are built from.
 */
export default function AssetRequestDialog({ tree, saving, error, onClose, onSubmit }) {
  const [form, setForm] = useState(() => emptyValues(assetRequestSections));
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  function submit(event) {
    event.preventDefault();
    onSubmit({ ...form, subCategoryId: form.subCategoryId || null, remarks: form.remarks || null });
  }

  return <SchemaFormPanel
    title="Request an Asset"
    description="Tell us what you need and roughly what kind of thing it is."
    sections={assetRequestSections}
    values={form}
    onChange={update}
    context={{ tree }}
    sidebarAriaLabel="Asset request form sections"
    closeAriaLabel="Close asset request form"
    onClose={onClose}
    onSubmit={submit}
    error={error}
    saving={saving}
    submitLabel="Send Request"
    savingLabel="Sending..."
  />;
}
