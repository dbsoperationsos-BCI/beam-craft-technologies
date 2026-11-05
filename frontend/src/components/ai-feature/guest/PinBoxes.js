"use client";
import { useEffect, useRef } from "react";

export const PIN_LENGTH = 4;

/**
 * The four-box PIN the client gallery uses, as a controlled field the join form can sit beside
 * its other questions. `value` is the digits typed so far, up to four; typing moves along, a
 * paste fills the row, Backspace on an empty box steps back. `length` and `label` let the same
 * boxes take the six-digit code that confirms a guest's phone.
 */
export default function PinBoxes({ value = "", onChange, disabled = false, error = "", length = PIN_LENGTH, label = "Event PIN", digitLabel = "PIN digit", autoFocus = false }) {
  const refs = useRef([]);
  // A step that is nothing but these boxes focuses the first, so a phone opens its keyboard and
  // offers the code from the SMS straight away.
  useEffect(() => { if (autoFocus) refs.current[0]?.focus(); }, [autoFocus]);
  const digits = Array.from({ length }, (_, index) => value[index] || "");
  function emit(next) { onChange(next.join("").slice(0, length)); }
  function update(index, raw) {
    const typed = raw.replace(/\D/g, "").slice(0, length - index).split("");
    if (!typed.length) { emit(digits.map((digit, i) => (i === index ? "" : digit))); return; }
    emit(digits.map((digit, i) => (i >= index && i < index + typed.length ? typed[i - index] : digit)));
    refs.current[Math.min(index + typed.length, length - 1)]?.focus();
  }
  function paste(event) {
    const pin = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!pin) return;
    event.preventDefault();
    onChange(pin);
    refs.current[Math.min(pin.length, length - 1)]?.focus();
  }
  return <div>
    <fieldset className={`flex w-full min-w-0 max-w-full justify-center ${length > 4 ? "gap-2" : "gap-2.5"}`} onPaste={paste}>
      <legend className="mb-2 block w-full text-center text-[11px] font-semibold text-slate-600 sm:text-xs">{label}</legend>
      {digits.map((digit, index) => <input key={index} ref={(element) => { refs.current[index] = element; }} value={digit} onChange={(event) => update(index, event.target.value)} onKeyDown={(event) => { if (event.key === "Backspace" && !digits[index] && index > 0) refs.current[index - 1]?.focus(); }} aria-label={`${digitLabel} ${index + 1}`} autoComplete={index === 0 ? "one-time-code" : "off"} inputMode="numeric" pattern="[0-9]*" maxLength={length} disabled={disabled} className={`h-14 ${length > 4 ? "min-w-0 flex-1 max-w-[52px]" : "w-[52px]"} rounded-xl border bg-white/90 text-center text-xl font-semibold text-slate-900 outline-none transition focus:bg-white focus:ring-4 disabled:cursor-not-allowed disabled:opacity-60 ${error ? "border-red-400 focus:border-red-500 focus:ring-red-100" : "border-slate-300 focus:border-blue-600 focus:ring-blue-100"}`} />)}
    </fieldset>
    {error && <p role="alert" className="mt-2 text-center text-[11px] text-red-600">{error}</p>}
  </div>;
}
