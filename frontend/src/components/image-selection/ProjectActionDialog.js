"use client";

import { useState } from "react";
import Button from "@/components/shared/Button";
import Dialog from "@/components/ui/Dialog";

// Confirms archive and delete. Edit is not a dialog any more: it opens the manual creation form
// pre-filled in the main pane, where every field of the project can be changed at once.
//
// Deleting a project that holds client-SUBMITTED selections is a two-step flow driven by the
// backend: the plain delete answers 409 with the affected counts, and this dialog escalates to a
// high-impact warning that requires typing the project's name before "Delete Anyway" unlocks.
// The backend re-checks on the acknowledged retry, so nothing rests on this dialog alone.
export default function ProjectActionDialog({ mode, project, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [impact, setImpact] = useState(null); const [typed, setTyped] = useState("");
  const remove = mode === "delete";
  const projectName = project?.projectName || "";
  const confirmBlocked = Boolean(impact) && typed.trim() !== projectName.trim();
  const title = impact ? "High-impact deletion" : remove ? "Delete project" : "Archive project";
  const description = impact
    ? undefined
    : remove
      ? `Delete ${projectName}? Its photos, folders, selections and shared gallery link are permanently deleted and cannot be restored. Original photos in your own storage are not touched. To keep the data, archive the project instead.`
      : `Archive ${projectName}? Photos and project data stay preserved and can be restored later.`;
  async function submit(event) {
    event.preventDefault();
    if (confirmBlocked) return;
    setBusy(true); setError("");
    try {
      await onConfirm(impact ? { acknowledgeSubmitted: true } : undefined);
      onClose();
    } catch (actionError) {
      const details = actionError.data?.details;
      if (details?.requiresAcknowledgement) { setImpact(details); setBusy(false); return; }
      setError(actionError.message || "Unable to complete this project action.");
      setBusy(false);
    }
  }
  return <Dialog
    title={title}
    description={description}
    busy={busy}
    onClose={onClose}
    onSubmit={submit}
    bodyClassName="pb-1"
    footer={<>
      <Button type="button" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button type="submit" variant="danger" disabled={busy || confirmBlocked}>{busy ? "Working..." : impact ? "Delete Anyway" : remove ? "Delete project" : "Archive project"}</Button>
    </>}
  >
    {impact && (
      <div className="mt-1 space-y-3">
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-800" role="alert">
          <p className="font-bold">⚠️ HIGH WARNING</p>
          <p className="mt-1">This project contains photos that were already selected and submitted by the client. Deleting it will permanently remove:</p>
          <ul className="mt-2 list-disc pl-4">
            <li><strong>{impact.submittedSelectionCount}</strong> client-submitted selections</li>
            <li><strong>{impact.photoCount}</strong> photo records with their previews and thumbnails</li>
            <li><strong>{impact.folderCount}</strong> folders{impact.shootCount ? <> across <strong>{impact.shootCount}</strong> shoots</> : null}</li>
          </ul>
          <p className="mt-2">The original photos on your Local Drive / NAS will NOT be deleted. This action cannot be undone.</p>
        </div>
        <label className="block text-xs text-slate-700">
          Type <strong>{projectName}</strong> to confirm deletion
          <input value={typed} onChange={(event) => setTyped(event.target.value)} autoFocus placeholder={projectName} className="mt-1 h-9 w-full rounded-md border border-slate-300 px-2 text-sm outline-none focus:border-red-500" />
        </label>
      </div>
    )}
    {error && <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
  </Dialog>;
}
