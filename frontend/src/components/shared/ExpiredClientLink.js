"use client";

import AppLogo from "@/components/shared/AppLogo";
import { useDeviceViewport } from "@/components/shared/DeviceViewport";
import useStudioBranding from "@/components/shared/useStudioBranding";
import { brandNameInProse } from "@/lib/studioBranding.mjs";

/**
 * The one page a client sees when their link has expired - whichever kind of link it was.
 *
 * It says the link has expired and whom to ask for a new one, and nothing else: not what the
 * link was for, whose it was, or when it lapsed. Every expired link - a quotation, a Photo
 * Selection gallery, a Signature Album, an album proof, an event gallery - reads exactly the same,
 * so the page tells whoever holds an old link nothing about what was behind it, and the server
 * sends nothing about it either (`backend/src/services/expiredLink.js`). Nothing behind the link is
 * shown or fetched, there is no redirect, and it answers the same on a refresh or an old bookmark,
 * because the server answers the same. The studio is named from Settings →
 * Branding, whose logo heads the card. There is no Contact button: the studio keeps no public
 * contact details, and a button that reaches no one would be worse than the sentence that says
 * whom to ask.
 *
 * Anything else passed on lands on the page's root - the quotation's `data-quotation-state`, which
 * its PDF renderer waits for.
 *
 * A quotation's pages declare a 1112px-wide viewport so the sheet scales to a phone like a PDF;
 * this card is laid out for the phone itself, so while it is up the viewport is the device's own
 * width, and it is put back as it was when the card goes. The page has already been drawn zoomed
 * out to a third by then, and a phone may keep that zoom across the change - the card then sits
 * small and far away in a wide empty page - so the switch first caps the scale at 1, which pulls
 * the zoom back to actual size, and a moment later lifts the cap so pinch-zoom works again
 * (`useDeviceViewport`, shared with the quotation's error screens).
 */

/*
 * An hourglass run out - all its sand in the lower bulb - with a small cross badge. Drawn rather
 * than an icon so it stays crisp at any size and costs no request; coral rather than an alarm red,
 * because a link that ran its course is not an error. Decorative: the heading says it in words.
 */
function ExpiredHourglass({ className = "" }) {
  return <svg viewBox="0 0 140 140" className={className} aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="expired-cap" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FB7185" /><stop offset="1" stopColor="#F05B67" /></linearGradient>
      <linearGradient id="expired-glass" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#FFFFFF" /><stop offset="1" stopColor="#F8FAFC" /></linearGradient>
      <linearGradient id="expired-sand" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FDA4AF" /><stop offset="1" stopColor="#FB7185" /></linearGradient>
    </defs>
    <circle cx="70" cy="68" r="60" fill="#FFF1F3" />
    <ellipse cx="70" cy="125" rx="36" ry="4" fill="#0F172A" opacity="0.06" />
    <path d="M47 30 C47 55 63 61 63 69 C63 77 47 83 47 108 L93 108 C93 83 77 77 77 69 C77 61 93 55 93 30 Z" fill="url(#expired-glass)" stroke="#E2E8F0" strokeWidth="2" strokeLinejoin="round" />
    <path d="M51 106 C55 93 63 88 70 88 C77 88 85 93 89 106 Z" fill="url(#expired-sand)" />
    <path d="M53 36 C54 50 60 56 64 60" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" opacity="0.9" />
    <rect x="38" y="20" width="64" height="11" rx="5.5" fill="url(#expired-cap)" />
    <rect x="38" y="107" width="64" height="11" rx="5.5" fill="url(#expired-cap)" />
    <circle cx="103" cy="99" r="15" fill="#F05B67" stroke="#FFFFFF" strokeWidth="4" />
    <path d="M97.5 93.5 L108.5 104.5 M108.5 93.5 L97.5 104.5" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" />
  </svg>;
}

export default function ExpiredClientLink(rest) {
  useDeviceViewport();
  const branding = useStudioBranding();
  const studio = brandNameInProse(branding);
  // A flat page and nothing else on it: the card is the whole message.
  return <main className="flex min-h-dvh items-center justify-center bg-[#F6F8FC] px-4 py-6 sm:py-12" {...rest}>
    <section aria-labelledby="expired-link-title" className="animate-expired-card-in w-full max-w-[430px] rounded-3xl border border-[#E5EAF2] bg-white px-6 py-8 text-center shadow-[0_20px_60px_rgba(15,23,42,0.08)] sm:max-w-[500px] sm:px-10 sm:py-11 lg:max-w-[540px] lg:px-11">
      {/* The mark at a phone's size and at a desktop's; only one is ever displayed. */}
      <div className="flex justify-center sm:hidden"><AppLogo variant="expiredLinkMobile" /></div>
      <div className="hidden justify-center sm:flex"><AppLogo variant="expiredLink" /></div>
      <ExpiredHourglass className="mx-auto mt-6 h-[118px] w-[118px] sm:mt-7 sm:h-[136px] sm:w-[136px]" />
      <h1 id="expired-link-title" className="mt-5 text-[25px] font-bold leading-tight tracking-tight text-[#0F172A] sm:text-[32px] sm:font-extrabold">This link has expired</h1>
      <p className="mt-2 text-[15px] text-[#64748B] sm:text-base">This link is no longer active.</p>
      <p className="mx-auto mt-6 max-w-[380px] text-sm leading-6 text-[#64748B]">Please contact <span className="font-semibold text-slate-700">{studio}</span> to request a new link.</p>
    </section>
  </main>;
}
