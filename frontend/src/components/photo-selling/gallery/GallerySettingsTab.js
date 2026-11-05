"use client";

import { useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import ColorField from "@/components/shared/ColorField";
import DateField from "@/components/shared/DateField";
import Dropdown from "@/components/shared/Dropdown";
import ChoiceCards from "@/components/shared/ChoiceCards";
import TextAreaField from "@/components/shared/TextAreaField";
import TextField from "@/components/shared/TextField";
import DashboardCard from "@/components/shared/DashboardCard";
import ReadOnlyFieldset from "@/components/shared/ReadOnlyFieldset";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import { localDateKey } from "@/lib/photoSelling.mjs";
import { listSaleWatermarkPresets, updateSaleGallery } from "@/services/photo-selling/photo-selling.service";
import WhatsAppMessagesStatus from "../shared/WhatsAppMessagesStatus";

/**
 * Step 1 - Details: the event and its client, what the gallery says about itself, its watermark and
 * look, how closely a face must match a guest's selfie - the only way a guest finds photos - and
 * whether guests may search and be told on WhatsApp when later photos match them. Photos and prices are the next two steps. One Save for the whole form; a reader sees
 * the same form read-only.
 */
const STRICTNESS_OPTIONS = [
  { value: "STANDARD", label: "Standard", description: "Confident matches only. Right for most events." },
  { value: "STRICTER", label: "Stricter", description: "Fewer, closer matches - for large events with many look-alikes." },
  { value: "BROADER", label: "Broader", description: "Finds a little more, with more chance of a wrong face." },
];
const dateKey = (value) => (value ? localDateKey(value) : "");
const fromGallery = (gallery) => ({
  title: gallery.title, venue: gallery.venue || "", description: gallery.description || "", eventDate: dateKey(gallery.eventDate), expiresAt: dateKey(gallery.expiresAt),
  accentColor: gallery.accentColor || "", watermarkPresetId: gallery.watermark?.presetId || "", matchStrictness: gallery.matchStrictness || "STANDARD",
  clientName: gallery.clientName || "", clientPhone: gallery.clientPhone || "",
  selfieSearchEnabled: gallery.selfieSearchEnabled !== false, whatsappNotify: Boolean(gallery.whatsappNotify),
});

export default function GallerySettingsTab({ gallery, galleryId, canWrite, onSaved, showSuccess, showError, onDirtyChange }) {
  const [form, setForm] = useState(() => fromGallery(gallery));
  const [presets, setPresets] = useState([]);
  const [errors, setErrors] = useState({});
  const { busy, run } = useSubmitOnce();
  useEffect(() => { listSaleWatermarkPresets().then((response) => setPresets(response.data || [])).catch(() => setPresets([])); }, []);

  const set = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));
  const dirty = JSON.stringify(form) !== JSON.stringify(fromGallery(gallery));
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  const presetOptions = presets.map((preset) => ({ value: preset.id, label: preset.name }));
  if (gallery.watermark?.presetId && !presets.some((preset) => preset.id === gallery.watermark.presetId)) presetOptions.unshift({ value: gallery.watermark.presetId, label: `${gallery.watermark.name} (kept copy)` });

  const save = (event) => {
    event?.preventDefault?.();
    return run(async () => {
      const next = {};
      if (!form.title.trim()) next.title = "Give the gallery a title.";
      if (form.accentColor && !/^#[0-9A-F]{6}$/i.test(form.accentColor)) next.accentColor = "Use a colour like #1D4ED8.";
      if (form.expiresAt && form.expiresAt < localDateKey() && gallery.status === "PUBLISHED") next.expiresAt = "Pick a later date - this would close the store now.";
      if (form.clientPhone.trim() && !/^[+\d][\d\s-]{6,19}$/.test(form.clientPhone.trim())) next.clientPhone = "Enter a phone number, or leave it empty.";
      setErrors(next);
      if (Object.keys(next).length) return;
      const original = fromGallery(gallery);
      const patch = {};
      if (form.title !== original.title) patch.title = form.title.trim();
      if (form.description !== original.description) patch.description = form.description;
      if (form.venue !== original.venue) patch.venue = form.venue.trim();
      if (form.eventDate !== original.eventDate) patch.eventDate = form.eventDate || null;
      if (form.expiresAt !== original.expiresAt) patch.expiresAt = form.expiresAt ? `${form.expiresAt}T23:59:59` : null;
      if (form.accentColor !== original.accentColor) patch.accentColor = form.accentColor || null;
      if (form.watermarkPresetId !== original.watermarkPresetId) patch.watermarkPresetId = form.watermarkPresetId || null;
      if (form.matchStrictness !== original.matchStrictness) patch.matchStrictness = form.matchStrictness;
      if (form.clientName !== original.clientName) patch.clientName = form.clientName.trim();
      if (form.clientPhone !== original.clientPhone) patch.clientPhone = form.clientPhone.trim();
      if (form.selfieSearchEnabled !== original.selfieSearchEnabled) patch.selfieSearchEnabled = form.selfieSearchEnabled;
      if (form.whatsappNotify !== original.whatsappNotify) patch.whatsappNotify = form.whatsappNotify;
      try {
        const response = await updateSaleGallery(galleryId, patch);
        onSaved(response.data);
        showSuccess("Gallery saved.");
      } catch (error) {
        showError(error.message || "The gallery could not be saved.");
      }
    });
  };

  return <form onSubmit={save} className="flex flex-col gap-3">
    <ReadOnlyFieldset canWrite={canWrite}>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <DashboardCard title="About this gallery" bodyClassName="flex flex-col gap-3 p-3">
          <TextField label="Title" required value={form.title} onChange={(event) => set("title")(event.target.value)} maxLength={191} error={errors.title} />
          <TextAreaField label="Welcome message" value={form.description} onChange={(event) => set("description")(event.target.value)} rows={4} maxLength={5000} />
          <TextField label="Venue" value={form.venue} onChange={(event) => set("venue")(event.target.value)} maxLength={255} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DateField label="Event date" value={form.eventDate} onChange={(key) => set("eventDate")(key || "")} />
            <DateField label="Closes on" value={form.expiresAt} onChange={(key) => set("expiresAt")(key || "")} minDate={localDateKey()} error={errors.expiresAt} />
          </div>
          <p className="text-xs text-slate-500">Leave “Closes on” empty to keep the store open until you unpublish it. Buyers keep their downloads after it closes.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField label="Client" value={form.clientName} onChange={(event) => set("clientName")(event.target.value)} maxLength={191} placeholder="Optional" />
            <TextField label="Client phone" type="tel" inputMode="tel" value={form.clientPhone} onChange={(event) => set("clientPhone")(event.target.value)} maxLength={20} error={errors.clientPhone} placeholder="Optional" />
          </div>
        </DashboardCard>
        <DashboardCard title="Look and matching" bodyClassName="flex flex-col gap-3 p-3">
          <Dropdown label="Watermark on previews" required options={presetOptions} value={form.watermarkPresetId} onChange={set("watermarkPresetId")} placeholder="Choose a watermark" />
          <ColorField label="Button colour" value={form.accentColor} onChange={set("accentColor")} error={errors.accentColor} />
          <div>
            <p className="mb-1.5 text-xs font-semibold text-slate-600">How closely a face must match the guest&apos;s selfie</p>
            <ChoiceCards ariaLabel="How closely a face must match the guest's selfie" value={form.matchStrictness} onChange={set("matchStrictness")} options={STRICTNESS_OPTIONS} />
            <p className="mt-1.5 text-xs text-slate-500">Guests see only the photos their selfie matches - never the whole gallery. A match is a likeness, not proof of who somebody is. A change applies to searches made from now on.</p>
          </div>
        </DashboardCard>
        <DashboardCard title="Guest selfie search & WhatsApp notifications" className="lg:col-span-2" bodyClassName="flex flex-col gap-3 p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ToggleSwitch label="Enable guest selfie search" checked={form.selfieSearchEnabled} onCheckedChange={set("selfieSearchEnabled")} />
            <ToggleSwitch label="Enable WhatsApp photo-match notifications" checked={form.whatsappNotify} onCheckedChange={set("whatsappNotify")} />
          </div>
          {!form.selfieSearchEnabled && <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">With selfie search off, guests can open the store but find no photos - selfie search is the only way in.</p>}
          <p className="text-xs text-slate-500">With notifications on, a guest leaves their name and WhatsApp number before the selfie and may tick to be told when photos you upload later match them - one message per batch, no login code. Their selfie&apos;s face is kept only with that tick, until they stop the messages.</p>
          <WhatsAppMessagesStatus status={gallery.whatsapp} counts={gallery.whatsapp} />
        </DashboardCard>
      </div>
    </ReadOnlyFieldset>
    {canWrite && <div className="flex justify-end gap-2">
      {dirty && <Button type="button" onClick={() => setForm(fromGallery(gallery))} disabled={busy}>Discard changes</Button>}
      <Button type="submit" variant="primary" busy={busy} busyLabel="Saving..." disabled={!dirty}>Save</Button>
    </div>}
  </form>;
}
