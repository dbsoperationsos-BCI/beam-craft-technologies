"use client";
import { useState } from "react";
import Button from "@/components/shared/Button";
import TextField from "@/components/shared/TextField";
import Dialog from "@/components/ui/Dialog";

export default function CreateFolderDialog({ parentName, onClose, onCreate }) {
  const [name, setName] = useState(""); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event) { event.preventDefault(); if (!name.trim()) return setError("Folder name is required."); setSaving(true); try { await onCreate(name.trim()); onClose(); } catch (e) { setError(e.message || "Unable to create folder."); } finally { setSaving(false); } }
  return <Dialog
    title="Create Folder"
    busy={saving}
    onClose={onClose}
    onSubmit={submit}
    bodyClassName="pb-1"
    footer={<>
      <Button type="button" onClick={onClose} disabled={saving}>Cancel</Button>
      <Button type="submit" variant="primary" disabled={saving}>{saving ? "Creating…" : "Create"}</Button>
    </>}
  >
    <TextField label="Folder name" autoFocus maxLength={191} value={name} error={error} onChange={(event) => { setName(event.target.value); setError(""); }} />
    {!error && <p className="mt-2 text-xs text-slate-500">Location: {parentName || "Project root"}</p>}
  </Dialog>;
}
