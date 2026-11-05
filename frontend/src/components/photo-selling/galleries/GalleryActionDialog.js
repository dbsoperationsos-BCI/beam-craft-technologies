"use client";

import { useState } from "react";
import Button from "@/components/shared/Button";
import TextField from "@/components/shared/TextField";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dialog from "@/components/ui/Dialog";

/**
 * The question asked before a gallery is duplicated, archived, restored or deleted from its card -
 * the AI Feature's own event question (ai-feature/events/EventActionDialog.js), in a gallery's words.
 *
 * `mode` is one of those four. Duplicate is the only one that collects something - the copy's
 * name - so it is a small form; the other three are the shared confirmation, with delete alone in
 * red. `onConfirm(payload)` does the work and may throw; the message is shown here and the dialog
 * stays open, so a failed delete never reads as a finished one. The words match the gallery's own
 * ⋮ menu: archiving keeps orders and buyers' downloads; deleting keeps only the orders' record, and
 * says so - with the way to keep buyers' downloads - when the gallery has paid orders.
 */
/** What deleting this gallery does, in the studio's words; the gallery workspace's own Delete asks the same. */
export function deleteMessage(gallery) {
  const paid = gallery?.paidOrders || 0;
  return [
    gallery?.status === "PUBLISHED" && "It stops selling at once, and its link and QR code stop working.",
    "The gallery and every photo uploaded to it are deleted for good - from this app and from cloud storage, originals included - with its guests' details and selfies. The files on your own computer are not touched.",
    paid > 0 && `Its ${paid} paid order${paid === 1 ? " stays" : "s stay"} in Orders for your records, but buyers can no longer download the photos they bought. To keep their downloads, archive it instead.`,
  ].filter(Boolean).join(" ");
}

const COPY = {
  delete: { title: "Delete this gallery?", confirm: "Delete gallery", busy: "Deleting...", tone: "danger", message: deleteMessage },
  archive: { title: "Archive this gallery?", confirm: "Archive", busy: "Archiving...", tone: "primary", message: () => "It closes to guests at once and becomes read-only. Its orders are kept, and buyers can still download what they paid for. You can restore it later." },
  restore: { title: "Restore this gallery?", confirm: "Restore", busy: "Restoring...", tone: "primary", message: () => "It comes back to Projects, unpublished until you publish it again. Its link and orders are as they were." },
};

export default function GalleryActionDialog({ mode, gallery, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState(`${gallery?.title || "Gallery"} (copy)`);

  async function run(payload) {
    setBusy(true); setError("");
    try {
      await onConfirm(payload);
      onClose();
    } catch (caught) {
      setError(caught?.message || "Unable to complete this action.");
      setBusy(false);
    }
  }

  if (mode === "duplicate") {
    const trimmed = name.trim();
    return <Dialog
      title="Duplicate gallery"
      description={`A copy of ${gallery?.title} with its prices, packages, watermark, QR poster and welcome note. Its photos, orders, client, date and venue are not copied, and it gets a link of its own.`}
      busy={busy}
      onClose={onClose}
      onSubmit={(submitEvent) => { submitEvent.preventDefault(); if (trimmed) void run({ title: trimmed }); }}
      footer={<>
        <Button className="max-sm:flex-1" type="button" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button className="max-sm:flex-1" type="submit" variant="primary" disabled={busy || !trimmed}>{busy ? "Duplicating..." : "Duplicate"}</Button>
      </>}
    >
      <TextField label="Name of the copy" required value={name} onChange={(changeEvent) => setName(changeEvent.target.value)} maxLength={191} autoFocus />
      {error && <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    </Dialog>;
  }

  const copy = COPY[mode];
  if (!copy) return null;
  return <ConfirmDialog
    title={copy.title}
    message={copy.message(gallery)}
    confirmLabel={copy.confirm}
    busyLabel={copy.busy}
    tone={copy.tone}
    loading={busy}
    onCancel={onClose}
    onConfirm={() => void run()}
  >
    {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
  </ConfirmDialog>;
}
