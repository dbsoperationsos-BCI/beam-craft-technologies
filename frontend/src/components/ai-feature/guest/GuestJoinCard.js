"use client";
import { useState } from "react";
import ArrowForward from "@mui/icons-material/ArrowForward";
import Autorenew from "@mui/icons-material/Autorenew";
import TextField from "@/components/shared/TextField";
import PhoneField from "@/components/shared/PhoneField";
import Checkbox from "@/components/shared/Checkbox";
import PinBoxes, { PIN_LENGTH } from "./PinBoxes";
import GuestJoinCodeStep from "./GuestJoinCodeStep";
import Button from "@/components/shared/Button";
import { JOIN_BUTTON } from "./guestActions";

/**
 * The one card between a guest and the photos. It asks only what the event's settings ask for:
 * a name, a phone number and the link's PIN. `onJoin` is handed the
 * answers and does the talking; whatever it throws is shown under the field it is about.
 *
 * Where the event offers the WhatsApp photo-match message, an unticked box asks for it. Ticking it
 * is the guest's consent for the number typed here, recorded once they are in (GuestEventExperience)
 * - no code. Left unticked, nothing is ever sent; Turn on in My Photos asks again later.
 *
 * The card is a pane of glass over the event's cover: white at about four fifths with the
 * photograph blurred through it where the browser can do that, and near-solid white where it
 * cannot, so the fields read on any photo either way - the white is enough on its own that a
 * bright photograph behind the card cannot lift the labels off it. A phone gets a little more
 * white than a desktop - its photo is busier behind a narrower card. The fields themselves are not glass: each
 * sits on white of its own.
 *
 * `copy` replaces the card's words for another public page that signs a guest in the same way (the
 * Photo Selling store's login); left out, the card says what it always has.
 */
const GLASS = "rounded-[22px] border border-white/50 bg-white/94 shadow-[0_24px_64px_rgba(0,0,0,0.28)] supports-backdrop-filter:bg-white/88 supports-backdrop-filter:backdrop-blur-xl supports-backdrop-filter:backdrop-saturate-125 md:supports-backdrop-filter:bg-white/82";
const FIELD_INPUT = "min-h-12 rounded-xl border-slate-300 bg-white/90 text-sm focus:bg-white";
// PhoneField sizes itself; on this card its box, its code picker and its input are raised to the
// same height as the other fields, with `!` because its own rules sit later in the stylesheet.
const PHONE_WRAP = "[&_span.flex]:min-h-12! [&_span.flex]:rounded-xl! [&_span.flex]:bg-white/90! [&_input]:min-h-12! [&_button]:min-h-12!";

const JOIN_COPY = {
  title: "Join the event",
  phoneLabel: "Phone number",
  phoneHelper: "Your mobile number, used to recognise you when you come back.",
  whatsappLabel: "Send me a WhatsApp when my photos are found",
  whatsappNote: "One WhatsApp message when new photos of you are found, never one per photo.",
  submitLabel: "Join Event",
  busyLabel: "Joining...",
  failure: "We couldn't join you to the event. Please try again.",
};

export default function GuestJoinCard({ meta, onJoin, copy }) {
  const text = { ...JOIN_COPY, subtitle: meta?.features?.selfieSearch ? "See every photo, and find the ones you are in with a selfie." : "See every photo from the day.", ...copy };
  const access = meta?.guestAccess || {};
  // The name is asked whenever a new guest could be created, so nobody is filed as "Guest". The
  // phone is asked when required, and also when registration is closed: it is the only thing that
  // finds an invited guest on the list.
  const askName = Boolean(access.requireName || access.allowRegistration);
  const askPhone = Boolean(access.requirePhone || !access.allowRegistration);
  const askPin = Boolean(meta?.requiresPin);
  // Only with a phone to send it to: the summary goes to the number the guest joins with.
  const offerWhatsApp = Boolean(meta?.features?.whatsappSummary && askPhone);
  const [form, setForm] = useState({ name: "", phone: "", pin: "", whatsappSummary: false });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  // Set when the server asks for the phone to be proved first: the card shows the code step instead.
  const [codeStep, setCodeStep] = useState(null);
  const set = (field, value) => { setForm((current) => ({ ...current, [field]: value })); setErrors((current) => ({ ...current, [field]: "", form: "" })); };

  function problems() {
    const found = {};
    if (access.requireName && !form.name.trim()) found.name = "Please enter your name.";
    if (access.requirePhone && !form.phone.trim()) found.phone = "Please enter your phone number.";
    if (askPin && form.pin.length !== PIN_LENGTH) found.pin = "Enter the 4-digit PIN from your invitation.";
    if (offerWhatsApp && form.whatsappSummary && !form.phone.trim()) found.phone = "Enter your mobile number to get the summary on WhatsApp.";
    return found;
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const found = problems();
    if (Object.keys(found).length) { setErrors(found); return; }
    setBusy(true); setErrors({});
    try {
      const next = await onJoin({ name: form.name.trim() || undefined, phone: form.phone.trim() || undefined, pin: askPin ? form.pin : undefined }, { whatsappSummary: offerWhatsApp && form.whatsappSummary });
      if (next) setCodeStep(next);
    } catch (error) {
      const status = Number(error?.status);
      const message = error?.message || text.failure;
      // A wrong PIN is the PIN's fault; everything else is said at the foot of the card.
      if (status === 403 && /pin/i.test(message)) setErrors({ pin: message });
      else setErrors({ form: message });
      if (status === 403 && /pin/i.test(message)) setForm((current) => ({ ...current, pin: "" }));
    } finally { setBusy(false); }
  }

  if (codeStep) return <GuestJoinCodeStep step={codeStep} onBack={() => setCodeStep(null)} className={`${GLASS} p-5 text-slate-900 sm:p-7 md:p-8`} />;

  return <form onSubmit={submit} noValidate className={`${GLASS} p-5 text-slate-900 sm:p-7 md:p-8`}>
    <h2 className="text-center text-xl font-semibold text-slate-900 md:text-[22px]">{text.title}</h2>
    <p className="mt-1 text-center text-sm leading-6 text-slate-600">{text.subtitle}</p>
    <div className="mt-6 space-y-4">
      {askName && <TextField label="Your name" helperText="So the studio knows who you are in the photos." required={Boolean(access.requireName)} value={form.name} onChange={(event) => set("name", event.target.value)} error={errors.name} autoComplete="name" placeholder="Enter your name" disabled={busy} inputClassName={FIELD_INPUT} />}
      {askPhone && <div className={PHONE_WRAP}><PhoneField label={text.phoneLabel} helperText={text.phoneHelper} field="phone" required={Boolean(access.requirePhone)} value={form.phone} onChange={(_field, value) => set("phone", value)} error={errors.phone} disabled={busy} /></div>}
      {askPin && <PinBoxes value={form.pin} onChange={(pin) => set("pin", pin)} disabled={busy} error={errors.pin} />}
      {offerWhatsApp && <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl px-1 py-1 text-sm leading-5 text-slate-700">
        <Checkbox checked={form.whatsappSummary} onChange={(checked) => set("whatsappSummary", checked)} disabled={busy} className="mt-0.5 h-5 w-5 shrink-0" />
        <span>{text.whatsappLabel}<span className="mt-0.5 block text-[13px] text-slate-600">{text.whatsappNote}</span></span>
      </label>}
    </div>
    {errors.form && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errors.form}</p>}
    <Button type="submit" variant="plain" size="none" disabled={busy} aria-busy={busy || undefined} className={JOIN_BUTTON}>
      {busy ? <><Autorenew className="animate-spin" style={{ fontSize: 18 }} aria-hidden="true" />{text.busyLabel}</> : <>{text.submitLabel} <ArrowForward style={{ fontSize: 18 }} aria-hidden="true" /></>}
    </Button>
  </form>;
}
