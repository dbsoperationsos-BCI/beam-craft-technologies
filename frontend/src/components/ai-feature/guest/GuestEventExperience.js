"use client";
import { useCallback, useEffect, useState } from "react";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import { consentGuestWhatsApp, getGuestEvent, getGuestMe, joinGuestEvent, resendGuestJoinCode, verifyGuestJoin } from "@/services/ai-feature/ai-feature-public.service";
import { clearGuestSession, getGuestSession, setGuestSession } from "@/lib/aiEventGuestSession";
import GuestGallery from "./GuestGallery";
import GuestLanding from "./GuestLanding";
import GuestStatusScreen from "./GuestStatusScreen";
import { isSessionExpired } from "./guestActions";

/**
 * The guest's page for an event link, at /e/[code]. No shell, no sign-in: the link's code names
 * the event, and joining hands back a session kept in localStorage so a returning guest lands in
 * the gallery. Three states - waiting or failed, the landing page with its join card, and the
 * gallery - and a 401 anywhere returns to the second.
 */
export default function GuestEventExperience({ code }) {
  const [meta, setMeta] = useState(null);
  const [failure, setFailure] = useState(null);
  const [session, setSession] = useState(null);
  const [guest, setGuest] = useState(null);
  const [phase, setPhase] = useState("loading");
  const [attempt, setAttempt] = useState(0);
  // The join card's WhatsApp box, when the server refused it: the gallery asks once more.
  const [offerWhatsApp, setOfferWhatsApp] = useState(false);
  const { notice, showNotice, clearNotice } = useNotice();

  useEffect(() => {
    let cancelled = false;
    async function open() {
      try {
        const response = await getGuestEvent(code);
        if (cancelled) return;
        setMeta(response.data); setFailure(null);
        const stored = getGuestSession(code);
        if (stored) {
          try {
            const me = await getGuestMe(code, stored);
            if (cancelled) return;
            setSession(stored); setGuest(me.data); setPhase("gallery");
            return;
          } catch (error) {
            if (cancelled) return;
            if (!isSessionExpired(error)) { setFailure({ status: error.status, message: error.message, data: error.data }); setPhase("failed"); return; }
            clearGuestSession(code);
          }
        }
        setPhase("landing");
      } catch (error) {
        if (cancelled) return;
        setFailure({ status: error.status, message: error.message, data: error.data }); setPhase("failed");
      }
    }
    open();
    return () => { cancelled = true; };
  }, [code, attempt]);

  const leave = useCallback((message) => {
    clearGuestSession(code);
    setSession(null); setGuest(null); setPhase("landing");
    if (message) showNotice(message);
    window.scrollTo({ top: 0 });
  }, [code, showNotice]);
  const expired = useCallback(() => leave("Your session has ended. Please join the event again."), [leave]);

  /**
   * In, with the session. The join card's ticked WhatsApp box is the guest's consent, recorded here
   * once the session exists - no code. If the server refuses it (the number, the event), the gallery
   * asks once more with the reason, rather than the box being lost silently.
   */
  async function enter(data, whatsappSummary) {
    let current = data.guest;
    let askAgain = false;
    if (whatsappSummary && !current?.whatsappSummary?.on) {
      try { current = (await consentGuestWhatsApp(code, data.session)).data || current; }
      catch { askAgain = true; }
    }
    setOfferWhatsApp(askAgain);
    setGuestSession(code, data.session);
    setSession(data.session); setGuest(current); setPhase("gallery");
    window.scrollTo({ top: 0 });
  }

  /**
   * Joining. Where the server asks for the phone to be proved first (a guest with photos to protect,
   * or an event that confirms every number), the answer is a code step instead of a session: the
   * join card is handed what it needs to finish it - where the code went, and `verify` / `resend`.
   */
  async function join(payload, { whatsappSummary = false } = {}) {
    const response = await joinGuestEvent(code, payload);
    if (!response.data.verificationRequired) { await enter(response.data, whatsappSummary); return null; }
    const { challenge, sentTo, expiresInSeconds, resendInSeconds, notice } = response.data;
    return {
      sentTo, expiresInSeconds, resendInSeconds, notice,
      verify: async (value) => enter((await verifyGuestJoin(code, { challenge, code: value, ...(payload.rsvp ? { rsvp: payload.rsvp } : {}) })).data, whatsappSummary),
      resend: async () => (await resendGuestJoinCode(code, { challenge })).data,
    };
  }

  const notify = useCallback((message, tone = "info") => showNotice(message, tone), [showNotice]);

  let page;
  if (phase === "loading") page = <GuestStatusScreen loading />;
  else if (phase === "failed") page = <GuestStatusScreen status={failure?.status} message={failure?.message} failure={failure} onRetry={() => { setPhase("loading"); setAttempt((current) => current + 1); }} />;
  else if (phase === "gallery" && session) page = <GuestGallery key={session} code={code} session={session} meta={meta} guest={guest} onGuestChange={setGuest} onExpired={expired} onLeave={() => leave()} notify={notify} offerWhatsApp={offerWhatsApp} />;
  else page = <GuestLanding meta={meta} onJoin={join} />;

  return <>
    {page}
    <FloatingNotice notice={notice} onClose={clearNotice} />
  </>;
}
