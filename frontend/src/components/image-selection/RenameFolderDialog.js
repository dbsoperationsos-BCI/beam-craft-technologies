"use client";
import { useState } from "react";
import Button from "@/components/shared/Button";
import TextField from "@/components/shared/TextField";
import Dialog from "@/components/ui/Dialog";

export default function RenameFolderDialog({ folder, onClose, onRename }) {
  const [name, setName] = useState(folder.name); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event) { event.preventDefault(); if (!name.trim()) return setError("Folder name is required."); setSaving(true); try { await onRename(name.trim()); onClose(); } catch (e) { setError(e.message || "Unable to rename folder."); } finally { setSaving(false); } }
  return <Dialog
    title="Rename Folder"
    busy={saving}
    onClose={onClose}
    onSubmit={submit}
    bodyClassName="pb-1"
    footer={<>
      <Button type="button" onClick={onClose} disabled={saving}>Cancel</Button>
      <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving…" : "Rename"}</Button>
    </>}
  >
    <TextField label="Folder name" autoFocus maxLength={191} value={name} error={error} onFocus={(event) => event.target.select()} onChange={(event) => { setName(event.target.value); setError(""); }} />
  </Dialog>;
}
