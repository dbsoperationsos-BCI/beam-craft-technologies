const { z } = require("zod");
const service = require("./service");
const { BRAND_CODES, BRAND_PDF_CONTENT_KEYS, GENERAL_PDF_CONTENT_KEYS, GENERAL_ASSET_KEYS, BRAND_ASSET_KEYS, MAX_INFRASTRUCTURE_PHOTOS, SECTION_KEYS, brandCodeFor, pdfContentOverrides, pdfSectionsFor } = require("./defaults");
const { storeImage, storeImages } = require("../../../services/imageStorage");

/**
 * Reading a brand's configuration is the Quotation Generator's daily work; changing it is an
 * administrator's. Which is which is decided by the router - this file validates and answers.
 */

const percent = z.union([z.coerce.number().finite().min(0).max(100), z.literal(""), z.null()]).optional()
  .transform((value) => (typeof value === "number" ? value : null));

// A picture as the upload field sends it: a fresh data URI, or the stored link echoed back.
const picture = z.string().trim().max(12_000_000).nullable().optional();

/*
 * The pictures and the timeline the brand's quotation prints. Bounded generously - a collage of a
 * dozen branches with a dozen photographs each is the reference design's own scale - and every
 * picture goes through `storeImages` before it is written, so what the column holds is links.
 */
const pdfAssetsSchema = z.object({
  coverImageUrl: picture,
  indiaMapUrl: picture,
  thankYouImageUrl: picture,
  // A cover and a Thank You photograph per group of shoots; the first group is also the fallback.
  coverSets: z.array(z.object({
    shoots: z.array(z.string().trim().min(1).max(100)).max(40).default([]),
    coverImageUrl: picture,
    thankYouImageUrl: picture,
    // The religion this set is used for, read the same way `shoots` is: blank means any.
    religion: z.string().trim().max(120).optional().default(""),
  })).max(40).optional(),
  infrastructure: z.array(z.object({
    title: z.string().trim().max(120).default(""),
    subtitle: z.string().trim().max(120).default(""),
    // Eight is what the collage has a composition for - see `MAX_INFRASTRUCTURE_PHOTOS`. A ninth is
    // named for what it is by `refuseOverfullCollages` before this ever reports it as invalid input.
    photos: z.array(z.string().trim().min(1).max(12_000_000)).max(MAX_INFRASTRUCTURE_PHOTOS).default([]),
  })).max(20).optional(),
  journey: z.array(z.object({
    year: z.string().trim().max(20).default(""),
    title: z.string().trim().max(191).default(""),
    detail: z.string().trim().max(500).default(""),
    place: z.string().trim().max(191).default(""),
  })).max(30).optional(),
});

const brandSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  pdfAssets: pdfAssetsSchema.nullable().optional(),
  pdfContent: z.record(z.string(), z.string().max(2000)).nullable().optional(),
  gstPercent: percent,
  defaultDiscountPercent: percent,
  // Whether this brand's client may save their quotation as a file. Coerced from the Yes/No the
  // screen sends, and only written when the request actually names it - see `provided`.
  allowClientDownload: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const termSchema = z.object({
  title: z.string().trim().min(1).max(191),
  body: z.string().trim().min(1).max(4000),
  isActive: z.boolean().optional(),
});

const orderSchema = z.object({ ids: z.array(z.string().trim().min(1).max(191)).max(500) });

function brandCodeParam(req, res) {
  const code = brandCodeFor(req.params.code);
  if (!code || !BRAND_CODES.includes(code)) {
    res.status(404).json({ message: "Quotation brand not found." });
    return null;
  }
  return code;
}

/**
 * The one refusal worth saying in words: a branch sent more photographs than a collage can print.
 *
 * The schema above stops it too, but as "Invalid quotation content." with a path - which tells an
 * administrator who has just added a ninth picture nothing at all. Read off the request rather than
 * the parsed body because the parse is what would otherwise fail first. Answers `true` when it has
 * answered the request, so the caller stops.
 */
function refuseOverfullCollages(body, res) {
  const groups = body?.pdfAssets?.infrastructure;
  if (!Array.isArray(groups)) return false;
  const over = groups.find((group) => Array.isArray(group?.photos) && group.photos.length > MAX_INFRASTRUCTURE_PHOTOS);
  if (!over) return false;
  const named = String(over.title || "").trim();
  res.status(400).json({
    message: `${named ? `${named} has` : "A branch has"} ${over.photos.length} photographs. A collage prints at most ${MAX_INFRASTRUCTURE_PHOTOS} - remove ${over.photos.length - MAX_INFRASTRUCTURE_PHOTOS} before saving.`,
  });
  return true;
}

function parse(schema, body, res, message) {
  const parsed = schema.safeParse(body || {});
  if (parsed.success) return parsed.data;
  res.status(400).json({ message, errors: parsed.error.flatten() });
  return null;
}

/** Only the keys the request actually named, so a partial edit cannot blank the rest. */
const provided = (body, data) => Object.fromEntries(Object.entries(data).filter(([key]) => key in (body || {})));

function handleError(error, res, action) {
  if (error?.status) return res.status(error.status).json({ message: error.message });
  console.error(`Unable to ${action}:`, error);
  return res.status(500).json({ message: `Unable to ${action}.` });
}

// ---- reads ----

async function listBrands(req, res) {
  try {
    return res.json({ data: await service.listBrands({ includeInactive: req.query.includeInactive === "1" }) });
  } catch (error) {
    return handleError(error, res, "load quotation brands");
  }
}

async function getConfiguration(req, res) {
  const code = brandCodeParam(req, res);
  if (!code) return undefined;
  try {
    const data = await service.brandConfiguration(code, { includeInactive: false });
    if (!data) return res.status(404).json({ message: "Quotation brand not found." });
    return res.json({ data });
  } catch (error) {
    return handleError(error, res, "load the brand configuration");
  }
}

// ---- administration ----

async function getAdminConfiguration(req, res) {
  const code = brandCodeParam(req, res);
  if (!code) return undefined;
  try {
    const data = await service.brandConfiguration(code, { includeInactive: true });
    if (!data) return res.status(404).json({ message: "Quotation brand not found." });
    return res.json({ data });
  } catch (error) {
    return handleError(error, res, "load the brand configuration");
  }
}

async function updateBrand(req, res) {
  const code = brandCodeParam(req, res);
  if (!code) return undefined;
  if (refuseOverfullCollages(req.body, res)) return undefined;
  const parsed = parse(brandSchema, req.body, res, "Invalid brand settings.");
  if (!parsed) return undefined;
  try {
    const data = provided(req.body, parsed);
    if ("pdfContent" in data) {
      // Unknown keys and blanks are dropped: a blank is "back to the default", not a word to print.
      // Only the brand's own words: the shared ones belong to General, and a brand cannot hold them.
      data.pdfContent = pdfContentOverrides(data.pdfContent || {}, BRAND_PDF_CONTENT_KEYS);
    }
    if ("pdfAssets" in data) data.pdfAssets = pickAssets(await storePdfAssets(data.pdfAssets), BRAND_ASSET_KEYS);
    return res.json({ message: "Brand settings saved.", data: await service.updateBrand(code, data, Number(req.user?.id) || null) });
  } catch (error) {
    return handleError(error, res, "save the brand settings");
  }
}

/** The named keys of a stored assets object, or null when there are none to keep. */
const pickAssets = (assets, keys) => (assets ? Object.fromEntries(keys.map((key) => [key, assets[key]])) : null);

/*
 * ── General: the content every brand shares ──────────────────────────────────────────────────
 *
 * The Additional Notes and trademark cards, the Journey & Legacy headings, map and timeline, and
 * Our Infrastructure's headings and collages are the studio's. They live on the studio's single
 * quotation settings row and are read onto every brand's quotation; only their own keys are
 * accepted here, so a brand's words cannot arrive through this door either.
 */
const generalSchema = z.object({
  pdfContent: z.record(z.string(), z.string().max(2000)).nullable().optional(),
  pdfAssets: pdfAssetsSchema.nullable().optional(),
  // Which of the four shared sections the client's copy prints. Unknown keys are dropped.
  pdfSections: z.record(z.enum(SECTION_KEYS), z.boolean()).nullable().optional(),
});

async function getGeneral(req, res) {
  try {
    return res.json({ data: await service.generalConfiguration() });
  } catch (error) {
    return handleError(error, res, "load the shared quotation content");
  }
}

async function updateGeneral(req, res) {
  if (refuseOverfullCollages(req.body, res)) return undefined;
  const parsed = parse(generalSchema, req.body, res, "Invalid quotation content.");
  if (!parsed) return undefined;
  try {
    const data = provided(req.body, parsed);
    if ("pdfContent" in data) data.pdfContent = pdfContentOverrides(data.pdfContent || {}, GENERAL_PDF_CONTENT_KEYS);
    if ("pdfAssets" in data) data.pdfAssets = pickAssets(await storePdfAssets(data.pdfAssets), GENERAL_ASSET_KEYS);
    if ("pdfSections" in data) data.pdfSections = pdfSectionsFor(data.pdfSections);
    return res.json({ message: "Shared quotation content saved.", data: await service.updateGeneral(data, Number(req.user?.id) || null) });
  } catch (error) {
    return handleError(error, res, "save the shared quotation content");
  }
}

/**
 * Uploads every fresh picture in the assets and returns the object to store.
 *
 * `storeImage` echoes an existing link back untouched, so re-saving the form without picking a new
 * picture uploads nothing. A cover or a background is shown a thousand pixels wide, so those are
 * allowed more bytes than a logo; a collage photograph is shown small and takes the default.
 */
async function storePdfAssets(assets) {
  if (!assets) return null;
  const single = async (value, maxBytes, maxDimension) => {
    const stored = await storeImage(value, { folder: "quotations/brands/assets", maxBytes, maxDimension });
    return stored ? stored.url : null;
  };
  // The same ceilings the settings screen resamples to, so a picture the browser has already
  // brought down to size is stored as it arrived rather than squeezed a second time.
  const LARGE = 2.5 * 1024 * 1024;
  const [coverImageUrl, indiaMapUrl, thankYouImageUrl] = await Promise.all([
    single(assets.coverImageUrl, LARGE, 2400),
    single(assets.indiaMapUrl, 1024 * 1024, 1800),
    single(assets.thankYouImageUrl, LARGE, 2400),
  ]);
  /*
   * The picture sets, one at a time. Each set holds two large photographs and there may be a dozen
   * sets, so they are stored set by set rather than as one fan-out of two dozen uploads - the same
   * shape, and the same reason, as the infrastructure collages below. A set that ends up with
   * neither a picture nor a shoot is dropped: it is a row somebody added and left empty.
   */
  const coverSets = [];
  for (const set of assets.coverSets || []) {
    const [cover, thankYou] = await Promise.all([
      single(set.coverImageUrl, LARGE, 2400),
      single(set.thankYouImageUrl, LARGE, 2400),
    ]);
    const shoots = (set.shoots || []).filter(Boolean);
    const religion = (set.religion || "").trim();
    if (shoots.length || religion || cover || thankYou) {
      coverSets.push({ shoots, religion, coverImageUrl: cover, thankYouImageUrl: thankYou });
    }
  }
  const infrastructure = [];
  for (const group of assets.infrastructure || []) {
    const photos = (await storeImages(group.photos || [], { folder: "quotations/brands/infrastructure", maxBytes: 450 * 1024, maxDimension: 1600 })).map((item) => item.url);
    if (group.title || photos.length) infrastructure.push({ title: group.title, subtitle: group.subtitle, photos });
  }
  const journey = (assets.journey || []).filter((row) => row.year || row.title);
  return { coverImageUrl, indiaMapUrl, thankYouImageUrl, coverSets, infrastructure, journey };
}

const masterHandlers = (kind, schema, create, update, reorderRows) => ({
  async create(req, res) {
    const code = brandCodeParam(req, res);
    if (!code) return undefined;
    const parsed = parse(schema, req.body, res, `Enter a valid ${kind}.`);
    if (!parsed) return undefined;
    try {
      return res.status(201).json({ data: await create(code, parsed) });
    } catch (error) {
      return handleError(error, res, `add the ${kind}`);
    }
  },
  async update(req, res) {
    const code = brandCodeParam(req, res);
    if (!code) return undefined;
    const parsed = parse(schema.partial(), req.body, res, `Enter a valid ${kind}.`);
    if (!parsed) return undefined;
    try {
      return res.json({ data: await update(code, req.params.id, provided(req.body, parsed)) });
    } catch (error) {
      return handleError(error, res, `save the ${kind}`);
    }
  },
  async reorder(req, res) {
    const code = brandCodeParam(req, res);
    if (!code) return undefined;
    const parsed = parse(orderSchema, req.body, res, "Send the ids in their new order.");
    if (!parsed) return undefined;
    try {
      await reorderRows(code, parsed.ids);
      return res.json({ message: "Order saved." });
    } catch (error) {
      return handleError(error, res, `reorder the ${kind}s`);
    }
  },
});

const terms = masterHandlers("term", termSchema, service.createTerm, service.updateTerm, service.reorderTerms);
// The shoots a brand quotes for: a plain named list, so the schema is the name and whether it is
// offered, and nothing else.
const shootSchema = z.object({ name: z.string().trim().min(1).max(191), isActive: z.boolean().optional() });
const shoots = masterHandlers("shoot", shootSchema, service.createShoot, service.updateShoot, service.reorderShoots);

const deleteHandler = (kind, remove) => async (req, res) => {
  const code = brandCodeParam(req, res);
  if (!code) return undefined;
  try {
    await remove(code, req.params.id);
    return res.status(204).send();
  } catch (error) {
    return handleError(error, res, `delete the ${kind}`);
  }
};

module.exports = {
  listBrands,
  getConfiguration,
  getAdminConfiguration,
  updateBrand,
  getGeneral,
  updateGeneral,
  // Exported for `test/sales-quotation-infrastructure.test.js`, which holds the refusal to its wording.
  refuseOverfullCollages,
  createShoot: shoots.create,
  updateShoot: shoots.update,
  reorderShoots: shoots.reorder,
  deleteShoot: deleteHandler("shoot", service.deleteShoot),
  createTerm: terms.create,
  updateTerm: terms.update,
  reorderTerms: terms.reorder,
  deleteTerm: deleteHandler("term", service.deleteTerm),
};
