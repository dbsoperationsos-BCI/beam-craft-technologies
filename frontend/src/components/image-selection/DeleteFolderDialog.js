"use client";

import { useState } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import useSubmitOnce from "@/components/shared/useSubmitOnce";

/*
 * Deleting a folder is permanent: the folder, its subfolders, their photos in the client gallery and
 * the selection items and limits filed under it go, after this one explicit confirmation. Originals on
 * the studio's own storage are never touched, and the client link keeps working for every other
 * folder. Confirming here is also the answer to the server's warning over client-submitted
 * selections, so there is no second step. The dialog closes only once the server has confirmed the
 * delete; a failure stays here, with the reason.
 */
export default function DeleteFolderDialog({ folder, onClose, onDelete }) {
  const [error, setError] = useState("");
  // One press, one request - a double click in the same tick sends no second delete.
  const { busy: deleting, run } = useSubmitOnce();
  async function remove() {
    await run(async () => {
      setError("");
      try {
        await onDelete();
        onClose();
      } catch (cause) {
        setError(cause.message || "Unable to delete the folder.");
      }
    });
  }
  return <ConfirmDialog
    title={`Delete "${folder.name}"`}
    message="Are you sure you want to permanently delete this folder? Its uploaded photos will no longer be available in the client gallery. Associated selection items and limits will also be deleted. This action cannot be undone."
    cancelLabel="Cancel"
    confirmLabel="Delete Permanently"
    busyLabel="Deleting..."
    loading={deleting}
    onCancel={onClose}
    onConfirm={remove}
  >
    {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
  </ConfirmDialog>;
}
