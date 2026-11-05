"use client";
import { useCallback, useEffect, useState } from "react";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import { getGuestEvent, getGuestMe, joinGuestEvent } from "@/services/ai-feature/ai-feature-public.service";
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
            if (!isSessionExpired(error)) { setFailure({ status: error.status, message: error.message }); setPhase("failed"); return; }
            clearGuestSession(code);
          }
        }
        setPhase("landing");
      } catch (error) {
        if (cancelled) return;
        setFailure({ status: error.status, message: error.message }); setPhase("failed");
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

  async function join(payload) {
    const response = await joinGuestEvent(code, payload);
    setGuestSession(code, response.data.session);
    setSession(response.data.session); setGuest(response.data.guest); setPhase("gallery");
    window.scrollTo({ top: 0 });
  }

  const notify = useCallback((message, tone = "info") => showNotice(message, tone), [showNotice]);

  let page;
  if (phase === "loading") page = <GuestStatusScreen loading />;
  else if (phase === "failed") page = <GuestStatusScreen status={failure?.status} message={failure?.message} onRetry={() => { setPhase("loading"); setAttempt((current) => current + 1); }} />;
  else if (phase === "gallery" && session) page = <GuestGallery key={session} code={code} session={session} meta={meta} guest={guest} onGuestChange={setGuest} onExpired={expired} onLeave={() => leave()} notify={notify} />;
  else page = <GuestLanding meta={meta} onJoin={join} />;

  return <>
    {page}
    <FloatingNotice notice={notice} onClose={clearNotice} />
  </>;
}
