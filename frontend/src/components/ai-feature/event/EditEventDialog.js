"use client";

import { useState } from "react";
import Dialog from "@/components/ui/Dialog";
import Button from "@/components/shared/Button";
import TextField from "@/components/shared/TextField";
import TextAreaField from "@/components/shared/TextAreaField";
import DateField from "@/components/shared/DateField";
import ImageUploadField from "@/components/shared/ImageUploadField";
import { detailsProblems, toDateInput } from "@/lib/aiFeature.mjs";
import { updateAiEvent } from "@/services/ai-feature/ai-feature.service";

/** The types the wizard offers; the studio's own list lives in Event Default Settings, which not every editor may read, so these are suggestions rather than the only answers. */
const EVENT_TYPES = ["Wedding", "Reception", "Engagement", "Birthday", "Corporate", "Conference", "Baby Shower", "Anniversary", "Other"];

/** The event's own details - everything on the wizard's first step, editable after the fact. */
export default function EditEventDialog({ eventId, event, onClose, onSaved }) {
  const [form, setForm] = useState({ name: event.name || "", eventType: event.eventType || "", startDate: toDateInput(event.startDate), endDate: toDateInput(event.endDate), timezone: event.timezone || "", location: event.location || "", description: event.description || "" });
  // `undefined` until the cover is touched: a data URI replaces it, null removes it, and an untouched
  // cover is left out of the patch entirely so the server keeps what it has.
  const [cover, setCover] = useState(undefined);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (key) => (value) => { setForm((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: "", form: "" })); };

  async function submit(submitEvent) {
    submitEvent.preventDefault();
    const problems = detailsProblems(form);
    if (Object.keys(problems).length) { setErrors(problems); return; }
    setBusy(true);
    try {
      const patch = { name: form.name.trim(), eventType: form.eventType.trim(), startDate: form.startDate, endDate: form.endDate || null, location: form.location.trim() || null, description: form.description.trim() || null };
      if (form.timezone.trim()) patch.timezone = form.timezone.trim();
      if (cover !== undefined) patch.coverImage = cover;
      const response = await updateAiEvent(eventId, patch);
      onSaved(response.data);
    } catch (cause) {
      setErrors({ form: cause.message || "Unable to save the event." });
      setBusy(false);
    }
  }

  return <Dialog
    title="Edit event"
    size="lg"
    onClose={onClose}
    busy={busy}
    onSubmit={submit}
    footer={<>
      <Button type="button" className="max-sm:flex-1" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button type="submit" variant="primary" className="max-sm:flex-1" disabled={busy}>{busy ? "Saving..." : "Save changes"}</Button>
    </>}
  >
    <div className="grid gap-3 sm:grid-cols-2">
      <TextField label="Event name" helperText="The name guests see at the top of the event page." required value={form.name} onChange={(e) => set("name")(e.target.value)} error={errors.name} maxLength={191} className="sm:col-span-2" />
      <TextField label="Event type" helperText="The kind of event; pick a suggestion or type your own." required value={form.eventType} onChange={(e) => set("eventType")(e.target.value)} error={errors.eventType} suggestions={EVENT_TYPES.includes(form.eventType) || !form.eventType ? EVENT_TYPES : [form.eventType, ...EVENT_TYPES]} maxLength={60} />
      <TextField label="Timezone" helperText="Time zone for the event's dates and times, like Asia/Kolkata." value={form.timezone} onChange={(e) => set("timezone")(e.target.value)} placeholder="Asia/Kolkata" maxLength={64} />
      <DateField label="Starts" helperText="The first day of the event." required value={form.startDate} onChange={set("startDate")} error={errors.startDate} />
      <DateField label="Ends" helperText="The last day of the event; leave empty for a one-day event." value={form.endDate} onChange={set("endDate")} error={errors.endDate} minDate={form.startDate} />
      <TextField label="Location" helperText="The venue and city where the event takes place." value={form.location} onChange={(e) => set("location")(e.target.value)} maxLength={255} className="sm:col-span-2" />
      <TextAreaField label="Description" helperText="Shown to guests under the event name." value={form.description} onChange={(e) => set("description")(e.target.value)} rows={3} maxLength={4000} className="sm:col-span-2" />
      <ImageUploadField label="Cover photo" helperText="The banner photo shown at the top of the guest page." value={cover === undefined ? event.coverUrl || null : cover} onChange={(dataUrl) => setCover(dataUrl || null)} className="sm:col-span-2" compress={{ maxDimension: 1600 }} />
    </div>
    {errors.form && <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{errors.form}</p>}
  </Dialog>;
}
