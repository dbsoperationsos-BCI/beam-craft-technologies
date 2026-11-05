"use client";
import { useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import PinBoxes from "./PinBoxes";
import { JOIN_BUTTON } from "./guestActions";

const CODE_LENGTH = 6;

/**
 * The join card's second step, when the server asks for the phone to be proved first - a guest with
 * photos to protect, or an event that confirms every number: the code goes by SMS to the number
 * already on that guest, and only the right code opens them. `step` is what `GuestEventExperience.join` handed back - where the code went, and
 * `verify` / `resend`; `verify` moves the page on by itself, so success needs nothing here.
 */
export default function GuestJoinCodeStep({ step, onBack, className = "" }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState(step.notice || "");
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(step.resendInSeconds || 45);

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const timer = setTimeout(() => setResendIn((current) => current - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (value.length !== CODE_LENGTH) { setError(`Enter the ${CODE_LENGTH}-digit code.`); return; }
    setBusy(true); setError("");
    try { await step.verify(value); }
    // A wrong, expired or used-up code: the way forward is a new one, offered at once (the server
    // still holds its own gap between codes).
    catch (failure) { setError(failure?.message || "That code didn't work. Please try again."); setValue(""); setResendIn(0); setBusy(false); }
  }

  async function resend() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const sent = await step.resend();
      setResendIn(sent?.resendInSeconds || 45);
      setNote(`We texted a new code to ${sent?.sentTo || step.sentTo}.`);
      setValue("");
    } catch (failure) { setError(failure?.message || "We couldn't send a new code. Please try again."); }
    finally { setBusy(false); }
  }

  return <form onSubmit={submit} noValidate className={className}>
    <h2 className="text-center text-xl font-semibold text-slate-900 md:text-[22px]">Confirm your number</h2>
    <p className="mt-1 text-center text-sm leading-6 text-slate-600">Enter the {CODE_LENGTH}-digit code we texted to <span className="font-semibold text-slate-900">{step.sentTo}</span>. It expires in {Math.round((step.expiresInSeconds || 300) / 60)} minutes.</p>
    {note && <p role="status" className="mt-3 text-center text-sm text-slate-600">{note}</p>}
    <div className="mt-6">
      <PinBoxes value={value} onChange={(next) => { setValue(next); setError(""); }} disabled={busy} error={error} length={CODE_LENGTH} label="Verification code" digitLabel="Code digit" autoFocus />
    </div>
    <Button type="submit" variant="plain" size="none" busy={busy} busyLabel="Checking..." disabled={value.length !== CODE_LENGTH} className={JOIN_BUTTON}>Confirm</Button>
    <div className="mt-3 flex flex-col items-center gap-1 text-sm text-slate-600 sm:flex-row sm:justify-between">
      <Button type="button" variant="ghost" size="lg" onClick={onBack} disabled={busy}>Back</Button>
      {resendIn > 0
        ? <span>You can ask for a new code in {resendIn} seconds.</span>
        : <Button type="button" variant="ghost" size="lg" onClick={resend} disabled={busy}>Send a new code</Button>}
    </div>
  </form>;
}
