const prisma = require("../../../config/db");
const { httpError } = require("../../ai-feature/shared/http");
const { expiredLinkError } = require("../../../services/expiredLink");
const security = require("../shared/security");
const settingsService = require("../settings/service");
const galleries = require("../galleries/service");
const orders = require("../orders/service");
const payments = require("../payments/service");
const search = require("../search/service");
const watermarks = require("../watermarks/service");
const guests = require("../guests/service");
const storage = require("../shared/storage");

/**
 * The guest store, mounted at /api/public/photo-selling. No staff JWT: the link's code names the
 * store, a PIN may guard it, and a store session (shared/security.js) names the device.
 *
 * **A guest never sees the gallery whole.** There is no route that lists a gallery's photos. A guest
 * opens the store (after its PIN, where it has one), uploads a selfie, and what they may then see,
 * put in a cart or buy is exactly the photos their own searches matched (`search.matchedPhotoIds`) -
 * checked here on every route that names a photo, so a changed photo id, gallery code or order
 * reference opens nothing more. Opening the store is not a match: a session with no matching search
 * can see and buy nothing.
 *
 * A store is reachable only while it is live (published, not archived, not expired). An order is
 * reachable for as long as it exists - a buyer keeps what they paid for after the store closes.
 *
 * Photos are only ever handed out as watermarked addresses (watermarks/service.js); a photo's clean
 * preview, its original, any storage key, its original path and its face data are never in a
 * response. The original is reached only by a paid order's download ticket.
 */
async function liveStore(code) {
  const gallery = await galleries.resolveCode(code);
  if (!gallery) throw httpError(404, "Gallery not found.");
  const state = galleries.liveState(gallery);
  if (!state.live) {
    if (state.reason === "Expired") throw expiredLinkError();
    throw httpError(404, "This gallery isn't open right now.");
  }
  return gallery;
}

/** A store for an order: found by its code whatever its state, so a closed store's buyers keep access. */
async function anyStore(code) {
  const gallery = await galleries.resolveCode(code);
  if (!gallery) throw httpError(404, "Gallery not found.");
  return gallery;
}

/**
 * The cover behind the store's login, only when the studio chose one - a photo it decided every
 * visitor may see - and only while that photo is on sale: hidden or removed, and there is no cover.
 * Shown without the store's watermark (owner's decision, 2026-10-31): it is the photo's web-size
 * preview from the public bucket, never its original. Every other photo a guest sees stays watermarked.
 */
async function coverUrl(gallery) {
  if (!gallery.coverPhotoId) return null;
  const photo = await prisma.photoSalePhoto.findFirst({ where: { id: gallery.coverPhotoId, galleryId: gallery.id, removedAt: null, available: true }, select: { previewKey: true } });
  return storage.publicUrl(photo?.previewKey);
}

/** What the landing page shows before anybody enters: the gallery's name and prices; its photos need a session. */
async function meta(code) {
  const gallery = await liveStore(code);
  const searchState = await search.availability(gallery);
  return {
    title: gallery.title, description: gallery.description || "", eventDate: gallery.eventDate, venue: gallery.venue || "", expiresAt: gallery.expiresAt,
    coverUrl: await coverUrl(gallery), accentColor: gallery.accentColor, requirePin: Boolean(gallery.pinHash),
    currency: gallery.currency, pricePaise: gallery.pricePaise,
    taxRateBps: gallery.taxRateBps, pricesIncludeTax: gallery.pricesIncludeTax, downloads: (await settingsService.get()).downloads,
    packages: gallery.packages.map((pack) => ({ id: pack.id, name: pack.name, photoCount: pack.photoCount, pricePaise: pack.pricePaise })),
    search: searchState,
    // Whether the store asks for a name and WhatsApp number before the selfie, to message the guest later.
    whatsapp: { offered: guests.offered(gallery) },
  };
}

/**
 * Opens a store session - the store's first screen, as the AI Feature's join card: the guest's name and
 * WhatsApp number, every time, and the PIN where the store has one (no code is sent). The guest is
 * registered with the session (guests.register), with their WhatsApp choice where the gallery offers
 * messages. Each session is one visit.
 */
async function openSession(code, { pin, name, phone, whatsappConsent = false }, address) {
  const gallery = await liveStore(code);
  if (gallery.pinHash) {
    if (!pin) throw httpError(401, "Enter the gallery PIN.");
    security.registerPinAttempt(gallery.shareTokenHash, address);
    if (!(await security.comparePin(pin, gallery.pinHash))) { security.registerWrongPin(gallery.shareTokenHash); throw httpError(401, "That PIN is not right. Check it and try again."); }
    security.clearPinAttempts(gallery.shareTokenHash, address);
  }
  guests.checkedPhone(phone);
  const { token, sid } = security.signSession(gallery.id);
  const guest = await guests.register(gallery, { sessionHash: security.hash(sid) }, { name, phone, whatsappConsent });
  await prisma.photoSaleGallery.update({ where: { id: gallery.id }, data: { visitCount: { increment: 1 } } });
  return { session: token, guest };
}

function storePhoto(gallery, offer, hash) {
  const addresses = watermarks.addressesFor(offer.id, hash);
  return {
    photoId: offer.id, width: offer.width, height: offer.height, capturedAt: offer.capturedAt,
    thumbnailUrl: addresses.thumbnailUrl, previewUrl: addresses.previewUrl,
    pricePaise: offer.pricePaise ?? gallery.pricePaise,
  };
}

/** The store photos among `photoIds`, in that order - only ones still for sale and indexed (a selfie's matches). */
async function photosByIds(gallery, photoIds) {
  if (!photoIds.length) return [];
  const rows = await prisma.photoSalePhoto.findMany({ where: { ...orders.FOR_SALE(gallery), faceStatus: "DONE", id: { in: photoIds } } });
  const hash = watermarks.lookHash(gallery.watermarkSnapshot);
  const byId = new Map(rows.map((row) => [row.id, storePhoto(gallery, row, hash)]));
  return photoIds.map((id) => byId.get(id)).filter(Boolean);
}

/** Cart lines checked against this device's matches: a photo it has not matched cannot be priced or bought. */
async function onlyMatched(gallery, session, items) {
  const matched = await search.matchedPhotoIds(gallery, session);
  const outside = items.filter((item) => !matched.has(item.photoId)).map((item) => item.photoId);
  if (outside.length) throw httpError(409, "Your cart has photos that aren't in your matched results. Search again with your selfie.", { unavailable: [...new Set(outside)] });
}

/** What a cart costs. Every photo is checked to be for sale in this store (orders.eligibleLines). */
async function quote(code, authHeader, body) {
  const gallery = await liveStore(code);
  const session = security.readSession(authHeader, gallery.id);
  await onlyMatched(gallery, session, body.items);
  return orders.quote(gallery, body.items);
}

async function checkout(code, authHeader, body) {
  const gallery = await liveStore(code);
  const session = security.readSession(authHeader, gallery.id);
  await onlyMatched(gallery, session, body.items);
  return orders.create(gallery, session, body);
}

async function myOrders(code, authHeader) {
  const gallery = await anyStore(code);
  const session = security.readSession(authHeader, gallery.id);
  return orders.listForSession(gallery, session);
}

/** One order, after asking Cashfree about any attempt still open - never trusting the redirect. */
async function order(code, ref, credentials) {
  const gallery = await anyStore(code);
  const found = await orders.authorize(gallery, ref, credentials);
  if (found.status !== "PAID") await payments.refreshOrder(found.id).catch((error) => console.error("[photo-selling] order refresh failed:", error.message));
  return { gallery: { title: gallery.title, shortCode: gallery.shortCode, accentColor: gallery.accentColor }, order: await orders.forBuyer(gallery, found) };
}

async function pay(code, ref, credentials) {
  const gallery = await anyStore(code);
  const found = await orders.authorize(gallery, ref, credentials);
  if (found.status !== "PAID" && !galleries.liveState(gallery).live) throw httpError(409, "This gallery has stopped selling, so this order can no longer be paid.");
  return payments.startCheckout(found, gallery);
}

async function downloadTicket(code, ref, itemId, credentials) {
  const gallery = await anyStore(code);
  const found = await orders.authorize(gallery, ref, credentials);
  return orders.downloadTicket(found, itemId);
}

async function selfieCreate(code, authHeader, file, consent) {
  const gallery = await liveStore(code);
  const session = security.readSession(authHeader, gallery.id);
  return search.create(gallery, session, file, consent);
}

async function selfieGet(code, authHeader, searchId) {
  const gallery = await liveStore(code);
  const session = security.readSession(authHeader, gallery.id);
  return search.get(gallery, session, searchId, (ids) => photosByIds(gallery, ids));
}

/** This device's latest search, so a guest who comes back finds their results rather than starting over. */
async function selfieLatest(code, authHeader) {
  const gallery = await liveStore(code);
  const session = security.readSession(authHeader, gallery.id);
  return { search: await search.latest(gallery, session) };
}

async function selfieDelete(code, authHeader, searchId) {
  const gallery = await anyStore(code);
  return search.remove(gallery, security.readSession(authHeader, gallery.id), searchId);
}

/** This device's registered guest in this store: name, masked number and whether messages are on - or null. */
async function guestGet(code, authHeader) {
  const gallery = await liveStore(code);
  return { guest: await guests.current(gallery, security.readSession(authHeader, gallery.id)) };
}

async function guestRegister(code, authHeader, body) {
  const gallery = await liveStore(code);
  return { guest: await guests.register(gallery, security.readSession(authHeader, gallery.id), body) };
}

/** "Stop WhatsApp messages" - allowed while the store is closed too: a guest can always say stop. */
async function guestStop(code, authHeader) {
  const gallery = await anyStore(code);
  return { guest: await guests.stop(gallery, security.readSession(authHeader, gallery.id)) };
}

/**
 * Every photo matched to this device's registered guest - their own search's and later uploads' - so a
 * guest who comes back from a WhatsApp message sees the new ones. Watermarked, as a search's are.
 */
async function guestPhotos(code, authHeader) {
  const gallery = await liveStore(code);
  const session = security.readSession(authHeader, gallery.id);
  return { photos: await photosByIds(gallery, await guests.matchedPhotoIds(gallery, session)) };
}

/** This device's guest's selfies (ids, dates, count and limit) - never a key or a face. */
async function guestSelfies(code, authHeader) {
  const gallery = await liveStore(code);
  return guests.listSelfies(gallery, security.readSession(authHeader, gallery.id));
}

/** One of this device's guest's own selfie thumbnails, streamed from private storage. */
async function guestSelfieThumbnail(code, authHeader, selfieId) {
  const gallery = await anyStore(code);
  return guests.selfieThumbnail(gallery, security.readSession(authHeader, gallery.id), selfieId);
}

/** Removes one of this device's guest's own selfies, and the matches only it supported. Allowed while the store is closed too. */
async function guestSelfieRemove(code, authHeader, selfieId) {
  const gallery = await anyStore(code);
  return guests.removeSelfie(gallery, security.readSession(authHeader, gallery.id), selfieId);
}

/** Whether this request may upload a selfie at all - asked before a single byte is read. */
async function selfiePreflight(code, authHeader) {
  const gallery = await liveStore(code);
  const session = security.readSession(authHeader, gallery.id);
  // Every guest gives a name and number first; a session from before that asks for them now.
  if (!(await guests.current(gallery, session))) throw httpError(409, "Enter your name and WhatsApp number first.");
  const open = await search.availability(gallery);
  if (!open.available) throw httpError(503, open.reason);
}

module.exports = { liveStore, meta, openSession, photosByIds, quote, checkout, myOrders, order, pay, downloadTicket, selfieCreate, selfieGet, selfieLatest, selfieDelete, selfiePreflight, guestGet, guestRegister, guestStop, guestPhotos, guestSelfies, guestSelfieThumbnail, guestSelfieRemove };
