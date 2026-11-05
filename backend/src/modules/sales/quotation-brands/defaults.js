/**
 * What a quotation says when its brand has said nothing.
 *
 * Every brand-specific thing on the client's copy is an *override*: the studio's standard terms,
 * the wording of every heading and caption on the page, the Journey & Legacy timeline, and the
 * pictures. The defaults below are the words the reference design prints; a brand replaces any of
 * them from Settings -> Quotation Settings -> PDF Content and leaves the rest.
 *
 * Held here, on the server, because the snapshot is built here: the version being raised copies
 * whatever applied at that moment - configured or default - into its own payload, and the page
 * reads the copy. The frontend keeps the same defaults in
 * `components/sales/quotationTemplateContent.js` for versions raised before snapshots existed.
 * `test/sales-quotation-brands.test.js` holds the two files to the same words.
 */

/*
 * ── The three brands ────────────────────────────────────────────────────────────────────────────
 *
 * The same three the CRM board is split by and the identifier counter numbers under; `verticalName`
 * is the spelling both of those already use, and what the generator stores in `payload.vertical`.
 * The aliases are every spelling the application has been seen to hold for each, so a payload from
 * any client version resolves to a brand rather than to nothing.
 */
const BRANDS = [
  { code: "DUM_DUM", name: "Dum Dum", verticalName: "Dum Dum", aliases: ["dumdum", "dd", "wed", "wedding"] },
  { code: "QUA_QUA", name: "Qua Qua", verticalName: "Qua Qua", aliases: ["quaqua", "qq", "ququa"] },
  { code: "CORP", name: "Corp", verticalName: "Corp", aliases: ["corp", "corporate", "corporation"] },
];

const BRAND_CODES = BRANDS.map((brand) => brand.code);

// Dum Dum, for the same reason the identifier counter and the CRM board answer Dum Dum for a blank
// vertical: it is what the rest of the application already reads an unnamed one as.
const DEFAULT_BRAND_CODE = "DUM_DUM";

/** Lowercased with every separator dropped, so "Dum Dum", "DUM_DUM" and "dum-dum" are one key. */
const fold = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The brand code for however a record names its brand - the code itself, the vertical name, the
 * CRM's spelling or the document code - or null when it names nothing recognisable.
 */
function brandCodeFor(value) {
  const key = fold(value);
  if (!key) return null;
  const found = BRANDS.find((brand) => fold(brand.code) === key || fold(brand.name) === key || brand.aliases.includes(key));
  return found ? found.code : null;
}

/** The vertical spelling the generator and the counter use for a brand code. */
function verticalNameFor(code) {
  return BRANDS.find((brand) => brand.code === code)?.verticalName || "";
}

function brandNameFor(code) {
  return BRANDS.find((brand) => brand.code === code)?.name || "";
}

/** The studio's standard Terms & Conditions, printed by a brand that has configured none. */
const DEFAULT_TERMS = [
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
 * The client-facing wording a brand may change, with what prints when it has not.
 *
 * Only *words*: the layout, the type, the spacing and the order of the sections are the template's
 * and no brand can move them. A default of "" prints nothing at all rather than a heading over a
 * gap - the page treats an empty string as absent - and a few of them are filled from elsewhere
 * when blank: the brand name from Settings -> Organization -> Global Name, the phone and website
 * from the quotation's branch, the copyright line from the year and the brand name.
 */
const DEFAULT_PDF_CONTENT = {
  // ── The head of the page ──
  tagline: "Cinematography & Fine Art Photography",
  motto: "Craft your memories and freeze the artistic moments into eternal heirlooms",
  coverQuote: "“Everyday cannot be remembered and likewise some days cannot be forgotten. As a resemblance and remembrance of such precious days we are here to serve you and we are highly relished in capturing the big moments of our clients.”",
  proposalLabel: "Exclusive proposal curated for",
  // ── The events ──
  eventSectionLabel: "Ceremonial Itinerary",
  eventSectionTitle: "Event Coverage & Deliverables Details",
  eventLabel: "Event",
  mainEventBadge: "Main Event",
  servicesTitle: "Services",
  deliverablesTitle: "Deliverables",
  deliverableFootnote: "Storage Note: Storage to be provided by client for raw data delivery",
  // ── The money: the Pricing & Total card ──
  pricingLabel: "Pricing & Total of Services and Deliverables",
  // `{gst}` is the quotation's own GST rate, which its pricing decided; the words only state it.
  gstText: "+ {gst}% GST APPLICABLE",
  paymentLabel: "For Payment",
  // How long a quotation is valid, in whole months: what `{months}` and `{validUntil}` print.
  validityMonths: "3",
  // `{months}` and `{validUntil}` (the quotation's own date plus `validityMonths`) are filled at print.
  validityText: "This Quotation Valid up-to {months} Months from the Date Created",
  notesTitle: "Additional Notes",
  // Printed under the notes heading when the quotation itself carries no note. Blank prints no card.
  notesDefault: "",
  // ── The brand ──
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
  // ── The infrastructure ──
  infrastructureTitle: "Our Infrastructure",
  infrastructureSubtitle: "All over South-India",
  infrastructureTagline: "“One Brand • Multiple Locations • Unlimited Memories.”",
  // ── The close ──
  thankYouQuote: "“Every Weddings are unique so let us customise yours for your needs!”",
  thankYouTitle: "Thank you",
  thankYouSubtitle: "For Choosing Us!",
  footerNote: "We are committed to making your experience beautiful with {brand}. For any assistance, please contact our team of expert advisors. In case you are not satisfied with the resolution provided, you can ask for the Appellate authority contact on the same number. We appreciate the confidence you have placed in us and we look forward to providing you with the best services.",
  contactPhone: "",
  websiteUrl: "",
  socialHandle: "",
  copyrightText: "",
};

const PDF_CONTENT_KEYS = Object.keys(DEFAULT_PDF_CONTENT);

/*
 * Which of those words are the studio's rather than a brand's.
 *
 * The Additional Notes and trademark cards, the Journey & Legacy headings and Our Infrastructure's
 * read the same on every brand's quotation, so they are kept once on the studio's settings row
 * (Settings -> Quotation Settings -> General) and every brand prints them. Everything else is the
 * brand's own. The same split applies to the pictures: the India map, the collages and the
 * timeline are the studio's; the cover, the background and the Thank You photograph are the brand's.
 */
const GENERAL_PDF_CONTENT_KEYS = [
  "notesTitle", "notesDefault",
  "trademarkBadge", "trademarkTitle", "trademarkBody", "trademarkNote",
  "journeyTitle", "journeySubtitle", "journeyIntro", "locationsTitle",
  "infrastructureTitle", "infrastructureSubtitle", "infrastructureTagline",
];
const BRAND_PDF_CONTENT_KEYS = PDF_CONTENT_KEYS.filter((key) => !GENERAL_PDF_CONTENT_KEYS.includes(key));

/*
 * The Pricing & Total card's words, set for every brand on General - and, for the two a brand's PDF
 * Content tab already offered (the heading and the validity line), still answerable by the brand.
 *
 * So they are neither General's alone nor a brand's alone: General's stand for every brand, and a
 * brand that has typed its own heading or validity line keeps it - the order a quotation is read in
 * is brand, then General, then the template's own words. The GST rate itself is not here: it is the
 * quotation's own, from its pricing, and `{gst}` only states it.
 */
const PRICING_PDF_CONTENT_KEYS = ["pricingLabel", "gstText", "paymentLabel", "validityMonths", "validityText"];

/** Whole months a quotation may be said to be valid for: what General accepts for `validityMonths`. */
const MAX_VALIDITY_MONTHS = 60;
const GENERAL_ASSET_KEYS = ["indiaMapUrl", "infrastructure", "journey"];

/*
 * How many photographs one branch's collage may hold.
 *
 * Eight, because the client's copy has a composition for one through eight and none for a ninth -
 * `frontend/src/lib/infrastructureCollage.mjs` is where those compositions are, and the two numbers
 * are the same number. A branch that could store nine would print a photograph nowhere, so the
 * ninth is refused here rather than accepted and then quietly dropped at print time.
 */
const MAX_INFRASTRUCTURE_PHOTOS = 8;

/*
 * The four sections of the client's copy the studio can switch off.
 *
 * Each is a whole card or band on the page - the notes, the trademark card, Journey & Legacy with
 * its map and timeline, Our Infrastructure with its collages - and they read the same on every
 * brand, so the switches live beside the shared wording in Settings -> Quotation Settings ->
 * General. Only an explicit `false` hides one: a settings row that has never been saved, and every
 * version raised before these existed, prints all four exactly as before.
 */
/*
 * And the Pricing & Total card's own four, also on General: the whole card, and inside it the GST
 * line, the payment link and the validity line. Hiding one prints nothing in its place and changes
 * no figure - the total is the saved one either way.
 */
const SECTION_KEYS = ["notes", "trademark", "journey", "infrastructure", "pricing", "gst", "payment", "validity"];
const DEFAULT_PDF_SECTIONS = Object.fromEntries(SECTION_KEYS.map((key) => [key, true]));

/**
 * Whether a brand lets the client holding its link save the quotation as a file.
 *
 * The opposite reading to the four section switches above, and deliberately: those are things the
 * studio has always printed and may now switch off, so silence means on. This is a thing the studio
 * has never given away, so silence - a brand row from before the column, a brand with no row at
 * all, a database that would not answer - means No. Only a stored `true` is Yes.
 */
const clientDownloadAllowed = (row) => row?.allowClientDownload === true;

/** The stored switches, read as booleans; anything but a stored `false` is on. */
function mergePdfSections(stored) {
  const source = stored && typeof stored === "object" ? stored : {};
  return Object.fromEntries(SECTION_KEYS.map((key) => [key, source[key] !== false]));
}

/** Only the eight keys, as booleans - what is worth storing. */
function pdfSectionsFor(input) {
  const source = input && typeof input === "object" ? input : {};
  return Object.fromEntries(SECTION_KEYS.map((key) => [key, source[key] !== false]));
}
const BRAND_ASSET_KEYS = ["coverImageUrl", "thankYouImageUrl", "coverSets"];

/*
 * The words the page printed before the reference design, per key.
 *
 * A snapshot raised then stored the *merged* wording - defaults and overrides together - so a
 * version from that time carries "The celebration" as though a brand had chosen it. It had not:
 * those are the template's old defaults, and the template's wording is the code's to change, not
 * a setting frozen with the version. A stored value equal to one of these reads as "nothing
 * chosen", so the current default prints; a brand's own words are never on this list.
 */
const LEGACY_PDF_CONTENT = {
  eventSectionLabel: ["The celebration"],
  eventSectionTitle: ["Event Coverage"],
  deliverablesTitle: ["Premium Deliverables"],
  deliverableFootnote: ["Storage to be provided by client for raw data delivery."],
  closingSignature: ["- TEAM DON'T BLINK STUDIOZ -"],
};

const isLegacyDefault = (key, value) => (LEGACY_PDF_CONTENT[key] || []).includes(value);

/**
 * The Journey & Legacy timeline a brand prints until it writes its own: the reference design's
 * entries. Each row is a year, a title, a line of detail and the place it names on the right.
 */
const DEFAULT_JOURNEY = [
  { year: "2012", title: "Brand Inception", detail: "Fine-art vision created for modern luxury weddings.", place: "The Story Begins" },
  { year: "2018", title: "Studio Foundations", detail: "Headquarters launch in Erode • With 2 - Full Time Employees", place: "Erode City - TN" },
  { year: "2022", title: "Service & Brand Expansion", detail: "Introducing Services • 5000 Sq Ft Workspace - Erode • 10 - Full Time Employees", place: "Qua Qua | Corp" },
  { year: "2023", title: "Branch Expansion", detail: "1st Branch Expansion • 16 - Full Time Employees • 2 - Branches", place: "Tiruppur - TN" },
  { year: "2024", title: "Metro Expansion", detail: "25 - Full Time Employees • 3 - Branches", place: "Bangalore - KA" },
  { year: "2025", title: "Overseas & Pan-India", detail: "65 - Full Time Employees • 7 - Branches", place: "Shah Alam - Malaysia | Hyderabad - TL | Vizag - AP | Coimbatore - TN" },
  { year: "2026", title: "Next Plans & Branches", detail: "Continuous innovation, new services at affordable pricing & to expand pan India", place: "Innovation and Future Plans" },
];

/**
 * The shoots each brand quotes for.
 *
 * Names, not codes: a quotation stores the shoot as the text Add Shoot offered - `payload.shoots[].shoot`
 * - and never an id, so this list has to be spelled the way that dropdown spells it. Every entry
 * below appears in `shootOptions` in `frontend/src/components/project-management/AddShootDialog.js`,
 * which is the studio's one vocabulary for a shoot;
 * `test/sales-quotation-brands.test.js` holds the two files to it.
 *
 * The split is per brand because a brand only ever quotes for its own kind of celebration - Qua Qua
 * does not photograph a Sangeeth and Dum Dum does not photograph a Naming ceremony - so the picture
 * sets in Settings offer each brand only its own shoots. It is the vocabulary that is split here,
 * not behaviour: nothing on the client's copy reads this list, and no template branches on a brand.
 */
const BRAND_SHOOTS = {
  DUM_DUM: [
    "Bride Haldi", "Groom Haldi", "Bride Making", "Groom Making", "Engagement", "Haldi", "Mehandi",
    "Post Wedding", "Pre Wedding", "Couple Shoot IH", "Reception", "Sangeeth", "Wedding", "Wedding + Reception",
  ],
  QUA_QUA: [
    "Baby Shoot IH", "Baby Shoot OH", "Baby Shoot_CP", "Baby Shower", "Birthday Shoot", "Ear Piercing",
    "Maternity CP", "Maternity IH", "Maternity OH", "Naming ceremony", "New Born", "Puberty Function", "Puberty Outdoor",
  ],
  CORP: ["Corporate", "Industrial"],
};

/** The shoots a brand may build a picture set from; an unknown code offers none. */
const shootsForBrand = (code) => (BRAND_SHOOTS[code] || []).slice();

/**
 * The pictures and the timeline, as stored on the brand. Every URL null and every list empty until
 * somebody uploads; the page prints the sections it has pictures for.
 */
const DEFAULT_PDF_ASSETS = {
  coverImageUrl: null,
  indiaMapUrl: null,
  thankYouImageUrl: null,
  /*
   * The cover and Thank You photographs, per group of shoots.
   *
   * [{ shoots: ["Engagement", "Reception"], coverImageUrl, thankYouImageUrl }] - a quotation prints
   * the set its shoots fall in, so a wedding opens on a wedding photograph and an engagement on an
   * engagement one. The first set is also the fallback: a quotation whose shoots match no set at
   * all, or which names no shoot, prints that one. See `resolveCoverSet`.
   */
  coverSets: [],
  // [{ title: "Erode", subtitle: "Tamil Nadu", photos: ["https://..."] }]
  infrastructure: [],
  // [{ year, title, detail, place }] - empty means DEFAULT_JOURNEY prints.
  journey: [],
};

const asString = (value) => (typeof value === "string" ? value.trim() : "");

/** Lowercased with every separator dropped, so "Baby Shoot_CP", "Baby Shoot CP" and "baby shootcp" meet. */
const foldShoot = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Which picture set a quotation prints, given the shoots on it.
 *
 * The main event decides it. That is the shoot the page already leads with - its name is the event
 * type under the couple's names - so the photograph the client opens on is the photograph of what
 * they are mainly buying. Where the main event is in no set, any other shoot on the quotation
 * answers, taking the sets in the order the studio arranged them; where nothing matches, the first
 * set prints, which is what makes it the default.
 *
 * Returns null only when there are no sets at all, in which case the brand's plain cover and Thank
 * You photographs print - how every brand configured before picture sets existed still reads.
 */
function resolveCoverSet(sets, shoots, religion) {
  const rows = Array.isArray(sets) ? sets.filter(Boolean) : [];
  if (!rows.length) return null;
  const list = Array.isArray(shoots) ? shoots.filter(Boolean) : [];
  const holds = (set, name) => (set.shoots || []).some((entry) => foldShoot(entry) === name);

  const wanted = String(religion || "").trim().toLowerCase();
  const namesReligion = (set) => String(set?.religion || "").trim().toLowerCase() === wanted;
  /*
   * A set naming no religion is used for any, exactly as an empty shoot list is used for any shoot.
   * A set that names one is only ever used for that one - so a "Christian Wedding" set can never
   * print over a Hindu wedding, which is the whole point of naming it.
   */
  const eligible = rows.filter((set) => !String(set?.religion || "").trim() || (wanted && namesReligion(set)));
  const pool = eligible.length ? eligible : rows;

  const main = list.find((shoot) => shoot?.isMainEvent) || list[0] || null;
  const mainName = foldShoot(main?.shoot);
  const names = list.map((shoot) => foldShoot(shoot?.shoot)).filter(Boolean);

  /*
   * The most specific set wins, and specificity is scored rather than branched.
   *
   * Naming the religion counts for more than naming a shoot, because a wedding's religion decides
   * the photographs more sharply than which of its shoots is the main event - a Christian wedding
   * must not open on a Hindu ceremony because the shoot matched first.
   *
   * With no religions named anywhere, every score comes from the shoots alone and the order is
   * exactly what it was before this existed: the main event's set, then any shoot's, then the
   * first. A tie keeps the earlier set, so Set 1 stays the fallback it says it is.
   */
  const score = (set) => (wanted && namesReligion(set) ? 4 : 0)
    + (mainName && holds(set, mainName) ? 2 : 0)
    + (names.some((name) => holds(set, name)) ? 1 : 0);

  let best = pool[0];
  let bestScore = score(best);
  for (const set of pool.slice(1)) {
    const value = score(set);
    if (value > bestScore) { best = set; bestScore = value; }
  }
  return best;
}

/** The stored assets laid over the defaults, every row cleaned to the shape the page reads. */
function mergePdfAssets(stored) {
  const source = stored && typeof stored === "object" ? stored : {};
  const coverImageUrl = asString(source.coverImageUrl) || null;
  const thankYouImageUrl = asString(source.thankYouImageUrl) || null;
  const storedSets = (Array.isArray(source.coverSets) ? source.coverSets : [])
    .map((set) => ({
      shoots: (Array.isArray(set?.shoots) ? set.shoots : []).map(asString).filter(Boolean),
      coverImageUrl: asString(set?.coverImageUrl) || null,
      thankYouImageUrl: asString(set?.thankYouImageUrl) || null,
      /*
       * The religion this set is used for — one, or none for "any".
       *
       * A second thing a set may be chosen by, beside its shoots, and blank means any religion the
       * same way an empty shoot list means any shoot. One rather than several: a set is a pair of
       * photographs, and a pair that suited two religions equally is the fallback set's job.
       *
       * Dum Dum's quotation is the only one that asks which religion a wedding is, so on every other
       * brand this stays blank and the set is chosen by its shoots alone, as it always was.
       */
      religion: asString(set?.religion),
    }))
    .filter((set) => set.shoots.length || set.religion || set.coverImageUrl || set.thankYouImageUrl);
  /*
   * A brand configured before picture sets existed reads as one set holding exactly what it had:
   * no shoots, so it matches nothing and is only ever the fallback - which is how a single cover
   * and Thank You photograph already behaved. Settings then shows those pictures as the first set
   * rather than as nothing, and no quotation changes.
   */
  const coverSets = storedSets.length || !(coverImageUrl || thankYouImageUrl)
    ? storedSets
    : [{ shoots: [], religion: "", coverImageUrl, thankYouImageUrl }];
  const infrastructure = (Array.isArray(source.infrastructure) ? source.infrastructure : [])
    .map((group) => ({
      title: asString(group?.title),
      subtitle: asString(group?.subtitle),
      photos: (Array.isArray(group?.photos) ? group.photos : []).map(asString).filter(Boolean),
    }))
    .filter((group) => group.title || group.photos.length);
  const journey = (Array.isArray(source.journey) ? source.journey : [])
    .map((row) => ({ year: asString(row?.year), title: asString(row?.title), detail: asString(row?.detail), place: asString(row?.place) }))
    .filter((row) => row.year || row.title);
  return {
    coverImageUrl,
    indiaMapUrl: asString(source.indiaMapUrl) || null,
    thankYouImageUrl,
    coverSets,
    infrastructure,
    journey,
  };
}

/**
 * The stored overrides laid over the defaults, key by key. An override that is blank or not a
 * string is not an override - the default prints - so clearing a field in Settings is how a brand
 * goes back to the standard wording rather than to nothing.
 */
function mergePdfContent(overrides) {
  const source = overrides && typeof overrides === "object" ? overrides : {};
  return Object.fromEntries(PDF_CONTENT_KEYS.map((key) => {
    const value = typeof source[key] === "string" ? source[key].trim() : "";
    return [key, value && !isLegacyDefault(key, value) ? value : DEFAULT_PDF_CONTENT[key]];
  }));
}

/**
 * The brand's own pictures and the studio's, as one object the page reads.
 *
 * Each side is cleaned on its own and then the studio's keys are laid over the brand's, so a
 * brand row from before the split - which may still hold a map or a collage of its own - cannot
 * put back what the studio has since taken over.
 */
function combinePdfAssets(brandStored, generalStored) {
  const brand = mergePdfAssets(brandStored);
  const general = mergePdfAssets(generalStored);
  return { ...brand, ...Object.fromEntries(GENERAL_ASSET_KEYS.map((key) => [key, general[key]])) };
}

/** Only the keys the page knows, only where something was typed - what is worth storing. */
function pdfContentOverrides(input, keys = PDF_CONTENT_KEYS) {
  const source = input && typeof input === "object" ? input : {};
  const kept = Object.fromEntries(keys
    .map((key) => [key, typeof source[key] === "string" ? source[key].trim() : ""])
    .filter(([key, value]) => value && !isLegacyDefault(key, value)));
  return Object.keys(kept).length ? kept : null;
}

module.exports = {
  BRANDS,
  BRAND_CODES,
  DEFAULT_BRAND_CODE,
  DEFAULT_TERMS,
  DEFAULT_PDF_CONTENT,
  DEFAULT_JOURNEY,
  DEFAULT_PDF_ASSETS,
  PDF_CONTENT_KEYS,
  GENERAL_PDF_CONTENT_KEYS,
  BRAND_PDF_CONTENT_KEYS,
  PRICING_PDF_CONTENT_KEYS,
  MAX_VALIDITY_MONTHS,
  GENERAL_ASSET_KEYS,
  BRAND_ASSET_KEYS,
  MAX_INFRASTRUCTURE_PHOTOS,
  BRAND_SHOOTS,
  shootsForBrand,
  resolveCoverSet,
  SECTION_KEYS,
  DEFAULT_PDF_SECTIONS,
  clientDownloadAllowed,
  mergePdfSections,
  pdfSectionsFor,
  combinePdfAssets,
  LEGACY_PDF_CONTENT,
  isLegacyDefault,
  brandCodeFor,
  brandNameFor,
  verticalNameFor,
  mergePdfContent,
  mergePdfAssets,
  pdfContentOverrides,
};
