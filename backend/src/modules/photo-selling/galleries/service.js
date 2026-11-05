const QRCode = require("qrcode");
const { Prisma } = require("@prisma/client");
const prisma = require("../../../config/db");
const { httpError } = require("../../ai-feature/shared/http");
const { createPosterService } = require("../../ai-feature/share/poster");
const { createSettingsService } = require("../../image-selection/settings/service");
const { generateShortCode, SHORT_CODE_PATTERN } = require("../../../services/shortCode");
const security = require("../shared/security");
const config = require("../shared/config");
const storage = require("../shared/storage");
const watermarks = require("../watermarks/service");
const faces = require("../faces/service");
const cleanup = require("../shared/cleanup");
const settingsService = require("../settings/service");
const { MAX_PRICE_PAISE } = require("../pricing/pricing");

/**
 * A gallery's lifecycle, run by staff holding IMAGE_SELECTION / Photo Selling.
 *
 * A gallery is Photo Selling's own: made here with nothing but a name, filled with photos uploaded
 * here (photos/service.js), priced and published here. Nothing in any other module is read to make
 * one or written by one.
 *
 * It is a DRAFT until somebody publishes it, and it can only be published with a watermark to draw,
 * a price per photo, at least one photo on sale (its original stored, since the original is what a
 * buyer gets) and its photos ready for selfie search - a guest finds photos only by their selfie, so
 * a gallery opens only once its faces can be searched. `checklist` says what is still missing, in the
 * studio's words. Every step saves as it goes, so a draft is simply a gallery somebody will come
 * back to.
 */
const STATUSES = Object.freeze({ DRAFT: "DRAFT", PUBLISHED: "PUBLISHED", UNPUBLISHED: "UNPUBLISHED" });
// What a guest can buy: shown, not removed, with its original stored. Matches orders.FOR_SALE.
const ON_SALE = { available: true, removedAt: null, originalKey: { not: null } };

const storeUrl = (gallery) => `${config.storeBaseUrl()}/${gallery.shortCode}`;

async function uniqueShortCode() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = generateShortCode();
    if (!(await prisma.photoSaleGallery.findUnique({ where: { shortCode: code }, select: { id: true } }))) return code;
  }
  throw httpError(500, "Could not allocate a gallery code.");
}

/** Whether a gallery is open to guests right now, and if not, why - in the studio's words. */
function liveState(gallery, now = new Date()) {
  if (gallery.archivedAt) return { live: false, reason: "Archived" };
  if (gallery.status !== STATUSES.PUBLISHED) return { live: false, reason: gallery.status === STATUSES.DRAFT ? "Draft - not published yet" : "Unpublished" };
  if (gallery.expiresAt && gallery.expiresAt <= now) return { live: false, reason: "Expired" };
  return { live: true, reason: null };
}

function serializePackage(row) {
  return { id: row.id, name: row.name, photoCount: row.photoCount, pricePaise: row.pricePaise, isActive: row.isActive, sortOrder: row.sortOrder };
}

function serializeGallery(row, extra = {}) {
  const state = liveState(row);
  const look = row.watermarkSnapshot;
  return {
    id: row.id, title: row.title, description: row.description ?? "", eventDate: row.eventDate, venue: row.venue ?? "",
    coverPhotoId: row.coverPhotoId, coverUrl: storage.publicUrl(row.coverPhoto?.thumbnailKey) || null,
    status: row.status, live: state.live, liveReason: state.reason,
    publishedAt: row.publishedAt, expiresAt: row.expiresAt, archivedAt: row.archivedAt,
    currency: row.currency, pricePaise: row.pricePaise,
    taxRateBps: row.taxRateBps, pricesIncludeTax: row.pricesIncludeTax, accentColor: row.accentColor,
    watermark: look ? { presetId: look.presetId ?? null, name: look.name ?? "Watermark", type: look.type, opacity: look.opacity, size: look.size } : null,
    matchStrictness: row.matchStrictness,
    clientName: row.clientName ?? "", clientPhone: row.clientPhone ?? "",
    qrTemplateId: row.qrTemplateId || null, qrText: settingsService.cleanQrText(row.qrText),
    shortCode: row.shortCode, requirePin: Boolean(row.pinHash), visitCount: row.visitCount,
    selfieSearchEnabled: row.selfieSearchEnabled !== false, whatsappNotify: Boolean(row.whatsappNotify),
    packages: (row.packages || []).map(serializePackage),
    createdAt: row.createdAt, updatedAt: row.updatedAt,
    ...extra,
  };
}

const INCLUDE = { coverPhoto: { select: { thumbnailKey: true } }, packages: { orderBy: [{ sortOrder: "asc" }, { photoCount: "asc" }] } };

/** A gallery the studio can work on - never a deleted one (a deleted gallery is only its orders' record). */
async function loadGallery(id) {
  const row = await prisma.photoSaleGallery.findFirst({ where: { id: String(id), deletedAt: null }, include: INCLUDE });
  if (!row) throw httpError(404, "Gallery not found.");
  return row;
}

async function countsFor(galleryIds) {
  if (!galleryIds.length) return new Map();
  const [all, onSale, noOriginal, paid, firstPhotos] = await Promise.all([
    prisma.photoSalePhoto.groupBy({ by: ["galleryId"], where: { galleryId: { in: galleryIds }, removedAt: null }, _count: { _all: true } }),
    prisma.photoSalePhoto.groupBy({ by: ["galleryId"], where: { galleryId: { in: galleryIds }, ...ON_SALE }, _count: { _all: true } }),
    prisma.photoSalePhoto.groupBy({ by: ["galleryId"], where: { galleryId: { in: galleryIds }, removedAt: null, originalKey: null }, _count: { _all: true } }),
    prisma.photoSaleOrder.groupBy({ by: ["galleryId"], where: { galleryId: { in: galleryIds }, status: "PAID" }, _count: { _all: true }, _sum: { totalPaise: true } }),
    // The first photo of each gallery, for a cover where none was chosen - one indexed read per gallery.
    Promise.all(galleryIds.map((galleryId) => prisma.photoSalePhoto.findFirst({ where: { galleryId, removedAt: null }, orderBy: [{ sortOrder: "asc" }], select: { galleryId: true, thumbnailKey: true } }))).then((rows) => rows.filter(Boolean)),
  ]);
  const map = new Map(galleryIds.map((id) => [id, { photoCount: 0, availableCount: 0, withoutOriginalCount: 0, paidOrders: 0, grossPaise: 0, firstThumbnailUrl: null }]));
  for (const row of all) map.get(row.galleryId).photoCount = row._count._all;
  for (const row of onSale) map.get(row.galleryId).availableCount = row._count._all;
  for (const row of noOriginal) map.get(row.galleryId).withoutOriginalCount = row._count._all;
  for (const row of paid) Object.assign(map.get(row.galleryId), { paidOrders: row._count._all, grossPaise: row._sum.totalPaise || 0 });
  for (const row of firstPhotos) map.get(row.galleryId).firstThumbnailUrl = storage.publicUrl(row.thumbnailKey);
  return map;
}

function withCover(serialized, counts) {
  return { ...serialized, ...counts, coverUrl: serialized.coverUrl || counts?.firstThumbnailUrl || null };
}

async function list({ view = "active", search = "" } = {}) {
  const where = {
    deletedAt: null,
    ...(view === "archived" ? { archivedAt: { not: null } } : view === "drafts" ? { archivedAt: null, status: STATUSES.DRAFT } : { archivedAt: null }),
    ...(search ? { OR: [{ title: { contains: search } }, { venue: { contains: search } }, { shortCode: { contains: search.toUpperCase() } }] } : {}),
  };
  const rows = await prisma.photoSaleGallery.findMany({ where, include: INCLUDE, orderBy: [{ updatedAt: "desc" }], take: 200 });
  const counts = await countsFor(rows.map((row) => row.id));
  return rows.map((row) => withCover(serializeGallery(row), counts.get(row.id)));
}

/**
 * What still stands between a gallery and publishing (`blocking`), and what is worth knowing
 * (`advice`). One list, in the order the creation flow asks for things.
 */
function checklist(row, counts, index) {
  const blocking = [];
  const advice = [];
  if (!counts.photoCount) blocking.push({ code: "NO_PHOTOS", step: "photos", message: "Upload the photos you want to sell." });
  else if (!counts.availableCount) blocking.push({ code: "NONE_ON_SALE", step: "photos", message: counts.withoutOriginalCount ? "No photo can be sold yet: show at least one, and upload again any photo whose original is missing." : "Every photo is hidden - show at least one." });
  if (counts.withoutOriginalCount) advice.push({ code: "NO_ORIGINAL", step: "photos", message: `${counts.withoutOriginalCount} photo${counts.withoutOriginalCount === 1 ? " has" : "s have"} no original stored, so ${counts.withoutOriginalCount === 1 ? "it isn't" : "they aren't"} for sale. Upload ${counts.withoutOriginalCount === 1 ? "it" : "them"} again to sell ${counts.withoutOriginalCount === 1 ? "it" : "them"}.` });
  if (!(row.pricePaise > 0)) blocking.push({ code: "NO_PRICE", step: "pricing", message: "Set a price per photo." });
  // Guests find photos only by their selfie, so a gallery opens only once its faces can be searched.
  const matching = config.faceMatching();
  if (!matching.available) blocking.push({ code: "FACE_MATCHING_OFF", step: "photos", message: matching.reason });
  else if (index && index.pending > 0) blocking.push({ code: "INDEXING", step: "photos", message: `${index.pending} of ${index.total} photo${index.total === 1 ? " is" : "s are"} still being prepared for selfie search.` });
  else if (index && index.total > 0 && index.done === 0) blocking.push({ code: "NONE_SEARCHABLE", step: "photos", message: "Faces couldn't be found in any of the photos on sale, so guests would find nothing. Retry them on the Photos step." });
  if (index && index.failed > 0) advice.push({ code: "INDEX_FAILED", step: "photos", message: `Faces could not be found in ${index.failed} photo${index.failed === 1 ? "" : "s"} - guests cannot find ${index.failed === 1 ? "it" : "them"} by selfie. Retry them on the Photos step.` });
  if (!watermarks.lookHash(row.watermarkSnapshot)) blocking.push({ code: "NO_WATERMARK", step: "details", message: "Choose a watermark - guests only ever see watermarked previews." });
  const look = row.watermarkSnapshot;
  if (look && watermarks.lookHash(look) && (Number(look.opacity) < 30 || Number(look.size) < 15)) advice.push({ code: "FAINT_WATERMARK", step: "details", message: "Your watermark is faint or small, so guests could crop it out. A stronger one protects the photos you sell." });
  if (row.expiresAt && row.expiresAt <= new Date()) blocking.push({ code: "EXPIRED", step: "details", message: "The closing date has passed. Move it later, or clear it." });
  // What this server cannot do yet: guests could find their photos, but not pay or download. Said before publishing.
  const payments = config.cashfree();
  if (!payments.enabled) advice.push({ code: "PAYMENTS_OFF", step: null, message: `${payments.blockedReason} Guests can find their photos in a published gallery but cannot pay until it is.` });
  const originals = config.originalsStore();
  if (!originals.ready) advice.push({ code: "ORIGINALS_OFF", step: null, message: "Cloud storage isn't set up on the server, so no photo can be uploaded or downloaded yet. Ask your administrator." });
  return { blocking, advice, ready: blocking.length === 0 };
}

async function withLink(row) {
  const url = storeUrl(row);
  return { url, pin: row.pinCipher ? security.decryptValue(row.pinCipher) : null, qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 360 }) };
}

async function get(id) {
  const row = await loadGallery(id);
  const counts = (await countsFor([row.id])).get(row.id);
  const index = await faces.indexStatus(row.id);
  // The WhatsApp photo-match messages: what the server has in place, and this gallery's counts.
  const whatsapp = { ...require("../notifications/config").readiness(), ...(await require("../notifications/service").summary(row.id)) };
  return withCover(serializeGallery(row, { link: await withLink(row), index, checklist: checklist(row, counts, index), server: config.status(), whatsapp }), counts);
}

/**
 * Inserts a new draft gallery row with a link of its own - its share token, its short code (tried
 * again on the rare clash) and, `withPin`, its own PIN. The one place a gallery's link is made, for
 * New Gallery and Duplicate alike.
 */
async function insertDraft(data, { withPin = false, user = null } = {}) {
  const token = security.generateToken();
  const pin = withPin ? security.generatePin() : null;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.photoSaleGallery.create({
        data: {
          ...data,
          shareTokenHash: security.hash(token), shareTokenCipher: security.encryptValue(token), shortCode: await uniqueShortCode(),
          pinHash: pin ? await security.hashPin(pin) : null, pinCipher: pin ? security.encryptValue(pin) : null,
          createdByUserId: user?.id ?? null,
        },
      });
    } catch (error) {
      if (error?.code === "P2002" && attempt < 3) continue;
      throw error;
    }
  }
}

/**
 * A new draft gallery. Only the name is required. Everything else starts from Photo Selling's own
 * settings (settings/service.js) - price, tax, PIN, how guests find photos, strictness, colour,
 * watermark design and QR poster - copied on now, so changing the settings later never alters this
 * gallery. No AI Feature setting is read.
 */
async function create(body, user) {
  const defaults = await settingsService.get();
  if (body.watermarkPresetId && !(await prisma.aiWatermarkPreset.findUnique({ where: { id: body.watermarkPresetId }, select: { id: true } }))) throw httpError(400, "That watermark design no longer exists. Choose another.");
  const created = await insertDraft({
    title: body.title, description: body.description || null, eventDate: body.eventDate ? new Date(body.eventDate) : null, venue: body.venue || null,
    clientName: body.clientName || null, clientPhone: body.clientPhone || null,
    currency: "INR", pricePaise: body.pricePaise ?? defaults.pricePaise ?? null,
    taxRateBps: defaults.taxRateBps, pricesIncludeTax: defaults.pricesIncludeTax, accentColor: defaults.accentColor,
    matchStrictness: defaults.matchStrictness,
    selfieSearchEnabled: defaults.selfieSearchEnabled, whatsappNotify: defaults.whatsappNotify,
    qrTemplateId: defaults.qrTemplateId, qrText: defaults.qrText,
  }, { withPin: body.requirePin ?? defaults.requirePin, user });
  const presetId = body.watermarkPresetId || defaults.watermarkPresetId;
  if (presetId) {
    const snapshot = await watermarks.snapshotFor(created.id, presetId).catch(() => null);
    if (snapshot) await prisma.photoSaleGallery.update({ where: { id: created.id }, data: { watermarkSnapshot: snapshot } });
  }
  return get(created.id);
}

/**
 * A copy of a gallery's set-up under a new name, as the AI Feature duplicates an event: its welcome
 * note, prices and packages, tax, look, match strictness, watermark and QR poster. Never what belongs
 * to the original event - its client, date, venue, photos, cover, orders or closing date - nor its
 * link: the copy is a new private draft with its own link and short code and, where the original
 * asks for a PIN, a PIN of its own. A logo watermark lives in the gallery's own folder, so the copy
 * gets its own copy of the logo; a logo no longer stored means the copy starts without a watermark
 * (its checklist asks for one).
 *
 * All or nothing: if anything after the new row fails - its packages, or storage while copying the
 * logo - the new draft is deleted (its packages with it), a logo already copied is removed through
 * the durable clean-up, and the error is reported. No half-made copy is left to retry into a second.
 */
async function duplicate(id, { title }, user) {
  const source = await loadGallery(id);
  const created = await insertDraft({
    title, description: source.description,
    currency: source.currency, pricePaise: source.pricePaise, taxRateBps: source.taxRateBps, pricesIncludeTax: source.pricesIncludeTax,
    accentColor: source.accentColor, matchStrictness: source.matchStrictness,
    selfieSearchEnabled: source.selfieSearchEnabled, whatsappNotify: source.whatsappNotify,
    qrTemplateId: source.qrTemplateId, qrText: source.qrText ?? undefined,
  }, { withPin: Boolean(source.pinHash), user });
  let copiedLogo = null;
  try {
    if (source.packages?.length) {
      await prisma.photoSalePackage.createMany({ data: source.packages.map((pack, index) => ({ galleryId: created.id, name: pack.name, photoCount: pack.photoCount, pricePaise: pack.pricePaise, isActive: pack.isActive, sortOrder: index })) });
    }
    const snapshot = source.watermarkSnapshot;
    if (snapshot) {
      let copy = { ...snapshot, takenAt: new Date().toISOString() };
      if (snapshot.logoKey) {
        // A logo no longer stored reads as nothing; a storage fault throws and undoes the copy.
        const bytes = await storage.getObject(snapshot.logoKey);
        if (bytes) { copiedLogo = await storage.putPublic(created.id, "watermark", "webp", bytes, "image/webp"); copy = { ...copy, logoKey: copiedLogo }; }
        else copy = null;
      }
      if (copy) await prisma.photoSaleGallery.update({ where: { id: created.id }, data: { watermarkSnapshot: copy } });
    }
  } catch (error) {
    const plan = cleanup.plan(created.id, { public: [copiedLogo] }, { sweep: true });
    try {
      await prisma.$transaction(async (tx) => {
        await cleanup.record(plan, tx);
        await tx.photoSaleGallery.delete({ where: { id: created.id } });
      });
      await cleanup.drain({ galleryId: created.id });
    } catch (undo) {
      console.error("[photo-selling] a failed duplicate could not be undone:", created.id, undo.message);
    }
    throw error;
  }
  return get(created.id);
}

const EDITABLE = ["title", "description", "venue", "pricePaise", "taxRateBps", "pricesIncludeTax", "accentColor", "matchStrictness", "clientName", "clientPhone", "qrTemplateId", "selfieSearchEnabled", "whatsappNotify"];

async function update(id, body) {
  const row = await loadGallery(id);
  if (row.archivedAt) throw httpError(409, "Restore this gallery before editing it.");
  const data = {};
  for (const key of EDITABLE) if (body[key] !== undefined) data[key] = body[key] === "" ? null : body[key];
  if (body.qrText !== undefined) data.qrText = settingsService.cleanQrText(body.qrText, settingsService.cleanQrText(row.qrText));
  if (body.eventDate !== undefined) data.eventDate = body.eventDate ? new Date(body.eventDate) : null;
  if (body.expiresAt !== undefined) data.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  if (row.status === STATUSES.PUBLISHED && data.pricePaise === null) throw httpError(409, "A published gallery needs a price per photo. Unpublish it first.");
  if (body.coverPhotoId !== undefined) {
    if (body.coverPhotoId && !(await prisma.photoSalePhoto.findFirst({ where: { id: body.coverPhotoId, galleryId: row.id, removedAt: null }, select: { id: true } }))) throw httpError(400, "The cover must be one of this gallery's photos.");
    data.coverPhotoId = body.coverPhotoId || null;
  }
  if (body.watermarkPresetId !== undefined) {
    if (!body.watermarkPresetId && row.status === STATUSES.PUBLISHED) throw httpError(409, "A published gallery must keep a watermark. Unpublish it first.");
    data.watermarkSnapshot = body.watermarkPresetId ? await watermarks.snapshotFor(row.id, body.watermarkPresetId) : Prisma.DbNull;
  }
  await prisma.photoSaleGallery.update({ where: { id: row.id }, data });
  if (body.watermarkPresetId && row.status === STATUSES.PUBLISHED) watermarks.warmGallery(row.id);
  return get(row.id);
}

async function publish(id) {
  const row = await loadGallery(id);
  if (row.archivedAt) throw httpError(409, "Restore this gallery before publishing it.");
  const counts = (await countsFor([row.id])).get(row.id);
  const { blocking } = checklist(row, counts, await faces.indexStatus(row.id));
  if (blocking.length) throw httpError(400, blocking[0].message, { checklist: blocking });
  if (!(row.pricePaise <= MAX_PRICE_PAISE)) throw httpError(400, "The price per photo is not valid.");
  await prisma.photoSaleGallery.update({ where: { id: row.id }, data: { status: STATUSES.PUBLISHED, publishedAt: new Date() } });
  watermarks.warmGallery(row.id);
  return get(row.id);
}

async function unpublish(id) {
  const row = await loadGallery(id);
  if (row.status !== STATUSES.PUBLISHED) throw httpError(409, "This gallery is not published.");
  await prisma.photoSaleGallery.update({ where: { id: row.id }, data: { status: STATUSES.UNPUBLISHED } });
  return get(row.id);
}

/** Archiving closes the store at once; orders already paid stay downloadable from the order link. */
async function archive(id) {
  const row = await loadGallery(id);
  if (row.archivedAt) return get(row.id);
  await prisma.photoSaleGallery.update({ where: { id: row.id }, data: { archivedAt: new Date(), status: row.status === STATUSES.PUBLISHED ? STATUSES.UNPUBLISHED : row.status } });
  return get(row.id);
}

/** Restoring brings it back unpublished, so it is never public again without somebody deciding so. */
async function restore(id) {
  const row = await loadGallery(id);
  if (!row.archivedAt) return get(row.id);
  await prisma.photoSaleGallery.update({ where: { id: row.id }, data: { archivedAt: null } });
  return get(row.id);
}

/**
 * Deletes a gallery - a draft, a live one (it stops selling) or an archived one - and every file it
 * owned in R2. One that never took an order goes entirely, rows and files.
 *
 * One with orders keeps its order and payment records for the studio's accounts (owner's decision,
 * 2026-10-31): the gallery row stays, marked deleted (`deletedAt`) - gone from every list, its link,
 * QR code and buyers' order pages dead - and so does each photo an order names, off sale, as its order
 * line's record. Their files go like every other, so buyers can no longer download. Everything else
 * is deleted: the other photos with their faces and watermarked copies, and every guest's details,
 * selfies, matches, searches and messages.
 *
 * The files cannot go in the database's transaction, so they are recorded in it instead: every key
 * the gallery's own rows name (originals, previews, thumbnails, watermarked copies, the watermark
 * logo) and a sweep of its own folder, written in the same transaction that deletes the rows
 * (shared/cleanup.js). The deletion is then attempted at once; anything that fails is retried by the
 * worker until it is gone. The answer says how many files are still waiting, never "all gone" while
 * any remain. Asked again for a gallery already deleted: 404, and nothing else happens.
 */
async function removeGallery(id) {
  const row = await loadGallery(id);
  const [photos, copies, orderCount] = await Promise.all([
    prisma.photoSalePhoto.findMany({ where: { galleryId: row.id }, select: { id: true, originalKey: true, previewKey: true, thumbnailKey: true, _count: { select: { orderItems: true } } } }),
    prisma.photoSaleWatermark.findMany({ where: { photo: { galleryId: row.id } }, select: { previewKey: true, thumbnailKey: true } }),
    prisma.photoSaleOrder.count({ where: { galleryId: row.id } }),
  ]);
  const plan = cleanup.plan(row.id, {
    public: [...photos.flatMap((photo) => [photo.previewKey, photo.thumbnailKey]), ...copies.flatMap((copy) => [copy.previewKey, copy.thumbnailKey]), row.watermarkSnapshot?.logoKey],
    originals: photos.map((photo) => photo.originalKey),
  }, { sweep: true });
  try {
    await prisma.$transaction(async (tx) => {
      await cleanup.record(plan, tx);
      if (orderCount) await retire(tx, row, photos.filter((photo) => !photo._count.orderItems).map((photo) => photo.id));
      else await tx.photoSaleGallery.delete({ where: { id: row.id } });
    });
  } catch (error) {
    // An order placed in the moment after the count: the database refuses (Restrict) and nothing changed.
    if (error?.code === "P2003") throw httpError(409, "An order was just placed in this gallery. Please try deleting it again.");
    throw error;
  }
  const { remaining } = await cleanup.drain({ galleryId: row.id });
  return { deleted: true, filesRemaining: remaining, ordersKept: orderCount };
}

/**
 * Inside the deletion's transaction, for a gallery with orders: everything but the orders' record
 * goes. `unsold` are the photos no order names; the rest stay as order lines' photos, off sale.
 */
async function retire(tx, row, unsold) {
  const galleryId = row.id;
  const now = new Date();
  // A guest's selfies, matches and messages go with the guest; each is cleared on its own as well.
  for (const table of ["photoSaleNotification", "photoSaleGuestMatch", "photoSaleGuestSelfie", "photoSaleGuest", "photoSaleSelfieSearch", "photoSaleFace"]) await tx[table].deleteMany({ where: { galleryId } });
  const photoIds = (await tx.photoSalePhoto.findMany({ where: { galleryId }, select: { id: true } })).map((photo) => photo.id);
  await tx.photoSaleWatermark.deleteMany({ where: { photoId: { in: photoIds } } });
  await tx.photoSalePhoto.deleteMany({ where: { id: { in: unsold } } });
  await tx.photoSalePhoto.updateMany({ where: { galleryId }, data: { available: false, removedAt: now } });
  await tx.photoSaleGallery.update({ where: { id: galleryId }, data: { deletedAt: now, archivedAt: row.archivedAt || now, status: row.status === STATUSES.PUBLISHED ? STATUSES.UNPUBLISHED : row.status, coverPhotoId: null } });
}

/**
 * What the QR poster is drawn from: the gallery's own store link (its short code, made here - never
 * a link typed or sent), the code's module grid, the PIN when there is one, the gallery's name, and
 * the studio's name and logos. The shared poster designs draw it in the browser (lib/qrPoster.mjs).
 */
const posterLogos = createPosterService({ prisma: null, loadEvent: () => null, withLink: () => null });
const branding = createSettingsService();
async function kitFor({ url, pin = null, event, extra = {} }) {
  const qr = QRCode.create(url, { errorCorrectionLevel: "H" });
  const studio = await branding.read();
  const [light, dark] = await Promise.all([posterLogos.logoData(studio.galleryLogoUrl), posterLogos.logoData(studio.galleryLogoDarkUrl)]);
  return {
    url, pin, event, studioName: studio.studioName || null,
    qr: { size: qr.modules.size, modules: Array.from(qr.modules.data, (bit) => (bit ? "1" : "0")).join(""), errorCorrection: "H" },
    logos: { light, dark },
    ...extra,
  };
}

async function qrKit(id) {
  const row = await loadGallery(id);
  return kitFor({
    url: storeUrl(row), pin: row.pinCipher ? security.decryptValue(row.pinCipher) : null,
    event: { id: row.id, name: row.title, startDate: row.eventDate || null, location: row.venue || null },
    extra: { shortCode: row.shortCode, live: liveState(row).live },
  });
}

/** A poster kit for the Settings page's preview: the store's address with a placeholder code - never a real gallery's. */
const qrSample = () => kitFor({ url: `${config.storeBaseUrl()}/SAMPLE`, pin: "1234", event: { id: null, name: "Your event's name" }, extra: { sample: true } });

/** PIN on or off, a new PIN, a new link code - each value made here, never typed. */
async function updateLink(id, { requirePin, newPin = false, newCode = false }) {
  const row = await loadGallery(id);
  if (newPin && requirePin === false) throw httpError(400, "A new PIN cannot be made while the PIN is being turned off.");
  const data = {};
  const wantsPin = newPin || (requirePin === undefined ? Boolean(row.pinHash) : Boolean(requirePin));
  if (!wantsPin && row.pinHash) { data.pinHash = null; data.pinCipher = null; }
  if (wantsPin) {
    const current = row.pinCipher ? security.decryptValue(row.pinCipher) : null;
    let next = current || security.generatePin();
    if (newPin) { next = security.generatePin(); while (next === current) next = security.generatePin(); }
    if (next !== current) { data.pinHash = await security.hashPin(next); data.pinCipher = security.encryptValue(next); }
  }
  if (newCode) { let code = await uniqueShortCode(); while (code === row.shortCode) code = await uniqueShortCode(); data.shortCode = code; }
  if (Object.keys(data).length) await prisma.photoSaleGallery.update({ where: { id: row.id }, data });
  return get(row.id);
}

async function savePackages(id, packages) {
  const row = await loadGallery(id);
  if (!(row.pricePaise > 0)) throw httpError(400, "Set the price per photo before adding packages.");
  const counts = new Set();
  for (const pack of packages) {
    if (counts.has(pack.photoCount)) throw httpError(400, `Two packages are for ${pack.photoCount} photos. Keep one.`);
    counts.add(pack.photoCount);
    if (pack.pricePaise >= pack.photoCount * row.pricePaise) throw httpError(400, `"${pack.name}" costs as much as buying its ${pack.photoCount} photos one by one, so it would save nothing.`);
  }
  await prisma.$transaction([
    prisma.photoSalePackage.deleteMany({ where: { galleryId: row.id, id: { notIn: packages.filter((pack) => pack.id).map((pack) => pack.id) } } }),
    ...packages.map((pack, index) => (pack.id
      ? prisma.photoSalePackage.updateMany({ where: { id: pack.id, galleryId: row.id }, data: { name: pack.name, photoCount: pack.photoCount, pricePaise: pack.pricePaise, isActive: pack.isActive, sortOrder: index } })
      : prisma.photoSalePackage.create({ data: { galleryId: row.id, name: pack.name, photoCount: pack.photoCount, pricePaise: pack.pricePaise, isActive: pack.isActive, sortOrder: index } }))),
  ]);
  return get(row.id);
}

/**
 * The store as a guest will see it, for the Preview step - draft or not. Watermarked addresses
 * only, the same ones the live store hands out once published.
 */
async function preview(id) {
  const row = await loadGallery(id);
  const hash = watermarks.lookHash(row.watermarkSnapshot);
  const [onSale, firstPage] = await Promise.all([
    prisma.photoSalePhoto.count({ where: { galleryId: row.id, ...ON_SALE } }),
    prisma.photoSalePhoto.findMany({ where: { galleryId: row.id, ...ON_SALE }, orderBy: { sortOrder: "asc" }, take: 24 }),
  ]);
  const cover = row.coverPhotoId || firstPage[0]?.id || null;
  return {
    title: row.title, description: row.description || "", eventDate: row.eventDate, venue: row.venue || "", accentColor: row.accentColor, requirePin: Boolean(row.pinHash),
    coverUrl: cover && hash ? watermarks.addressesFor(cover, hash).previewUrl : null,
    currency: row.currency, pricePaise: row.pricePaise, photoCount: onSale,
    packages: row.packages.filter((pack) => pack.isActive).map(serializePackage), watermarked: Boolean(hash),
    photos: firstPage.map((photo) => ({ id: photo.id, width: photo.width, height: photo.height, pricePaise: photo.pricePaise ?? row.pricePaise, ...watermarks.addressesFor(photo.id, hash) })),
  };
}

/**
 * Resolves a public code or token to a gallery, whether or not it is live; the caller decides. A
 * deleted gallery resolves to nothing: its link, QR code and buyers' order pages no longer open. Its
 * code stays taken, so an old QR code can never lead to another gallery.
 */
async function resolveCode(codeOrToken) {
  const value = String(codeOrToken || "");
  const where = security.TOKEN_PATTERN.test(value) ? { shareTokenHash: security.hash(value) } : SHORT_CODE_PATTERN.test(value) ? { shortCode: value.toUpperCase() } : null;
  if (!where) return null;
  const row = await prisma.photoSaleGallery.findUnique({ where, include: { packages: { where: { isActive: true }, orderBy: [{ photoCount: "asc" }] } } });
  return row && !row.deletedAt ? row : null;
}

module.exports = {
  STATUSES, ON_SALE, liveState, serializeGallery, serializePackage, loadGallery, storeUrl, checklist,
  list, get, create, duplicate, update, publish, unpublish, archive, restore, removeGallery, updateLink, savePackages, preview, resolveCode, qrKit, qrSample,
};
