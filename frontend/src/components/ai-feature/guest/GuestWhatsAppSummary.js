"use client";
import { useState } from "react";
import WhatsApp from "@mui/icons-material/WhatsApp";
import Button from "@/components/shared/Button";
import Dialog from "@/components/ui/Dialog";
import { consentGuestWhatsApp, stopGuestWhatsAppSummary } from "@/services/ai-feature/ai-feature-public.service";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "./guestActions";

/**
 * The guest's WhatsApp photo-match message: a line on My Photos saying whether it is on, and Turn on
 * / Turn off. Turning it on is the guest's own consent for the number they joined with - no code
 * (the owner's decision, 2026-10-29): the join card's box asks for it at the door, and Turn on asks
 * here. Nothing is ever switched on without the guest pressing one of them. Turning it off is one
 * press and takes effect at once.
 *
 * `startOpen` opens the Turn on step straight away - the join card's box could not be honoured (the
 * server refused it), so the guest is asked once more here. `showBar` draws the status line.
 */
/** The one way the page says how often: the same words on the join card, here and in the studio's setting. */
const HOW_OFTEN = "one WhatsApp message when new photos of you are found, never one per photo";

export default function GuestWhatsAppSummary({ code, session, guest, onGuestChange, notify, onError, showBar = true, startOpen = false }) {
  const summary = guest?.whatsappSummary || { on: false, phone: null, joinedPhone: null };
  const [open, setOpen] = useState(startOpen && !summary.on);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function close() {
    if (busy) return;
    setOpen(false); setError("");
  }

  async function turnOn() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await consentGuestWhatsApp(code, session);
      onGuestChange(response.data);
      setOpen(false);
      notify?.("WhatsApp messages are on.", "success");
    } catch (failure) { onError?.(failure); setError(failure.message || "We couldn't turn it on. Please try again."); }
    finally { setBusy(false); }
  }

  async function stop() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await stopGuestWhatsAppSummary(code, session);
      onGuestChange(response.data);
      notify?.("WhatsApp messages turned off. You can turn them back on any time.", "success");
    } catch (failure) { onError?.(failure); notify?.(failure.message || "We couldn't turn it off. Please try again.", "error"); }
    finally { setBusy(false); }
  }

  return <>
    {showBar && <section aria-label="WhatsApp photo messages" className="mb-4 flex flex-col gap-3 rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200/70 sm:flex-row sm:items-center sm:justify-between md:mb-5 md:px-5">
      <div className="flex min-w-0 items-start gap-3">
        <WhatsApp className="mt-0.5 shrink-0 text-[#25D366]" style={{ fontSize: 22 }} aria-hidden="true" />
        <p className="min-w-0 text-sm leading-6 text-slate-700">
          {summary.on
            ? <>WhatsApp messages are on for <span className="font-semibold text-slate-900">{summary.phone}</span>: {HOW_OFTEN}.</>
            : `Get your photos on WhatsApp: ${HOW_OFTEN}.`}
        </p>
      </div>
      {summary.on
        ? <Button type="button" variant="plain" size="none" busy={busy} busyLabel="Turning off..." onClick={stop} className={`${SECONDARY_BUTTON} w-full shrink-0 sm:w-auto`}>Turn off</Button>
        : <Button type="button" variant="plain" size="none" onClick={() => { setError(""); setOpen(true); }} className={`${PRIMARY_BUTTON} w-full shrink-0 sm:w-auto`}>Turn on</Button>}
    </section>}

    {open && <Dialog title="Get your photos on WhatsApp" onClose={close} busy={busy}
      footer={<>
        <Button type="button" variant="plain" size="none" onClick={close} disabled={busy} className={SECONDARY_BUTTON}>Not now</Button>
        <Button type="button" variant="plain" size="none" busy={busy} busyLabel="Turning on..." onClick={turnOn} className={PRIMARY_BUTTON}>Turn on</Button>
      </>}>
      <div className="space-y-3 text-sm leading-6 text-slate-700">
        <p>We&apos;ll send you {HOW_OFTEN}, with your gallery link. You can turn it off at any time.</p>
        <p>We&apos;ll send it to {summary.joinedPhone ? <span className="font-semibold text-slate-900">{summary.joinedPhone}</span> : "the mobile number you joined with"}.</p>
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      </div>
    </Dialog>}
  </>;
}
