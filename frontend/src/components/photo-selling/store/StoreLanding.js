"use client";

import GuestLanding from "@/components/ai-feature/guest/GuestLanding";
import { formatMoney } from "@/lib/photoSelling.mjs";

/**
 * The store's login: the AI Feature's guest login page (GuestLanding - the cover behind everything,
 * the studio's mark, the gallery's identity and the glass join card), asking every guest their name
 * and WhatsApp number, and the PIN when the studio set one. No code is sent. Where the gallery sends
 * WhatsApp photo-match messages, an unticked box asks to be told when new photos of them are found.
 * The selfie comes only after this, on its own page (StoreSelfieSearch); the gallery's photos are
 * never shown here. The store remembers this device afterwards.
 *
 * `onEnter` opens the store session and throws what the server said; the card shows it.
 */
const COPY = {
  title: "Log in to find your photos",
  subtitle: "Then take a selfie and see only the photos you're in.",
  phoneLabel: "WhatsApp number",
  phoneHelper: "Used to recognise you when you come back.",
  whatsappLabel: "Send me a WhatsApp when new photos of me are found",
  whatsappNote: "One message when the photographer uploads more photos of you, with your gallery link. To find them, the face from your selfie is kept until you stop the messages.",
  submitLabel: "Log in",
  busyLabel: "Logging in...",
  failure: "We couldn't open the gallery. Please try again.",
};

/** The store's answers in the shape the join card reads: name and number always, the PIN where set. */
const loginMeta = (meta) => ({
  event: { name: meta.title, startDate: meta.eventDate, location: meta.venue, description: meta.description, coverUrl: meta.coverUrl },
  guestAccess: { requireName: true, requirePhone: true, allowRegistration: true },
  requiresPin: Boolean(meta.requirePin),
  features: { whatsappSummary: Boolean(meta.whatsapp?.offered), selfieSearch: true },
});

export default function StoreLanding({ meta, onEnter }) {
  async function join({ name, phone, pin }, { whatsappSummary }) {
    try { await onEnter({ name, phone, pin, whatsappConsent: whatsappSummary }); }
    catch (caught) {
      // The store answers a wrong PIN with 401; the card files a PIN error under the PIN by 403.
      if (/pin/i.test(caught?.message || "")) caught.status = 403;
      throw caught;
    }
    return null;
  }

  return <GuestLanding meta={loginMeta(meta)} onJoin={join} joinCopy={COPY}>
    <div className="mt-5 flex flex-wrap justify-center gap-2 text-xs text-white">
      <span className="rounded-full border border-white/20 bg-black/30 px-3 py-1 backdrop-blur">From {formatMoney(meta.pricePaise, meta.currency)} a photo</span>
      {meta.packages.slice(0, 2).map((pack) => <span key={pack.id} className="rounded-full border border-white/20 bg-black/30 px-3 py-1 backdrop-blur">{pack.photoCount} for {formatMoney(pack.pricePaise, meta.currency)}</span>)}
    </div>
    <p className="mt-4 text-center text-xs leading-5 text-white/85 [text-shadow:0_1px_2px_rgba(0,0,0,0.5)]">Previews carry a watermark. You buy the original photo - full quality, without the watermark - and can download it as soon as your payment is confirmed.</p>
  </GuestLanding>;
}
