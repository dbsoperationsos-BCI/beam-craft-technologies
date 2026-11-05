"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import TextAreaField from "@/components/shared/TextAreaField";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import useFormErrors from "@/components/shared/useFormErrors";

/**
 * The remark asked on the way back to a project's Status tab, once something was changed in the
 * stage opened from it. It goes to the Status tab's update history, so it is required: the only way
 * past it is to say what changed, or to go back to the editor ("Keep editing").
 *
 * `onConfirm(remark)` saves it; the caller closes the dialog once it has.
 *
 * Drawn on <body>, above every panel. It is opened from the Status tab, which sits inside the
 * project's own panel - drawn there, its layer counted only inside that panel, so it opened hidden
 * behind the stage editor stacked on top (Pre Production, Production), and Close and Back looked
 * dead the moment anything had been saved.
 */
export default function StageUpdateRemarkDialog({ stageLabel, saving = false, error = "", onCancel, onConfirm }) {
  const [remark, setRemark] = useState("");
  const fields = useFormErrors();
  return createPortal(<ConfirmDialog
    title={`What did you update in ${stageLabel}?`}
    message="This remark is kept in the project's status history."
    tone="primary"
    confirmLabel="Save remark"
    busyLabel="Saving..."
    cancelLabel="Keep editing"
    loading={saving}
    layer="dialogOverPanel"
    onCancel={onCancel}
    onConfirm={() => { if (fields.check({ remark: remark.trim() ? "" : "Enter a remark." })) onConfirm(remark.trim()); }}
  >
    <TextAreaField required label="Remark" helperText="What you changed in this stage, kept in the status history." value={remark} onChange={(event) => { setRemark(event.target.value); fields.clear("remark"); }} rows={4} error={fields.errors.remark} />
    {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
  </ConfirmDialog>, document.body);
}
