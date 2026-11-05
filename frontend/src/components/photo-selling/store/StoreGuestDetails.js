"use client";

import WhatsApp from "@mui/icons-material/WhatsApp";
import { useState } from "react";
import Checkbox from "@/components/shared/Checkbox";
import TextField from "@/components/shared/TextField";
import { saveStoreGuest } from "@/services/photo-selling/photo-store-public.service";
import StoreButton from "./StoreButton";

/**
 * The first screen's name and WhatsApp number, for a device whose store session was opened before the
 * store asked for them (StoreLanding asks everyone else) - and, where the gallery sends WhatsApp
 * photo-match messages (`offered`), an unticked box asking to be told when photos the studio uploads
 * later match them. No code is sent - the box is the guest's own consent, and leaving it unticked
 * sends nothing. The server checks the number (`guests.register`); its words come back under the field.
 */
export default function StoreGuestDetails({ code, session, accent, offered = false, guest = null, onSaved, onCancel }) {
  const [form, setForm] = useState({ name: guest?.name || "", phone: "", whatsappConsent: guest ? guest.whatsappOn : false });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (key) => (event) => { const value = event?.target ? event.target.value : event; setForm((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: undefined, form: undefined })); };

  async function save(event) {
    event.preventDefault();
    const found = {};
    if (!form.name.trim()) found.name = "Enter your name.";
    if (!form.phone.trim()) found.phone = "Enter your WhatsApp number.";
    if (Object.keys(found).length) { setErrors(found); return; }
    setSaving(true);
    try {
      const response = await saveStoreGuest(code, session, { name: form.name.trim(), phone: form.phone.trim(), whatsappConsent: offered && form.whatsappConsent });
      onSaved(response.data.guest);
    } catch (caught) {
      setErrors(Number(caught.status) === 400 ? { phone: caught.message } : { form: caught.message || "We couldn't save your details. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  return <div className="mx-auto w-full max-w-lg py-6">
    <form onSubmit={save} noValidate className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-7">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-neutral-100"><WhatsApp className="text-[#25D366]" aria-hidden="true" /></div>
      <h2 className="mt-4 text-center text-xl font-semibold tracking-tight text-neutral-900">Before you search</h2>
      <p className="mt-1 text-center text-sm text-neutral-600">Tell us who you are, then take a selfie to find your photos.</p>
      <div className="mt-5 space-y-3">
        <TextField label="Your name" required autoComplete="name" value={form.name} onChange={set("name")} error={errors.name} maxLength={120} />
        <TextField label="WhatsApp number" required type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={set("phone")} error={errors.phone} note="A 10-digit mobile, or with its country code." maxLength={20} />
        {offered && <label className="flex cursor-pointer items-start gap-2 text-sm text-neutral-800">
          <Checkbox checked={form.whatsappConsent} onChange={(checked) => set("whatsappConsent")(Boolean(checked))} />
          <span>Send me a WhatsApp when new photos of me are found<span className="mt-0.5 block text-xs text-neutral-500">One message when the photographer uploads more photos of you, with your gallery link. To find them, the face from your selfie is kept until you stop the messages.</span></span>
        </label>}
      </div>
      {errors.form && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errors.form}</p>}
      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        {onCancel && <StoreButton type="button" onClick={onCancel} disabled={saving} className="w-full">Cancel</StoreButton>}
        <StoreButton type="submit" variant="primary" accent={accent} disabled={saving} className={`w-full ${onCancel ? "" : "sm:col-span-2"}`}>{saving ? "Saving..." : "Continue"}</StoreButton>
      </div>
    </form>
  </div>;
}
