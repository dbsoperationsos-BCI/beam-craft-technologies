"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import TextAreaField from "@/components/shared/TextAreaField";
import WhatsAppLinkCard from "@/components/shared/WhatsAppLinkCard";
import useFormErrors from "@/components/shared/useFormErrors";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import { connectWhatsapp, getMyWhatsappSession } from "@/services/sales/whatsapp-chat.service";
import { sendCandidateWhatsApp } from "@/services/hrm/interview.service";

/**
 * A WhatsApp message to the candidate, from the recruiter's own WhatsApp.
 *
 * ── Their own, because the session is per user ──
 *
 * Nothing here sends from a studio account: WhatsApp credentials are stored per user id, and a message
 * goes out from the phone that person paired. That is the same arrangement the screening form and the
 * onboarding invite already use, so nobody pairs anything new for this - but somebody who has never
 * paired has to be able to, and the only screen that offered the code was the CRM's lead popup. So the
 * tab asks whether this user is linked and draws `WhatsAppLinkCard` when they are not. It used to draw a
 * box and a Send button whatever the answer, which meant typing a message and being refused on send.
 *
 * **The code is asked for by a press.** Pairing is not rate limited on the server - the limit used to be
 * met by people pressing Refresh code while trying to link - and each attempt is a real registration
 * against a number WhatsApp can ban for registering repeatedly. Reading the session is cheap and happens
 * on open; asking for a code never does.
 *
 * ── One way, for now ──
 *
 * Their replies do not come back here: the inbound handler keeps only messages from a number belonging to
 * a CRM lead and drops the rest, and the message store requires a lead. What this is worth is the half
 * that is nearly free - the recruiter stops leaving the screen to open WhatsApp on their phone, and what
 * was sent is recorded on the record.
 *
 * **The number is not sent.** The server reads it off the candidate the id names. There is no "send to
 * this number" route in this application and there must not be, because the studio's paired number can be
 * banned for being used that way. The number is *shown* here so nobody messages somebody they did not
 * mean to.
 */
export default function InterviewWhatsAppTab({ candidate, canWrite = true, onSent }) {
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState(null);
  // `null` is "not asked yet", so the tab does not flash the pairing card at somebody who is linked.
  const [session, setSession] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const { busy, run } = useSubmitOnce();
  const fields = useFormErrors();

  const number = candidate?.whatsappNumber || candidate?.phone || "";

  /** Whether this user has a paired phone. A read, not a registration - see the note above. */
  const readSession = useCallback(async () => {
    try {
      const response = await getMyWhatsappSession();
      setSession(response?.data?.session || response?.data || { status: "disconnected" });
    } catch {
      // Unreadable is not unlinked: refusing to draw the composer over a failed read would leave
      // somebody who is perfectly well linked unable to send.
      setSession({ status: "unknown" });
    }
  }, []);
  useEffect(() => { void readSession(); }, [readSession]);

  /** Asked for by the card's button, never on mount. */
  async function connect() {
    setConnecting(true);
    try {
      const response = await connectWhatsapp();
      setSession(response?.data?.session || response?.data || { status: "pairing" });
    } catch (error) {
      setSession((current) => ({ ...(current || {}), status: "disconnected", error: error?.data?.message || error?.message || "Unable to start pairing." }));
    } finally {
      setConnecting(false);
    }
  }

  async function send() {
    if (!canWrite) return;
    if (!fields.check({ message: draft.trim() ? "" : "Type the message to send." })) return;
    await run(async () => {
      try {
        const response = await sendCandidateWhatsApp(candidate.id, draft.trim());
        setDraft("");
        setNotice({ tone: "ok", text: `Sent to ${response?.sentTo || number}.` });
        onSent?.(response?.data, "WhatsApp message sent.");
      } catch (sendError) {
        // The server's own sentence: it tells "your WhatsApp is not linked" apart from the rest, and
        // only it knows which.
        setNotice({ tone: "error", text: sendError?.data?.message || sendError?.message || "Unable to send that message." });
      }
    });
  }

  /*
   * Said before they type, not after. A walk-in written down from a phone call often has no number
   * yet, and a compose box that cannot send is a box somebody fills in for nothing.
   */
  if (!number) return <p className="text-xs text-slate-500 sm:text-sm">No WhatsApp number or phone number on this record yet. Add one on the left and save.</p>;
  if (!canWrite) return <p className="text-xs text-slate-500 sm:text-sm">You can read this candidate but not message them.</p>;
  if (session === null) return <p className="text-xs text-slate-500 sm:text-sm">Checking your WhatsApp…</p>;
  /*
   * Not linked, so the code rather than a box. `unknown` draws the composer: a read that failed says
   * nothing about whether they are paired, and the send itself will say so properly if they are not.
   */
  if (session?.status !== "connected" && session?.status !== "unknown") {
    return <WhatsAppLinkCard
      session={session}
      connecting={connecting}
      onConnect={connect}
      note="Once linked, messages you send a candidate go out from your own WhatsApp."
    />;
  }

  return <div className="space-y-2">
    {notice && <p role="alert" className={`rounded-lg border px-3 py-2 text-xs font-normal sm:text-sm ${notice.tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>{notice.text}</p>}
    <p className="text-[11px] font-normal text-slate-500 sm:text-xs">To <span className="font-semibold text-slate-700">{number}</span>, from your own WhatsApp.</p>
    <TextAreaField label="Message" helperText="Sent to this candidate from your own WhatsApp when you press Send." value={draft} onChange={(event) => { setDraft(event.target.value); setNotice(null); fields.clear("message"); }} rows={5} error={fields.errors.message} />
    <div className="flex justify-end">
      <Button type="button" variant="primary" busy={busy} busyLabel="Sending..." onClick={() => void send()}>Send</Button>
    </div>
    {/* The studio's number is bannable for bulk or automated sending, so this stays one message to one
        person, pressed by a person. */}
    <p className="text-[11px] font-normal leading-5 text-slate-500 sm:text-xs">
      One message to one candidate. Their replies do not come back here — check WhatsApp for those.
    </p>
  </div>;
}
