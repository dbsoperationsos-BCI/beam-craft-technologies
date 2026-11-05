"use client";

import ArrowForward from "@mui/icons-material/ArrowForward";
import Autorenew from "@mui/icons-material/Autorenew";
import { useEffect, useRef, useState } from "react";
import useEscapeKey from "@/components/shared/useEscapeKey";

const PIN_LENGTH = 4;

// A client who came in through "View Photos" is browsing without a PIN. The moment they reach
// for anything that records a choice, this asks for the PIN over the gallery rather than
// throwing them back to the welcome screen and losing their place.
export default function SelectionPinDialog({ onVerify, onClose }) {
  const [digits, setDigits] = useState(() => Array(PIN_LENGTH).fill(""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refs = useRef([]);
  const complete = digits.every(Boolean);

  useEffect(() => { refs.current[0]?.focus(); }, []);
  useEscapeKey(onClose, !busy);

  function update(index, raw) {
    const values = raw.replace(/\D/g, "").slice(0, PIN_LENGTH - index).split("");
    if (!values.length) { setDigits((items) => items.map((item, i) => (i === index ? "" : item))); return; }
    setDigits((items) => items.map((item, i) => (i >= index && i < index + values.length ? values[i - index] : item)));
    refs.current[Math.min(index + values.length, PIN_LENGTH - 1)]?.focus();
  }
  function paste(event) {
    const pin = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, PIN_LENGTH);
    if (!pin) return;
    event.preventDefault();
    setDigits(pin.padEnd(PIN_LENGTH, "").split(""));
    refs.current[Math.min(pin.length, PIN_LENGTH - 1)]?.focus();
  }
  async function submit(event) {
    event.preventDefault();
    if (!complete || busy) return;
    setBusy(true); setError("");
    try { await onVerify(digits.join("")); }
    catch (cause) {
      setError(cause.message || "We couldn’t verify that PIN. Please try again.");
      setDigits(Array(PIN_LENGTH).fill("")); refs.current[0]?.focus();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center px-4" role="dialog" aria-modal="true" aria-labelledby="selection-pin-title">
      <button type="button" aria-label="Back to photos" onClick={() => !busy && onClose()} className="absolute inset-0 bg-slate-900/30" />
      <form onSubmit={submit} className="relative w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl sm:p-7">
        <p id="selection-pin-title" className="text-sm text-slate-700">Please enter your 4-digit PIN to Select Photos</p>
        <fieldset className="mt-5 flex justify-center gap-2.5" onPaste={paste}>
          <legend className="sr-only">Four digit gallery PIN</legend>
          {digits.map((digit, index) => (
            <input
              key={index}
              ref={(element) => { refs.current[index] = element; }}
              value={digit}
              onChange={(event) => update(index, event.target.value)}
              onKeyDown={(event) => { if (event.key === "Backspace" && !digits[index] && index > 0) refs.current[index - 1]?.focus(); }}
              aria-label={`PIN digit ${index + 1}`}
              autoComplete={index === 0 ? "one-time-code" : "off"}
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={1}
              disabled={busy}
              className="h-12 w-11 rounded-lg border border-slate-200 bg-slate-50 text-center text-lg font-semibold text-slate-900 outline-none transition focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
            />
          ))}
        </fieldset>
        {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <button type="submit" disabled={!complete || busy} className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? <><Autorenew className="animate-spin" style={{ fontSize: 16 }} aria-hidden="true" />Verifying</> : <>Enter Gallery <ArrowForward style={{ fontSize: 16 }} aria-hidden="true" /></>}
        </button>
        <button type="button" disabled={busy} onClick={onClose} className="mt-2 h-10 w-full rounded-lg bg-blue-50 text-sm font-medium text-blue-700 transition hover:bg-blue-100 disabled:opacity-50">Back to Photos</button>
      </form>
    </div>
  );
}
