const crypto = require("crypto");
const prisma = require("../../../config/db");
const { storeImage } = require("../../../services/imageStorage");
const objectStorage = require("../../../services/objectStorage");
const { httpError } = require("../shared/http");
const storage = require("../shared/storage");
const { mergeGroup } = require("../shared/settingsDefaults");
const { MAX_PRESETS, lookOf, configHash, watermarkUses, activeSnapshot } = require("./config");
const render = require("./render");
// Required when first used: the queue module pulls in Redis, which a list that needs nothing drawn never touches.
const queue = () => require("../processing/queue");

/**
 * Watermark Presets, and everything an event does with one.
 *
 * - A preset is the studio's (this application serves one studio, so presets are shared by everyone
 *   holding AI Event Default Settings); at most MAX_PRESETS, counted under a row lock so two saves
 *   at once cannot both make the twenty-first. Its logo is a WebP in the public bucket under
 *   `ai-feature-watermarks/`, apart from any event's photos.
 * - Event Default Settings names a preset by id (`gallery.watermarkPresetId`); it is never copied
 *   there, so the defaults always offer the preset as it is now.
 * - An event copies the preset it is given into `gallery.watermarkSnapshot`, logo and all - the logo
 *   to the event's own folder - so editing or deleting the preset later changes nothing the event's
 *   guests see, and deleting the event takes its copy with it.
 * - A guest is handed watermarked copies of the preview and thumbnail, drawn once per photo per look
 *   (`configHash`) and kept in `ai_event_media_watermark`. The photo's own objects are never written.
 */
const LOGO_FOLDER = "ai-feature-watermarks";
const LOGO_DATA_URL = /^data:image\/(png|jpeg|jpg|webp|svg\+xml|gif|avif);base64,/i;
const DEFAULTS_ID = "default";
const RENDER_CONCURRENCY = 4;

function serializePreset(row) {
  return {
    id: row.id, name: row.name, type: row.type,
    logoUrl: row.logoKey ? objectStorage.publicUrl(row.logoKey) : null, logoWidth: row.logoWidth, logoHeight: row.logoHeight,
    text: row.text, textColor: row.textColor, fontWeight: row.fontWeight,
    position: row.position, size: row.size, opacity: row.opacity, offsetX: row.offsetX, offsetY: row.offsetY,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

/** What a snapshot looks like to the screens: the look, and the logo's address instead of its key. */
function serializeSnapshot(snapshot) {
  if (!snapshot) return null;
  const { logoKey, ...rest } = snapshot;
  return { ...rest, logoUrl: logoKey ? storage.publicUrl(logoKey) : null };
}

async function defaultPresetId() {
  const row = await prisma.aiEventDefaultSetting.findUnique({ where: { id: DEFAULTS_ID } });
  return mergeGroup("gallery", row?.gallery).watermarkPresetId || null;
}

async function list() {
  const rows = await prisma.aiWatermarkPreset.findMany({ orderBy: [{ createdAt: "asc" }] });
  return { items: rows.map(serializePreset), limit: MAX_PRESETS, defaultPresetId: await defaultPresetId() };
}

async function find(id) {
  const row = await prisma.aiWatermarkPreset.findUnique({ where: { id } });
  if (!row) throw httpError(404, "Watermark preset not found.");
  return row;
}

/** A picked logo, checked by decoding it, kept as a transparent WebP no wider than 2000 px. */
async function storeLogo(dataUrl) {
  if (!LOGO_DATA_URL.test(dataUrl || "")) throw httpError(400, "Choose a PNG, JPG, WEBP or SVG logo.");
  if (!storage.isConfigured()) throw httpError(500, "Cloudflare R2 storage is not configured.");
  const stored = await storeImage(dataUrl, { folder: LOGO_FOLDER, maxBytes: 600 * 1024, maxDimension: 2000 });
  if (!stored?.key) throw httpError(500, "The logo could not be stored.");
  return { logoKey: stored.key, logoWidth: stored.width, logoHeight: stored.height };
}

const removeLogo = (key) => (key ? objectStorage.deleteObject(key).catch((error) => console.error("[ai-feature] watermark logo delete failed:", error.message)) : null);

function columnsFrom(body) {
  const text = body.type === "TEXT";
  return {
    name: body.name, type: body.type,
    text: text ? body.text : null, textColor: text ? (body.textColor || "#FFFFFF") : null, fontWeight: text ? (body.fontWeight || "BOLD") : null,
    position: body.position, size: body.size, opacity: body.opacity, offsetX: body.offsetX ?? 0, offsetY: body.offsetY ?? 0,
  };
}

const duplicateName = (error) => error?.code === "P2002" ? httpError(409, "A watermark with this name already exists. Choose another name.") : error;

/**
 * Runs `work(tx)` holding the Event Default Settings row's lock - the one lock that orders every
 * write which counts presets or names the default, so a count, a delete and a default choice can
 * never interleave.
 */
async function withDefaultsLock(work) {
  await prisma.aiEventDefaultSetting.upsert({ where: { id: DEFAULTS_ID }, create: { id: DEFAULTS_ID }, update: {} });
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM ai_event_default_setting WHERE id = ${DEFAULTS_ID} FOR UPDATE`;
    return work(tx);
  });
}

async function create(body, user) {
  if (body.type === "LOGO" && !body.logo) throw httpError(400, "Upload a logo for this watermark.");
  const logo = body.type === "LOGO" ? await storeLogo(body.logo) : { logoKey: null, logoWidth: null, logoHeight: null };
  try {
    // Counted under the lock, so the count and the insert are one step however many saves arrive together.
    const row = await withDefaultsLock(async (tx) => {
      if ((await tx.aiWatermarkPreset.count()) >= MAX_PRESETS) throw httpError(409, `You can keep up to ${MAX_PRESETS} watermark presets. Delete one to add another.`);
      return tx.aiWatermarkPreset.create({ data: { ...columnsFrom(body), ...logo, createdByUserId: user?.id ?? null, updatedByUserId: user?.id ?? null } });
    });
    return serializePreset(row);
  } catch (error) {
    await removeLogo(logo.logoKey);
    throw duplicateName(error);
  }
}

async function update(id, body, user) {
  const existing = await find(id);
  if (body.type === "LOGO" && !body.logo && !existing.logoKey) throw httpError(400, "Upload a logo for this watermark.");
  const logo = body.type === "LOGO" ? (body.logo ? await storeLogo(body.logo) : { logoKey: existing.logoKey, logoWidth: existing.logoWidth, logoHeight: existing.logoHeight }) : { logoKey: null, logoWidth: null, logoHeight: null };
  let row;
  try {
    row = await prisma.aiWatermarkPreset.update({ where: { id }, data: { ...columnsFrom(body), ...logo, updatedByUserId: user?.id ?? null } });
  } catch (error) {
    if (logo.logoKey && logo.logoKey !== existing.logoKey) await removeLogo(logo.logoKey);
    throw duplicateName(error);
  }
  // Events hold their own copy of the logo, so the preset's old one can go once nothing names it.
  if (existing.logoKey && existing.logoKey !== row.logoKey) await removeLogo(existing.logoKey);
  return serializePreset(row);
}

async function remove(id) {
  const existing = await find(id);
  // Under the lock Event Default Settings saves under, so it cannot name this preset mid-delete.
  await withDefaultsLock(async (tx) => {
    const defaults = await tx.aiEventDefaultSetting.findUnique({ where: { id: DEFAULTS_ID } });
    if (mergeGroup("gallery", defaults?.gallery).watermarkPresetId === id) throw httpError(409, "This is the default watermark in Event Default Settings. Choose another default, or turn the default watermark off, before deleting it.");
    await tx.aiWatermarkPreset.delete({ where: { id } });
  });
  await removeLogo(existing.logoKey);
  return { id, deleted: true };
}

/** The text mark the preset screen previews with: the server's own drawing, as a PNG data URL. */
async function textMarkPng(body) {
  const mark = await render.textMark(body);
  return { dataUrl: `data:image/png;base64,${mark.buffer.toString("base64")}`, width: mark.width, height: mark.height };
}

/** Checks a preset id an event or the defaults is about to name. `db` is a transaction when the caller holds the lock. */
async function assertPreset(presetId, db = prisma) {
  if (!presetId) return null;
  const row = await db.aiWatermarkPreset.findUnique({ where: { id: String(presetId) } });
  if (!row) throw httpError(400, "That watermark preset no longer exists. Choose another one.");
  return row;
}

/** The event's own copy of a preset: its look, and its logo copied into the event's folder. */
async function snapshotFor(eventId, presetId) {
  const preset = await assertPreset(presetId);
  if (!preset) throw httpError(400, "Choose a watermark preset.");
  let logoKey = null;
  if (preset.type === "LOGO") {
    const bytes = await objectStorage.getPublicObjectBuffer(preset.logoKey);
    if (!bytes) throw httpError(400, `The logo of "${preset.name}" is missing from storage. Upload it again in Watermark Presets.`);
    logoKey = await storage.putPublic(eventId, "watermark", "webp", bytes, "image/webp");
  }
  return { presetId: preset.id, name: preset.name, ...lookOf(preset), logoKey, takenAt: new Date().toISOString() };
}

/** A snapshot copied onto another event (Duplicate): same look, its own logo object. */
async function copySnapshot(snapshot, eventId) {
  if (!snapshot) return null;
  if (!snapshot.logoKey) return { ...snapshot };
  const bytes = await objectStorage.getPublicObjectBuffer(snapshot.logoKey);
  if (!bytes) return null;
  return { ...snapshot, logoKey: await storage.putPublic(eventId, "watermark", "webp", bytes, "image/webp") };
}

/**
 * Whether guests of an event must only ever see watermarked photos: a preset was chosen and the
 * watermark is on. An event from before presets existed may say `watermark: true` with nothing to
 * draw; it keeps showing what it always showed.
 */
const watermarkRequired = (gallery) => { const uses = watermarkUses(gallery); return uses.view || uses.download; };

async function mapLimited(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() { while (next < items.length) { const index = next; next += 1; results[index] = await mapper(items[index]); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

/** One photo drawn with one look, stored, and recorded; the row that won a race is answered either way. */
async function drawOne(row, snapshot, hash, markPromise) {
  const mark = await markPromise;
  const previewBytes = await objectStorage.getPublicObjectBuffer(row.previewKey);
  if (!previewBytes) return null;
  const preview = await render.applyWatermark(previewBytes, snapshot, mark);
  const previewKey = await storage.putPublic(row.eventId, "watermarked", preview.extension, preview.buffer, preview.contentType);
  let thumbnailKey = null;
  const thumbnailBytes = row.thumbnailKey ? await objectStorage.getPublicObjectBuffer(row.thumbnailKey) : null;
  if (thumbnailBytes) {
    const thumbnail = await render.applyWatermark(thumbnailBytes, snapshot, mark);
    thumbnailKey = await storage.putPublic(row.eventId, "watermarked", thumbnail.extension, thumbnail.buffer, thumbnail.contentType);
  }
  try {
    return await prisma.aiEventMediaWatermark.create({ data: { mediaId: row.id, configHash: hash, previewKey, thumbnailKey } });
  } catch (error) {
    await storage.deletePublicKeys([previewKey, thumbnailKey].filter(Boolean));
    if (error?.code === "P2002") return prisma.aiEventMediaWatermark.findUnique({ where: { mediaId_configHash: { mediaId: row.id, configHash: hash } } });
    throw error;
  }
}

const loadLogo = (key) => objectStorage.getPublicObjectBuffer(key);

/** Draws the photos among `rows` that have no copy for `snapshot` yet; answers the copies drawn. */
async function drawMissing(snapshot, rows) {
  const hash = configHash(snapshot);
  const photos = rows.filter((row) => row.kind !== "VIDEO" && row.previewKey);
  if (!photos.length) return [];
  const existing = new Set((await prisma.aiEventMediaWatermark.findMany({ where: { mediaId: { in: photos.map((row) => row.id) }, configHash: hash }, select: { mediaId: true } })).map((row) => row.mediaId));
  const missing = photos.filter((row) => !existing.has(row.id));
  if (!missing.length) return [];
  const markPromise = render.markFor(snapshot, loadLogo);
  markPromise.catch(() => {});
  const drawn = await mapLimited(missing, RENDER_CONCURRENCY, (row) => drawOne(row, snapshot, hash, markPromise).catch((error) => { console.error("[ai-feature] watermark draw failed:", row.id, error.message); return null; }));
  return drawn.filter(Boolean);
}

/*
 * A copy not drawn yet is handed out as a signed address on this server rather than drawn while the
 * guest waits for the list: the browser asks for it only when the tile is on screen, the server
 * draws that one photo, and answers with a redirect to the stored copy. The signature binds the
 * photo to one look, so the address cannot be turned into any other photo or any other look - and
 * it can only ever lead to a watermarked copy.
 */
// Never signed with a key anyone could compute: without the server's secret there are no addresses.
function signingKey() {
  if (!process.env.JWT_SECRET) throw httpError(500, "Watermark signing is not configured.");
  return crypto.createHash("sha256").update(`ai-feature-watermark:${process.env.JWT_SECRET}`).digest();
}
const signCopy = (mediaId, hash) => crypto.createHmac("sha256", signingKey()).update(`${mediaId}:${hash}`).digest("base64url").slice(0, 32);
function verifyCopy(mediaId, hash, signature) {
  const expected = Buffer.from(signCopy(mediaId, hash));
  const given = Buffer.from(String(signature || ""));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}
const copyPath = (mediaId, hash, variant) => `/api/public/ai-feature/w/${encodeURIComponent(mediaId)}/${hash}/${variant}?s=${signCopy(mediaId, hash)}`;

/**
 * The watermarked copies of these photos for an event's guests, as far as they are drawn. Answers
 * null when the event draws no watermark anywhere (guests get the photos as they are); otherwise
 * `{ hash, copies, view, download }` - a Map of media id to `{ previewKey, thumbnailKey }`, and
 * which of viewing and downloading take the watermark - and the worker is asked to draw whatever is
 * missing. One copy serves both: it is the photo's preview with the watermark drawn on it. A photo missing from the map is handed out by `copyPath`, never
 * clean; with no usable look at all, `hash` is null and it is handed out with no address.
 * Nothing is drawn here, so a list answers at once however new the look is.
 */
async function guestCopies(gallery, rows) {
  if (!watermarkRequired(gallery)) return null;
  const { view, download } = watermarkUses(gallery);
  const snapshot = activeSnapshot(gallery);
  const copies = new Map();
  if (!snapshot) return { hash: null, copies, view, download };
  const hash = configHash(snapshot);
  const photos = rows.filter((row) => row && row.kind !== "VIDEO" && row.previewKey);
  if (!photos.length) return { hash, copies, view, download };
  const existing = await prisma.aiEventMediaWatermark.findMany({ where: { mediaId: { in: photos.map((row) => row.id) }, configHash: hash } });
  for (const row of existing) copies.set(row.mediaId, row);
  if (copies.size < photos.length) queue().enqueueWatermarks(photos[0].eventId).catch((error) => console.error("[ai-feature] watermark enqueue failed:", error.message));
  return { hash, copies, view, download };
}

/**
 * The copy a signed address names, drawn now if it has not been. Refused (null) for a photo that is
 * gone, an event that no longer draws this look, or a photo that cannot be drawn - the guest's tile
 * stays empty rather than showing the photo clean.
 */
// One drawing per copy however many requests ask for it at once, and at most a few drawings at a
// time for the whole server; the rest wait their turn, and past a long queue the answer is no.
const inFlight = new Map();
const ON_DEMAND_SLOTS = 4;
const ON_DEMAND_QUEUE = 200;
let running = 0;
const waiting = [];
async function withSlot(work) {
  if (running >= ON_DEMAND_SLOTS) {
    if (waiting.length >= ON_DEMAND_QUEUE) return null;
    await new Promise((resolve) => waiting.push(resolve));
  }
  running += 1;
  try { return await work(); } finally { running -= 1; waiting.shift()?.(); }
}

function drawOnDemand(mediaId, hash) {
  const key = `${mediaId}:${hash}`;
  if (!inFlight.has(key)) inFlight.set(key, drawOnDemandOnce(mediaId, hash).finally(() => inFlight.delete(key)));
  return inFlight.get(key);
}

async function drawOnDemandOnce(mediaId, hash) {
  const row = await prisma.aiEventMedia.findFirst({ where: { id: mediaId, deletedAt: null } });
  if (!row) return null;
  const setting = await prisma.aiEventSetting.findUnique({ where: { eventId: row.eventId } });
  const gallery = mergeGroup("gallery", setting?.gallery);
  const snapshot = watermarkRequired(gallery) ? activeSnapshot(gallery) : null;
  if (!snapshot || configHash(snapshot) !== hash) return null;
  const existing = await prisma.aiEventMediaWatermark.findUnique({ where: { mediaId_configHash: { mediaId, configHash: hash } } });
  if (existing) return existing;
  try { return await withSlot(() => drawOne(row, snapshot, hash, render.markFor(snapshot, loadLogo))); }
  catch (error) { console.error("[ai-feature] watermark draw failed:", mediaId, error.message); return null; }
}

/**
 * Draws every photo of an event that has no copy for the event's current look, then takes away the
 * copies of any older look. Run by the worker after a settings change or an upload, so guests rarely
 * wait for a drawing; `guestCopies` still draws on demand whatever this has not reached.
 */
async function currentLook(eventId) {
  const setting = await prisma.aiEventSetting.findUnique({ where: { eventId } });
  const gallery = mergeGroup("gallery", setting?.gallery);
  const snapshot = watermarkRequired(gallery) ? activeSnapshot(gallery) : null;
  return { snapshot, hash: snapshot ? configHash(snapshot) : null };
}

async function drawEvent(eventId, rounds = 3) {
  const { snapshot, hash } = await currentLook(eventId);
  let cursor = null;
  for (;;) {
    const rows = await prisma.aiEventMedia.findMany({ where: { eventId, deletedAt: null, kind: "PHOTO" }, orderBy: { id: "asc" }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (!rows.length) break;
    if (snapshot) await drawMissing(snapshot, rows);
    cursor = rows[rows.length - 1].id;
  }
  // The look may have changed while this ran; what is kept is decided by the look as it is now.
  const now = await currentLook(eventId);
  await discardStale(eventId, now.hash);
  if (now.hash && now.hash !== hash && rounds > 1) await drawEvent(eventId, rounds - 1);
}

/** The copies an event no longer shows: every look but `keepHash` (all of them when null). */
async function discardStale(eventId, keepHash) {
  const where = { media: { eventId }, ...(keepHash ? { configHash: { not: keepHash } } : {}) };
  for (;;) {
    const rows = await prisma.aiEventMediaWatermark.findMany({ where, take: 500, select: { id: true, previewKey: true, thumbnailKey: true } });
    if (!rows.length) return;
    await storage.deletePublicKeys(rows.flatMap((row) => [row.previewKey, row.thumbnailKey]).filter(Boolean));
    await prisma.aiEventMediaWatermark.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
  }
}

/**
 * The copies of one photo, for a photo being deleted. Best effort: the rows go with the photo by
 * cascade, and a copy's object left behind is never handed out again, so tidying it can never be
 * what stops a photo being deleted.
 */
async function discardForMedia(mediaId) {
  try {
    const rows = await prisma.aiEventMediaWatermark.findMany({ where: { mediaId }, select: { previewKey: true, thumbnailKey: true } });
    await storage.deletePublicKeys(rows.flatMap((row) => [row.previewKey, row.thumbnailKey]).filter(Boolean));
  } catch (error) {
    console.error("[ai-feature] watermarked copies not discarded:", mediaId, error.message);
  }
}

module.exports = { withDefaultsLock, list, create, update, remove, textMarkPng, assertPreset, snapshotFor, copySnapshot, serializeSnapshot, watermarkRequired, watermarkUses, guestCopies, drawOnDemand, signCopy, verifyCopy, copyPath, drawEvent, discardStale, discardForMedia, LOGO_FOLDER };
