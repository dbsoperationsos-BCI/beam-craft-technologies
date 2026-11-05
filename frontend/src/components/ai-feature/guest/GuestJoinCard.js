"use client";
import { useState } from "react";
import ArrowForward from "@mui/icons-material/ArrowForward";
import Autorenew from "@mui/icons-material/Autorenew";
import TextField from "@/components/shared/TextField";
import PhoneField from "@/components/shared/PhoneField";
import PinBoxes, { PIN_LENGTH } from "./PinBoxes";
import { PRIMARY_BUTTON } from "./guestActions";

const RSVP_CHOICES = [["ACCEPTED", "Attending"], ["DECLINED", "Not attending"]];

/**
 * The one card between a guest and the photos. It asks only what the event's settings ask for:
 * a name, a phone number, the link's PIN, and whether they are coming. `onJoin` is handed the
 * answers and does the talking; whatever it throws is shown under the field it is about.
 */
export default function GuestJoinCard({ meta, onJoin }) {
  const access = meta?.guestAccess || {};
  // The name is asked whenever a new guest could be created, so nobody is filed as "Guest". The
  // phone is asked when required, and also when registration is closed: it is the only thing that
  // finds an invited guest on the list.
  const askName = Boolean(access.requireName || access.allowRegistration);
  const askPhone = Boolean(access.requirePhone || !access.allowRegistration);
  const askRsvp = Boolean(meta?.features?.rsvp);
  const askPin = Boolean(meta?.requiresPin);
  const [form, setForm] = useState({ name: "", phone: "", pin: "", rsvp: "" });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (field, value) => { setForm((current) => ({ ...current, [field]: value })); setErrors((current) => ({ ...current, [field]: "", form: "" })); };

  function problems() {
    const found = {};
    if (access.requireName && !form.name.trim()) found.name = "Please enter your name.";
    if (access.requirePhone && !form.phone.trim()) found.phone = "Please enter your phone number.";
    if (askPin && form.pin.length !== PIN_LENGTH) found.pin = "Enter the 4-digit PIN from your invitation.";
    return found;
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const found = problems();
    if (Object.keys(found).length) { setErrors(found); return; }
    setBusy(true); setErrors({});
    try {
      await onJoin({ name: form.name.trim() || undefined, phone: form.phone.trim() || undefined, pin: askPin ? form.pin : undefined, rsvp: form.rsvp || undefined });
    } catch (error) {
      const status = Number(error?.status);
      const message = error?.message || "We couldn't join you to the event. Please try again.";
      // A wrong PIN is the PIN's fault; everything else is said at the foot of the card.
      if (status === 403 && /pin/i.test(message)) setErrors({ pin: message });
      else setErrors({ form: message });
      if (status === 403 && /pin/i.test(message)) setForm((current) => ({ ...current, pin: "" }));
    } finally { setBusy(false); }
  }

  return <form onSubmit={submit} noValidate className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_20px_52px_rgba(15,23,42,0.08)] sm:p-8">
    <h2 className="text-center text-lg font-semibold text-slate-900">Join the event</h2>
    <p className="mt-1 text-center text-sm leading-6 text-slate-600">{meta?.features?.selfieSearch ? "See every photo, and find the ones you are in with a selfie." : "See every photo from the day."}</p>
    <div className="mt-6 space-y-4">
      {askName && <TextField label="Your name" required={Boolean(access.requireName)} value={form.name} onChange={(event) => set("name", event.target.value)} error={errors.name} autoComplete="name" placeholder="How the host knows you" disabled={busy} inputClassName="min-h-12 text-sm" />}
      {askPhone && <PhoneField label="Phone number" field="phone" required={Boolean(access.requirePhone)} value={form.phone} onChange={(_field, value) => set("phone", value)} error={errors.phone} disabled={busy} />}
      {askPin && <PinBoxes value={form.pin} onChange={(pin) => set("pin", pin)} disabled={busy} error={errors.pin} />}
      {askRsvp && <fieldset>
        <legend className="text-[11px] font-semibold text-slate-600 sm:text-xs">Will you be there?</legend>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          {RSVP_CHOICES.map(([value, label]) => <button key={value} type="button" disabled={busy} aria-pressed={form.rsvp === value} onClick={() => set("rsvp", form.rsvp === value ? "" : value)} className={`min-h-12 rounded-xl border px-3 text-sm font-medium transition ${form.rsvp === value ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>{label}</button>)}
        </div>
      </fieldset>}
    </div>
    {errors.form && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errors.form}</p>}
    <button type="submit" disabled={busy} className={`${PRIMARY_BUTTON} mt-6 w-full`}>
      {busy ? <><Autorenew className="animate-spin" style={{ fontSize: 17 }} aria-hidden="true" />Joining</> : <>Join Event <ArrowForward style={{ fontSize: 17 }} aria-hidden="true" /></>}
    </button>
  </form>;
}
