"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Button from "@/components/shared/Button";
import { connectImageSelectionWhatsapp, getImageSelectionWhatsappSession } from "@/services/image-selection/image-selection.service";

/*
 * This coordinator's own WhatsApp, read and paired from inside Image Selection.
 *
 * The same session the CRM chat pairs - one per signed-in person, never the app's - reached through
 * this module's own endpoints, so a post-production coordinator who holds Image Selection and not
 * CRM Leads can still link. The pacing is the sales gate's (`WhatsappRequiredGate`) and for the same
 * reasons: the status reply carries whatever code the session currently holds, so *reading* is what
 * collects a rotated code and is cheap, while *pairing* is a real registration against the studio's
 * number and is asked for no more often than the server would accept anyway.
 */

// Well under the life of a code: Baileys gives the first QR sixty seconds and every one after it
// twenty, so a read every five seconds hands nobody a code with no life left in it.
const QR_REFRESH_MS = 5 * 1000;
// The server's own gap between two pairing requests (`MIN_CONNECT_GAP_MS`), matched so the
// button's countdown tells the truth about when a press actually reaches WhatsApp.
const PAIRING_COOLDOWN_MS = 15 * 1000;

/**
 * Reads the session while `active`, and offers `start` to ask for a code.
 *
 * `session` is null until the first answer arrives; `connected` is the one question most callers
 * ask. Replies are merged, never swapped in, so a partial one cannot make a linked session read as
 * unlinked. With `autoStart`, a code is asked for as soon as the session turns out to be down and
 * allowed to link - once per lapse, the way the gate does it, so a code that expires unscanned is
 * replaced rather than leaving an empty square.
 */
/**
 * This person's WhatsApp session, polled while `active`, with a pairing code asked for on demand
 * (or at once, with `autoStart`). `readSession` and `connectSession` are the two endpoints it calls -
 * each screen that pairs WhatsApp has its own pair behind its own permission; they must be stable
 * (module-level functions), since the hook's callbacks depend on them.
 */
export function useWhatsappPairingSession(active = true, { autoStart = false, readSession, connectSession } = {}) {
  const [session, setSession] = useState(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const nextAllowedRef = useRef(0);
  const askedRef = useRef(false);
  const [blockedUntil, setBlockedUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const response = await readSession();
      if (response?.data) setSession((current) => ({ ...(current || {}), ...response.data }));
    } catch (cause) {
      setError(cause?.message || "Unable to read the WhatsApp session.");
    }
  }, [readSession]);

  const start = useCallback(async () => {
    if (starting || Date.now() < nextAllowedRef.current) return;
    nextAllowedRef.current = Date.now() + PAIRING_COOLDOWN_MS;
    setBlockedUntil(nextAllowedRef.current);
    setStarting(true);
    setError("");
    try {
      const response = await connectSession();
      if (response?.data) setSession((current) => ({ ...(current || {}), ...response.data }));
    } catch (cause) {
      setError(cause?.message || "Unable to start WhatsApp pairing.");
    } finally {
      setStarting(false);
    }
  }, [starting, connectSession]);

  useEffect(() => {
    if (!active) return undefined;
    // Deferred by a zero timer, the way the workspace's loaders are: setting state straight from
    // an effect body is a cascading render.
    const first = window.setTimeout(() => { void refresh(); }, 0);
    const timer = window.setInterval(() => { void refresh(); }, QR_REFRESH_MS);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [active, refresh]);

  // One tick a second, and only while the button is actually waiting.
  useEffect(() => {
    if (blockedUntil <= now) return undefined;
    const timer = window.setTimeout(() => setNow(Date.now()), 1000);
    return () => window.clearTimeout(timer);
  }, [blockedUntil, now]);

  useEffect(() => {
    if (!autoStart || !session) return;
    // Not allowed to link: the studio-wide switch or this person's own is off, and asking for a
    // code would only be refused.
    if (session.chatEnabled === false || session.userChatEnabled === false) return;
    // Producing codes, or done: nothing to ask for, and the next lapse should ask again.
    if (session.status === "pairing" || session.status === "connected") { askedRef.current = false; return; }
    if (askedRef.current || starting) return;
    askedRef.current = true;
    void start();
  }, [autoStart, session, start, starting]);

  const waiting = Math.max(0, Math.ceil((blockedUntil - now) / 1000));
  return { session, connected: session?.status === "connected", starting, error, waiting, start, refresh };
}

/**
 * The pairing code, or why there is none.
 *
 * The square is the full width of whatever holds it, capped so it never grows past a phone's
 * screen, and the code and the line that stands in for it share one frame so nothing moves as
 * WhatsApp rotates the code.
 */
/** Image Selection's own: the session read and paired through its endpoints. */
export function useImageSelectionWhatsappSession(active = true, { autoStart = false } = {}) {
  return useWhatsappPairingSession(active, { autoStart, readSession: getImageSelectionWhatsappSession, connectSession: connectImageSelectionWhatsapp });
}

export function WhatsAppPairingCode({ session, starting, error, waiting, onStart }) {
  const switchedOff = session?.chatEnabled === false || session?.userChatEnabled === false;
  return (
    <div>
      <div className="mx-auto flex aspect-square w-full max-w-[280px] items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white p-2">
        {session?.qr ? (
          // A data URL generated per pairing attempt and thrown away seconds later, so there is
          // nothing for next/image to optimise or cache.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={session.qr} alt="WhatsApp pairing code" className="h-full w-full object-contain" />
        ) : (
          <span className="px-3 text-center text-xs text-slate-500">
            {switchedOff ? "WhatsApp is switched off for this account." : starting || session?.status === "pairing" ? "Preparing your code..." : "Not linked"}
          </span>
        )}
      </div>
      <p className="mt-2 text-center text-[11px] leading-4 text-slate-500">
        On your phone: WhatsApp → Linked devices → Link a device, then scan this code.
      </p>
      {(error || session?.error) && (
        <p role="alert" className="mt-2 text-xs leading-5 text-red-600">{error || session.error}</p>
      )}
      {!switchedOff && (
        <div className="mt-3 flex justify-center">
          <Button type="button" variant="primary" size="sm" onClick={onStart} disabled={starting || waiting > 0}>
            {starting ? "Preparing code..." : waiting > 0 ? `Refresh code in ${waiting}s` : session?.qr ? "Refresh code" : "Get pairing code"}
          </Button>
        </div>
      )}
    </div>
  );
}
