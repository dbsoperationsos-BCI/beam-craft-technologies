"use client";

import { useState } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

// Deleting a folder that holds client-SUBMITTED selections is a two-step flow driven by the
// backend: the plain delete answers 409 with the affected counts, and this dialog escalates to a
// high-impact warning that requires typing DELETE before "Delete Anyway" unlocks. The backend
// re-checks on the acknowledged retry, so nothing rests on this dialog alone.
export default function DeleteFolderDialog({ folder, onClose, onDelete }) {
  const [error, setError] = useState(""); const [deleting, setDeleting] = useState(false);
  const [impact, setImpact] = useState(null); const [typed, setTyped] = useState("");
  const confirmBlocked = Boolean(impact) && typed.trim() !== "DELETE";
  async function remove() {
    if (confirmBlocked) return;
    setDeleting(true); setError("");
    try {
      await onDelete(impact ? { acknowledgeSubmitted: true } : undefined);
      onClose();
    } catch (cause) {
      const details = cause.data?.details;
      if (details?.requiresAcknowledgement) { setImpact(details); setDeleting(false); return; }
      setError(cause.message || "Unable to delete folder.");
      setDeleting(false);
    }
  }
  return <ConfirmDialog
    title={impact ? "High-impact deletion" : "Delete Folder"}
    message={impact ? undefined : `Delete ${folder.name}? All previews, thumbnails, subfolders and selection data inside this folder will be permanently removed. Your original photos will NOT be deleted. This cannot be undone.`}
    confirmLabel={impact ? "Delete Anyway" : "Delete"}
    busyLabel="Deleting..."
    loading={deleting}
    confirmDisabled={confirmBlocked}
    onCancel={onClose}
    onConfirm={remove}
  >
    {impact && (
      <div className="space-y-3">
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-800" role="alert">
          <p className="font-bold">⚠️ HIGH WARNING</p>
          <p className="mt-1">This folder contains <strong>{impact.submittedSelectionCount}</strong> client-submitted selections across <strong>{impact.photoCount}</strong> photos. Deleting it will permanently remove those submitted selections, the photo records, their previews and thumbnails, and {impact.folderCount > 1 ? `all ${impact.folderCount} folders in this branch` : "this folder"}.</p>
          <p className="mt-2">Your original photos will NOT be deleted. This action cannot be undone.</p>
        </div>
        <label className="block text-xs text-slate-700">
          Type <strong>DELETE</strong> to confirm
          <input value={typed} onChange={(event) => setTyped(event.target.value)} autoFocus placeholder="DELETE" className="mt-1 h-9 w-full rounded-md border border-slate-300 px-2 text-sm outline-none focus:border-red-500" />
        </label>
      </div>
    )}
    {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
  </ConfirmDialog>;
}
