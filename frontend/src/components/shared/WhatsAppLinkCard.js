"use client";

import Button from "@/components/shared/Button";

/**
 * "Link your WhatsApp" — the QR, the instructions, and the button that asks for a code.
 *
 * The WhatsApp session is per **user**: credentials are stored per user id and everything sent goes out
 * from that person's own paired phone. So every screen that sends has to be able to offer the pairing
 * code, and this was written into the CRM's lead popup alone — an HR user working the interview register
 * was told they were not linked and given nowhere to link.
 *
 * ── It never pairs itself ──
 *
 * Pairing is **deliberately not rate limited** on the server: the limit used to be met by the very people
 * it was not aimed at — somebody pressing Refresh code while trying to link — so it was taken off. Which
 * means each caller brings its own pacing, and each request is a real registration against a WhatsApp
 * number that WhatsApp will refuse codes to, and can ban, for registering repeatedly. This card asks for
 * a code only when a person presses the button. Nothing here runs on mount.
 */
export default function WhatsAppLinkCard({ session, connecting = false, onConnect, note }) {
  const status = session?.status || "disconnected";

  return <div className="flex h-full min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
    <section className="flex h-full max-h-[24rem] w-full max-w-[17rem] flex-col items-center overflow-hidden rounded-xl border border-slate-200 bg-white p-4 text-center">
      <h4 className="shrink-0 text-sm font-semibold text-slate-700">Link your WhatsApp</h4>
      <p className="mt-1 shrink-0 text-xs leading-4 text-slate-500">
        On your phone: <span className="font-medium text-slate-600">WhatsApp → Settings → Linked devices</span>,
        then scan this code.
      </p>

      {/* Square, and sized by what is left rather than by a number, so the card never grows past the
          space it is in. The code and the line that stands in for it share the same frame, so nothing
          moves as WhatsApp rotates it. */}
      <div className="mt-3 flex aspect-square min-h-0 w-auto max-w-full flex-1 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white p-1.5">
        {session?.qr ? (
          // A QR is a data URL generated per pairing attempt and thrown away seconds later, so there is
          // nothing for next/image to optimise or cache.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={session.qr} alt="WhatsApp pairing code" className="h-full w-full object-contain" />
        ) : (
          <span className="px-2 text-xs text-slate-500">
            {status === "pairing" ? "Preparing your code..." : "Not linked"}
          </span>
        )}
      </div>

      {/* What will and will not appear once linked, which differs by screen: the CRM shows lead threads,
          the interview register shows the candidate in front of you. */}
      {note && <p className="mt-2 shrink-0 text-[11px] leading-4 text-slate-400">{note}</p>}
      {session?.error && (
        <p role="alert" className="mt-2 shrink-0 text-xs leading-4 text-red-600">{session.error}</p>
      )}
      <Button type="button" variant="primary" className="mt-3 w-full shrink-0" onClick={() => void onConnect?.()} disabled={connecting}>
        {connecting ? "Starting..." : status === "pairing" ? "Refresh code" : "Connect WhatsApp"}
      </Button>
    </section>
  </div>;
}
