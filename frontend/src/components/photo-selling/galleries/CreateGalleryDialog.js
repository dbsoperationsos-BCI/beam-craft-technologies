"use client";

import { useState } from "react";
import Dialog from "@/components/ui/Dialog";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";
import TextAreaField from "@/components/shared/TextAreaField";
import TextField from "@/components/shared/TextField";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import { createSaleGallery } from "@/services/photo-selling/photo-selling.service";

/**
 * New Gallery - the event's details, asked up front: its name (required), the client, the date,
 * venue and a welcome note for the guests' page. Everything else - price, tax, PIN, how guests find
 * photos, watermark, QR poster - starts from Photo Selling's own settings and is changed in the
 * gallery's steps (the poster in Share with guests → QR Template). Creating saves a draft and opens it on the Photos step, so the studio is one
 * action from adding photos. Nothing is public until it is published.
 */
export default function CreateGalleryDialog({ onClose, onCreated }) {
  const [form, setForm] = useState({ title: "", clientName: "", clientPhone: "", eventDate: "", venue: "", description: "" });
  const [error, setError] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const { busy, run } = useSubmitOnce();
  const set = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));

  const submit = (event) => {
    event?.preventDefault?.();
    return run(async () => {
      setSubmitError("");
      const badPhone = form.clientPhone.trim() && !/^[+\d][\d\s-]{6,19}$/.test(form.clientPhone.trim());
      setError(form.title.trim() ? "" : "Give the gallery a name - guests see it at the top of the page.");
      setPhoneError(badPhone ? "Enter a phone number, or leave it empty." : "");
      if (!form.title.trim() || badPhone) return;
      try {
        const response = await createSaleGallery({
          title: form.title.trim(),
          ...(form.clientName.trim() ? { clientName: form.clientName.trim() } : {}),
          ...(form.clientPhone.trim() ? { clientPhone: form.clientPhone.trim() } : {}),
          ...(form.eventDate ? { eventDate: form.eventDate } : {}),
          ...(form.venue.trim() ? { venue: form.venue.trim() } : {}),
          ...(form.description.trim() ? { description: form.description.trim() } : {}),
        });
        onCreated?.(response.data);
      } catch (caught) {
        setSubmitError(caught.message || "The gallery could not be created.");
      }
    });
  };

  return <Dialog
    title="New gallery"
    description="The event's details. Prices, access and the QR poster start from your Photo Selling settings; you can change them later in the gallery. It stays a private draft until you publish."
    onClose={onClose}
    size="md"
    busy={busy}
    onSubmit={submit}
    footer={<>
      <Button type="button" onClick={onClose}>Cancel</Button>
      <Button type="submit" variant="primary" busy={busy} busyLabel="Creating...">Create and add photos</Button>
    </>}
  >
    <div className="flex flex-col gap-4">
      <TextField label="Gallery name" required autoFocus value={form.title} onChange={(event) => set("title")(event.target.value)} maxLength={191} error={error} placeholder="e.g. Aarav & Diya - Reception" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Client" value={form.clientName} onChange={(event) => set("clientName")(event.target.value)} maxLength={191} placeholder="Optional - who the event is for" />
        <TextField label="Client phone" type="tel" inputMode="tel" value={form.clientPhone} onChange={(event) => set("clientPhone")(event.target.value)} maxLength={20} error={phoneError} placeholder="Optional" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DateField label="Event date" value={form.eventDate} onChange={(key) => set("eventDate")(key || "")} />
        <TextField label="Venue" value={form.venue} onChange={(event) => set("venue")(event.target.value)} maxLength={255} placeholder="Optional" />
      </div>
      <TextAreaField label="Welcome note" value={form.description} onChange={(event) => set("description")(event.target.value)} rows={3} maxLength={5000} placeholder="Optional - a line for your guests" />
      {submitError && <p className="text-sm text-red-700" role="alert">{submitError}</p>}
    </div>
  </Dialog>;
}
