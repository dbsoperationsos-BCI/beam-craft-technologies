"use client";
import { useState } from "react";

const LABELS = { ACCEPTED: "You're attending", DECLINED: "You're not attending" };

/**
 * The guest's answer to the invitation, and the way to change it. A guest who has not answered is
 * asked in a line; one who has sees their answer and a small "Change".
 */
export default function GuestRsvpBar({ guest, onChange }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const answered = guest?.rsvp === "ACCEPTED" || guest?.rsvp === "DECLINED";
  async function pick(value) {
    if (busy) return;
    setBusy(true);
    try { await onChange(value); setEditing(false); } finally { setBusy(false); }
  }
  if (answered && !editing) return <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700">
    <span>{LABELS[guest.rsvp]}</span>
    <button type="button" onClick={() => setEditing(true)} className="min-h-9 text-sm font-semibold text-blue-700 underline decoration-blue-200 underline-offset-4">Change</button>
  </div>;
  return <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 sm:flex-row sm:items-center sm:justify-between">
    <span className="font-medium">Will you be there?</span>
    <div className="grid grid-cols-2 gap-2 sm:flex">
      <button type="button" disabled={busy} onClick={() => pick("ACCEPTED")} className="min-h-10 rounded-lg bg-[#7fa4fa] px-4 text-sm font-semibold text-white hover:bg-[#638df0] disabled:opacity-50">Attending</button>
      <button type="button" disabled={busy} onClick={() => pick("DECLINED")} className="min-h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Not attending</button>
    </div>
  </div>;
}
