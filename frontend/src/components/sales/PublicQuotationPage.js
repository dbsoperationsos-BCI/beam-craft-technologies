"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import DownloadRounded from "@mui/icons-material/DownloadRounded";
import ScheduleRounded from "@mui/icons-material/ScheduleRounded";
import LocalOfferOutlined from "@mui/icons-material/LocalOfferOutlined";
import LoyaltyOutlined from "@mui/icons-material/LoyaltyOutlined";
import { durationForSessionTiming, shootTimingsOf, shootTypesOf } from "@/components/project-management/AddShootDialog";
import ExpiredClientLink from "@/components/shared/ExpiredClientLink";
import DeviceViewport from "@/components/shared/DeviceViewport";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import { expiredLinkFrom, linkTimeLeft } from "@/lib/expiredLink.mjs";
import { eventCount, eventTypeNames, mainEventTypeSummary } from "@/lib/quotationEventTypes.mjs";
import { shootDisplayName } from "@/lib/shootDisplay.mjs";
import { DocumentLogo } from "@/components/shared/AppLogo";
import InfrastructureImageGrid from "@/components/shared/InfrastructureImageGrid";
import useStudioBranding from "@/components/shared/useStudioBranding";
import { getPublicQuotation, publicQuotationPdfUrl } from "@/services/sales/public-quotation.service";
import { displayUrl, hrefFor, templateContentFor } from "./quotationTemplateContent";
import { quotationDiscountBreakdown } from "@/lib/quotationBrand.mjs";
import { Eyebrow, GOLD, GOLD_DEEP } from "./quotationSheetParts";
import { QuotationPricingCard, UpdatedTotalCard } from "./QuotationPricingCards";
import QuotationExtraSection from "./QuotationExtraSection";

/*
 * The client's copy of a quotation, at `/q/<token>`.
 *
 * This page is the whole template: the PDF is produced by rendering this same URL in headless
 * Chrome as one sheet the length of the document, so there is one layout and it cannot drift
 * between what a client reads in a browser and what they are sent as a file. `?print=1` is what
 * the renderer adds - it hides the download button and drops the page's outer surround.
 *
 * The design is the studio's reference proposal: a cover photograph, the brand's mark and name, a
 * navy proposal card, one card per event with its services and deliverables, the navy pricing
 * card, the notes, the trademark card, the Journey & Legacy timeline over the India map, the
 * infrastructure collage per branch, and a closing photograph over which the studio signs off.
 * Every word, picture, name, website and phone number on it is the brand's, the studio's or the
 * branch's - resolved once when the version was raised and frozen with it - and the template
 * itself is one for every brand.
 */

export { GOLD, GOLD_DEEP, Eyebrow };
export const INK = "#1c1c1c";
const NAVY_TOP = "#0d1624";
const NAVY_BOTTOM = "#0a121e";
const TEAL = "#004246";

/**
 * One of the palette's own colours at partial strength.
 *
 * Written from the constant rather than as a second hex, so a tint of the gold cannot end up being
 * a tint of something that used to be the gold.
 */
const withAlpha = (hex, alpha) => `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, ${alpha})`;

/** The ground the sheet is printed on, shared with the Terms & Conditions page. */
export const sheetBackground = "linear-gradient(180deg, #faf7ef 0%, #f8f3ea 60%, #faf7ef 100%)";

/**
 * The sheet's running text: the design's face, then Tamil (`--q-font-tamil-sans`, set by the
 * quotation's layout in `app/q/quotationFonts.js`), then the system's. Shared with the Terms &
 * Conditions and payment pages, which are the same sheet.
 */
export const QUOTATION_BODY_FONT = "var(--q-font-body), var(--q-font-tamil-sans), 'Plus Jakarta Sans', 'Helvetica Neue', Arial, sans-serif";

/*
 * The sheet's own stylesheet: the five faces the design is set in, the two card grounds, and what
 * changes when it is printed. Exported because the Terms & Conditions page at `/q/<token>/terms` is
 * the same sheet and must not describe any of it a second time.
 */
export const SHEET_CSS = `
      .q-display { font-family: var(--q-font-display), var(--q-font-tamil-serif), 'Cormorant Garamond', Georgia, 'Times New Roman', serif; }
      .q-script { font-family: var(--q-font-script), var(--q-font-tamil-serif), 'Great Vibes', 'Brush Script MT', cursive; }
      .q-condensed { font-family: var(--q-font-condensed), var(--q-font-tamil-sans), Oswald, 'Arial Narrow', sans-serif; }
      .q-footer { font-family: var(--q-font-footer), var(--q-font-tamil-sans), Poppins, 'Segoe UI', Arial, sans-serif; }
      .q-mono { font-family: 'Courier New', Courier, monospace; letter-spacing: 0; }
      .q-label { letter-spacing: .28em; text-transform: uppercase; }
      .q-card { background: linear-gradient(180deg, rgba(255,255,255,0.72), rgba(252,249,245,0.9)); box-shadow: 0 1px 2px rgba(28,28,28,0.03), 0 18px 40px -30px rgba(28,28,28,0.25); }
      .q-navy { background: linear-gradient(180deg, ${NAVY_TOP}, ${NAVY_BOTTOM}); box-shadow: 0 24px 40px -28px rgba(10,18,30,0.7); }
      /*
       * The download control, in the sheet's own gold rather than an application blue: it is drawn
       * over the client's copy, so it is the one thing on screen that has to belong to the document
       * instead of to the software. Gold is what every heading rule, eyebrow and small icon on the
       * proposal is drawn in, and it carries over both grounds it passes - the cream sheet and the
       * navy cards, where the sheet already sets gold type on navy.
       */
      .q-download { background-color: ${withAlpha(GOLD, 0.18)}; color: ${GOLD}; box-shadow: inset 0 0 0 1px ${withAlpha(GOLD, 0.45)}; }
      .q-download:hover { background-color: ${withAlpha(GOLD, 0.3)}; color: ${GOLD_DEEP}; box-shadow: inset 0 0 0 1px ${withAlpha(GOLD, 0.65)}; }
      .q-download:focus-visible { outline: 2px solid ${GOLD}; outline-offset: 2px; }
      @media print {
        .no-print { display: none !important; }
        .q-sheet { box-shadow: none !important; margin: 0 !important; }
        .q-card, .q-inner, .q-event { break-inside: avoid; }
      }
    `;

/*
 * How much the browser has shrunk the page to fit the screen: 1 on a laptop, about 0.32 on a 360px
 * phone, and whatever a pinch has made it.
 *
 * The sheet is handed to the browser at its own 1080px width and scaled to fit (see the route's
 * `viewport`), so *everything* on the page is drawn at that factor - which is right for the
 * document and wrong for a control somebody has to hit. Read as an external store rather than
 * copied into state, the way `useStudioBranding` is: state taken at the first render would leave
 * the server's answer and the browser's disagreeing, and setting it from an effect afterwards is
 * the cascading render the linter warns about. `visualViewport` is absent on the server and in
 * older browsers, and 1 is the honest answer for both - the page is simply not scaled there.
 */
const subscribeToPageScale = (onChange) => {
  const viewport = typeof window === "undefined" ? null : window.visualViewport;
  if (!viewport) return () => {};
  viewport.addEventListener("resize", onChange);
  return () => viewport.removeEventListener("resize", onChange);
};
const pageScale = () => (typeof window === "undefined" ? 1 : window.visualViewport?.scale || 1);
/*
 * Whether the screen itself is phone-sized. Not a media query: the route declares a 1112px viewport,
 * so on every phone the layout is 1112 wide and `sm:`/`md:` never fire. The visible width times the
 * scale is the screen's own width in unscaled CSS pixels, and it holds still through a pinch -
 * zooming in shrinks one as much as it grows the other - so the controls do not jump size mid-zoom.
 */
const PHONE_SCREEN_PX = 640;
const onPhone = () => {
  const viewport = typeof window === "undefined" ? null : window.visualViewport;
  return Boolean(viewport) && viewport.width * viewport.scale < PHONE_SCREEN_PX;
};

/**
 * Download, as an icon in the top-right corner that stays there while the quotation scrolls.
 *
 * It was a full-width row with a **Download PDF** button in it, which scrolled away with the cover
 * photograph and was gone for the rest of the document - a client who reached the price and wanted
 * the file had to scroll back to the top for it.
 *
 * Sized against the page scale rather than in plain pixels: at a third scale a 44px control is an
 * 14px one, and 44px - what it is - is about the smallest a finger reliably hits. Scaling by the
 * inverse keeps it that size to the eye on a phone, a tablet and a laptop alike, and the margin
 * inside the scaled wrapper means its distance from the corner holds too. `no-print` and the caller's `printMode`
 * both keep it out of the PDF, which is printed from this same page.
 *
 * On a phone it is a 42px disc with an 18px arrow, 10px off the corner: at a third scale the sheet's
 * own type is a few pixels tall, and the full-size control towered over the document beside it.
 */
function FloatingDownload({ onDownload }) {
  const scale = useSyncExternalStore(subscribeToPageScale, pageScale, () => 1);
  const phone = useSyncExternalStore(subscribeToPageScale, onPhone, () => false);

  return <div
    className="no-print fixed right-0 top-0 z-50"
    // Anchored to the corner it is pinned to, so growing the button cannot push it off the screen.
    style={{ transform: `scale(${1 / (scale || 1)})`, transformOrigin: "top right" }}
  >
    <button
      type="button"
      onClick={onDownload}
      // The only name it has: there is no label beside the icon to read it by.
      aria-label="Download this quotation as a PDF"
      title="Download PDF"
      /*
       * Soft rather than solid: this sits over the client's own proposal, and a strong blue disc
       * competed with the document it is only there to fetch. The fill is translucent so the page
       * shows faintly through it, with the arrow and a hairline ring carrying the colour instead -
       * enough to read as a control against the warm surround, the sheet's cream and the navy
       * pricing card it passes over. The blur behind the tint is what keeps it legible over the
       * photographs, where a flat wash would take on whatever happened to be underneath. Its colour
       * is the sheet's, in `SHEET_CSS` beside the grounds it has to sit on.
       */
      className={`q-download flex items-center justify-center rounded-full backdrop-blur-sm transition focus:outline-none ${phone ? "m-2.5" : "m-3 h-11 w-11"}`}
      // The arrow in the deeper gold, matching the expiry chip below it - the colour `.q-download`
      // already turns on hover, so hovering changes only the fill and ring. Inline, so the payment
      // page's button, which shares the class, keeps its own light gold.
      style={{ color: GOLD_DEEP, ...(phone ? { width: 42, height: 42 } : {}) }}
    >
      <DownloadRounded sx={{ fontSize: phone ? 18 : 20 }} />
    </button>
  </div>;
}

/**
 * How long this link still opens, in the bottom-right corner - clear of Download at the top right,
 * pinned and sized the same way (against the page scale, so it is the same size to the eye on a
 * phone and a laptop) and in the same gold. Two short lines, "Expires in 3d" over "22h 39m", so it
 * stays narrow - the time left to the minute, a unit left out where it is nought ("Expires in" over
 * "12h 45m" on the last day), running on its own, with no date. A small status chip rather than a
 * second button: lower and tighter than Download, which is the control.
 *
 * Read off the link's own expiry (`linkExpiresAt`), the date the server checks, and decides nothing:
 * a lapsed link never reaches this page - the server refuses it and the shared expired page is shown.
 * Kept out of the PDF (`no-print`, and the caller's `printMode`), which is a copy kept, not a link.
 *
 * On a phone it is one line instead ("Expires in 3d 5h 54m") in a slim pill 10px off the corner -
 * lower than the two-line chip, so it covers less of the sheet's closing sections. Same countdown,
 * same label; only the box changes.
 */
function FloatingExpiry({ expiresAt }) {
  const scale = useSyncExternalStore(subscribeToPageScale, pageScale, () => 1);
  const phone = useSyncExternalStore(subscribeToPageScale, onPhone, () => false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Twice a minute, so the minutes turn over on time without a refresh.
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const left = linkTimeLeft(expiresAt, now);
  if (!left) return null;
  const inset = phone ? 10 : 12;
  return <div
    className="no-print fixed bottom-0 right-0 z-50"
    // Anchored to the corner it is pinned to, so growing it against the page scale keeps it on screen.
    style={{ transform: `scale(${1 / (scale || 1)})`, transformOrigin: "bottom right" }}
  >
    <div
      role="status"
      aria-live="off"
      aria-label={left.label}
      className={`q-download flex backdrop-blur-sm ${phone ? "max-w-[190px] items-center gap-1 rounded-full pl-2 pr-2.5" : "items-start gap-1.5 rounded-xl py-1.5 pl-2 pr-2.5"}`}
      // The chip keeps Download's gold box, but its words and clock are the deeper gold: it is read,
      // not pressed, and the light gold on the gold tint was too faint to read at a glance. Inline, so
      // it wins over `.q-download`'s colour for this chip alone; the icon follows through `currentColor`.
      style={{ color: GOLD_DEEP, marginRight: `max(${inset}px, env(safe-area-inset-right))`, marginBottom: `max(${inset}px, env(safe-area-inset-bottom))`, ...(phone && { paddingBlock: 5 }) }}
    >
      {phone
        ? <>
          <ScheduleRounded aria-hidden="true" sx={{ fontSize: 13 }} />
          <span className="whitespace-nowrap text-[11px] font-semibold leading-none tabular-nums">{left.label}</span>
        </>
        : <>
          <ScheduleRounded aria-hidden="true" sx={{ fontSize: 14, mt: "1px" }} />
          <span className="flex flex-col gap-0.5 whitespace-nowrap leading-none tabular-nums">
            <span className="text-[11px] font-medium">{left.lead}</span>
            {left.rest && <span className="text-[12px] font-semibold">{left.rest}</span>}
          </span>
        </>}
    </div>
  </div>;
}

function currency(value) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function longDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date).toUpperCase();
}

/** "11/08/2026 | 16:00", the way the proposal card stamps when it was raised. */
function createdStamp(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return `${new Intl.DateTimeFormat("en-GB").format(date)} | ${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date)}`;
}

function rowsByShoot(rows = []) {
  return rows.reduce((result, row) => ({ ...result, [row.shootId]: [...(result[row.shootId] || []), row] }), {});
}

/** "5 Hours Duration" for an hourly shoot, "Half Session (4-5 Hours)" for a session one. */
function durationText(shoot) {
  const timings = shootTimingsOf(shoot);
  if (!timings.length) return "";
  const parts = [];
  if (timings.includes("Hourly")) {
    const { sessionDurationHours, sessionDurationMinutes } = durationForSessionTiming(timings, shoot?.sessionDurationHours, shoot?.sessionDurationMinutes);
    const hours = Number(sessionDurationHours || 0);
    const minutes = Number(sessionDurationMinutes || 0);
    const words = [hours ? `${hours} Hour${hours === 1 ? "" : "s"}` : "", minutes ? `${minutes} Minute${minutes === 1 ? "" : "s"}` : ""].filter(Boolean).join(" ");
    if (words) parts.push(`${words} Duration`);
  }
  if (timings.includes("Half Session")) parts.push("Half Session (4-5 Hours)");
  if (timings.includes("Full Session")) parts.push("Full Session (8-10 Hours)");
  return parts.join(" • ");
}

/** "District, State • 5 Hours Duration • Outdoor / On-Location", skipping what the shoot did not record. */
function shootMeta(shoot) {
  const place = [shoot.district, shoot.state].map((part) => String(part || "").trim()).filter(Boolean).join(", ") || String(shoot.shootPlace || "").trim();
  return [place, durationText(shoot), shootTypesOf(shoot).join(" / ")].filter(Boolean).join(" • ");
}

/**
 * "Accommodation & Food to be taken care by Client | Travel to be taken care by <brand>".
 *
 * Read off the shoot's three answers. "Studio" prints as the brand's name, because that is who the
 * studio is to the client reading it.
 */
function careLine(shoot, brandName) {
  const who = (value) => (String(value || "").toLowerCase() === "client" ? "Client" : brandName || "Studio");
  if (!shoot.foodTakenCareBy && !shoot.accommodation && !shoot.travel) return null;
  const food = who(shoot.foodTakenCareBy);
  const stay = who(shoot.accommodation);
  const travel = who(shoot.travel);
  const first = food === stay
    ? <><b>Accommodation</b> &amp; <b>Food</b> to be taken care by {food}</>
    : <><b>Accommodation</b> to be taken care by {stay} • <b>Food</b> to be taken care by {food}</>;
  return <>{first} <span className="mx-1 text-slate-400">|</span> <b>Travel</b> to be taken care by {travel}</>;
}

/* ── Small pieces of the design ─────────────────────────────────────────────────────────────── */

/** A serif heading with a short rule either side of it. */
export function RuledTitle({ children, size = "text-[34px]", className = "" }) {
  return <div className={`flex items-center justify-center gap-5 ${className}`}>
    <span aria-hidden="true" className="hidden h-px w-16 sm:block" style={{ background: `linear-gradient(90deg, transparent, ${GOLD})` }} />
    <h2 className={`q-display text-center ${size} font-medium leading-tight`} style={{ color: INK }}>{children}</h2>
    <span aria-hidden="true" className="hidden h-px w-16 sm:block" style={{ background: `linear-gradient(90deg, ${GOLD}, transparent)` }} />
  </div>;
}

/**
 * One cell of the proposal card's grid: the label in the card's small caps, and the value in the one
 * type every value shares - the Client Name's - so an ID, a number, a venue and the event read as
 * one set rather than four.
 */
function DetailCell({ label, value }) {
  return <div className="relative min-w-0 rounded-xl px-3.5 py-3" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
    <p className="q-label text-[10px] font-medium" style={{ color: "#8f9bb0" }}>{label}</p>
    <p className="mt-1 break-words text-[14px] font-semibold text-white">{value}</p>
  </div>;
}

/** The rows of one shoot's services or deliverables, with the quantity on the right. */
function LineList({ title, rows, nameOf }) {
  if (!rows.length) return null;
  return <div className="q-inner rounded-2xl px-5 py-5 sm:px-6" style={{ background: "#fffefc", boxShadow: "0 0 0 1px rgba(28,28,28,0.03), 0 8px 24px -18px rgba(28,28,28,0.25)" }}>
    <Eyebrow size="text-[13px]" className="tracking-[0.22em]">{title}</Eyebrow>
    <ul className="mt-2.5">
      {rows.map((row) => <li key={row.id || nameOf(row)} className="flex items-baseline justify-between gap-4 py-[6px] text-[16px] font-semibold leading-snug" style={{ color: "#262626" }}>
        <span className="min-w-0">
          {nameOf(row)}
          {Boolean(row.remarks) && <span className="block text-[12px] font-normal text-slate-500">{row.remarks}</span>}
        </span>
        <span className="shrink-0 text-[14px] font-semibold" style={{ color: "#262626" }}>{Number(row.quantity || 1)}</span>
      </li>)}
    </ul>
  </div>;
}

function BankIcon() {
  return <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 10h18L12 4 3 10z" /><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" /><path d="M3 20h18" />
    <path d="M16 13.5a2.5 2.5 0 0 1 5 0c0 2-2.5 3.5-2.5 3.5S16 15.5 16 13.5z" fill={GOLD} stroke="none" />
  </svg>;
}

function StorageIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M8 4v5" />
  </svg>;
}

/*
 * The discounts the quotation was saved with, on a card of their own between the events and the
 * price: the rupees it came to - never the percentage - then each extra discount by its reason. Read
 * from the saved quotation (`quotationDiscountBreakdown`) and never taken off again - the price
 * below is the saved total, which already has them taken off. Nothing at all when there are none,
 * so a quotation without a discount prints exactly as it did.
 */
function DiscountLine({ label, amount }) {
  return <div className="flex items-start justify-between gap-4 py-1.5">
    <span className="min-w-0 break-words">{label}</span>
    <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums">- {currency(amount)}</span>
  </div>;
}

function DiscountHeading({ icon: Icon, children }) {
  return <div className="flex items-center gap-2.5">
    <Icon style={{ fontSize: 20, color: GOLD }} aria-hidden="true" />
    <Eyebrow className="tracking-[0.24em]">{children}</Eyebrow>
  </div>;
}

function DiscountCard({ breakdown }) {
  if (!breakdown.any) return null;
  return <section className="mx-[18px] mt-6 sm:mx-[45px]">
    <div className="q-card rounded-2xl px-5 py-5 text-[14px] sm:px-8" style={{ color: "#3b3b3b" }}>
      {breakdown.discount && <div>
        <DiscountHeading icon={LocalOfferOutlined}>Discount</DiscountHeading>
        <div className="mt-2"><DiscountLine label="Discount" amount={breakdown.discount.amount} /></div>
      </div>}
      {breakdown.extras.length > 0 && <div className={breakdown.discount ? "mt-4 border-t pt-4" : ""} style={breakdown.discount ? { borderColor: withAlpha(GOLD, 0.25) } : undefined}>
        <DiscountHeading icon={LoyaltyOutlined}>Extra Discount</DiscountHeading>
        <div className="mt-2">{breakdown.extras.map((entry, index) => <DiscountLine key={index} label={entry.reason || "Extra Discount"} amount={entry.amount} />)}</div>
      </div>}
    </div>
  </section>;
}

function PhoneIcon() {
  return <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.9 2z" />
    <path d="M15 3a6 6 0 0 1 6 6M15 6.5a2.5 2.5 0 0 1 2.5 2.5" />
  </svg>;
}

/**
 * One branch's photographs, laid the way the reference lays them, and its name on the gold tag.
 *
 * The composition depends on how many photographs the branch has - `@/lib/infrastructureCollage.mjs`
 * decides it and `InfrastructureImageGrid` draws it, the same two the studio's preview in Settings
 * uses, so what is arranged there is what is printed here. A branch with eight prints the reference
 * mosaic; one with fewer prints a composition of its own rather than the mosaic with holes in it.
 * Every count stands the same height, so several branches down the page line up.
 */
function Collage({ group }) {
  const photos = (group.photos || []).filter(Boolean);
  if (!photos.length) return null;
  return <div className="relative mx-auto w-full max-w-[612px]">
    <span className="absolute -left-4 top-3 z-10 rounded-md px-3 py-1.5 sm:-left-36" style={{ background: "#d6b96a", boxShadow: "0 1px 2px rgba(0,0,0,0.12)" }}>
      <span className="q-footer text-[22px] font-semibold leading-none" style={{ color: TEAL }}>{group.title}</span>
      {Boolean(group.subtitle) && <span className="q-footer text-[15px] font-medium" style={{ color: TEAL }}>,{group.subtitle}</span>}
    </span>
    <InfrastructureImageGrid photos={photos} />
  </div>;
}

/*
 * `previewQuotation` is the studio's Preview (`/q/preview/<key>`): a quotation not yet generated,
 * handed in already loaded (`POST /api/sales/quotations/preview`) rather than fetched by a token it
 * does not have, and handed in again, newer, each time the generator's Preview is pressed. It prints the same sheet and nothing a link has - no Download, no expiry, and the
 * Terms & Conditions and payment labels as text, since there is no page behind them yet. A client's
 * link never passes it, so its Download and expiry are exactly as they were.
 */
export default function PublicQuotationPage({ token, previewQuotation = null }) {
  const preview = Boolean(previewQuotation);
  // A preview is whatever it was last handed - each Preview press in the generator hands it a newer
  // one - and a link is what it fetched.
  const [fetchedQuotation, setQuotation] = useState(null);
  const quotation = preview ? previewQuotation : fetchedQuotation;
  const [loading, setLoading] = useState(!preview);
  const [error, setError] = useState("");
  // A link that has run out is its own state, not a failure: the page says so plainly and tells the
  // client what to do about it, rather than showing them a red error box.
  // Whether the link has expired (`expiredLinkFrom`) - an empty marker - or null while it is live.
  const [expired, setExpired] = useState(null);
  // Read from the URL rather than held in state: the renderer appends `?print=1` before the page
  // loads and never changes it, so there is nothing to synchronise.
  const searchParams = useSearchParams();
  const printMode = searchParams.get("print") === "1";
  // A download the server refused comes back as `?download=failed` (`backToPage`) instead of an
  // error page in place of the quotation: said once, and taken off the address.
  const downloadFailed = searchParams.get("download") === "failed";
  const { notice, showError, clearNotice } = useNotice();
  useEffect(() => {
    if (!downloadFailed) return undefined;
    // The address is tidied after the notice is up: tidying it first changes the search params,
    // which would run this cleanup and cancel the notice before it showed.
    const timer = window.setTimeout(() => {
      showError("The PDF could not be downloaded. Please try again.");
      const url = new URL(window.location.href);
      url.searchParams.delete("download");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [downloadFailed, showError]);
  // The live Global Name and Global Logo, only ever read for a version so old its snapshot holds
  // neither. See `templateContentFor`.
  const branding = useStudioBranding();

  /*
   * Shown inside the client's app (`#embed=app&pass=…`): the app has already signed the client in,
   * so it hands over a pass for this quotation, and the page leaves out what the app does not offer -
   * Download, and the link's expiry. Both are read once and kept for this tab (a refresh keeps them),
   * then taken off the address.
   */
  const [embed] = useState(() => {
    if (typeof window === "undefined") return { app: false, pass: null };
    const key = `dbs_quotation_embed_${token}`;
    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (hash.get("embed") === "app") {
      window.sessionStorage.setItem(key, JSON.stringify({ pass: hash.get("pass") || null }));
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
    }
    try {
      const kept = JSON.parse(window.sessionStorage.getItem(key) || "null");
      return kept ? { app: true, pass: kept.pass } : { app: false, pass: null };
    } catch {
      return { app: false, pass: null };
    }
  });

  useEffect(() => {
    if (preview) return undefined;
    let active = true;
    setLoading(true);
    getPublicQuotation(token, embed.pass)
      .then((response) => { if (active) { setQuotation(response.data); setError(""); setExpired(null); } })
      .catch((requestError) => { if (active) { setExpired(expiredLinkFrom(requestError)); setError(requestError.message || "Unable to load quotation."); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, preview, embed.pass]);

  const payload = quotation?.payload || {};
  const content = useMemo(() => templateContentFor(quotation, branding), [quotation, branding]);
  const serviceRows = useMemo(() => rowsByShoot(payload.services || []), [payload.services]);
  const deliverableRows = useMemo(() => rowsByShoot(payload.deliverables || []), [payload.deliverables]);
  const shoots = payload.shoots || [];

  /*
   * `data-quotation-state` is how the PDF renderer knows where this page has got to: every state
   * the page can settle in carries it, and the one it does not - loading - carries nothing. The
   * renderer waits for the attribute, prints `ready`, and fails loudly on the other two.
   */
  if (loading) return <main className="grid min-h-dvh place-items-center bg-white p-6 text-slate-500">Loading quotation…</main>;
  // The shared expired page, the same one every client link lapses to; the state attribute is what
  // the PDF renderer reads to refuse printing it.
  if (expired) return <ExpiredClientLink {...expired} data-quotation-state="expired" />;
  // Laid out for the phone itself, as the expired card is: in the sheet's 1112px viewport it was
  // drawn at a third of its size. An error is not gone back from, so the viewport stays switched.
  if (error) return <DeviceViewport><main data-quotation-state="error" className="grid min-h-dvh place-items-center bg-white p-6"><p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700">{error}</p></main></DeviceViewport>;

  const { assets, brandName, contact } = content;
  // The couple, or whoever the quotation is for. `name` is what the vertical form asks for and
  // `clientName` is what quotations raised before it stored, so both are read.
  const clientName = payload.name || quotation.clientName || "Our Client";
  // The Main Event's type and how many other events there are - "Wedding +2 events"
  // (`mainEventTypeSummary`); a quotation with no events names the offer it was raised for, as it
  // always did.
  const eventTypes = eventTypeNames(shoots);
  const eventType = eventTypes.length ? mainEventTypeSummary(eventTypes, eventCount(shoots)) : payload.offerType || "";
  const website = contact.websiteUrl;
  // The salesperson's note for this client, else the studio's standard note from Settings ->
  // Quotation Settings -> General; nothing at all prints no card.
  const additionalNotes = String(quotation.additionalNotes || payload.additionalNotes || "").trim() || String(content.notesDefault || "").trim();
  const locationNames = content.locations.map((location) => String(location.name || "").trim()).filter(Boolean);
  /*
   * Where the Terms & Conditions are read. Relative on screen; absolute when the page is being
   * printed, because a link annotation in a PDF is followed with no page to resolve it against.
   * `printMode` is only ever true in the renderer, which loads this page from the frontend's own
   * origin, so `window.location.origin` is exactly the host a client can reach.
   */
  const termsPath = `/q/${encodeURIComponent(token)}/terms`;
  const termsHref = preview ? undefined : printMode && typeof window !== "undefined" ? `${window.location.origin}${termsPath}` : termsPath;
  // Where the client pays - `/q/<token>/payment`, the same sheet - made absolute for the PDF the
  // same way, and printed only where the Assigned Branch holds some way to be paid.
  const paymentPath = `/q/${encodeURIComponent(token)}/payment`;
  const paymentHref = preview ? undefined : printMode && typeof window !== "undefined" ? `${window.location.origin}${paymentPath}` : paymentPath;
  const infrastructure = (assets.infrastructure || []).filter((group) => group.photos?.length);

  /*
   * Two rows of five, always. The reference lays the card as a fixed grid, and dropping a cell the
   * quotation left blank pulled the second row apart - five cells over two. A blank prints as a
   * dash in its own cell instead, so the card reads the same whatever was filled in.
   */
  const details = [
    ["Quotation ID", quotation.quotationId],
    ["Client Name", clientName],
    ["Contact Number", quotation.clientMainNumber],
    ["Nearest Branch", quotation.sourceBranch],
    ["Followed By", quotation.followedBy],
    ["Enquiry ID", quotation.enquiryId],
    ["Referred By", quotation.referredBy],
    ["Event Venue", quotation.eventVenue],
    ["Event Type", eventType],
    ["Created At", createdStamp(quotation.quotationDate)],
  ].map(([label, value]) => [label, String(value || "").trim() || "\u2014"]);

  return <main
    data-quotation-state="ready"
    className={`min-h-dvh ${printMode ? "bg-white" : "bg-[#e9e6df] px-0 py-0 sm:px-4 sm:py-8"}`}
    style={{ fontFamily: QUOTATION_BODY_FONT, color: INK }}
  >
    <style>{SHEET_CSS}</style>

    {/*
      * The download control, only where the brand allows its clients one - Settings → Quotation
      * Settings → <brand> → PDF Content → Allow Client Download, read live off the quotation's own
      * brand rather than off its snapshot, so withdrawing it reaches the links already sent. A
      * quotation answered before this existed carries nothing, which reads as No; the file itself
      * is refused by the same answer, so this is the courtesy and not the lock.
      */}
    {!printMode && !preview && !embed.app && quotation.allowClientDownload === true
      && <FloatingDownload onDownload={() => { window.location.href = publicQuotationPdfUrl(token); }} />}
    {!printMode && <FloatingNotice notice={notice} onClose={clearNotice} />}
    {/* Bottom right, clear of Download: how long the link still opens. Only on a link that opened. */}
    {!printMode && !preview && !embed.app && <FloatingExpiry expiresAt={quotation.linkExpiresAt} />}

    <article className={`q-sheet relative mx-auto w-full max-w-[1080px] overflow-hidden ${printMode ? "" : "shadow-sm"}`} style={{ background: sheetBackground }}>
      <div className="relative">
        {/* ── Cover ── */}
        {Boolean(assets.coverImageUrl) && <section className="px-[30px] pt-[30px]">
          <div className="overflow-hidden rounded-[18px]" style={{ boxShadow: "0 1px 2px rgba(28,28,28,0.08)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={assets.coverImageUrl} alt="" className="block h-[420px] w-full object-cover object-top sm:h-[720px] lg:h-[1280px]" loading="eager" />
          </div>
        </section>}
        {/* The quote sits on the page itself, as the reference sets it: a faint wash of white on
            the sheet's own ground, no edge and no shadow - the cover frame's shadow above it is the
            only line the eye finds. */}
        {Boolean(content.coverQuote) && <section className="mx-auto mt-5 max-w-[1020px] rounded-[18px] px-6 py-7 sm:px-16" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.32), rgba(255,255,255,0.08))" }}>
          <p className="q-display mx-auto max-w-3xl text-center text-[17px] italic leading-relaxed sm:text-[19px]" style={{ color: "#2b2b2b" }}>{content.coverQuote}</p>
        </section>}

        {/* ── The brand ── */}
        <header className="px-6 pt-14 text-center sm:px-12">
          <DocumentLogo variant="quotationCover" src={content.logoUrl} priority className="mx-auto" />
          {Boolean(brandName) && <h1 className="q-display mt-5 text-[26px] font-semibold uppercase leading-none tracking-[0.3em] sm:text-[38px] sm:tracking-[0.4em]" style={{ color: INK }}>{brandName}</h1>}
          {Boolean(content.tagline) && <p className="q-label mt-4 text-[10px] font-medium sm:text-[12px]" style={{ color: GOLD_DEEP }}>{content.tagline}</p>}
          {Boolean(content.motto) && <p className="mx-auto mt-4 inline-block rounded-full border bg-white px-6 py-2 text-[13px] sm:text-[14px]" style={{ borderColor: "#e8e0cc", color: "#2b2b2b" }}>{content.motto}</p>}
          {Boolean(website) && <p className="mt-4 text-[13px] font-medium tracking-[0.12em]"><a href={hrefFor(website)} className="underline underline-offset-4" style={{ color: "#1a5cd6" }}>{displayUrl(website)}</a></p>}
        </header>

        {/* ── The proposal ── */}
        <section className="q-navy mx-[18px] mt-9 rounded-[26px] px-6 py-8 text-white sm:mx-[45px] sm:px-9">
          <span className="q-label inline-block rounded-full border px-4 py-1.5 text-[11px] font-semibold" style={{ borderColor: GOLD, color: GOLD }}>{content.proposalLabel}</span>
          <h2 className="q-display mt-5 text-[44px] font-medium leading-none sm:text-[74px]">
            {clientName.split(/\s&\s/).map((part, index, parts) => <span key={index}>{part}{index < parts.length - 1 && <span style={{ color: GOLD }}> &amp; </span>}</span>)}
          </h2>
          <div className="mt-7 border-t" style={{ borderColor: "rgba(255,255,255,0.12)" }} />
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {details.map(([label, value]) => <DetailCell key={label} label={label} value={value} />)}
          </div>
        </section>

        {/* ── The events ── */}
        {Boolean(shoots.length) && <section className="px-[18px] pt-14 sm:px-[45px]">
          <Eyebrow className="text-center tracking-[0.32em]">{content.eventSectionLabel}</Eyebrow>
          <RuledTitle className="mt-2">{content.eventSectionTitle}</RuledTitle>
          <div className="mt-12 space-y-6">
            {shoots.map((shoot, index) => {
              const services = serviceRows[shoot.id] || [];
              const deliverables = deliverableRows[shoot.id] || [];
              const meta = shootMeta(shoot);
              const care = careLine(shoot, brandName);
              return <article key={shoot.id || shoot.shootId || index} className="q-card q-event rounded-[24px] px-5 py-6 sm:px-9 sm:py-8">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <Eyebrow>{content.eventLabel} {String(index + 1).padStart(2, "0")}</Eyebrow>
                      {shoot.isMainEvent && <span className="q-label rounded-full border px-2.5 py-0.5 text-[9px] font-semibold" style={{ borderColor: "#e3cf8f", background: "#fbf3da", color: GOLD_DEEP, letterSpacing: ".18em" }}>★ {content.mainEventBadge}</span>}
                    </div>
                    <h3 className="q-display mt-1 text-[26px] font-semibold uppercase leading-tight tracking-[0.02em] sm:text-[32px]" style={{ color: INK }}>{shootDisplayName(shoot, "Shoot")}</h3>
                    {Boolean(meta) && <p className="mt-1.5 text-[14px]" style={{ color: "#5c5c5c" }}>{meta}</p>}
                    {care && <p className="mt-1 text-[14px]" style={{ color: "#5c5c5c" }}>{care}</p>}
                  </div>
                  <div className="shrink-0 rounded-xl border px-6 py-3.5 text-center" style={{ borderColor: "#e6d3a3", background: "linear-gradient(180deg, #fffdf8, #fbf5e8)", boxShadow: "0 1px 2px rgba(28,28,28,0.04)" }}>
                    <Eyebrow size="text-[10px]" className="tracking-[0.3em]">Event Date</Eyebrow>
                    <p className="mt-1 text-[16px] font-bold" style={{ color: INK }}>{longDate(shoot.dateCreated) || "To be decided"}</p>
                  </div>
                </div>
                {(services.length > 0 || deliverables.length > 0) && <div className="mt-6 border-t" style={{ borderColor: "#eee7d9" }} />}
                <div className="mt-6 space-y-8">
                  <LineList title={content.servicesTitle} rows={services} nameOf={(row) => row.serviceName || row.serviceDefinition?.name || "Service"} />
                  {/* A deliverable line reads as the studio configured it - "Album Printing -
                      Canvera - 12x18 - 1.5 inch" - and not as the deliverable's bare name. Both
                      are already on the row: the label is the one `deliverableVariantLabel` built
                      when the variant was picked, which is the same sentence the generator's own
                      table and the deliverables picker show, so the client is sent what the studio
                      chose rather than a shorter version of it.

                      `deliverableName` is left exactly as it is, here and everywhere: it is the
                      deliverable's own name and what a project raised off this quotation matches
                      by. It answers below only where there is no label - a line added without a
                      variant, or a quotation saved before variants existed - which is what keeps
                      every quotation already sent reading as it was sent. */}
                  <LineList title={content.deliverablesTitle} rows={deliverables} nameOf={(row) => row.deliverableVariantLabel || row.deliverableName || row.deliverableDefinition?.name || "Deliverable"} />
                </div>
              </article>;
            })}
          </div>
          {Boolean(content.deliverableFootnote) && <div className="q-card mt-6 flex items-center justify-center gap-3 rounded-2xl px-5 py-4 text-[13px] font-semibold" style={{ color: "#3b3b3b" }}>
            <StorageIcon />
            <span>{content.deliverableFootnote}</span>
          </div>}
        </section>}

        {/* ── The discounts, when there are any ── */}
        <DiscountCard breakdown={quotationDiscountBreakdown(quotation)} />

        {/* ── The money ── */}
        {/* Each part prints while its switch is on (Settings → Quotation Settings → General →
            Pricing & Total), and the card as a whole too. The figure is the saved total either way;
            switching a part off changes no number. */}
        {content.sections.pricing && (() => {
          /*
           * The link, not the account: the Assigned Branch's details are read on a page of their own
           * rather than printed under the price, and absent where the branch has nothing to be paid
           * into, so a quotation from a branch without bank details prints exactly as before.
           */
          const gstLine = content.sections.gst && content.gstLine ? content.gstLine : "";
          const paymentLabel = content.sections.payment && content.paymentLabel && quotation.paymentDetailsAvailable === true ? content.paymentLabel : "";
          const validityText = content.sections.validity && content.validityText ? content.validityText : "";
          /*
           * The quotation's own card, always exactly as it was. Once the studio has published extras on
           * this booked quotation - the latest published revision only, so a draft never shows - the
           * EXTRA section and the Updated Total follow it; the GST line on both is this same switch.
           */
          return <>
            <QuotationPricingCard label={content.pricingLabel} amountText={currency(quotation.amount)} gstLine={gstLine} paymentHref={paymentHref} paymentLabel={paymentLabel} validityText={validityText} />
            {quotation.saleExtras && <>
              <QuotationExtraSection extras={quotation.saleExtras} />
              <UpdatedTotalCard extras={quotation.saleExtras} gstLine={gstLine} />
            </>}
          </>;
        })()}

        {/* ── The notes ── */}
        {/* Each of the four cards below prints only while its switch is on - Settings → Quotation
            Settings → General - and every version keeps the switches it was raised under. */}
        {content.sections.notes && Boolean(additionalNotes) && <section className="q-card mx-[18px] mt-7 rounded-[24px] px-6 py-8 sm:mx-[45px] sm:px-7">
          <h2 className="q-display text-[24px] font-semibold" style={{ color: INK }}>{content.notesTitle}</h2>
          <p className="mt-4 whitespace-pre-line text-[14.5px] leading-relaxed" style={{ color: "#3b3b3b" }}>{additionalNotes}</p>
        </section>}

        {/* ── The trademark ── */}
        {content.sections.trademark && Boolean(content.trademarkTitle) && <section className="q-card mx-[18px] mt-7 rounded-[24px] px-6 py-7 sm:mx-[45px] sm:px-7">
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border bg-white" style={{ borderColor: "#eadfbf" }}><BankIcon /></span>
            <div className="min-w-0">
              {Boolean(content.trademarkBadge) && <span className="inline-block rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ borderColor: "#e3cf8f", background: "#fbf3da", color: GOLD_DEEP }}>{content.trademarkBadge}</span>}
              <h2 className="q-display mt-1 text-[26px] font-semibold leading-tight sm:text-[30px]" style={{ color: INK }}>{content.trademarkTitle}</h2>
            </div>
          </div>
          {Boolean(content.trademarkBody) && <p className="mt-4 whitespace-pre-line text-[14.5px] leading-relaxed" style={{ color: "#3b3b3b" }}>{content.trademarkBody}</p>}
          {Boolean(content.trademarkNote) && <p className="mt-3 text-[12.5px] italic" style={{ color: "#6b6b6b" }}>{content.trademarkNote}</p>}
        </section>}

        {/* ── The journey ── */}
        {content.sections.journey && <section className="q-card relative mx-[18px] mt-7 overflow-hidden rounded-[24px] px-6 pb-8 pt-10 sm:mx-[45px] sm:px-7">
          {Boolean(assets.indiaMapUrl) && <div aria-hidden="true" className="pointer-events-none absolute bottom-16 right-2 top-24 w-[46%] opacity-[0.16]" style={{ backgroundImage: `url(${assets.indiaMapUrl})`, backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "right center" }} />}
          <div className="relative">
            <RuledTitle size="text-[34px] sm:text-[42px]">{content.journeyTitle}</RuledTitle>
            {Boolean(content.journeySubtitle) && <Eyebrow size="text-[13px]" className="mt-2 text-center tracking-[0.32em]">{content.journeySubtitle}</Eyebrow>}
            {Boolean(content.journeyIntro) && <p className="q-display mt-3 text-center text-[18px] italic sm:text-[19px]" style={{ color: "#4a4a4a" }}>{content.journeyIntro}</p>}
            <ol className="mt-8 space-y-0">
              {content.journey.map((row, index) => {
                const last = index === content.journey.length - 1;
                return <li key={`${row.year}-${index}`} className="relative grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 pb-5 sm:grid-cols-[1.5rem_minmax(0,1fr)_auto] sm:gap-x-4">
                  <span className="relative flex justify-center">
                    <span className="mt-1 h-3 w-3 rounded-full" style={{ background: last ? "#2e8b57" : "#d6b96a", boxShadow: "0 0 0 3px rgba(214,185,106,0.25)" }} />
                    {!last && <span aria-hidden="true" className="absolute left-1/2 top-5 h-full w-px -translate-x-1/2" style={{ background: "#e6dcc3" }} />}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[11.5px] font-bold" style={{ color: "#262626" }}>{[row.year, row.title].filter(Boolean).join(" • ")}</p>
                    {Boolean(row.detail) && <p className="mt-0.5 text-[11px]" style={{ color: "#6b6b6b" }}>{row.detail}</p>}
                    {Boolean(row.place) && <p className="q-display mt-0.5 text-[13px] italic sm:hidden" style={{ color: GOLD_DEEP }}>{row.place}</p>}
                  </div>
                  {Boolean(row.place) && <p className="q-display hidden self-start text-right text-[13px] sm:block" style={{ color: GOLD_DEEP }}>{row.place}</p>}
                </li>;
              })}
            </ol>
            {Boolean(locationNames.length) && <>
              <div className="mt-2 border-t" style={{ borderColor: "#eee7d9" }} />
              <Eyebrow size="text-[14px]" className="mt-5 text-center tracking-[0.3em]">{content.locationsTitle}</Eyebrow>
              <ul className="mt-3 flex flex-wrap justify-center gap-2">
                {content.locations.map((location, index) => <li key={`${location.name}-${index}`} className="rounded-full border px-3.5 py-1 text-[10.5px] font-medium" style={location.isHeadOffice ? { borderColor: "#e3cf8f", background: "#fbf3da", color: GOLD_DEEP } : { borderColor: "#e6dfd0", background: "#fffdf8", color: "#3b3b3b" }}>{location.name}</li>)}
              </ul>
            </>}
          </div>
        </section>}

        {/* ── The close of the proposal ── */}
        <section className="px-6 pb-12 pt-12 text-center sm:px-16">
          {Boolean(content.closingQuote) && <p className="q-display mx-auto max-w-3xl text-[19px] italic leading-relaxed sm:text-[20px]" style={{ color: "#5b5238" }}>{content.closingQuote}</p>}
          {Boolean(content.closingThanks) && <p className="mx-auto mt-5 max-w-3xl text-[13.5px]" style={{ color: "#3b3b3b" }}>{content.closingThanks}</p>}
          {/*
            * The link, not the clauses. The studio's design closes the proposal on it, and the
            * terms are read on a page of their own - `/q/<token>/terms`, the same sheet - rather
            * than as small print between the closing lines and the infrastructure. The link is
            * printed into the PDF as a link, so a client reading the file can follow it too.
            */}
          {Boolean(content.terms.length) && <p className="mt-6">
            <a href={termsHref} className="text-[12.5px] font-semibold underline underline-offset-4" style={{ color: "#1a5cd6", letterSpacing: ".04em" }}>{content.termsTitle}</a>
          </p>}
        </section>

        {/* ── The infrastructure ── */}
        {content.sections.infrastructure && Boolean(infrastructure.length) && <section className="px-[18px] pb-10 pt-4 sm:px-[45px]">
          <RuledTitle size="text-[34px] sm:text-[42px]"><span className="uppercase tracking-[0.04em]">{content.infrastructureTitle}</span></RuledTitle>
          {Boolean(content.infrastructureSubtitle) && <Eyebrow size="text-[13px]" className="mt-2 text-center tracking-[0.32em]">{content.infrastructureSubtitle}</Eyebrow>}
          <div className="mt-10 space-y-12 sm:pl-24">
            {infrastructure.map((group, index) => <Collage key={`${group.title}-${index}`} group={group} />)}
          </div>
          {Boolean(content.infrastructureTagline) && <p className="q-footer mt-12 text-center text-[16px] font-semibold tracking-[0.08em] sm:text-[18px]" style={{ color: TEAL }}>{content.infrastructureTagline}</p>}
        </section>}

        {/* ── Thank you ── */}
        {/*
          * The photograph is the section, and the words sit on it - the quote and the "Thank you"
          * over its top, the footer paragraph and the branch list over its foot - exactly as the
          * reference lays them, with the picture's own sky behind the words. The picture is shown
          * at the sheet's full width and its own height, so a portrait and a wide picture both read
          * as the studio meant them; only one too short to carry the words is held to a minimum
          * height and cropped to fit. With no picture, a sky gradient stands in behind the words.
          */}
        <section className="relative overflow-hidden border-t-2" style={{ borderColor: TEAL }}>
          {/* The picture and the words on it, as one block, so the footer paragraph sits over the
              picture's foot and not under the contact bar that follows. */}
          <div className="relative" style={{ background: "linear-gradient(180deg, #d2f0fb 0%, #e6f8fe 55%, #cfe6ee 100%)" }}>
          {assets.thankYouImageUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={assets.thankYouImageUrl} alt="" className="block h-auto min-h-[760px] w-full object-cover object-top sm:min-h-[1300px]" loading="eager" />
            : <div aria-hidden="true" className="h-[760px] sm:h-[1000px]" />}
          <div className="absolute inset-x-0 top-0 px-6 pt-16 text-center sm:pt-32">
            {Boolean(content.thankYouQuote) && <p className="mx-auto max-w-2xl text-[22px] italic leading-snug sm:text-[34px]" style={{ color: "#1f2a2a" }}>{content.thankYouQuote}</p>}
            <p className="q-script mt-10 text-[96px] leading-none sm:mt-16 sm:text-[190px]" style={{ color: "#0f4b47" }}>{content.thankYouTitle}</p>
            {Boolean(content.thankYouSubtitle) && <p className="q-condensed -mt-2 text-[24px] font-medium underline underline-offset-8 sm:-mt-6 sm:text-[36px]" style={{ color: "#111" }}>{content.thankYouSubtitle}</p>}
          </div>
          {(Boolean(content.footerNote) || Boolean(locationNames.length)) && <div className="absolute inset-x-0 bottom-0 px-6 pb-5 pt-28 text-center sm:px-12" style={{ background: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.42) 100%)" }}>
            {Boolean(content.footerNote) && <p className="q-footer mx-auto max-w-4xl text-[12px] font-semibold leading-snug text-white sm:text-[14px]" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.45)" }}>{content.footerNote}</p>}
            {Boolean(locationNames.length) && <p className="q-footer mt-5 text-[14px] font-semibold uppercase tracking-[0.04em] text-white sm:text-[17px]" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.45)" }}>
              {locationNames.map((name, index) => <span key={`${name}-${index}`}>{index > 0 && <span className="mx-2 sm:mx-3">|</span>}{name}</span>)}
            </p>}
          </div>}
          </div>
          <footer className="relative text-center text-white" style={{ background: TEAL }}>
            <div className="px-6 pb-4 pt-5">
              {Boolean(contact.phone) && <p className="q-condensed flex items-center justify-center gap-3 text-[26px] font-medium tracking-wide sm:text-[30px]"><PhoneIcon />{contact.phone}</p>}
              {(Boolean(website) || Boolean(contact.socialHandle)) && <p className="q-footer mt-3 flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-[16px] font-semibold sm:text-[20px]">
                {Boolean(website) && <a href={hrefFor(website)} className="uppercase">{displayUrl(website)}</a>}
                {Boolean(website) && Boolean(contact.socialHandle) && <span aria-hidden="true">|</span>}
                {Boolean(contact.socialHandle) && <span>{contact.socialHandle}</span>}
              </p>}
            </div>
            {Boolean(content.copyright) && <p className="q-footer px-6 py-3 text-[12px] font-medium sm:text-[13px]" style={{ background: "#003639" }}>{content.copyright}</p>}
          </footer>
        </section>
      </div>
    </article>
  </main>;
}
