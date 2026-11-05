"use client";

import { useState } from "react";
import Button from "@/components/shared/Button";
import TextField from "@/components/shared/TextField";
import useFormErrors from "@/components/shared/useFormErrors";
import Dialog from "@/components/ui/Dialog";
import { createAlbumProof } from "@/services/image-selection/album-proofs.service";

const select = "mt-1.5 block min-h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs font-normal text-slate-700 outline-none transition sm:text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

/**
 * Create Album: only the proofing-specific configuration — everything about the client and the
 * project is read through the existing project relationship, never asked again. Defaults follow
 * the studio's process: spread viewer, 3 client revision rounds, 30-day proof expiry.
 */
export default function CreateAlbumProofDialog({ project, onClose, onCreated }) {
  const [form, setForm] = useState({ name: "", albumType: "", viewerMode: "SPREAD", revisionLimit: "3", proofExpiryDays: "30" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fields = useFormErrors();
  const set = (key) => (value) => { fields.clear(key); setForm((current) => ({ ...current, [key]: value })); };

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!fields.check({ name: form.name.trim() ? "" : "Enter the album name." })) return;
    setBusy(true);
    try {
      const response = await createAlbumProof({
        projectId: project.id, name: form.name.trim(), albumType: form.albumType || null,
        viewerMode: form.viewerMode,
        revisionLimit: form.revisionLimit === "unlimited" ? null : Number(form.revisionLimit),
        proofExpiryDays: Number(form.proofExpiryDays) || 30,
      });
      onCreated(response.data);
    } catch (submitError) {
      setError(submitError.message || "Unable to create the album.");
      setBusy(false);
    }
  }

  return <Dialog
    title="Create Album"
    description={`For ${project.projectName} — client details come from the project itself.`}
    size="md"
    busy={busy}
    onClose={onClose}
    onSubmit={submit}
    footer={<>
      <Button type="button" className="max-sm:flex-1" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button type="submit" variant="primary" className="max-sm:flex-1" disabled={busy}>{busy ? "Creating..." : "Create Album"}</Button>
    </>}
  >
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <TextField label="Album Name" helperText="The album's name as the client sees it on the proof." required autoFocus className="sm:col-span-2" value={form.name} maxLength={191} onChange={(event) => set("name")(event.target.value)} placeholder="e.g. Main Wedding Album" error={fields.errors.name} />
      <TextField label="Album Type" helperText="Which album this is, such as Signature or Parents." value={form.albumType} maxLength={100} onChange={(event) => set("albumType")(event.target.value)} placeholder="e.g. Signature / Parents" />
      <label className="block text-[11px] font-semibold text-slate-600 sm:text-xs">
        <span>Viewer Mode</span>
        <select value={form.viewerMode} onChange={(event) => set("viewerMode")(event.target.value)} className={select}>
          <option value="SPREAD">Spread</option>
          <option value="PAGE">Page</option>
        </select>
      </label>
      <label className="block text-[11px] font-semibold text-slate-600 sm:text-xs">
        <span>Client Revision Limit</span>
        <select value={form.revisionLimit} onChange={(event) => set("revisionLimit")(event.target.value)} className={select}>
          <option value="1">1 round</option>
          <option value="2">2 rounds</option>
          <option value="3">3 rounds</option>
          <option value="4">4 rounds</option>
          <option value="unlimited">Unlimited</option>
        </select>
      </label>
      <TextField label="Proof Expiry (days)" helperText="Days the client's proof link stays open, from 1 to 365." type="number" min="1" max="365" value={form.proofExpiryDays} onChange={(event) => set("proofExpiryDays")(event.target.value)} />
    </div>
    {error && <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
  </Dialog>;
}
