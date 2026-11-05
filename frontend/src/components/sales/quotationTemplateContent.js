/**
 * The wording the client-facing quotation is built from, and how one quotation's own copy of it
 * is read.
 *
 * Everything on `/q/<token>` that is not the client's own numbers comes through here. The defaults
 * below are the words the reference design prints; a brand replaces any of them from Settings ->
 * Quotation Settings -> PDF Content, and the server freezes whatever applied into each version as
 * `payload.brandSnapshot` the moment it is raised. This file reads that copy - and prints these
 * defaults for a version raised before snapshots existed - so the web page and the PDF, which are
 * one template rendered twice, cannot disagree.
 *
 * The same keys and the same defaults as `backend/.../quotation-brands/defaults.js`; the backend's
 * test holds the two files to the same words.
 */

import { brandNameInProse } from "../../lib/studioBranding.mjs";

/** The rate used when a quotation was raised before the studio's settings existed. */
export const DEFAULT_GST_PERCENT = 18;

/**
 * Stated on top of the quoted total rather than folded into the figure. The rate comes from the
 * quotation itself, so a client reopening one from months ago reads the rate that applied then.
 */
export function gstLabel(percent) {
  const rate = Number(percent);
  const shown = Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_GST_PERCENT;
  // "18" not "18.00", but "18.5" kept: a rate is written the way it was entered.
  return `+ ${Number(shown.toFixed(2))}% GST APPLICABLE`;
}

export const termsAndConditions = [
  {
    title: "Payment Schedule",
    body: "Slots will be booked only upon paying a booking advance (25%). To secure dates, an immediate payment is required. The remaining 50% should be paid one week prior to the scheduled event.",
  },
  {
    title: "Travel & Accommodation",
    body: "Accommodation & Food to be taken care by the Client. Travel expenses for events occurring at locations more than 5 kilometers away from our offices shall be arranged by the client.",
  },
  {
    title: "Copyrights & Usage",
    body: "The photos and videos pertaining to this event shall be shared on all Don't Blink Studioz Social Media Platforms unless specifically requested otherwise.",
  },
];

/**
 * Every word on the page a brand may change, with what prints when it has not. A default of ""
 * prints nothing; a few are filled from elsewhere when blank - the brand name from Settings ->
 * Organization -> Global Name, the phone and website from the quotation's branch.
 */
export const defaultPdfContent = {
  tagline: "Cinematography & Fine Art Photography",
  motto: "Craft your memories and freeze the artistic moments into eternal heirlooms",
  coverQuote: "“Everyday cannot be remembered and likewise some days cannot be forgotten. As a resemblance and remembrance of such precious days we are here to serve you and we are highly relished in capturing the big moments of our clients.”",
  proposalLabel: "Exclusive proposal curated for",
  eventSectionLabel: "Ceremonial Itinerary",
  eventSectionTitle: "Event Coverage & Deliverables Details",
  eventLabel: "Event",
  mainEventBadge: "Main Event",
  servicesTitle: "Services",
  deliverablesTitle: "Deliverables",
  deliverableFootnote: "Storage Note: Storage to be provided by client for raw data delivery",
  pricingLabel: "Pricing & Total of Services and Deliverables",
  validityText: "This Quotation Valid up-to 3 Months from the Date Created",
  notesTitle: "Additional Notes",
  notesDefault: "",
  trademarkBadge: "Govt of India Registered",
  trademarkTitle: "Officially Trademarked Brand",
  trademarkBody: "",
  trademarkNote: "",
  journeyTitle: "The Journey & Legacy",
  journeySubtitle: "Pan-India & International",
  journeyIntro: "From a humble dream in 2012 to a prestigious South-India powerhouse.",
  locationsTitle: "Studio Infrastructure Locations",
  closingQuote: "“Great photographs are all about getting to know you and having fun on the day.”",
  closingThanks: "Thank you for putting your trust and confidence in our company. We won't settle for less than the best for you!",
  termsTitle: "Our Terms & Conditions",
  infrastructureTitle: "Our Infrastructure",
  infrastructureSubtitle: "All over South-India",
  infrastructureTagline: "“One Brand • Multiple Locations • Unlimited Memories.”",
  thankYouQuote: "“Every Weddings are unique so let us customise yours for your needs!”",
  thankYouTitle: "Thank you",
  thankYouSubtitle: "For Choosing Us!",
  footerNote: "We are committed to making your experience beautiful with {brand}. For any assistance, please contact our team of expert advisors. In case you are not satisfied with the resolution provided, you can ask for the Appellate authority contact on the same number. We appreciate the confidence you have placed in us and we look forward to providing you with the best services.",
  contactPhone: "",
  websiteUrl: "",
  socialHandle: "",
  copyrightText: "",
};

/** The Journey & Legacy timeline printed until a brand writes its own. */
export const defaultJourney = [
  { year: "2012", title: "Brand Inception", detail: "Fine-art vision created for modern luxury weddings.", place: "The Story Begins" },
  { year: "2018", title: "Studio Foundations", detail: "Headquarters launch in Erode • With 2 - Full Time Employees", place: "Erode City - TN" },
  { year: "2022", title: "Service & Brand Expansion", detail: "Introducing Services • 5000 Sq Ft Workspace - Erode • 10 - Full Time Employees", place: "Qua Qua | Corp" },
  { year: "2023", title: "Branch Expansion", detail: "1st Branch Expansion • 16 - Full Time Employees • 2 - Branches", place: "Tiruppur - TN" },
  { year: "2024", title: "Metro Expansion", detail: "25 - Full Time Employees • 3 - Branches", place: "Bangalore - KA" },
  { year: "2025", title: "Overseas & Pan-India", detail: "65 - Full Time Employees • 7 - Branches", place: "Shah Alam - Malaysia | Hyderabad - TL | Vizag - AP | Coimbatore - TN" },
  { year: "2026", title: "Next Plans & Branches", detail: "Continuous innovation, new services at affordable pricing & to expand pan India", place: "Innovation and Future Plans" },
];

// Kept for the pieces of the application that still import them by name.
export const deliverableFootnote = defaultPdfContent.deliverableFootnote;
export const closingQuote = defaultPdfContent.closingQuote;
export const closingThanks = defaultPdfContent.closingThanks;
export const closingSignature = "- TEAM DON'T BLINK STUDIOZ -";

const text = (value) => (typeof value === "string" ? value.trim() : "");

/*
 * The words the page printed before the reference design. A snapshot raised then stored the
 * merged wording, defaults included, so a version from that time carries "The celebration" as
 * though a brand had chosen it. Those are the template's old defaults - the code's to change -
 * and read as "nothing chosen"; a brand's own words are never on this list. The same list as the
 * backend's `LEGACY_PDF_CONTENT`.
 */
const legacyPdfContent = {
  eventSectionLabel: ["The celebration"],
  eventSectionTitle: ["Event Coverage"],
  deliverablesTitle: ["Premium Deliverables"],
  deliverableFootnote: ["Storage to be provided by client for raw data delivery."],
  closingSignature: ["- TEAM DON'T BLINK STUDIOZ -"],
};
const override = (key, value) => {
  const trimmed = text(value);
  return trimmed && !(legacyPdfContent[key] || []).includes(trimmed) ? trimmed : "";
};

const emptyPresentation = () => ({
  studioName: "",
  brandDisplayName: "",
  globalLogoUrl: null,
  assets: { coverImageUrl: null, indiaMapUrl: null, thankYouImageUrl: null, infrastructure: [], journey: [] },
  branch: null,
  headOffice: null,
  locations: [],
  contact: { phone: "", websiteUrl: "", email: "", socialHandle: "" },
  // Every section on until the studio switches one off; a version raised before the switches
  // existed carries none, and prints all four as it always did.
  sections: {},
});

/**
 * What one quotation prints, read off its own snapshot and never off today's settings.
 *
 * `fallbackBranding` is the live Global Name and Global Logo, for a version so old that its
 * snapshot names no studio at all - the page passes what `useStudioBranding` holds. Everything
 * else falls back to the defaults above, which is what those versions printed the day they were
 * sent. `{brand}` inside a sentence is the brand's display name.
 */
export function templateContentFor(quotation, fallbackBranding = null) {
  const snapshot = quotation?.brandSnapshot || quotation?.payload?.brandSnapshot || null;
  const overrides = snapshot?.pdfContent && typeof snapshot.pdfContent === "object" ? snapshot.pdfContent : {};
  const words = Object.fromEntries(Object.entries(defaultPdfContent).map(([key, fallback]) => [key, override(key, overrides[key]) || fallback]));
  const presentation = { ...emptyPresentation(), ...(snapshot?.presentation || {}) };
  presentation.assets = { ...emptyPresentation().assets, ...(presentation.assets || {}) };
  presentation.contact = { ...emptyPresentation().contact, ...(presentation.contact || {}) };
  const studioName = text(presentation.studioName) || text(fallbackBranding?.studioName);
  // The Global Name, and the bundled name where the studio has left it blank - the same rule every
  // sentence in the application follows. Never a name the brand typed.
  const brandName = text(presentation.brandDisplayName) || studioName || brandNameInProse(fallbackBranding);
  const fill = (value) => String(value || "").replace(/\{brand\}/g, brandName);
  const content = Object.fromEntries(Object.entries(words).map(([key, value]) => [key, fill(value)]));
  const terms = Array.isArray(snapshot?.terms) && snapshot.terms.length
    ? snapshot.terms.filter((term) => term && (term.title || term.body))
    : termsAndConditions;
  const journey = Array.isArray(presentation.assets.journey) && presentation.assets.journey.length ? presentation.assets.journey : defaultJourney;
  const contact = {
    phone: text(words.contactPhone) || text(presentation.contact.phone),
    websiteUrl: text(words.websiteUrl) || text(presentation.contact.websiteUrl),
    email: text(presentation.contact.email),
    socialHandle: text(words.socialHandle) || text(presentation.contact.socialHandle),
  };
  // Only an explicit `false` hides a section - see `emptyPresentation`.
  const sections = Object.fromEntries(["notes", "trademark", "journey", "infrastructure"].map((key) => [key, presentation.sections?.[key] !== false]));
  const year = new Date(quotation?.quotationDate || quotation?.createdAt || Date.now()).getFullYear();
  const copyright = text(content.copyrightText) || (brandName ? `Copyright © ${year} ${brandName}. All rights reserved.` : "");
  return {
    ...content,
    brandName,
    studioName,
    logoUrl: quotation?.logoUrl || snapshot?.logoUrl || presentation.globalLogoUrl || fallbackBranding?.galleryLogoUrl || "",
    terms,
    journey,
    assets: presentation.assets,
    branch: presentation.branch,
    locations: Array.isArray(presentation.locations) ? presentation.locations : [],
    contact,
    sections,
    copyright,
    gstPercent: snapshot?.gstPercent ?? quotation?.payload?.rates?.gstPercent,
  };
}

/** "www.example.com" for a link, the way the page prints it; the href keeps the scheme. */
export function displayUrl(value) {
  return String(value || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

export function hrefFor(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}
