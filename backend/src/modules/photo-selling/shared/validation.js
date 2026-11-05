const { z } = require("zod");
const { MAX_PRICE_PAISE, MAX_TAX_BPS, MAX_ITEMS } = require("../pricing/pricing");

/**
 * Every body Photo Selling accepts, strict: a field it does not name is refused, so nothing in a
 * request ever reaches Prisma unread. Prices arrive in paise as whole numbers.
 */
const id = z.string().trim().min(1).max(191);
const positiveMoney = z.number().int().min(100, "At least ₹1.").max(MAX_PRICE_PAISE);
const isoDate = z.string().trim().refine((value) => !Number.isNaN(Date.parse(value)), "Not a date.");
const hex = z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/, "Use a colour like #1D4ED8.");
const strictness = z.enum(["STANDARD", "STRICTER", "BROADER"]);
// The shared poster designs (frontend lib/qrPoster.mjs) by id - a short slug, checked on the client against the list.
const qrTemplateId = z.string().trim().regex(/^[a-z0-9-]{2,40}$/, "Choose a poster design.");
const qrText = z.object({
  heading: z.string().max(32).optional(),
  subheading: z.string().max(36).optional(),
  instruction: z.string().max(32).optional(),
  note: z.string().max(90).optional(),
  footer: z.string().max(60).optional(),
  showPin: z.boolean().optional(),
}).strict();
const clientPhone = z.string().trim().max(20).regex(/^[+\d][\d\s-]{6,19}$/, "Enter a phone number.").or(z.literal(""));

const galleryParams = z.object({ galleryId: id });
const orderParams = z.object({ orderId: id });

/** A copy of a gallery's set-up: only the copy's name is asked. */
const duplicateGallery = z.object({ title: z.string().trim().min(1, "Give the copy a name.").max(191) }).strict();

const createGallery = z.object({
  title: z.string().trim().min(1, "Give the gallery a name.").max(191),
  clientName: z.string().trim().max(191).optional(),
  clientPhone: clientPhone.optional(),
  venue: z.string().trim().max(255).optional(),
  description: z.string().trim().max(5000).optional(),
  eventDate: isoDate.nullable().optional(),
  expiresAt: isoDate.nullable().optional(),
  pricePaise: positiveMoney.optional(),
  watermarkPresetId: id.optional(),
  requirePin: z.boolean().optional(),
}).strict();

const updateGallery = z.object({
  title: z.string().trim().min(1).max(191).optional(),
  venue: z.string().trim().max(255).optional(),
  description: z.string().trim().max(5000).optional(),
  eventDate: isoDate.nullable().optional(),
  expiresAt: isoDate.nullable().optional(),
  coverPhotoId: id.nullable().optional(),
  pricePaise: positiveMoney.nullable().optional(),
  taxRateBps: z.number().int().min(0).max(MAX_TAX_BPS).optional(),
  pricesIncludeTax: z.boolean().optional(),
  accentColor: hex.nullable().optional(),
  watermarkPresetId: id.nullable().optional(),
  matchStrictness: strictness.optional(),
  clientName: z.string().trim().max(191).optional(),
  clientPhone: clientPhone.optional(),
  qrTemplateId: qrTemplateId.optional(),
  qrText: qrText.optional(),
  selfieSearchEnabled: z.boolean().optional(),
  whatsappNotify: z.boolean().optional(),
}).strict();

const settings = z.object({
  pricePaise: positiveMoney.nullable().optional(),
  taxRateBps: z.number().int().min(0).max(MAX_TAX_BPS).optional(),
  pricesIncludeTax: z.boolean().optional(),
  requirePin: z.boolean().optional(),
  matchStrictness: strictness.optional(),
  accentColor: hex.nullable().optional(),
  watermarkPresetId: id.nullable().optional(),
  qrTemplateId: qrTemplateId.optional(),
  qrText: qrText.optional(),
  downloads: z.object({ limit: z.number().int().min(1).max(1000).optional(), days: z.number().int().min(1).max(3650).optional() }).strict().optional(),
  selfieSearchEnabled: z.boolean().optional(),
  whatsappNotify: z.boolean().optional(),
}).strict();

const updateLink = z.object({ requirePin: z.boolean().optional(), newPin: z.boolean().optional(), newCode: z.boolean().optional() }).strict();

const listGalleries = z.object({ view: z.enum(["active", "drafts", "archived"]).optional(), search: z.string().trim().max(120).optional() });
const listPhotos = z.object({
  scope: z.enum(["all", "available", "hidden", "preparing", "issues"]).optional(),
  search: z.string().trim().max(120).optional(),
  sort: z.enum(["upload", "newest", "name", "captured"]).optional(),
  page: z.coerce.number().int().min(1).max(10000).optional(),
});
const photoIds = z.array(id).min(1).max(2000);
const removePhotos = z.object({ photoIds }).strict();
const reindexPhotos = z.object({ photoIds: photoIds.optional() }).strict();
const updatePhotos = z.object({ photoIds, available: z.boolean().optional(), pricePaise: positiveMoney.nullable().optional() }).strict()
  .refine((body) => body.available !== undefined || body.pricePaise !== undefined, "Nothing to change.");

const packages = z.object({
  packages: z.array(z.object({
    id: id.optional(),
    name: z.string().trim().min(1).max(120),
    photoCount: z.number().int().min(2).max(MAX_ITEMS),
    pricePaise: positiveMoney,
    isActive: z.boolean().default(true),
  }).strict()).max(10),
}).strict();

const listOrders = z.object({
  galleryId: id.optional(),
  status: z.enum(["PENDING", "PAID", "FAILED", "CANCELLED"]).optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(10000).optional(),
  // When the order was placed: the last 7 days, 30 days, 3 months or 6 months up to now; all when absent.
  range: z.enum(["all", "7d", "30d", "3m", "6m"]).optional(),
});
const overview = z.object({ range: z.enum(["7d", "30d", "90d", "all"]).optional() });

/* ---------------------------------------------------------------- public */

const publicOrderParams = z.object({ code: z.string().trim().min(4).max(64), orderRef: z.string().trim().regex(/^PS-[A-Za-z0-9]{6,12}$/) });
const cartItems = z.array(z.object({ photoId: id }).strict()).min(1).max(MAX_ITEMS);
const quote = z.object({ items: cartItems }).strict();
const checkout = z.object({
  items: cartItems,
  buyer: z.object({
    name: z.string().trim().min(2, "Enter your name.").max(120),
    phone: z.string().trim().min(10).max(20),
    email: z.string().trim().email("Enter a valid email address.").max(191).optional().or(z.literal("").transform(() => undefined)),
  }).strict(),
}).strict();

module.exports = {
  galleryParams, orderParams, createGallery, duplicateGallery, updateGallery, settings, updateLink, listGalleries, listPhotos, removePhotos, reindexPhotos, updatePhotos, packages, listOrders, overview,
  publicOrderParams, quote, checkout,
};
