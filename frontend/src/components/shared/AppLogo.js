"use client";

import { useState } from "react";
import BrandFallbackLogo, { FALLBACK_LOGO_ALT } from "./BrandFallbackLogo";
import useStudioBranding from "./useStudioBranding";
import useDocumentTheme from "./useDocumentTheme";
import { logoFor, themeWantsDarkMark } from "@/lib/studioBranding.mjs";

/**
 * The one component that shows the studio's mark, wherever the application shows one.
 *
 * There is a single rule behind every surface — the sign-in page, the app bar, the client's
 * selection gallery, a quotation on screen and in the PDF printed from it, and the CRD document:
 *
 *     the Global Logo from Settings, if one is configured → otherwise the bundled mark
 *
 * Settings holds a light-mode and a dark-mode Global Logo, and **a surface is given the dark one
 * only if it asks** - `themed`, below. That is deliberate and it is the whole safety of the pair:
 * the appearance picker paints the *application* dark (`globals.css` scopes every dark rule to
 * `.app-shell`, `.app-topbar`, `.crm-page` and the sidebar), while the sign-in page, the public
 * onboarding and interview forms, the client's selection gallery, the album proofing room, the AI
 * Feature guest pages and the client's quotation are white whatever the viewer's theme is. Driving
 * the choice off `data-theme` alone would put a dark mark on every one of those the moment a
 * *member of staff* with Dark Mode selected opened one - including the quotation that is printed
 * to PDF for the client. So the top bar asks, and nothing else does.
 *
 * Either mark still stands in for the other when only one is uploaded, on every surface: a studio
 * that has uploaded only a dark mark shows it rather than the bundled one.
 *
 * and the bundled mark is never removed. It is the permanent default branding, so there is no
 * state in which a surface shows a broken image or an empty space where the logo goes: an
 * unconfigured logo falls back to it, and so does a configured one whose file fails to load
 * (`onError` below), which is what a moved or deleted upload would otherwise leave behind.
 *
 * Nothing here decides *what* the logo is — `useStudioBranding` reads that once for the whole page
 * from the public branding endpoint, so every mark on a screen is the same mark, and Settings →
 * Global Logo reaches all of them the moment it saves.
 *
 * `src` is the one override, and exists for the published client gallery: a gallery carries the
 * branding it was published with on its own token payload, so it names the logo rather than
 * reading it back. An override that is empty falls through to Settings exactly as if it had not
 * been given, so a gallery published before the setting existed still shows the studio's logo.
 */

/*
 * How tall the mark is in each module, and how wide it may get.
 *
 * The height is stated and fixed, because that is what makes a logo look the same size from one
 * screen to the next whatever shape it is: a round badge and a wide wordmark are both exactly 40px
 * tall in the app bar, 64px at the head of a quotation. Sizing by width instead is what made a
 * square upload a 40px sliver where a wordmark had been.
 *
 * The width is a *limit*, not a reservation. A fixed width padded a narrow logo with dead space —
 * a round mark floating a hundred pixels from the Global Name beside it — so the element is only
 * as wide as the logo actually needs at that height, and never wider than the cap, which is what
 * keeps a long wordmark from crowding whatever sits next to it. Each cap is also held under the
 * width of the surface itself, so a fixed number can never push a phone screen sideways.
 *
 * Whatever the two work out to, the mark is *contained*: scaled to fit, its own proportions kept,
 * centred, never stretched and never cropped.
 */
export const LOGO_VARIANTS = {
  default: { height: 44, maxWidth: 160 },
  // The top bar is `h-12` (48px), so 40 is the tallest a mark can be there and still sit clear of
  // its edges. 160 is what is left beside the menu button and the account controls on a 360px
  // phone, and it is about the width the bundled wordmark wants at this height anyway.
  navbar: { height: 40, maxWidth: 160 },
  // The same bar on a phone narrower than 400px, where the full-size mark pushed the calendar, the
  // account and the bell off the right edge.
  navbarCompact: { height: 30, maxWidth: 104 },
  // Sign-in, above the form: the largest the mark is ever shown. The column is 420px at its widest
  // and 328px on a 360px screen, so 260 fits with room around it.
  login: { height: 96, maxWidth: 260 },
  // The public onboarding form, above its title. Deliberately not `login`'s box: a 96px-tall box
  // letterboxes the bundled wordmark (300×65) by 20px top and bottom, so the space under the mark
  // depended on the shape of the logo — 36px under the wordmark, 16px under a square upload. At
  // 56×240 the wordmark all but fills its box, so the gap under the mark is the same whatever the
  // studio has configured.
  onboarding: { height: 56, maxWidth: 240 },
  // The expired-link card, above its hourglass: a shade under onboarding's, so the mark leads the
  // card without outweighing the message, and it fits a 360px phone's card with room either side.
  expiredLink: { height: 48, maxWidth: 210 },
  // The same card on a phone, below `sm`: the bundled wordmark at about 165px wide.
  expiredLinkMobile: { height: 38, maxWidth: 170 },
  // The client's selection gallery: its 248px sidebar and folder grid, its mobile bar, and the
  // badge at the foot of the welcome screen.
  clientSelection: { height: 56, maxWidth: 144 },
  clientSelectionMobile: { height: 40, maxWidth: 112 },
  clientSelectionBadge: { height: 80, maxWidth: 176 },
  // The client's album proofing room: the mark at the head of its 270px sidebar, which has 222px
  // of content width to give it. Larger than the selection gallery's because that mark shares its
  // sidebar with a folder tree, and this one has the head of the column to itself.
  albumProof: { height: 72, maxWidth: 200 },
  // The head of a quotation, on screen and in the PDF printed from it.
  quotation: { height: 64, maxWidth: 240 },
  // The client's copy of a quotation opens on the mark alone, above the brand's name, at the size
  // the reference design gives it - the largest the mark is shown anywhere.
  quotationCover: { height: 120, maxWidth: 400 },
  // A document header that sits in a row beside other things rather than owning the width.
  document: { height: 40, maxWidth: 160 },
  // The same header on a phone, where the title beside it needs the width more than the mark does.
  documentCompact: { height: 28, maxWidth: 104 },
  // The CRD form's header band, whose slot is 256px wide.
  crd: { height: 68, maxWidth: 240 },
  // Anything printed: a shade smaller than the screen header, because paper has less room.
  print: { height: 48, maxWidth: 200 },
};

/*
 * Never stretched, never cropped, always centred.
 *
 * The height and the cap are given as inline styles rather than as `h-*`/`max-w-*` classes: two
 * Tailwind utilities of the same property are settled by the order they sit in the stylesheet, not
 * by the order they are written, and a `max-w-full` guard silently beat a variant's own cap — the
 * mark then ran to the full width of the column it was in. One declaration each, and nothing to
 * lose to.
 */
const BASE_CLASS = "block w-auto object-contain object-center";

/**
 * @param variant  which surface this is, and so which box the mark is given — see `LOGO_VARIANTS`.
 * @param src      an explicit logo, for a surface that carries its own branding (the client
 *                 gallery). Empty falls back to Settings.
 * @param className  anything *other* than size — placement, opacity, `lg:hidden`. The height and
 *                 the width cap belong to the variant, so one module's mark cannot quietly differ
 *                 from another's.
 */
/**
 * @param themed  whether this surface actually turns dark with the appearance picker, and so may
 *                be given the dark-mode Global Logo. Only the app bar passes it - see above.
 * @param surface "dark" for a surface that is dark whatever the appearance picker says - the
 *                guest landing page's mark over an event photograph - and so takes the dark-mode
 *                Global Logo outright, with the same fallbacks `logoFor` gives the app bar.
 */
export default function AppLogo({ variant = "default", src = "", alt = "", className = "", priority = false, themed = false, surface = "light" }) {
  const branding = useStudioBranding();
  // Read unconditionally - a hook cannot be called behind a condition - and used only where the
  // surface has said it goes dark.
  const theme = useDocumentTheme();
  const dark = surface === "dark" || (themed && themeWantsDarkMark(theme));
  const mark = logoFor(branding, dark);
  /*
   * `studio-logo-own-dark` marks an upload made *for* the dark theme, and `globals.css` leaves it
   * alone. The top bar inverts an uploaded logo on its dark bar, which is the right guess for a
   * light mark it has borrowed and the wrong thing to do to a mark drawn for that bar.
   */
  const ownDark = !src && dark && mark.ownMark;
  return <LogoImage
    variant={variant}
    src={src || mark.src}
    alt={alt || branding?.studioName || FALLBACK_LOGO_ALT}
    className={`${ownDark ? "studio-logo-own-dark " : ""}${className}`}
    priority={priority}
    darkFallback={surface === "dark"}
  />;
}

/**
 * The mark on a document that has already been issued - a quotation, a CRD document - shown as it
 * was issued, not as Settings stands today.
 *
 * `src` is the logo the document's own record carries (`logoUrl`, copied from Settings when the
 * row was created and never updated - see `backend/src/services/documentBranding.js`). This
 * component never reads the live branding, on purpose: a document rendered against today's
 * Settings would silently rebrand every quotation ever sent the day the logo changes. A record
 * older than the snapshot carries nothing and shows the bundled default mark - the same mark it
 * would have shown then, and never whichever logo happens to be configured now.
 */
export function DocumentLogo({ variant = "document", src = "", alt = "", className = "", priority = false }) {
  return <LogoImage variant={variant} src={src || ""} alt={alt || FALLBACK_LOGO_ALT} className={className} priority={priority} />;
}

/** The rendering both of the above share; it takes the source as given and decides nothing. */
function LogoImage({ variant, src, alt, className, priority, darkFallback = false }) {
  // The last source that failed to load. Compared by value, so a logo saved in Settings while the
  // page is open is tried afresh rather than being written off by the failure before it.
  const [brokenSrc, setBrokenSrc] = useState("");

  const box = LOGO_VARIANTS[variant] || LOGO_VARIANTS.default;
  /*
   * The cap is a plain length, and `100%` is left out of it on purpose.
   *
   * It used to read `min(<cap>px, 100%)` — the variant's limit or the surface's width, whichever
   * was smaller. It painted correctly and measured wrong: a percentage max-width is ignored while
   * a browser works out how much room an element *asks* for, so the surface reserved the mark's
   * uncapped width and the cap only applied afterwards. A wide wordmark — 300×65 at 40px tall
   * wants 185px, capped to 160 — left 25px of empty box behind it, which read on the top bar as a
   * hole between the logo and the Global Name that no spacing class accounted for.
   *
   * A length is honoured in both passes, so the surface reserves exactly what the mark is drawn
   * at. Every variant's box is already narrower than the surface it is given (see each note in
   * `LOGO_VARIANTS`, sized against its own column at 360px), so nothing is left unguarded by
   * dropping the percentage: `object-contain` still fits the mark inside the box without
   * stretching or cropping it, whatever shape it is.
   */
  const style = { height: `${box.height}px`, maxWidth: `${box.maxWidth}px` };
  const sizing = `${BASE_CLASS} ${className}`;
  const source = src;
  const label = alt;

  // No logo to show, or one that would not load: the bundled mark stands there at the same height
  // instead. Never a gap, never a broken image.
  if (!source || source === brokenSrc) return <BrandFallbackLogo alt={label} style={style} className={sizing} dark={darkFallback} />;

  /*
   * A plain <img>, not next/image.
   *
   * The configured logo is whatever Settings holds — an upload on the studio's own bucket — which
   * is neither a build-time import nor a host next/image has a loader configured for, and half of
   * these surfaces are public pages served without the optimiser. PNG, JPG, JPEG, WebP, AVIF, GIF
   * and SVG all render here exactly as the browser reads them.
   */
  // eslint-disable-next-line @next/next/no-img-element
  return <img
    src={source}
    alt={label}
    height={box.height}
    style={style}
    fetchPriority={priority ? "high" : undefined}
    onError={() => setBrokenSrc(source)}
    className={sizing}
  />;
}
