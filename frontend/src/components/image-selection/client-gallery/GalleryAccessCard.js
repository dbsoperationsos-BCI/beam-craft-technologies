"use client";

import { useEffect, useRef, useState } from "react";
import ArrowForward from "@mui/icons-material/ArrowForward";
import Autorenew from "@mui/icons-material/Autorenew";
import LockOutlined from "@mui/icons-material/LockOutlined";

const PIN_LENGTH = 4;

export default function GalleryAccessCard({ onVerify, onViewPhotos }) {
  const [digits, setDigits] = useState(() => Array(PIN_LENGTH).fill(""));
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const refs = useRef([]); const complete = digits.every(Boolean);
  // Browsing needs no PIN — the gallery link is already private. The PIN is asked for later,
  // the first time the client reaches for something that records a choice.
  async function browse() { if (busy) return; setBusy(true); setError(""); try { await onViewPhotos(); } catch (cause) { setError(cause.message || "We couldn’t open the gallery. Please try again."); setBusy(false); } }
  useEffect(() => { refs.current[0]?.focus(); }, []);
  function update(index, raw) { const values = raw.replace(/\D/g, "").slice(0, PIN_LENGTH - index).split(""); if (!values.length) { setDigits((items) => items.map((item, i) => i === index ? "" : item)); return; } setDigits((items) => items.map((item, i) => i >= index && i < index + values.length ? values[i - index] : item)); refs.current[Math.min(index + values.length, PIN_LENGTH - 1)]?.focus(); }
  function paste(event) { const pin = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, PIN_LENGTH); if (!pin) return; event.preventDefault(); setDigits(pin.padEnd(PIN_LENGTH, "").split("")); refs.current[Math.min(pin.length, PIN_LENGTH - 1)]?.focus(); }
  async function submit(event) { event.preventDefault(); if (!complete || busy) return; setBusy(true); setError(""); try { await onVerify(digits.join("")); } catch (cause) { setError(cause.message || "We couldn’t verify that PIN. Please try again."); setDigits(Array(PIN_LENGTH).fill("")); refs.current[0]?.focus(); } finally { setBusy(false); } }
  return <form onSubmit={submit} className="mt-9 rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-[0_20px_52px_rgba(15,23,42,0.08)] sm:p-9"><div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-blue-50 text-blue-700"><LockOutlined style={{ fontSize: 19 }} aria-hidden="true" /></div><p className="mt-5 text-sm leading-6 text-slate-600">Please enter your 4-digit PIN to access your gallery.</p><fieldset className="mt-7 flex justify-center gap-2.5" onPaste={paste}><legend className="sr-only">Four digit gallery PIN</legend>{digits.map((digit, index) => <input key={index} ref={(element) => { refs.current[index] = element; }} value={digit} onChange={(event) => update(index, event.target.value)} onKeyDown={(event) => { if (event.key === "Backspace" && !digits[index] && index > 0) refs.current[index - 1]?.focus(); }} aria-label={`PIN digit ${index + 1}`} autoComplete={index === 0 ? "one-time-code" : "off"} inputMode="numeric" pattern="[0-9]*" maxLength={1} disabled={busy} className="h-16 w-[55px] rounded-xl border border-slate-200 bg-slate-50 text-center text-xl font-semibold text-slate-900 outline-none transition focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-60" />)}</fieldset>{error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}<button type="submit" disabled={!complete || busy} className="mt-7 inline-flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-[#7fa4fa] px-5 text-sm font-semibold text-white transition hover:bg-[#638df0] focus:outline-none focus:ring-4 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-50">{busy ? <><Autorenew className="animate-spin" style={{ fontSize: 17 }} aria-hidden="true" />Verifying</> : <>Enter Gallery <ArrowForward style={{ fontSize: 17 }} aria-hidden="true" /></>}</button><button type="button" onClick={browse} disabled={busy} className="mt-4 text-sm font-medium text-slate-700 underline decoration-slate-300 underline-offset-4 hover:text-blue-700 disabled:opacity-50">View Photos</button></form>;
}
