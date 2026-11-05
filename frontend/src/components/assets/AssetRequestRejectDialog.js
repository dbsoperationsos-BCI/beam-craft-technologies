"use client";

import { useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import { assetRequestRejectSections } from "@/constants/formPanelConfig";

/**
 * Turning down an asset request. The remark is checked here as well as by the server, so the
 * requester is never told "rejected" with no reason attached.
 */
export default function AssetRequestRejectDialog({ request, saving, error, onClose, onSubmit }) {
  const [form, setForm] = useState({ remarks: "" });
  const [remarksError, setRemarksError] = useState("");

  function submit(event) {
    event.preventDefault();
    if (!form.remarks.trim()) {
      setRemarksError("A reason for the rejection is required.");
      return;
    }
    onSubmit(form.remarks.trim());
  }

  return <SchemaFormPanel
    title={`Reject ${request.requestCode}`}
    description="Tell the requester why this asset is not being added."
    sections={assetRequestRejectSections}
    values={form}
    onChange={(field, value) => { setForm({ [field]: value }); setRemarksError(""); }}
    errors={{ remarks: remarksError }}
    context={{ request }}
    sidebarAriaLabel="Asset request rejection sections"
    closeAriaLabel="Close asset request rejection form"
    onClose={onClose}
    onSubmit={submit}
    error={error}
    saving={saving}
    submitLabel="Reject Request"
    savingLabel="Rejecting..."
    submitVariant="danger"
  />;
}
