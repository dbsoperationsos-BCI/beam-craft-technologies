const { z } = require("zod");
const prisma = require("../../../config/db");
const { storeImage, discardUploads } = require("../../../services/imageStorage");
const { studioDateKey } = require("../../../services/studioTime");

/*
 * Offers the studio shows its clients in their app (Sales -> Client Offers), in one of two places
 * (`PLACEMENTS`): the Home page, or the Referrals page - the studio's referral offer.
 *
 * The team adds, edits, switches off or removes them; a client's app reads the live ones - active,
 * not removed, and today (on the studio's calendar) between `validFrom` and `validUntil`, either of
 * which may be left open. The picture is the studio's own artwork, in one of the three sizes it
 * already makes for Instagram (`POSTER_SIZES`), shown whole at its own shape; its stored size goes to
 * the app with it. Removing an offer withdraws it rather than erasing the row.
 */

/*
 * The poster sizes an offer may be. Checked by shape, not by exact pixels - the same poster exported
 * at 2160 x 2700 is still a portrait - with a little room for an export a pixel or two off.
 */
const POSTER_SIZES = [
  { key: "square", label: "Square", width: 1080, height: 1080 },
  { key: "portrait", label: "Portrait", width: 1080, height: 1350 },
  { key: "story", label: "Story", width: 1080, height: 1920 },
];
const SHAPE_TOLERANCE = 0.02;
// Where an offer shows in the clients' app; each is a tab on Client Offers.
const PLACEMENTS = ["home", "referral"];
// Room for a story at full size; the browser compresses to the same before it uploads.
const POSTER_MAX_DIMENSION = 1920;
const POSTER_MAX_BYTES = 500 * 1024;

/** Which of the poster sizes a picture of this width and height is, or null. */
function posterSizeOf(width, height) {
  if (!width || !height) return null;
  const ratio = width / height;
  return POSTER_SIZES.find((size) => Math.abs(ratio - size.width / size.height) <= (size.width / size.height) * SHAPE_TOLERANCE) || null;
}

function wrongSize(width, height) {
  const error = new Error(`This poster is ${width} x ${height}. Upload it as 1080 x 1080 (square), 1080 x 1350 (portrait) or 1080 x 1920 (story).`);
  error.status = 400;
  return error;
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date.").or(z.literal("")).nullable().optional();
const offerSchema = z.object({
  tag: z.string().trim().max(40).optional().default(""),
  // The poster is the offer: the words are optional (a finished poster carries its own).
  title: z.string().trim().max(120).optional().default(""),
  note: z.string().trim().max(300).optional().default(""),
  tone: z.enum(["dark", "light"]).optional().default("dark"),
  placement: z.enum(PLACEMENTS).optional().default("home"),
  validFrom: day,
  validUntil: day,
  sortOrder: z.coerce.number().int().min(0).max(9999).optional().default(0),
  isActive: z.boolean().optional().default(true),
  // A new picture as a data URI, the one it already has (its URL), or "" to take it off.
  image: z.string().optional(),
}).refine((offer) => !offer.validFrom || !offer.validUntil || offer.validFrom <= offer.validUntil, {
  message: "The offer must start on or before its last day.",
  path: ["validUntil"],
});

const toDate = (value) => (value ? new Date(`${value}T00:00:00.000Z`) : null);
const dayOf = (value) => (value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString().slice(0, 10) : null);

/** One offer as the team's screen reads it. */
function serialize(row) {
  return {
    id: row.id,
    tag: row.tag || "",
    title: row.title,
    note: row.note || "",
    tone: row.tone === "light" ? "light" : "dark",
    imageUrl: row.imageUrl || null,
    imageWidth: row.imageWidth ?? null,
    imageHeight: row.imageHeight ?? null,
    placement: placementOf(row),
    validFrom: dayOf(row.validFrom),
    validUntil: dayOf(row.validUntil),
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    live: isLive(row),
    updatedAt: row.updatedAt,
  };
}

const placementOf = (row) => (PLACEMENTS.includes(row.placement) ? row.placement : "home");

/** Whether a client sees it today. */
function isLive(row, today = studioDateKey(new Date())) {
  if (!row.isActive || row.deletedAt) return false;
  const from = dayOf(row.validFrom);
  const until = dayOf(row.validUntil);
  return (!from || from <= today) && (!until || until >= today);
}

/** Every offer that has not been removed, in the order the clients see them. */
async function listOffers() {
  const rows = await prisma.clientOffer.findMany({ where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }] });
  return rows.map(serialize);
}

/** The offers a client's app shows today in one place (Home, unless asked for Referrals), in order. */
async function liveOffers(placement = "home") {
  const today = studioDateKey(new Date());
  const rows = await prisma.clientOffer.findMany({ where: { deletedAt: null, isActive: true, placement }, orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }] });
  return rows.filter((row) => isLive(row, today)).map((row) => ({
    id: row.id,
    tag: row.tag || "",
    title: row.title,
    note: row.note || "",
    imageUrl: row.imageUrl || null,
    // The poster's size, so the app lays the card out at its shape before the picture arrives; null
    // on an offer saved before sizes were kept.
    imageWidth: row.imageWidth ?? null,
    imageHeight: row.imageHeight ?? null,
    tone: row.tone === "light" ? "light" : "dark",
    validUntil: dayOf(row.validUntil),
  }));
}

/**
 * The picture to keep: a new upload stored, the existing one kept, or none. A Home offer's new upload
 * must be one of the poster sizes; one that is not is refused before anything is kept. A referral
 * offer's may be any size (`anySize`): the Referrals page shows it as a banner at its own shape.
 */
async function pictureFor(image, existing, { anySize = false } = {}) {
  const kept = { imageUrl: existing?.imageUrl ?? null, imageKey: existing?.imageKey ?? null, imageWidth: existing?.imageWidth ?? null, imageHeight: existing?.imageHeight ?? null, stored: null };
  if (image === undefined) return kept;
  if (!image) return { imageUrl: null, imageKey: null, imageWidth: null, imageHeight: null, stored: null };
  if (existing?.imageUrl && image === existing.imageUrl) return kept;
  const stored = await storeImage(image, { folder: "sales/client-offers", maxBytes: POSTER_MAX_BYTES, maxDimension: POSTER_MAX_DIMENSION });
  // A link (not an upload) has no size to read; only an uploaded picture is held to the sizes.
  if (stored && !stored.reused && !anySize && !posterSizeOf(stored.width, stored.height)) {
    await discardUploads([stored]);
    throw wrongSize(stored.width, stored.height);
  }
  return { imageUrl: stored?.url ?? null, imageKey: stored?.key ?? null, imageWidth: stored?.width ?? null, imageHeight: stored?.height ?? null, stored };
}

function dataOf(input, picture, actorId) {
  return {
    tag: input.tag || null,
    title: input.title,
    note: input.note || null,
    tone: input.tone,
    placement: input.placement,
    validFrom: toDate(input.validFrom),
    validUntil: toDate(input.validUntil),
    sortOrder: input.sortOrder,
    isActive: input.isActive,
    imageUrl: picture.imageUrl,
    imageKey: picture.imageKey,
    imageWidth: picture.imageWidth,
    imageHeight: picture.imageHeight,
    updatedBy: actorId,
  };
}

/** An offer is its poster: one without a picture is refused, and the reason given. */
function needsPoster(picture) {
  if (picture.imageUrl) return null;
  const error = new Error("Upload the offer's poster.");
  error.status = 400;
  return error;
}

async function createOffer(input, actorId) {
  const picture = await pictureFor(input.image, null, { anySize: input.placement === "referral" });
  const missing = needsPoster(picture);
  if (missing) throw missing;
  try {
    return serialize(await prisma.clientOffer.create({ data: { ...dataOf(input, picture, actorId), createdBy: actorId } }));
  } catch (error) {
    await discardUploads([picture.stored]);
    throw error;
  }
}

async function updateOffer(id, input, actorId) {
  const existing = await prisma.clientOffer.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return null;
  const picture = await pictureFor(input.image, existing, { anySize: (input.placement || placementOf(existing)) === "referral" });
  const missing = needsPoster(picture);
  if (missing) throw missing;
  let saved;
  try {
    saved = await prisma.clientOffer.update({ where: { id }, data: dataOf(input, picture, actorId) });
  } catch (error) {
    await discardUploads([picture.stored]);
    throw error;
  }
  // The old picture goes once the new one is saved in its place.
  if (existing.imageKey && existing.imageKey !== saved.imageKey) await discardUploads([{ key: existing.imageKey }]).catch(() => {});
  return serialize(saved);
}

async function removeOffer(id, actorId) {
  const existing = await prisma.clientOffer.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return false;
  await prisma.clientOffer.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, updatedBy: actorId } });
  return true;
}

module.exports = { offerSchema, listOffers, liveOffers, createOffer, updateOffer, removeOffer, isLive, serialize, posterSizeOf, POSTER_SIZES, PLACEMENTS };
