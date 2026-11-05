"use client";

import { useRef, useState } from "react";
import AlbumFrame from "./AlbumFrame";
import AlbumLogo from "./AlbumLogo";
import AlbumImage from "./AlbumImage";
import { formatEventDate } from "@/lib/signatureAlbum.mjs";
import useFormErrors from "@/components/shared/useFormErrors";

/**
 * The album before the PIN: the studio's mark, the couple's names, and the four boxes. Drawn in
 * the album's own design so the first screen already looks like the album behind it, with the
 * cover softened underneath.
 */
export default function AlbumPinGate({ meta, onVerify, error, busy }) {
  const length = Math.min(6, Math.max(4, Number(meta?.pinLength) || 4));
  const [digits, setDigits] = useState(Array.from({ length: 6 }, () => ""));
  const inputs = useRef([]);
  const design = meta?.design;
  const pin = digits.join("");
  // An incomplete PIN is said under the boxes; a wrong one keeps the server's message below them.
  const fields = useFormErrors();

  async function submit(event) {
    event?.preventDefault();
    if (busy) return;
    if (!fields.check({ pin: pin.length >= length ? "" : pin ? `Enter all ${length} digits.` : "Enter the PIN." })) return;
    await onVerify(pin);
  }
  function setDigit(index, value) {
    const clean = value.replace(/\D/g, "");
    fields.clear("pin");
    if (!clean) { setDigits((current) => current.map((digit, position) => (position === index ? "" : digit))); return; }
    // Pasting the whole PIN into the first box fills every box.
    setDigits((current) => {
      const next = [...current];
      clean.split("").slice(0, 6 - index).forEach((char, offset) => { next[index + offset] = char; });
      return next;
    });
    const target = Math.min(5, index + clean.length);
    inputs.current[target]?.focus();
  }
  function onKeyDown(index, event) {
    if (event.key === "Backspace" && !digits[index] && index > 0) inputs.current[index - 1]?.focus();
    if (event.key === "Enter") submit();
  }
  const visible = digits.slice(0, 6).filter((digit, index) => index < length || digit);

  return <AlbumFrame design={design} className="relative min-h-[100svh] overflow-hidden">
    {meta?.cover && <div className="absolute inset-0 opacity-25"><AlbumImage item={meta.cover} eager alt="" className="!absolute inset-0 h-full blur-sm" style={{ aspectRatio: "auto" }} /></div>}
    <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[var(--album-bg)]/40 to-[var(--album-bg)]" aria-hidden="true" />
    <main className="relative flex min-h-[100svh] flex-col items-center justify-center px-6 py-16 text-center">
      {/* The mark when the logo switch is on - the Global Logo for this album's ground, or the
          bundled mark in that tone where none is uploaded - and the name when the name switch is
          on; either on its own, or both. */}
      {meta?.showLogo && <div className="mb-6"><AlbumLogo logo={meta?.logo} design={design} alt={meta?.studioName || ""} /></div>}
      {meta?.studioName && <p className="sa-eyebrow mb-8">{meta.studioName}</p>}
      <h1 className="sa-heading text-4xl sm:text-5xl">{meta?.title || "Signature Album"}</h1>
      {meta?.eventDate && <p className="sa-muted mt-3 text-xs tracking-[0.3em] uppercase">{formatEventDate(meta.eventDate)}</p>}
      <p className="sa-eyebrow mt-8">Private Signature Album</p>
      <form onSubmit={submit} className="mt-6 w-full max-w-xs">
        <label htmlFor="album-pin-0" className="sa-muted block text-xs tracking-[0.2em] uppercase">Enter PIN</label>
        <div className="mt-3 flex justify-center gap-2">
          {visible.map((digit, index) => <input
            key={index}
            id={`album-pin-${index}`}
            ref={(node) => { inputs.current[index] = node; }}
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label={`PIN digit ${index + 1}`}
            value={digit}
            maxLength={6}
            onChange={(event) => setDigit(index, event.target.value)}
            onKeyDown={(event) => onKeyDown(index, event)}
            aria-invalid={fields.errors.pin && !digit ? true : undefined}
            className={`sa-line h-14 w-12 rounded-md border bg-transparent text-center text-2xl outline-none focus:border-[var(--album-accent)] ${fields.errors.pin && !digit ? "!border-rose-500" : ""}`}
          />)}
        </div>
        {fields.errors.pin && <p role="alert" className="mt-2 text-xs text-rose-500">{fields.errors.pin}</p>}
        {error && <p role="alert" className="mt-4 text-sm text-rose-500">{error}</p>}
        <button type="submit" disabled={busy} className="sa-btn mt-8 w-full disabled:opacity-50">{busy ? "Opening" : "View Album"}</button>
      </form>
    </main>
  </AlbumFrame>;
}
