const QRCode = require("qrcode");
const prisma = require("../../../config/db");
const { httpError } = require("../shared/http");
const { loadEvent } = require("../shared/eventAccess");
const objectStorage = require("../../../services/objectStorage");
const { createSettingsService } = require("../../image-selection/settings/service");

/**
 * What a QR poster is drawn from, for the Share dialog's QR Template (web and desktop): the live
 * link, the event's own name, and the two things a browser cannot get for itself -
 *
 * - the QR as its grid of modules, made by the same `qrcode` library and from the same URL the
 *   dialog's own QR image is, so the client can draw it sharp at print size with a proper quiet
 *   zone. Error correction is High, which is what lets the studio's mark sit in its centre.
 * - the studio's Global Logo (light and dark, as Settings → Branding Logo holds them) as data
 *   URLs. The logo is a public object in our own bucket, but the bucket sends no CORS headers, so
 *   a canvas that drew it straight from its URL could never be exported. It is read here by its
 *   key, from our own storage only - a stored URL that is not ours is never fetched - and a
 *   missing, unreadable or oversized one is simply left out: the client then uses the app's own
 *   fallback mark, the same rule every logo in the app follows.
 *
 * Only an ACTIVE, unexpired link has a poster: a revoked or lapsed one is a 409, so nobody prints
 * a code that no longer opens. Nothing here is more than the Share dialog already shows the same
 * caller (the URL, the short code and the PIN).
 */
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
// Where Settings → Branding Logo stores the Global Logo (image-selection/settings/controller.js).
// Only a key under it is read, so a stored URL can never pull any other object into the answer.
const BRANDING_PREFIX = "image-selection/branding/";
const LOGO_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml", gif: "image/gif" };

function createPosterService(dependencies = {}) {
  const db = dependencies.prisma || prisma;
  const storage = dependencies.objectStorage || objectStorage;
  const settings = dependencies.settings || createSettingsService();
  const findEvent = dependencies.loadEvent || loadEvent;
  const linkOf = dependencies.withLink || ((share) => require("./service").withLink(share));
  const now = dependencies.now || (() => new Date());

  /** One stored logo as a data URL, or null - never an error that would cost the poster. */
  async function logoData(url) {
    const value = String(url || "").trim();
    if (!value) return null;
    // Storage not configured (development): the logo was saved as a data URL in the first place.
    if (/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/i.test(value)) return value.length <= LOGO_MAX_BYTES * 1.4 ? value : null;
    const key = storage.keyFromUrl(value);
    if (!key || !key.startsWith(BRANDING_PREFIX) || key.includes("..")) return null;
    const extension = (key.split(".").pop() || "").toLowerCase();
    const type = LOGO_TYPES[extension];
    if (!type) return null;
    try {
      const bytes = await storage.getPublicObjectBuffer(key);
      if (!bytes || !bytes.length || bytes.length > LOGO_MAX_BYTES) return null;
      return `data:${type};base64,${bytes.toString("base64")}`;
    } catch (error) {
      console.error("[ai-feature] poster logo could not be read:", error.message);
      return null;
    }
  }

  async function poster(eventId) {
    const event = await findEvent(eventId);
    const share = await db.aiEventShare.findUnique({ where: { eventId } });
    if (!share || share.status !== "ACTIVE") throw httpError(409, "This event has no active guest link. Generate one before making a poster.");
    if (share.expiresAt && new Date(share.expiresAt) <= now()) throw httpError(409, "The guest link has expired. Regenerate it before making a poster.");
    const link = await linkOf(share);
    const qr = QRCode.create(link.url, { errorCorrectionLevel: "H" });
    const size = qr.modules.size;
    const modules = Array.from(qr.modules.data, (bit) => (bit ? "1" : "0")).join("");
    const branding = await settings.read();
    const [light, dark] = await Promise.all([logoData(branding.galleryLogoUrl), logoData(branding.galleryLogoDarkUrl)]);
    return {
      url: link.url, shortCode: link.shortCode, pin: link.pin || null, expiresAt: share.expiresAt,
      event: { id: event.id, name: event.name, eventType: event.eventType || null, startDate: event.startDate || null, endDate: event.endDate || null, location: event.location || null },
      studioName: branding.studioName || null,
      qr: { size, modules, errorCorrection: "H" },
      logos: { light, dark },
    };
  }

  return { poster, logoData };
}

const defaultService = createPosterService();

module.exports = { createPosterService, poster: defaultService.poster, LOGO_MAX_BYTES, BRANDING_PREFIX };
