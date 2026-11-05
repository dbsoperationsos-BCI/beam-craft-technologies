"use client";
import { useRef } from "react";

export const PIN_LENGTH = 4;

/**
 * The four-box PIN the client gallery uses, as a controlled field the join form can sit beside
 * its other questions. `value` is the digits typed so far, up to four; typing moves along, a
 * paste fills the row, Backspace on an empty box steps back.
 */
export default function PinBoxes({ value = "", onChange, disabled = false, error = "" }) {
  const refs = useRef([]);
  const digits = Array.from({ length: PIN_LENGTH }, (_, index) => value[index] || "");
  function emit(next) { onChange(next.join("").slice(0, PIN_LENGTH)); }
  function update(index, raw) {
    const typed = raw.replace(/\D/g, "").slice(0, PIN_LENGTH - index).split("");
    if (!typed.length) { emit(digits.map((digit, i) => (i === index ? "" : digit))); return; }
    emit(digits.map((digit, i) => (i >= index && i < index + typed.length ? typed[i - index] : digit)));
    refs.current[Math.min(index + typed.length, PIN_LENGTH - 1)]?.focus();
  }
  function paste(event) {
    const pin = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, PIN_LENGTH);
    if (!pin) return;
    event.preventDefault();
    onChange(pin);
    refs.current[Math.min(pin.length, PIN_LENGTH - 1)]?.focus();
  }
  return <div>
    <fieldset className="flex justify-center gap-2.5" onPaste={paste}>
      <legend className="mb-2 block w-full text-center text-[11px] font-semibold text-slate-600 sm:text-xs">Event PIN</legend>
      {digits.map((digit, index) => <input key={index} ref={(element) => { refs.current[index] = element; }} value={digit} onChange={(event) => update(index, event.target.value)} onKeyDown={(event) => { if (event.key === "Backspace" && !digits[index] && index > 0) refs.current[index - 1]?.focus(); }} aria-label={`PIN digit ${index + 1}`} autoComplete={index === 0 ? "one-time-code" : "off"} inputMode="numeric" pattern="[0-9]*" maxLength={1} disabled={disabled} className={`h-14 w-[52px] rounded-xl border bg-slate-50 text-center text-xl font-semibold text-slate-900 outline-none transition focus:bg-white focus:ring-4 disabled:cursor-not-allowed disabled:opacity-60 ${error ? "border-red-400 focus:border-red-500 focus:ring-red-100" : "border-slate-200 focus:border-blue-600 focus:ring-blue-100"}`} />)}
    </fieldset>
    {error && <p role="alert" className="mt-2 text-center text-[11px] text-red-600">{error}</p>}
  </div>;
}
