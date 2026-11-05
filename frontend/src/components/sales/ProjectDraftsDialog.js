"use client";

import { useState } from "react";
import Dialog from "@/components/ui/Dialog";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Button from "@/components/shared/Button";

const savedOn = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const keptUntil = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });

export const draftSavedOn = (draft) => savedOn.format(new Date(draft.savedAt));
export const draftKeptUntil = (draft) => keptUntil.format(new Date(draft.expiresAt));
const draftSavedText = (draft) => `Saved ${draftSavedOn(draft)} · kept until ${draftKeptUntil(draft)}`;

/**
 * The Create Project forms put aside with Save Draft, newest first: open one to carry on, or delete
 * it. Each card says when it was saved and the day it will be gone, because a draft lasts five days
 * and nothing else warns before it lapses. Delete asks first - a draft is somebody's unfinished
 * typing and there is no undo.
 */
export default function ProjectDraftsDialog({ drafts = [], onOpen, onDelete, onClose }) {
  const [deleting, setDeleting] = useState(null);

  return <>
    <Dialog
      title="Project drafts"
      description="Create Project forms saved on this computer, kept for five days from their last save. Payment proof files are not kept."
      size="lg"
      height={drafts.length > 2 ? "mid" : "auto"}
      onClose={onClose}
      footer={<Button type="button" onClick={onClose}>Done</Button>}
    >
      {drafts.length === 0
        ? <p className="py-6 text-center text-sm text-slate-500">No drafts. Press Save Draft on a Create Project form to keep it here.</p>
        : <ul className="space-y-3 pb-2">
          {drafts.map((draft) => <li key={draft.id} className="rounded-lg border border-slate-200 bg-white px-3 py-3 sm:px-4">
            <p className="truncate text-sm font-semibold text-slate-800">{draft.title || "Untitled project"}</p>
            <p className="mt-0.5 text-xs text-slate-500">{draft.enquiryId ? `Enquiry #${draft.enquiryId}` : "No enquiry"} · {draftSavedText(draft)}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="primary" aria-label={`Open draft ${draft.title || "Untitled project"}`} onClick={() => onOpen(draft)}>Open draft</Button>
              <Button type="button" size="sm" aria-label={`Delete draft ${draft.title || "Untitled project"}`} onClick={() => setDeleting(draft)}>Delete</Button>
            </div>
          </li>)}
        </ul>}
    </Dialog>
    {deleting && <ConfirmDialog
      layer="confirmOverDialog"
      title="Delete this draft?"
      message={`“${deleting.title || "Untitled project"}” will be removed from this browser. This cannot be undone.`}
      confirmLabel="Delete draft"
      onCancel={() => setDeleting(null)}
      onConfirm={() => { onDelete(deleting.id); setDeleting(null); }}
    />}
  </>;
}
