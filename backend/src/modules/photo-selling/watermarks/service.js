const crypto = require("crypto");
const prisma = require("../../../config/db");
const { httpError } = require("../../ai-feature/shared/http");
const { configHash, lookOf, TYPES } = require("../../ai-feature/watermarks/config");
const aiWatermarks = require("../../ai-feature/watermarks/service");
const render = require("../../ai-feature/watermarks/render");
const storage = require("../shared/storage");
const cleanup = require("../shared/cleanup");

/**
 * A store shows nothing but watermarked previews: a clean preview in a shop is a free photo. The one
 * exception is the cover the studio chose, shown clean behind the login (public/service.js coverUrl).
 *
 * The look is a Watermark Preset (the studio's presets, managed in AI Feature → Event Default
 * Settings), copied onto the gallery with its logo when chosen, so editing or deleting the preset
 * later changes nothing a live store shows. The drawing is the AI Feature's renderer; the copies,
 * their table, their folder and their signing key are this module's own.
 *
 * A copy is drawn when a guest's browser first asks for it (or ahead of time when a store is
 * published), through a signed address that can only ever lead to one photo drawn with one look; a
 * photo that cannot be drawn is never handed out clean.
 */
const FOLDER = "watermarked";
const VARIANTS = new Set(["preview", "thumbnail"]);
const SLOTS = 4;
const QUEUE_LIMIT = 200;

function signingKey() {
  if (!process.env.JWT_SECRET) throw httpError(500, "Watermark signing is not configured.");
  return crypto.createHash("sha256").update(`photo-selling-watermark:${process.env.JWT_SECRET}`).digest();
}
/*
 * A picture's address carries its expiry inside the signature: about a day (rounded up to the next six
 * hours, so a page's addresses stay the same - and cacheable - for hours at a time). A saved or shared
 * address stops working; the store hands out fresh ones every time it is opened.
 */
const LINK_TTL_MS = 24 * 60 * 60 * 1000;
const LINK_STEP_MS = 6 * 60 * 60 * 1000;
const linkExpiry = (now = Date.now()) => Math.ceil((now + LINK_TTL_MS) / LINK_STEP_MS) * LINK_STEP_MS / 1000;
const sign = (photoId, hash, expires) => crypto.createHmac("sha256", signingKey()).update(`${photoId}:${hash}:${expires}`).digest("base64url").slice(0, 32);
function verify(photoId, hash, signature, expires) {
  const at = Number(expires);
  if (!Number.isInteger(at) || at * 1000 <= Date.now()) return false;
  const expected = Buffer.from(sign(photoId, hash, at));
  const given = Buffer.from(String(signature || ""));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/** The look's hash, or null when the gallery has no usable watermark (it then cannot be published). */
function lookHash(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || !TYPES.includes(snapshot.type)) return null;
  if (snapshot.type === "LOGO" && !snapshot.logoKey) return null;
  if (snapshot.type === "TEXT" && !snapshot.text) return null;
  return configHash(snapshot);
}

/** The gallery's own copy of a preset: its look, and its logo copied into the gallery's folder. */
async function snapshotFor(galleryId, presetId) {
  const preset = await aiWatermarks.assertPreset(presetId);
  if (!preset) throw httpError(400, "Choose a watermark.");
  let logoKey = null;
  if (preset.type === "LOGO") {
    const bytes = await storage.getObject(preset.logoKey);
    if (!bytes) throw httpError(400, `The logo of "${preset.name}" is missing from storage. Upload it again in Watermark Presets.`);
    logoKey = await storage.putPublic(galleryId, "watermark", "webp", bytes, "image/webp");
  }
  return { presetId: preset.id, name: preset.name, ...lookOf(preset), logoKey, takenAt: new Date().toISOString() };
}

const copyPath = (photoId, hash, variant, expires = linkExpiry()) => `/api/public/photo-selling/w/${encodeURIComponent(photoId)}/${hash}/${variant}?e=${expires}&s=${sign(photoId, hash, expires)}`;

/** A photo's two addresses for the store, never its clean preview. */
function addressesFor(photoId, hash) {
  if (!hash) return { previewUrl: null, thumbnailUrl: null };
  return { previewUrl: copyPath(photoId, hash, "preview"), thumbnailUrl: copyPath(photoId, hash, "thumbnail") };
}

let running = 0;
const waiting = [];
async function withSlot(work) {
  if (running >= SLOTS) {
    if (waiting.length >= QUEUE_LIMIT) return null;
    await new Promise((resolve) => waiting.push(resolve));
  }
  running += 1;
  try { return await work(); } finally { running -= 1; waiting.shift()?.(); }
}

const inFlight = new Map();

async function drawOne(photo, snapshot, hash) {
  const mark = await render.markFor(snapshot, storage.getObject);
  const previewBytes = await storage.getObject(photo.previewKey);
  if (!previewBytes) return null;
  const preview = await render.applyWatermark(previewBytes, snapshot, mark);
  const previewKey = await storage.putPublic(photo.galleryId, FOLDER, preview.extension, preview.buffer, preview.contentType);
  let thumbnailKey = null;
  const thumbnailBytes = photo.thumbnailKey ? await storage.getObject(photo.thumbnailKey) : null;
  if (thumbnailBytes) {
    const thumbnail = await render.applyWatermark(thumbnailBytes, snapshot, mark);
    thumbnailKey = await storage.putPublic(photo.galleryId, FOLDER, thumbnail.extension, thumbnail.buffer, thumbnail.contentType);
  }
  try {
    return await prisma.photoSaleWatermark.create({ data: { photoId: photo.id, configHash: hash, previewKey, thumbnailKey } });
  } catch (error) {
    await cleanup.record(cleanup.plan(photo.galleryId, { public: [previewKey, thumbnailKey] }));
    cleanup.drain({ galleryId: photo.galleryId }).catch(() => {});
    if (error?.code === "P2002") return prisma.photoSaleWatermark.findUnique({ where: { photoId_configHash: { photoId: photo.id, configHash: hash } } });
    throw error;
  }
}

/**
 * The stored copy a signed address names, drawn now if it has not been. Null - and so no picture -
 * for a photo hidden or taken off sale, a gallery archived, or a look the gallery no longer wears.
 */
async function copyFor(photoId, hash) {
  // Checked on every request, a copy drawn before too: a photo hidden or removed since stops showing at once.
  const photo = await prisma.photoSalePhoto.findFirst({
    where: { id: photoId, removedAt: null, available: true, gallery: { archivedAt: null } },
    include: { gallery: { select: { watermarkSnapshot: true } } },
  });
  if (!photo || lookHash(photo.gallery.watermarkSnapshot) !== hash) return null;
  const existing = await prisma.photoSaleWatermark.findUnique({ where: { photoId_configHash: { photoId, configHash: hash } } });
  if (existing) return existing;
  const key = `${photoId}:${hash}`;
  if (!inFlight.has(key)) {
    inFlight.set(key, (async () => {
      try { return await withSlot(() => drawOne(photo, photo.gallery.watermarkSnapshot, hash)); }
      catch (error) { console.error("[photo-selling] watermark draw failed:", photoId, error.message); return null; }
    })().finally(() => inFlight.delete(key)));
  }
  return inFlight.get(key);
}

/**
 * Draws, in the background, every copy a store will hand out that is not drawn yet - run when a store
 * is published or its watermark changes, so guests rarely wait on a tile. One run per store at a
 * time; the on-demand path above still covers anything this has not reached.
 */
const warming = new Set();
function warmGallery(galleryId) {
  if (warming.has(galleryId)) return;
  warming.add(galleryId);
  (async () => {
    const gallery = await prisma.photoSaleGallery.findUnique({ where: { id: galleryId }, select: { watermarkSnapshot: true } });
    const hash = lookHash(gallery?.watermarkSnapshot);
    if (!hash) return;
    const photos = await prisma.photoSalePhoto.findMany({ where: { galleryId, available: true, removedAt: null, watermarks: { none: { configHash: hash } } }, select: { id: true }, orderBy: { sortOrder: "asc" } });
    for (const photo of photos) await copyFor(photo.id, hash);
  })().catch((error) => console.error("[photo-selling] watermark warm-up failed:", galleryId, error.message)).finally(() => warming.delete(galleryId));
}

module.exports = { FOLDER, VARIANTS, LINK_TTL_MS, linkExpiry, sign, verify, lookHash, snapshotFor, copyPath, addressesFor, copyFor, warmGallery };
