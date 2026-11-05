const prisma = require("../../../config/db");
const {
  BRANDS,
  DEFAULT_BRAND_CODE,
  DEFAULT_TERMS,
  DEFAULT_PDF_CONTENT,
  DEFAULT_JOURNEY,
  brandCodeFor,
  brandNameFor,
  verticalNameFor,
  mergePdfContent,
  mergePdfAssets,
  pdfContentOverrides,
  combinePdfAssets,
  GENERAL_PDF_CONTENT_KEYS,
  BRAND_PDF_CONTENT_KEYS,
  GENERAL_ASSET_KEYS,
  mergePdfSections,
  clientDownloadAllowed,
  shootsForBrand,
  resolveCoverSet,
} = require("./defaults");
const { createSettingsService } = require("../../image-selection/settings/service");

// Settings -> Organization: the Global Name and Global Logo every document falls back to.
const studioSettings = createSettingsService();

/**
 * The brand behind a quotation: what it offers, and what it froze onto the version it raised.
 *
 * Two jobs, and the second is the one the whole module exists for.
 *
 * **Configuration** - `brandConfiguration(code)` is what the Quotation Generator loads when a brand
 * is picked: its services and deliverables (each carrying the project definition it points at, so
 * the service table can draw the timing and size columns it always has), its packages, its terms,
 * its event types and its PDF wording, every override already laid over its default. One read per
 * table, never one per row.
 *
 * **Snapshot** - `snapshotForQuotation(payload)` is called once, as a version is *raised*, and
 * returns what to stamp onto it: the brand column and a `brandSnapshot` object holding the name,
 * the logo, the terms, the wording and the GST rate that applied at that moment. The public page
 * and the PDF read the snapshot and never the tables, so `DBS-QO-DD-ERD-000001` keeps printing the
 * terms and the mark it was sent with however the brand's settings change afterwards. Line prices
 * are frozen the same way, one level down: each service row carries the `unitPrice` it was added
 * at, stamped by the generator from the brand's default at the time.
 */

const fail = (status, message) => Object.assign(new Error(message), { status });

const number = (value) => (value === null || value === undefined ? null : Number(value));

// The same shape the project register includes on a definition, so a brand service's linked
// definition is exactly what the service table already knows how to draw.
const serviceDefinitionInclude = {
  timingOptionSet: { include: { values: { where: { isActive: true }, orderBy: [{ label: "asc" }] } } },
  sizeOptionSet: { include: { values: { where: { isActive: true }, orderBy: [{ label: "asc" }] } } },
};
const deliverableDefinitionInclude = {
  sizeOptionSet: { include: { values: { where: { isActive: true }, orderBy: [{ label: "asc" }] } } },
  /*
   * The brands a deliverable is sold by, and the variants each sells it in - the same shape the
   * project register includes, so a brand deliverable's linked definition is exactly what the
   * Quotation Generator already knows how to read.
   *
   * Without them, a brand that configures its own deliverable list hands the generator definitions
   * carrying no brands at all: the Choose Deliverables picker would list each deliverable once
   * under its bare name instead of one entry per variant, and a variant mapped onto a service's
   * pricing row could never be resolved, so nothing would follow that service in. A brand that
   * configures nothing is answered with the project catalogue, which always carried them - which is
   * why this was invisible until the first brand configured a list.
   */
  brands: {
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { variants: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
  },
};

function serializeBrand(row) {
  return {
    code: row.code,
    name: row.name,
    verticalName: row.verticalName,
    logoUrl: row.logoUrl || null,
    // Both halves: what is stored (for the settings form) and what prints (for everything else).
    pdfOverrides: row.pdfContent && typeof row.pdfContent === "object" ? row.pdfContent : {},
    pdfContent: mergePdfContent(row.pdfContent),
    // The pictures and the timeline, cleaned to the shape the page reads.
    pdfAssets: mergePdfAssets(row.pdfAssets),
    gstPercent: number(row.gstPercent),
    defaultDiscountPercent: number(row.defaultDiscountPercent),
    // Whether the client may save this brand's quotation as a file. Anything but a stored `true`
    // is No - a brand that has never been asked has not said yes.
    allowClientDownload: clientDownloadAllowed(row),
    isActive: row.isActive !== false,
    sortOrder: row.sortOrder || 0,
    updatedAt: row.updatedAt,
  };
}

/** A brand that is not in the table yet, answered from the built-in list so nothing refuses to load. */
function builtInBrand(code) {
  const known = BRANDS.find((brand) => brand.code === code);
  if (!known) return null;
  return serializeBrand({ code: known.code, name: known.name, verticalName: known.verticalName, isActive: true, sortOrder: BRANDS.indexOf(known) });
}

const serializeService = (row, definition) => ({
  id: row.id,
  brandCode: row.brandCode,
  serviceDefinitionId: row.serviceDefinitionId || null,
  name: row.name,
  defaultPrice: number(row.defaultPrice),
  isActive: row.isActive !== false,
  sortOrder: row.sortOrder || 0,
  definition: definition || null,
});

const serializeDeliverable = (row, definition) => ({
  id: row.id,
  brandCode: row.brandCode,
  deliverableDefinitionId: row.deliverableDefinitionId || null,
  name: row.name,
  defaultPrice: number(row.defaultPrice),
  isActive: row.isActive !== false,
  sortOrder: row.sortOrder || 0,
  definition: definition || null,
});

const serializeTerm = (row) => ({ id: row.id, brandCode: row.brandCode, title: row.title, body: row.body, isActive: row.isActive !== false, sortOrder: row.sortOrder || 0 });

const serializePackage = (row) => ({
  id: row.id,
  brandCode: row.brandCode,
  name: row.name,
  description: row.description || "",
  isActive: row.isActive !== false,
  sortOrder: row.sortOrder || 0,
  items: (row.items || []).map((item) => ({
    id: item.id,
    itemType: item.itemType,
    masterId: item.masterId,
    quantity: item.quantity || 1,
    defaultPrice: number(item.defaultPrice),
    sortOrder: item.sortOrder || 0,
  })),
});

async function listBrands({ includeInactive = false } = {}) {
  const rows = await prisma.salesQuotationBrand.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  if (rows.length) return rows.map(serializeBrand);
  // A database the migration's seed has not reached: the built-in three, so the generator still
  // has a selector and the settings screen still has something to configure.
  return BRANDS.map((brand) => builtInBrand(brand.code));
}

async function readBrand(code) {
  const row = await prisma.salesQuotationBrand.findUnique({ where: { code } });
  return row ? serializeBrand(row) : builtInBrand(code);
}

/**
 * Everything the generator or the settings screen needs for one brand, in one answer.
 *
 * `includeInactive` is the settings screen's reading - a retired service is still a row to be
 * re-enabled - while the generator reads only what may be picked. Either way every table is read
 * once and the linked definitions once more, by id list.
 */
async function brandConfiguration(code, { includeInactive = false } = {}) {
  const brand = await readBrand(code);
  if (!brand) return null;
  const active = includeInactive ? {} : { isActive: true };
  const order = [{ sortOrder: "asc" }, { name: "asc" }];

  const [services, deliverables, packages, terms, shoots] = await Promise.all([
    prisma.salesQuotationBrandService.findMany({ where: { brandCode: code, ...active }, orderBy: order }),
    prisma.salesQuotationBrandDeliverable.findMany({ where: { brandCode: code, ...active }, orderBy: order }),
    prisma.salesQuotationBrandPackage.findMany({ where: { brandCode: code, ...active }, include: { items: { orderBy: { sortOrder: "asc" } } }, orderBy: order }),
    prisma.salesQuotationBrandTerm.findMany({ where: { brandCode: code, ...active }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.salesQuotationBrandShoot.findMany({ where: { brandCode: code, ...active }, orderBy: order }),
  ]);

  const serviceDefinitionIds = [...new Set(services.map((row) => row.serviceDefinitionId).filter(Boolean))];
  const deliverableDefinitionIds = [...new Set(deliverables.map((row) => row.deliverableDefinitionId).filter(Boolean))];
  const [serviceDefinitions, deliverableDefinitions] = await Promise.all([
    serviceDefinitionIds.length ? prisma.projectServiceDefinition.findMany({ where: { id: { in: serviceDefinitionIds } }, include: serviceDefinitionInclude }) : [],
    deliverableDefinitionIds.length ? prisma.projectDeliverableDefinition.findMany({ where: { id: { in: deliverableDefinitionIds } }, include: deliverableDefinitionInclude }) : [],
  ]);
  const serviceDefinitionById = new Map(serviceDefinitions.map((row) => [row.id, row]));
  const deliverableDefinitionById = new Map(deliverableDefinitions.map((row) => [row.id, row]));

  return {
    brand,
    services: services.map((row) => serializeService(row, serviceDefinitionById.get(row.serviceDefinitionId))),
    deliverables: deliverables.map((row) => serializeDeliverable(row, deliverableDefinitionById.get(row.deliverableDefinitionId))),
    packages: packages.map(serializePackage),
    terms: terms.map(serializeTerm),
    // The brand's pictures as the screen edits them, not as the column happens to hold them: a
    // brand configured before picture sets existed reads back as one set holding what it had.
    pdfAssets: mergePdfAssets(brand.pdfAssets),
    /*
     * The shoots this brand quotes for: the only ones a picture set may be built from, and - since
     * Field Settings started maintaining them - the only ones the generator's Add Shoot offers a
     * quotation raised under this brand.
     *
     * `shootsForBrand` is the fallback rather than the answer. It is what the constant held before
     * this became a table, and it stands in for a brand with no rows of its own so a database that
     * has not run the seed behaves exactly as the application did before.
     */
    shoots: shoots.length ? shoots.map((row) => row.name) : shootsForBrand(code),
    /*
     * The same shoots as rows, for the one screen that edits them.
     *
     * `shoots` above is the list every *reader* wants - the generator's Add Shoot, the picture sets -
     * and names are all a quotation ever stores of a shoot. Renaming or removing one needs the row it
     * came from, so Field Settings reads these instead. Empty where the brand is still falling back
     * to the constant, which is the honest answer: there is nothing stored yet to edit.
     */
    shootRows: shoots.map((row) => ({ id: row.id, name: row.name, isActive: row.isActive, sortOrder: row.sortOrder })),
    // What prints when the brand has configured nothing, so the settings screen can show it and
    // the generator can say which it is using.
    defaultTerms: DEFAULT_TERMS,
    pdfDefaults: DEFAULT_PDF_CONTENT,
    journeyDefaults: DEFAULT_JOURNEY,
  };
}

/*
 * ── What the page prints beyond the rows ────────────────────────────────────────────────────────
 *
 * The client's copy prints things a quotation does not hold: the studio's name and mark, the
 * branch's website and phone, the list of the studio's locations, the brand's pictures and its
 * timeline. `presentationFor` gathers them as they stand right now; `snapshotForQuotation` freezes
 * that answer onto the version being raised; and `presentationForQuotation` is what the public
 * page reads - the version's own snapshot, with today's answer filling only what a snapshot older
 * than this shape never held.
 */

/** Lowercased with separators dropped, so "Erode TN", "Erode" and "erode" meet. */
const fold = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

const branchSelect = { id: true, name: true, city: true, state: true, phone: true, email: true, websiteUrl: true, isHeadOffice: true, isActive: true };

const serializeBranch = (row) => (row ? { id: row.id, name: row.name, city: row.city || "", state: row.state || "", phone: row.phone || "", email: row.email || "", websiteUrl: row.websiteUrl || "" } : null);

/**
 * The branch a quotation was raised in: by its resolved id first, then by the text it holds -
 * "Erode", "Erode TN", "Hyderabad" - against the branch's name and city. Null when nothing
 * matches, in which case the head office answers for the website and the phone.
 */
function matchBranch(branches, { branchId, names }) {
  if (branchId) {
    const byId = branches.find((row) => row.id === Number(branchId));
    if (byId) return byId;
  }
  for (const name of names.map(fold).filter(Boolean)) {
    const found = branches.find((row) => fold(row.name) === name || fold(row.city) === name)
      || branches.find((row) => fold(row.name).startsWith(name) || name.startsWith(fold(row.city) || "\u0000"));
    if (found) return found;
  }
  return null;
}

/**
 * Everything the page prints that is not the quotation's own rows, as it stands now.
 *
 * `payload` and `quotation` are read only for the branch: `branchId` where the reference was
 * resolved, the free text otherwise. Everything else is the brand's, the studio's, or the branch
 * register's.
 */
async function presentationFor(code, { payload = {}, quotation = {} } = {}) {
  const [brand, terms, settings, studio, branches] = await Promise.all([
    readBrand(code),
    prisma.salesQuotationBrandTerm.findMany({ where: { brandCode: code, isActive: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.salesQuotationSettings.findUnique({ where: { id: "default" } }).catch(() => null),
    studioSettings.read().catch(() => ({})),
    prisma.branch.findMany({ where: { isActive: true }, select: branchSelect, orderBy: [{ isHeadOffice: "desc" }, { name: "asc" }] }).catch(() => []),
  ]);
  /*
   * What was chosen, and nothing else: this is what the snapshot freezes. The studio's shared
   * words (Settings -> Quotation Settings -> General) answer for the shared keys and the brand's
   * own for the rest, so a brand row from before the split cannot keep a trademark paragraph the
   * studio has since taken over. The template's own defaults are read at print time, so the
   * wording of the design can be improved without a version from last month keeping the old words
   * as though somebody had picked them.
   */
  const pdfOverrides = {
    ...(pdfContentOverrides(brand?.pdfOverrides || null, BRAND_PDF_CONTENT_KEYS) || {}),
    ...(pdfContentOverrides(settings?.pdfContent || null, GENERAL_PDF_CONTENT_KEYS) || {}),
  };
  const pdfContent = mergePdfContent(pdfOverrides);
  // The brand's cover and Thank You photographs; the studio's map, collages and timeline.
  const combined = combinePdfAssets(brand?.pdfAssets, settings?.pdfAssets);
  /*
   * Which of the brand's picture sets this quotation opens and closes on - decided here, once,
   * from the shoots the quotation actually holds, so `coverImageUrl` and `thankYouImageUrl` are
   * already the right two by the time anything reads them. The page is told a cover, not a rule:
   * it has never known about shoots and still does not, and the snapshot freezes the two links,
   * so a version keeps the photographs it was sent with even if the set is later re-pointed.
   */
  /*
   * Which set, chosen by the shoots and the religion together — two things a set may be named for,
   * and an empty list on either means "any", exactly as the shoots alone always worked.
   *
   * `payload.religion` is the Category every brand's quotation asks for, from that brand's own
   * list; a quotation raised before a brand had categories carries none, and its set is chosen by
   * its shoots alone, as it always was.
   */
  const chosen = resolveCoverSet(combined.coverSets, payload.shoots, payload.religion);
  const assets = chosen
    ? { ...combined, coverImageUrl: chosen.coverImageUrl, thankYouImageUrl: chosen.thankYouImageUrl }
    : combined;
  const assetsForPage = { ...assets };
  delete assetsForPage.coverSets;
  const branch = matchBranch(branches, {
    branchId: quotation.branchId,
    names: [quotation.sourceBranch, payload.sourceBranch, payload.assignedBranch, payload.nearestBranch],
  });
  const headOffice = branches.find((row) => row.isHeadOffice) || branches[0] || null;
  const studioName = String(studio?.studioName || "").trim();
  return {
    brand,
    settings,
    terms: terms.length ? terms.map((term) => ({ title: term.title, body: term.body })) : DEFAULT_TERMS.map((term) => ({ ...term })),
    termsSource: terms.length ? "brand" : "default",
    pdfContent,
    pdfOverrides,
    presentation: {
      // The name at the head of the page: the brand's own display name, else the Global Name.
      studioName,
      // The name at the head of the page is the Global Name, and nothing a brand types; the page
      // prints the bundled name where even that is blank.
      brandDisplayName: studioName,
      globalLogoUrl: studio?.galleryLogoUrl || null,
      // Which of the four shared sections print at all - Settings -> Quotation Settings -> General.
      sections: mergePdfSections(settings?.pdfSections),
      // The two photographs this quotation prints, not the sets they were chosen from: the page
      // has no use for the others and a snapshot should not carry the studio's whole configuration.
      assets: { ...assetsForPage, journey: assets.journey.length ? assets.journey : DEFAULT_JOURNEY.map((row) => ({ ...row })) },
      branch: serializeBranch(branch),
      headOffice: serializeBranch(headOffice),
      // Where the page says the studio is: every active branch, the head office first.
      locations: branches.map((row) => ({ name: row.city || row.name, state: row.state || "", isHeadOffice: row.isHeadOffice })),
      contact: {
        phone: pdfContent.contactPhone || branch?.phone || headOffice?.phone || "",
        websiteUrl: pdfContent.websiteUrl || branch?.websiteUrl || headOffice?.websiteUrl || "",
        email: branch?.email || headOffice?.email || "",
        socialHandle: pdfContent.socialHandle || "",
      },
    },
  };
}

/**
 * What the public page prints for one stored version: its own snapshot, and today's answer only
 * where the snapshot is silent.
 *
 * A version raised under this shape carries everything and today's tables are not consulted for
 * it. A version raised before the pictures and the branch were snapshotted carries the words and
 * the terms but not those, so they - and only they - are read live; a version raised before
 * snapshots at all is read live entirely, which is the only answer there is for it. Nothing here
 * is written back.
 */
async function presentationForQuotation(row) {
  const payload = row?.payload || {};
  const snapshot = payload.brandSnapshot && typeof payload.brandSnapshot === "object" ? payload.brandSnapshot : null;
  const code = brandCodeFor(row?.quotationBrand) || brandCodeOfPayload(payload);
  if (snapshot?.presentation?.assets && snapshot?.presentation?.branch !== undefined) return snapshot;
  const live = await presentationFor(code, { payload, quotation: row || {} });
  return {
    code,
    name: snapshot?.name || live.brand?.name || brandNameFor(code),
    verticalName: snapshot?.verticalName || live.brand?.verticalName || verticalNameFor(code),
    logoUrl: snapshot?.logoUrl || row?.logoUrl || live.presentation.globalLogoUrl || null,
    pdfContent: snapshot?.pdfContent ? mergePdfContent(snapshot.pdfContent) : live.pdfContent,
    terms: snapshot?.terms || live.terms,
    termsSource: snapshot?.termsSource || live.termsSource,
    gstPercent: snapshot?.gstPercent ?? gstPercentFor(payload, live.brand, live.settings),
    snapshotAt: snapshot?.snapshotAt || null,
    presentation: live.presentation,
    presentationSource: snapshot ? "snapshot+live" : "live",
  };
}

/**
 * Whether the client holding this quotation's link may download it.
 *
 * The brand's own answer, read from the brand table as it stands *now* rather than from the
 * version's snapshot. Everything else the public page prints is frozen onto the version, and
 * deliberately so - the client must go on reading the terms and the prices they were sent - but
 * this is not part of what was sent. It is the studio's standing decision about the document, and
 * withdrawing it has to reach the links already out.
 *
 * False for anything unreadable: an unrecognised brand, a brand row that is not there yet, a
 * database that cannot be reached. Refusing a download nobody has enabled is the safe failure.
 */
async function allowsClientDownload(row) {
  try {
    const code = brandCodeFor(row?.quotationBrand) || brandCodeOfPayload(row?.payload || {});
    const brand = await readBrand(code);
    return clientDownloadAllowed(brand);
  } catch {
    return false;
  }
}

/**
 * The brand a payload was filled in for: the brand column if the client sent one, the vertical
 * the generator has always stored otherwise, and Dum Dum when neither says anything.
 */
function brandCodeOfPayload(payload) {
  return brandCodeFor(payload?.quotationBrand) || brandCodeFor(payload?.vertical) || DEFAULT_BRAND_CODE;
}

/** The GST rate a version is raised under: what the generator priced with, else the brand's, else the studio's. */
function gstPercentFor(payload, brand, settings) {
  const candidates = [payload?.rates?.gstPercent, payload?.gstPercent, brand?.gstPercent, settings?.gstPercent, 18];
  for (const candidate of candidates) {
    // Null and blank are "not set", and must not read as zero - a brand that has not said its
    // rate is not a brand that charges no GST.
    if (candidate === null || candidate === undefined || candidate === "") continue;
    const value = Number(candidate);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return 18;
}

/**
 * What to stamp onto a version being raised right now.
 *
 * Reads the brand once. Not cached: a version raised a second after the terms are saved must carry
 * the new terms, which is the whole rule. `globalLogoUrl` is the studio's Global Logo as
 * `documentBranding` snapshotted it; the brand's own mark wins where it has one.
 */
async function snapshotForQuotation(payload, { globalLogoUrl = null } = {}) {
  const code = brandCodeOfPayload(payload);
  const live = await presentationFor(code, { payload, quotation: payload });
  // The Global Logo from Settings -> Organization, and nothing else: a brand has no mark of its own
  // on the quotation. Null - nothing configured - is what the page prints the bundled mark for.
  const logoUrl = globalLogoUrl || live.presentation.globalLogoUrl || null;
  return {
    quotationBrand: code,
    logoUrl,
    brandSnapshot: {
      code,
      name: live.brand?.name || brandNameFor(code),
      verticalName: live.brand?.verticalName || verticalNameFor(code),
      logoUrl,
      // The brand's overrides only - see `presentationFor`. The page lays them over its defaults.
      pdfContent: live.pdfOverrides,
      terms: live.terms,
      termsSource: live.termsSource,
      gstPercent: gstPercentFor(payload, live.brand, live.settings),
      // The pictures, the timeline, the branch and the studio's name as they stood - the page
      // prints these and never today's tables.
      presentation: live.presentation,
      snapshotAt: new Date().toISOString(),
    },
  };
}

/**
 * Refuses a service or deliverable that may not be *newly* chosen for this brand.
 *
 * A row naming a brand master is checked against the brand's active masters - a retired service
 * cannot be picked for a new quotation, and a Qua Qua master cannot ride onto a Corp one. A row the
 * source version already held is not new: it stays, whatever has since happened to its master,
 * because a historical line must not vanish from the negotiation it belongs to. Rows naming no
 * master - the project catalogue, as every quotation used before brands - are not this rule's to
 * judge.
 */
async function assertNewSelectionsOffered(payload, sourcePayload = null) {
  const code = brandCodeOfPayload(payload);
  const carried = {
    services: new Set((sourcePayload?.services || []).map((row) => row?.brandServiceId).filter(Boolean)),
    deliverables: new Set((sourcePayload?.deliverables || []).map((row) => row?.brandDeliverableId).filter(Boolean)),
  };
  const newServiceIds = [...new Set((payload.services || []).map((row) => row?.brandServiceId).filter((id) => id && !carried.services.has(id)))];
  const newDeliverableIds = [...new Set((payload.deliverables || []).map((row) => row?.brandDeliverableId).filter((id) => id && !carried.deliverables.has(id)))];
  if (!newServiceIds.length && !newDeliverableIds.length) return;

  const [services, deliverables] = await Promise.all([
    newServiceIds.length ? prisma.salesQuotationBrandService.findMany({ where: { id: { in: newServiceIds }, brandCode: code, isActive: true }, select: { id: true } }) : [],
    newDeliverableIds.length ? prisma.salesQuotationBrandDeliverable.findMany({ where: { id: { in: newDeliverableIds }, brandCode: code, isActive: true }, select: { id: true } }) : [],
  ]);
  const offeredServices = new Set(services.map((row) => row.id));
  const offeredDeliverables = new Set(deliverables.map((row) => row.id));
  const refusedServices = (payload.services || []).filter((row) => row?.brandServiceId && !carried.services.has(row.brandServiceId) && !offeredServices.has(row.brandServiceId));
  const refusedDeliverables = (payload.deliverables || []).filter((row) => row?.brandDeliverableId && !carried.deliverables.has(row.brandDeliverableId) && !offeredDeliverables.has(row.brandDeliverableId));
  if (!refusedServices.length && !refusedDeliverables.length) return;
  const names = [...refusedServices.map((row) => row.serviceName), ...refusedDeliverables.map((row) => row.deliverableName)].filter(Boolean);
  throw fail(422, `${names.length ? names.join(", ") : "One of the selected items"} is no longer offered for ${brandNameFor(code) || "this brand"}. Remove it and choose from the current list.`);
}

// ---- administration: Settings -> Quotation Settings ----

/**
 * The content every brand's quotation shares, as Settings -> Quotation Settings -> General edits
 * it: the shared words as stored and as they print, and the shared pictures and timeline.
 */
async function generalConfiguration() {
  const [settings, branches] = await Promise.all([
    prisma.salesQuotationSettings.findUnique({ where: { id: "default" } }).catch(() => null),
    // Every active branch Organization -> Branches holds, for the infrastructure collage's own
    // Branch picker below - the same register `presentationFor` reads for the printed page. Its
    // `state` is what fills the collage's State field the moment a branch is picked.
    prisma.branch.findMany({ where: { isActive: true }, select: { name: true, state: true }, orderBy: { name: "asc" } }).catch(() => []),
  ]);
  const pdfOverrides = pdfContentOverrides(settings?.pdfContent || null, GENERAL_PDF_CONTENT_KEYS) || {};
  const merged = mergePdfContent(pdfOverrides);
  const assets = mergePdfAssets(settings?.pdfAssets);
  return {
    pdfOverrides,
    pdfContent: Object.fromEntries(GENERAL_PDF_CONTENT_KEYS.map((key) => [key, merged[key]])),
    pdfAssets: Object.fromEntries(GENERAL_ASSET_KEYS.map((key) => [key, assets[key]])),
    pdfSections: mergePdfSections(settings?.pdfSections),
    pdfDefaults: Object.fromEntries(GENERAL_PDF_CONTENT_KEYS.map((key) => [key, DEFAULT_PDF_CONTENT[key]])),
    journeyDefaults: DEFAULT_JOURNEY,
    generalKeys: GENERAL_PDF_CONTENT_KEYS,
    branches: branches.map((row) => ({ name: row.name, state: row.state || "" })),
  };
}

/** Writes the shared words and pictures onto the studio's single settings row. */
async function updateGeneral(data, userId) {
  const row = { ...data, updatedByUserId: userId ?? null };
  await prisma.salesQuotationSettings.upsert({ where: { id: "default" }, update: row, create: { id: "default", ...row } });
  return generalConfiguration();
}

async function requireBrandRow(code) {
  const row = await prisma.salesQuotationBrand.findUnique({ where: { code } });
  if (row) return row;
  // The built-in three may be configured before the migration's seed row exists on some database;
  // creating the row on first write is the same answer the seed gives.
  const known = BRANDS.find((brand) => brand.code === code);
  if (!known) throw fail(404, "Quotation brand not found.");
  return prisma.salesQuotationBrand.create({ data: { code: known.code, name: known.name, verticalName: known.verticalName, sortOrder: BRANDS.indexOf(known) } });
}

async function updateBrand(code, data, userId) {
  await requireBrandRow(code);
  const row = await prisma.salesQuotationBrand.update({ where: { code }, data: { ...data, updatedByUserId: userId ?? null } });
  return serializeBrand(row);
}

async function nextSortOrder(model, where) {
  const last = await model.findFirst({ where, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  return (last?.sortOrder ?? -1) + 1;
}

/** Writes a new order for the brand's rows in one transaction; ids not named keep their place after. */
async function reorder(model, where, ids) {
  const rows = await model.findMany({ where, select: { id: true } });
  const known = new Set(rows.map((row) => row.id));
  const ordered = ids.filter((id) => known.has(id));
  await prisma.$transaction(ordered.map((id, index) => model.update({ where: { id }, data: { sortOrder: index } })));
}

/*
 * The shoots a brand quotes for, maintained in Settings → Field Settings → Quotation → Shoot Type.
 *
 * A plain named list per brand: no code, no price, nothing but the words and their order. It is read
 * in three places - this screen, the picture sets in Quotation Settings, and the generator's Add
 * Shoot - so it is stored once and each of them asks.
 */
async function createShoot(code, data) {
  await requireBrandRow(code);
  const name = String(data?.name || "").trim();
  // Twice under one brand is the picture sets being unable to say which set the shoot belongs to.
  const clash = await prisma.salesQuotationBrandShoot.findFirst({ where: { brandCode: code, name } });
  if (clash) throw fail(409, `"${name}" is already a shoot for this brand.`);
  const row = await prisma.salesQuotationBrandShoot.create({
    data: { brandCode: code, name, sortOrder: await nextSortOrder(prisma.salesQuotationBrandShoot, { brandCode: code }) },
  });
  return { id: row.id, name: row.name, isActive: row.isActive, sortOrder: row.sortOrder };
}

async function updateShoot(code, id, data) {
  const existing = await prisma.salesQuotationBrandShoot.findFirst({ where: { id, brandCode: code } });
  if (!existing) throw fail(404, "Shoot not found for this brand.");
  const name = data?.name === undefined ? undefined : String(data.name).trim();
  if (name && name !== existing.name) {
    const clash = await prisma.salesQuotationBrandShoot.findFirst({ where: { brandCode: code, name } });
    if (clash) throw fail(409, `"${name}" is already a shoot for this brand.`);
  }
  const row = await prisma.salesQuotationBrandShoot.update({
    where: { id },
    data: { ...(name === undefined ? {} : { name }), ...(data?.isActive === undefined ? {} : { isActive: data.isActive }) },
  });
  return { id: row.id, name: row.name, isActive: row.isActive, sortOrder: row.sortOrder };
}

async function deleteShoot(code, id) {
  const result = await prisma.salesQuotationBrandShoot.deleteMany({ where: { id, brandCode: code } });
  if (!result.count) throw fail(404, "Shoot not found for this brand.");
}

const reorderShoots = (code, ids) => reorder(prisma.salesQuotationBrandShoot, { brandCode: code }, ids);

async function createTerm(code, data) {
  await requireBrandRow(code);
  const row = await prisma.salesQuotationBrandTerm.create({ data: { ...data, brandCode: code, sortOrder: await nextSortOrder(prisma.salesQuotationBrandTerm, { brandCode: code }) } });
  return serializeTerm(row);
}

async function updateTerm(code, id, data) {
  const existing = await prisma.salesQuotationBrandTerm.findFirst({ where: { id, brandCode: code } });
  if (!existing) throw fail(404, "Term not found for this brand.");
  return serializeTerm(await prisma.salesQuotationBrandTerm.update({ where: { id }, data }));
}

async function deleteTerm(code, id) {
  const result = await prisma.salesQuotationBrandTerm.deleteMany({ where: { id, brandCode: code } });
  if (!result.count) throw fail(404, "Term not found for this brand.");
}

const reorderTerms = (code, ids) => reorder(prisma.salesQuotationBrandTerm, { brandCode: code }, ids);

module.exports = {
  listBrands,
  readBrand,
  brandConfiguration,
  brandCodeOfPayload,
  gstPercentFor,
  snapshotForQuotation,
  presentationFor,
  presentationForQuotation,
  allowsClientDownload,
  assertNewSelectionsOffered,
  updateBrand,
  generalConfiguration,
  updateGeneral,
  createShoot,
  updateShoot,
  deleteShoot,
  reorderShoots,
  createTerm,
  updateTerm,
  deleteTerm,
  reorderTerms,
};
