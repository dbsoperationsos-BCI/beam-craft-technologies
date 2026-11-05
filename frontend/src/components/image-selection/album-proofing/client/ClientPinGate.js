"use client";

import ArrowForward from "@mui/icons-material/ArrowForward";
import LockOutlined from "@mui/icons-material/LockOutlined";
import { useEffect, useRef, useState } from "react";

/*
 * How many boxes the gate draws.
 *
 * PINs are four digits now, and a link shared before that carries six - it is out with somebody and
 * cannot be edited, so the gate is told its length by the link rather than assuming one. Four is the
 * fallback, which is what everything issued from now on uses.
 */
const DEFAULT_PIN_LENGTH = 4;
const steps = [
  ["01", "Review every album spread at your own pace."],
  ["02", "Pin precise corrections directly on the page."],
  ["03", "Send your changes or approve the final album."],
];

/** A client-facing, PIN-protected entry screen for a published album proof. */
export default function ClientPinGate({ meta, onVerify }) {
  // The link says how long its PIN is; anything unexpected falls back to the current length.
  const pinLength = meta?.pinLength === 6 ? 6 : DEFAULT_PIN_LENGTH;
  const [digits, setDigits] = useState(() => Array(pinLength).fill(""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputs = useRef([]);
  const complete = digits.every(Boolean);

  useEffect(() => { inputs.current[0]?.focus(); }, []);

  async function submit(pin = digits.join("")) {
    if (busy || pin.length !== pinLength) return;
    setBusy(true); setError("");
    try { await onVerify(pin); }
    catch (verifyError) {
      setError(verifyError.message || "Incorrect PIN. Please check and try again.");
      setDigits(Array(pinLength).fill(""));
      inputs.current[0]?.focus();
    } finally { setBusy(false); }
  }

  function update(index, raw) {
    const entered = raw.replace(/\D/g, "").slice(0, pinLength - index).split("");
    if (!entered.length) { setDigits((current) => current.map((digit, position) => position === index ? "" : digit)); return; }
    const next = digits.map((digit, position) => position >= index && position < index + entered.length ? entered[position - index] : digit);
    setDigits(next);
    inputs.current[Math.min(index + entered.length, pinLength - 1)]?.focus();
    if (next.every(Boolean)) submit(next.join(""));
  }

  function handlePaste(event) {
    const pin = (event.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, pinLength);
    if (!pin) return;
    event.preventDefault();
    setDigits(pin.padEnd(pinLength, "").split(""));
    inputs.current[Math.min(pin.length, pinLength - 1)]?.focus();
    if (pin.length === pinLength) submit(pin);
  }

  return <main className="min-h-dvh bg-[#f4f7fb] px-4 py-12 sm:px-6 sm:py-16 lg:py-18">
    <div className="mx-auto w-full max-w-[1024px]">
      <header className="text-center">
        <p className="font-serif text-5xl leading-none tracking-[-0.04em] text-slate-950 sm:text-6xl">Welcome</p>
        <h1 className="mt-4 font-serif text-3xl leading-tight tracking-[-0.04em] text-slate-900 sm:text-[3.45rem]">{meta?.albumName || "Your Album"}</h1>
        {meta?.clientName && <p className="mt-2 text-sm font-medium text-slate-500">{meta.clientName}</p>}
      </header>
      <div className="mt-8 text-center"><span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-[11px] font-semibold tracking-[0.12em] text-slate-600 shadow-sm"><LockOutlined style={{ fontSize: 15 }} aria-hidden="true" />VERSION {meta?.versionNumber || 1} · SECURE ALBUM PROOF</span></div>

      <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="mx-auto mt-9 max-w-[504px] rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-[0_20px_52px_rgba(15,23,42,0.08)] sm:p-9">
        <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-blue-50 text-blue-700"><LockOutlined style={{ fontSize: 19 }} aria-hidden="true" /></div>
        <p className="mt-5 text-sm leading-6 text-slate-600">Please enter your 6-digit PIN to access your album proof.</p>
        <fieldset className="mt-7 flex justify-center gap-2 sm:gap-2.5" onPaste={handlePaste}>
          <legend className="sr-only">Six digit album proof PIN</legend>
          {digits.map((digit, index) => <input key={index} ref={(element) => { inputs.current[index] = element; }} value={digit} onChange={(event) => update(index, event.target.value)} onKeyDown={(event) => { if (event.key === "Backspace" && !digits[index] && index > 0) inputs.current[index - 1]?.focus(); }} aria-label={`PIN digit ${index + 1}`} autoComplete={index === 0 ? "one-time-code" : "off"} inputMode="numeric" pattern="[0-9]*" maxLength={1} disabled={busy} className="h-14 w-10 rounded-xl border border-slate-200 bg-slate-50 text-center text-xl font-semibold text-slate-900 outline-none transition focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-60 sm:h-16 sm:w-[52px]" />)}
        </fieldset>
        {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={!complete || busy} className="mt-7 inline-flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-[#7fa4fa] px-5 text-sm font-semibold text-white transition hover:bg-[#638df0] focus:outline-none focus:ring-4 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Checking PIN..." : <>Enter Album Proof <ArrowForward style={{ fontSize: 17 }} aria-hidden="true" /></>}</button>
        <p className="mt-4 text-xs text-slate-500">Your review link is private and protected by this PIN.</p>
      </form>

      <section aria-label="How to review this proof" className="relative mx-auto mt-10 grid max-w-[1008px] gap-4 md:grid-cols-3 md:gap-6">
        <div className="pointer-events-none absolute left-[16.7%] right-[16.7%] top-11 hidden border-t border-dashed border-slate-300 md:block" />
        {steps.map(([number, text]) => <article key={number} className="relative min-h-[144px] rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_12px_32px_rgba(15,23,42,0.04)]"><p className="text-xs font-bold tracking-[0.16em] text-blue-600">{number}</p><p className="mt-3 text-sm font-semibold leading-5 text-slate-900">{text}</p></article>)}
      </section>
      <footer className="pt-10 text-center"><p className="text-sm font-medium text-slate-500">{meta?.studioName || "Don't Blink Studioz"}</p></footer>
    </div>
  </main>;
}
