"use client";

import { useState } from "react";
import Dialog from "@/components/ui/Dialog";
import Button from "@/components/shared/Button";
import TextField from "@/components/shared/TextField";
import Dropdown from "@/components/shared/Dropdown";
import { createAiFolder, updateAiFolder } from "@/services/ai-feature/ai-feature.service";

/** Name a folder and, if the studio wants, file it under one of the event's sub-events. */
export default function FolderDialog({ eventId, folder = null, subEvents = [], onClose, onSaved }) {
  const [name, setName] = useState(folder?.name || "");
  const [subEventId, setSubEventId] = useState(folder?.subEventId || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (!name.trim()) { setError("Give the folder a name."); return; }
    setBusy(true);
    try {
      const payload = { name: name.trim(), subEventId: subEventId || null };
      const response = folder ? await updateAiFolder(eventId, folder.id, payload) : await createAiFolder(eventId, payload);
      onSaved(response.data);
    } catch (cause) {
      setError(cause.message || "Unable to save the folder.");
      setBusy(false);
    }
  }

  return <Dialog
    title={folder ? "Rename folder" : "New folder"}
    description="Folders group the upload; binding one to a sub event lets guests with access to that sub event see what is inside."
    onClose={onClose}
    busy={busy}
    onSubmit={submit}
    footer={<>
      <Button type="button" className="max-sm:flex-1" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button type="submit" variant="primary" className="max-sm:flex-1" disabled={busy}>{busy ? "Saving..." : folder ? "Save" : "Create folder"}</Button>
    </>}
  >
    <div className="space-y-3">
      <TextField label="Folder name" required value={name} onChange={(event) => { setName(event.target.value); setError(""); }} error={error} autoFocus maxLength={191} />
      <Dropdown label="Sub event" clearable placeholder="Not bound to a sub event" options={subEvents.map((subEvent) => ({ label: subEvent.name, value: subEvent.id }))} value={subEventId} onChange={(value) => setSubEventId(value || "")} sorted={false} />
    </div>
  </Dialog>;
}
