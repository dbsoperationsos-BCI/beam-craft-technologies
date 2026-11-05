"use client";

import Button from "@/components/shared/Button";
import Dialog from "./Dialog";

/**
 * Asking before something is done that cannot be taken back. Six of these were written out by hand
 * — deleting an asset, a project, an employee, a service, signing out, taking a vendor off the list
 * — each with its own markup for the same question.
 *
 * `children` is for the rare confirmation that also collects something, such as the reason a vendor
 * is being removed.
 */
export default function ConfirmDialog({
  open = true,
  title,
  message,
  confirmLabel = "Confirm",
  busyLabel,
  cancelLabel = "Cancel",
  tone = "danger",
  loading = false,
  confirmDisabled = false,
  layer,
  onCancel,
  onConfirm,
  children,
}) {
  if (!open) return null;

  return <Dialog
    title={title}
    description={message}
    layer={layer}
    busy={loading}
    onClose={onCancel}
    footer={<>
      <Button className="max-sm:flex-1" type="button" onClick={onCancel} disabled={loading}>{cancelLabel}</Button>
      <Button className="max-sm:flex-1" type="button" variant={tone} onClick={onConfirm} disabled={loading || confirmDisabled}>{loading && busyLabel ? busyLabel : confirmLabel}</Button>
    </>}
  >
    {children}
  </Dialog>;
}
