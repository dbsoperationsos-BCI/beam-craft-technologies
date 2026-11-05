"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Dialog from "@/components/ui/Dialog";
import Button from "@/components/shared/Button";
import { connectWhatsapp, getWhatsappSession } from "@/services/sales/whatsapp-chat.service";
import { whatsappLinkNeeded } from "@/lib/whatsappGate.mjs";

/*
 * ── The application, held shut until this person's WhatsApp is linked ────────────────────────
 *
 * Everybody except an administrator has to pair before they may use the application. A CRM working a
 * morning of leads with the one channel the client is answering on disconnected is the fault this
 * exists to stop, and a notice that can be dismissed is one people learn to dismiss unread - so it is
 * a condition rather than a reminder, and there is no × drawn, no Escape, no backdrop.
 *
 * What keeps that safe rather than reckless is `whatsappLinkNeeded` beside this file, and every way
 * it says *no*: an administrator is never held, somebody the WhatsApp switches have turned off is
 * never held, a linked session is never held, and a read that did not come back never holds anybody.
 * On top of those, `linkRequired` is the server's answer for this account - false for an
 * administrator and false for anyone an administrator has released in Login Credentials → WhatsApp,
 * which is the way out for a lost or broken phone that needs no deploy.
 *
 * Read live, per poll, rather than taken from the login. A rule carried on the token only changes
 * when somebody signs in again - and a person this is holding cannot sign out to collect it.
 *
 * The QR is polled rather than streamed: WhatsApp rotates a pairing code every twenty seconds or so,
 * and the **status** reply carries whatever code the session currently holds, so a rotation arrives
 * without asking to pair again. That distinction is the whole of the pacing below - reading is cheap
 * and repeatable, pairing is a real registration against the studio's number and is neither.
 */

/*
 * How often an open gate re-reads the session, which is also how a rotated code arrives.
 *
 * **Well under the life of a code, and that is the point.** Baileys gives the first QR sixty
 * seconds and every one after it twenty (`qrMs = qrTimeout || 20000` in its Socket/socket.js), so a
 * poll of twenty seconds could hand somebody a code with no life left in it - drawn just as WhatsApp
 * replaced it, expiring in the time it takes to pick up a phone. The scan then fails for a reason
 * nothing on screen explains. At five seconds the worst a displayed code can be is five seconds old
 * with fifteen left to scan. Reading is cheap - it is a status call, not a registration.
 */
const QR_REFRESH_MS = 5 * 1000;

/*
 * The least time between two pairing requests from this screen.
 *
 * **The server's own gap, not a shorter one.** `MIN_CONNECT_GAP_MS` in the backend's
 * whatsapp-chat/sessionManager.js drops a non-reconnect start inside fifteen seconds of the last one
 * and answers with the state it already had - no error, nothing changed. A button that re-enabled at
 * five therefore spent ten seconds doing nothing at all when pressed, which reads as broken and
 * invites the very stream of presses both gaps exist to prevent. Matching it means the countdown
 * tells the truth: when it says Refresh code, the press reaches WhatsApp.
 */
const PAIRING_COOLDOWN_MS = 15 * 1000;

export default function WhatsappRequiredGate() {
  /*
   * `null` until the first answer arrives, so the first frame renders nothing on the server and on
   * the client alike and the application is never held on a guess.
   */
  const [session, setSession] = useState(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  /*
   * Whether a code has been asked for at all, and when one may be asked for next.
   *
   * Refs rather than state: a pairing request must not be *caused* by a render, and what the
   * automatic request reads has to be settled the instant it is called. `askedRef` is what makes it
   * happen once per lapse rather than once per session object - and a merged reply is a new object
   * every poll, which is how it once spent a whole rate-limit budget in about a second.
   */
  const askedRef = useRef(false);
  const nextAllowedRef = useRef(0);
  // The same moment as `nextAllowedRef`, in state so the button can count it down rather than
  // refusing silently - a control that does nothing when pressed reads as broken.
  const [blockedUntil, setBlockedUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  /**
   * Asks the server for a code, and folds the answer into what is already known.
   *
   * **Merged, never replaced.** `linkRequired` is the server's answer about this account, and
   * replacing the whole session with a reply that did not carry it read as "not required" - so
   * pressing Refresh code unlocked the application, which is the exact opposite of what the button
   * is for. A failed call changes nothing: the previous session stands and the gate holds.
   */
  const start = useCallback(async () => {
    if (starting || Date.now() < nextAllowedRef.current) return;
    nextAllowedRef.current = Date.now() + PAIRING_COOLDOWN_MS;
    setBlockedUntil(nextAllowedRef.current);
    setStarting(true);
    setError("");
    try {
      const response = await connectWhatsapp("");
      const next = response?.data;
      if (next) setSession((current) => ({ ...(current || {}), ...next }));
    } catch (cause) {
      setError(cause?.message || "Unable to start WhatsApp pairing.");
    } finally {
      setStarting(false);
    }
  }, [starting]);

  /*
   * Read the session, then keep reading it. This is how a rotated code arrives and how the scan
   * succeeding is noticed - which is what takes the dialog away without anything being pressed.
   */
  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      try {
        const response = await getWhatsappSession();
        // Merged for the same reason `start` merges: a partial reply must never be able to unlock
        // the application by omission.
        if (!cancelled && response?.data) setSession((current) => ({ ...(current || {}), ...response.data }));
      } catch {
        // Not an answer. The last reading stands rather than the gate opening on a hiccup.
      }
    };
    void read();
    const timer = window.setInterval(read, QR_REFRESH_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  // One tick a second, and only while the button is actually waiting.
  useEffect(() => {
    if (blockedUntil <= now) return undefined;
    const timer = window.setTimeout(() => setNow(Date.now()), 1000);
    return () => window.clearTimeout(timer);
  }, [blockedUntil, now]);

  /*
   * Ask for a code when the gate turns out to apply, and again if the pairing lapses.
   *
   * The reader has nowhere else to go, so making them press Connect first is a step that exists only
   * to be got through.
   *
   * **Not while one is already being produced.** A session that is pairing is rotating codes and the
   * poll above collects them without spending a pairing attempt on any of them; that guard is what
   * stops a merged reply - a new object every poll - from spending the whole budget in a second.
   *
   * ── Why it is no longer once per visit ──
   *
   * It was, and that left the reader looking at an empty square with no way out. WhatsApp stops
   * issuing codes after a few minutes unscanned; the socket closes; and because nothing has been
   * paired yet there is nothing to reconnect, so `handleClose` clears the code and stops. The poll
   * duly reported a session with no code, the square fell back to "Not linked", and the one thing
   * that would have asked for another was a ref that had already been spent and was never reset.
   * The dialog has no ×, no Escape and no backdrop - so somebody whose code lapsed was left holding
   * a locked application and a blank box.
   *
   * Re-arming on the lapse is what makes the gate self-healing. `askedRef` still does its real job -
   * one request per lapse rather than one per poll - and `start` refuses anything inside the
   * cooldown, so the worst this can do is ask once every `PAIRING_COOLDOWN_MS`.
   */
  useEffect(() => {
    if (!session || session.linkRequired !== true) return;
    if (!whatsappLinkNeeded(session)) return;
    // Producing codes, or done: nothing to ask for, and the next lapse should ask again.
    if (session.status === "pairing" || session.status === "connected") {
      askedRef.current = false;
      return;
    }
    // Still waiting on the request already made - the reply has not landed yet.
    if (askedRef.current || starting) return;
    askedRef.current = true;
    void start();
  }, [session, start, starting]);

  /*
   * `linkRequired` is the server's answer for *this* account: false for an administrator, false for
   * an account somebody has released, true for everybody else. `!== true` rather than falsy, so the
   * first render - before any answer has arrived - lets the application through rather than holding
   * it on a value nobody has supplied yet.
   */
  if (session?.linkRequired !== true) return null;
  if (!whatsappLinkNeeded(session)) return null;

  // Whole seconds left before another pairing request is allowed, for the button below.
  const waiting = Math.max(0, Math.ceil((blockedUntil - now) / 1000));

  return <Dialog
    // No `onClose`. That is what makes this a condition rather than a notice: Escape does nothing,
    // the backdrop does nothing, and `Dialog` draws its × only where a caller passes one.
    title="Link your WhatsApp to continue"
    // The narrowest card there is: the body is one square, and a wider dialog is a band of empty
    // card either side of it.
    size="xs"
    /*
     * Refresh code, and an honest wait on it. Nothing counts pairing attempts on the server, so this
     * pause is the whole of the pacing - and nothing is lost by waiting, because the code on screen
     * is still the current one and the poll behind this collects rotations without asking to pair.
     */
    footer={<Button className="max-sm:flex-1" type="button" variant="primary" onClick={() => void start()} disabled={starting || waiting > 0}>
      {starting ? "Preparing code..." : waiting > 0 ? `Refresh code in ${waiting}s` : "Refresh code"}
    </Button>}
  >
    {/* The full width of the card, so there is no gap down either side of the code, and square, so
        it never grows past the screen on a phone. The code and the line that stands in for it share
        one frame, so nothing moves as WhatsApp rotates it. */}
    <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white p-2">
      {session.qr ? (
        // A data URL generated per pairing attempt and thrown away seconds later, so there is
        // nothing for next/image to optimise or cache.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={session.qr} alt="WhatsApp pairing code" className="h-full w-full object-contain" />
      ) : (
        <span className="px-3 text-center text-xs text-slate-500">
          {starting || session.status === "pairing" ? "Preparing your code..." : "Not linked"}
        </span>
      )}
    </div>
    {(error || session.error) && (
      <p role="alert" className="mt-3 text-xs leading-5 text-red-600">{error || session.error}</p>
    )}
  </Dialog>;
}
