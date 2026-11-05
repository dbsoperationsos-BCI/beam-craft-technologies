"use client";

import { useState } from "react";
import Dialog from "@/components/ui/Dialog";
import Button from "@/components/shared/Button";
import TextField from "@/components/shared/TextField";
import { createAiFolder, updateAiFolder } from "@/services/ai-feature/ai-feature.service";

/** Name a folder. */
export default function FolderDialog({ eventId, folder = null, onClose, onSaved }) {
  const [name, setName] = useState(folder?.name || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (!name.trim()) { setError("Give the folder a name."); return; }
    setBusy(true);
    try {
      const payload = { name: name.trim() };
      const response = folder ? await updateAiFolder(eventId, folder.id, payload) : await createAiFolder(eventId, payload);
      onSaved(response.data);
    } catch (cause) {
      setError(cause.message || "Unable to save the folder.");
      setBusy(false);
    }
  }

  return <Dialog
    title={folder ? "Rename folder" : "New folder"}
    description="Folders group the upload."
    onClose={onClose}
    busy={busy}
    onSubmit={submit}
    footer={<>
      <Button type="button" className="max-sm:flex-1" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button type="submit" variant="primary" className="max-sm:flex-1" disabled={busy}>{busy ? "Saving..." : folder ? "Save" : "Create folder"}</Button>
    </>}
  >
    <TextField label="Folder name" helperText="The name this folder of photos is listed under." required value={name} onChange={(event) => { setName(event.target.value); setError(""); }} error={error} autoFocus maxLength={191} />
  </Dialog>;
}
