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
 *
 * **`primaryAction`** says which button carries the emphasis - `"confirm"` (the default, unchanged
 * for every existing caller) styles Confirm in `tone` and leaves Cancel as the plain secondary
 * button, which is right where Confirm is the thing somebody came here to do: deleting an asset,
 * signing out. Pass `"cancel"` for the opposite case - discarding unsaved work, where staying
 * (Cancel, worded "Keep editing" or "Go Back") is the safe default and should draw the eye, not the
 * button that throws work away. There Cancel is styled `primary` and Confirm drops to `secondary`,
 * `tone` unused - a discarded edit is not the kind of danger red is for.
 */
export default function ConfirmDialog({
  open = true,
  title,
  message,
  confirmLabel = "Confirm",
  busyLabel,
  cancelLabel = "Cancel",
  tone = "danger",
  primaryAction = "confirm",
  loading = false,
  confirmDisabled = false,
  layer,
  onCancel,
  onConfirm,
  children,
}) {
  if (!open) return null;

  const cancelVariant = primaryAction === "cancel" ? "primary" : "secondary";
  const confirmVariant = primaryAction === "cancel" ? "secondary" : tone;

  return <Dialog
    title={title}
    description={message}
    layer={layer}
    busy={loading}
    onClose={onCancel}
    // Two buttons, Cancel on the left and the action on the right - side by side on a phone as well.
    footerInline
    footer={<>
      <Button className="max-sm:flex-1" type="button" variant={cancelVariant} onClick={onCancel} disabled={loading}>{cancelLabel}</Button>
      <Button className="max-sm:flex-1" type="button" variant={confirmVariant} onClick={onConfirm} disabled={loading || confirmDisabled}>{loading && busyLabel ? busyLabel : confirmLabel}</Button>
    </>}
  >
    {children}
  </Dialog>;
}
