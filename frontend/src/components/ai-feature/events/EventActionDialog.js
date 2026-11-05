"use client";

import { useState } from "react";
import Button from "@/components/shared/Button";
import TextField from "@/components/shared/TextField";
import useFormErrors from "@/components/shared/useFormErrors";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dialog from "@/components/ui/Dialog";

/**
 * The question asked before an event is duplicated, archived, restored or deleted.
 *
 * `mode` is one of those four. Duplicate is the only one that collects something - the copy's
 * name - so it is a small form; the other three are the shared confirmation, with delete alone in
 * red. `onConfirm(payload)` does the work and may throw; the message is shown here and the dialog
 * stays open, so a failed delete never reads as a finished one.
 */
const COPY = {
  delete: { title: "Delete event", confirm: "Delete event", busy: "Deleting...", tone: "danger", message: (name) => `Delete ${name}? Its photos, guests, faces and shared link are permanently removed and cannot be restored. To keep the data, archive the event instead.` },
  archive: { title: "Archive event", confirm: "Archive event", busy: "Archiving...", tone: "primary", message: (name) => `Archive ${name}? Guests can no longer open its gallery, and everything stays preserved until it is restored.` },
  restore: { title: "Restore event", confirm: "Restore event", busy: "Restoring...", tone: "primary", message: (name) => `Restore ${name}? It returns to the list and its gallery link works again.` },
};

export default function EventActionDialog({ mode, event, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState(`${event?.name || "Event"} (copy)`);
  const fields = useFormErrors();

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
      title="Duplicate event"
      description={`A copy of ${event?.name} with its settings. Guests, photos and faces are not copied.`}
      busy={busy}
      onClose={onClose}
      onSubmit={(submitEvent) => {
        submitEvent.preventDefault();
        if (!fields.check({ name: trimmed ? "" : "Enter a name for the copy." })) return;
        void run({ name: trimmed });
      }}
      footer={<>
        <Button className="max-sm:flex-1" type="button" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button className="max-sm:flex-1" type="submit" variant="primary" disabled={busy}>{busy ? "Duplicating..." : "Duplicate"}</Button>
      </>}
    >
      <TextField label="Name of the copy" helperText="The name the copied event is saved under." required value={name} onChange={(changeEvent) => { setName(changeEvent.target.value); fields.clear("name"); }} error={fields.errors.name} maxLength={191} autoFocus />
      {error && <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    </Dialog>;
  }

  const copy = COPY[mode];
  if (!copy) return null;
  return <ConfirmDialog
    title={copy.title}
    message={copy.message(event?.name || "this event")}
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
