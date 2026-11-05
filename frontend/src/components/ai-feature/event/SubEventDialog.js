"use client";

import { useState } from "react";
import Dialog from "@/components/ui/Dialog";
import Button from "@/components/shared/Button";
import TextField from "@/components/shared/TextField";
import TextAreaField from "@/components/shared/TextAreaField";
import DateField from "@/components/shared/DateField";
import TimeField from "@/components/shared/TimeField";
import { toDateInput } from "@/lib/aiFeature.mjs";
import { createAiSubEvent, updateAiSubEvent } from "@/services/ai-feature/ai-feature.service";

/** One ceremony or session of the event: when, where, and a line about it. */
export default function SubEventDialog({ eventId, subEvent = null, minDate = "", maxDate = "", onClose, onSaved }) {
  const [form, setForm] = useState({ name: subEvent?.name || "", date: toDateInput(subEvent?.date), startTime: subEvent?.startTime || "", endTime: subEvent?.endTime || "", location: subEvent?.location || "", description: subEvent?.description || "" });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (key) => (value) => { setForm((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: "", form: "" })); };

  async function submit(event) {
    event.preventDefault();
    const problems = {};
    if (!form.name.trim()) problems.name = "Give the sub event a name.";
    if (form.startTime && form.endTime && form.endTime < form.startTime) problems.endTime = "Ends before it starts.";
    if (Object.keys(problems).length) { setErrors(problems); return; }
    setBusy(true);
    try {
      const payload = { name: form.name.trim(), date: form.date || null, startTime: form.startTime || null, endTime: form.endTime || null, location: form.location.trim() || null, description: form.description.trim() || null };
      const response = subEvent ? await updateAiSubEvent(eventId, subEvent.id, payload) : await createAiSubEvent(eventId, payload);
      onSaved(response.data);
    } catch (cause) {
      setErrors({ form: cause.message || "Unable to save the sub event." });
      setBusy(false);
    }
  }

  return <Dialog
    title={subEvent ? "Edit sub event" : "Add sub event"}
    size="md"
    onClose={onClose}
    busy={busy}
    onSubmit={submit}
    footer={<>
      <Button type="button" className="max-sm:flex-1" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button type="submit" variant="primary" className="max-sm:flex-1" disabled={busy}>{busy ? "Saving..." : subEvent ? "Save" : "Add sub event"}</Button>
    </>}
  >
    <div className="grid gap-3 sm:grid-cols-2">
      <TextField label="Name" required value={form.name} onChange={(event) => set("name")(event.target.value)} error={errors.name} autoFocus maxLength={191} placeholder="Haldi, Reception, Keynote" className="sm:col-span-2" />
      <DateField label="Date" value={form.date} onChange={set("date")} minDate={minDate} maxDate={maxDate} className="sm:col-span-2" />
      <TimeField label="Starts" value={form.startTime} onChange={(event) => set("startTime")(event.target.value)} />
      <TimeField label="Ends" value={form.endTime} onChange={(event) => set("endTime")(event.target.value)} error={errors.endTime} />
      <TextField label="Location" value={form.location} onChange={(event) => set("location")(event.target.value)} maxLength={255} className="sm:col-span-2" />
      <TextAreaField label="Description" value={form.description} onChange={(event) => set("description")(event.target.value)} rows={3} maxLength={4000} className="sm:col-span-2" />
    </div>
    {errors.form && <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{errors.form}</p>}
  </Dialog>;
}
