"use client";

import { useCallback, useState } from "react";
import Button from "@/components/shared/Button";
import TextField from "@/components/shared/TextField";
import { setWhatsappChatLimits } from "@/services/sales/whatsapp-chat.service";

/**
 * The studio's WhatsApp usage limits, on the screen that owns them.
 *
 * ── Why this is a setting at all ──────────────────────────────────────────────────────────────
 *
 * The three numbers decide when a CRM is told they are messaging too hard. They used to live in
 * the code, overridable only by an environment variable on the server - which meant a studio whose
 * CRMs genuinely work at a hundred messages an hour had two choices: ask a developer, or learn to
 * read past a red banner every afternoon. The second is what actually happens, and a warning
 * people have trained themselves to ignore is worse than no warning, because it is still there
 * when the pattern is real.
 *
 * ── The three, and why they are not one ───────────────────────────────────────────────────────
 *
 * **Different clients an hour** is the one that matters. WhatsApp bans numbers for looking like a
 * broadcaster, and from the outside a broadcast is many different people written to in a short
 * time - not volume. A CRM deep in one conversation is the opposite of that however much they
 * type, which is why volume is counted separately and why raising the two message limits is a far
 * smaller decision than raising this one. The screen says so rather than leaving an administrator
 * to infer it from three identical boxes.
 *
 * ── Empty means "use the app's own number" ────────────────────────────────────────────────────
 *
 * A blank box is not zero and is not an error: it hands that limit back to the default, which is
 * shown in the box as a placeholder so nobody has to clear a field to find out what it was. That
 * is the only way back once a number has been typed, and a screen without it would be a one-way
 * door.
 *
 * Nothing here blocks a send or ends a session - that is what the switch and the per-CRM menu
 * above are for. These decide what a CRM is *told*, and a limit saved here reaches the panel of
 * somebody already being warned on their next poll.
 */

// The order an administrator should read them in: reach first, because it is the one that decides
// whether the studio's number looks like a broadcaster, then the two volume measures.
const FIELDS = [
  {
    key: "hourlyChats",
    label: "Different clients an hour",
    hint: "The one WhatsApp bans numbers over. Raise it last.",
  },
  {
    key: "hourlyMessages",
    label: "Messages an hour",
    hint: "Volume, however few people it went to.",
  },
  {
    key: "dailyMessages",
    label: "Messages a day",
    hint: "Catches a steady drip no single hour flags.",
  },
];

/** The saved limits as the form holds them: a string per box, empty where nothing was set. */
function formFrom(saved) {
  const values = {};
  for (const field of FIELDS) {
    const value = saved?.[field.key];
    values[field.key] = value === null || value === undefined ? "" : String(value);
  }
  return values;
}

export default function WhatsAppLimitsCard({ limits, saved, defaults, bounds, canEdit, onSaved }) {
  /*
   * Seeded from the props and owned from then on.
   *
   * Deliberately not resynced from above by an effect: the parent reloads the table after a save -
   * the usage column changes with the limits - and an effect watching these props would then
   * overwrite whatever had been typed since. The save path sets this state from the server's own
   * answer, so the two cannot drift.
   */
  const [form, setForm] = useState(() => formFrom(saved));
  const [inForce, setInForce] = useState(limits || {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const update = useCallback((key, value) => {
    // Digits only, so a stray letter never reaches a field whose whole job is to be a number.
    // The length cap is the ceiling's width: it stops a runaway keypress rather than validating.
    setForm((current) => ({ ...current, [key]: value.replace(/\D/g, "").slice(0, 5) }));
    setNotice("");
    setError("");
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      // Empty stays empty all the way to the server, where it is stored as null - the limit
      // handed back to the app's default. Numbers go as numbers so the server is not parsing
      // strings to find out whether somebody typed one.
      const payload = {};
      for (const field of FIELDS) {
        const typed = form[field.key];
        payload[field.key] = typed === "" ? null : Number(typed);
      }
      const response = await setWhatsappChatLimits(payload);
      setInForce(response?.data?.limits || {});
      setForm(formFrom(response?.data?.saved));
      setError("");
      setNotice("Saved. Every CRM is held to these from their next refresh.");
      // The table above shows each CRM against these limits, so it is stale the moment they move.
      if (onSaved) await onSaved();
    } catch (requestError) {
      setError(requestError.message || "Unable to save the WhatsApp limits.");
      setNotice("");
    } finally {
      setSaving(false);
    }
  }, [form, onSaved]);

  /*
   * A CRM without User Settings gets the numbers and no form.
   *
   * Read rather than write, which is what their permission says - and the reading is worth
   * having: the banner in their chat panel names a limit, and this is the screen that says where
   * that limit came from. The boxes are absent rather than disabled, so nothing offers itself to
   * somebody it would only refuse.
   */
  if (!canEdit) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-xs font-semibold text-slate-700 sm:text-sm">Usage limits</p>
        <p className="mt-1 text-xs font-normal text-slate-500 sm:text-sm">
          Each CRM is warned past {inForce.hourlyChats} different clients an hour,{" "}
          {inForce.hourlyMessages} messages an hour, or {inForce.dailyMessages} messages a day.
          Changing them needs User Settings access.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
      <p className="text-xs font-semibold text-slate-700 sm:text-sm">Usage limits</p>
      <p className="mt-1 text-xs font-normal text-slate-500 sm:text-sm">
        When a CRM is warned that they are messaging too hard. Nothing is blocked - the warning
        asks them to stop, and their row above is where you can disconnect them. Leave a box empty
        to use the app&apos;s own number.
      </p>

      {/* One column on a phone, three from `sm` - the boxes are short and the hints under them are
          not, so a narrow screen stacks rather than squeezing three of each side by side. */}
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {FIELDS.map((field) => (
          <div key={field.key}>
            <TextField
              label={field.label}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              // The default, shown rather than described: an empty box that says `25` in grey is
              // its own explanation of what leaving it empty will do.
              placeholder={String(defaults?.[field.key] ?? "")}
              value={form[field.key]}
              disabled={saving}
              onChange={(event) => update(field.key, event.target.value)}
            />
            <p className="mt-1 text-[11px] font-normal text-slate-400">{field.hint}</p>
          </div>
        ))}
      </div>

      {/* Said once, under the field it is about rather than in the paragraph above: the reach
          limit is the one with a number's ban behind it, and an administrator raising it should
          be told at the moment they are raising it. */}
      <p className="mt-3 text-xs font-normal text-slate-500">
        In force now: {inForce.hourlyChats} clients an hour, {inForce.hourlyMessages} messages an
        hour, {inForce.dailyMessages} a day. Messaging many different people in a short time is what
        WhatsApp reads as a broadcast, and the studio&apos;s number can be banned for it - so raise
        the message counts before the client count.
      </p>

      {error && <p role="alert" className="mt-2 text-xs text-red-600 sm:text-sm">{error}</p>}
      {notice && <p role="status" className="mt-2 text-xs text-emerald-700 sm:text-sm">{notice}</p>}

      <div className="mt-3 flex justify-end">
        <Button variant="primary" size="sm" onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Save limits"}
        </Button>
      </div>
    </div>
  );
}
