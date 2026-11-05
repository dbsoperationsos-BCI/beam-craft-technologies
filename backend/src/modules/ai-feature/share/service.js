const QRCode = require("qrcode");
const { expiredLinkError } = require("../../../services/expiredLink");
const prisma = require("../../../config/db");
const { httpError } = require("../shared/http");
const activity = require("../shared/activity");
const { loadEvent } = require("../shared/eventAccess");
const { serializeShareSummary } = require("../shared/serializers");
const { generateShortCode, SHORT_CODE_PATTERN } = require("../../../services/shortCode");
const security = require("./security");

/** Where a guest link points: a dedicated host if one is set, else the app's own `/e/<code>`. */
function guestUrl(share) {
  const base = (process.env.AI_EVENT_PUBLIC_URL || `${(process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/+$/, "")}/e`).replace(/\/+$/, "");
  return `${base}/${share.shortCode || security.decryptValue(share.tokenCipher)}`;
}

async function withLink(share) {
  const url = guestUrl(share);
  return { ...serializeShareSummary(share), url, pin: share.pinCipher ? security.decryptValue(share.pinCipher) : null, qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 320 }) };
}

async function get(eventId) {
  await loadEvent(eventId);
  const share = await prisma.aiEventShare.findUnique({ where: { eventId } });
  return share ? withLink(share) : null;
}

async function uniqueShortCode() {
  for (let attempt = 0; attempt < 10; attempt += 1) { const code = generateShortCode(); if (!(await prisma.aiEventShare.findUnique({ where: { shortCode: code }, select: { id: true } }))) return code; }
  throw httpError(500, "Could not allocate a share code.");
}

/** Creates the link, or re-activates and re-keys a revoked one. `requirePin` adds a 4-digit PIN. */
async function create(eventId, { requirePin = false, expiresAt = null } = {}, user) {
  await loadEvent(eventId, { includeArchived: false });
  const token = security.generateToken();
  const pin = requirePin ? security.generatePin() : null;
  const data = { tokenHash: security.hashValue(token), tokenCipher: security.encryptValue(token), pinHash: pin ? await security.hashPin(pin) : null, pinCipher: pin ? security.encryptValue(pin) : null, status: "ACTIVE", expiresAt: expiresAt ? new Date(expiresAt) : null, revokedAt: null, createdByUserId: user?.id ?? null };
  const existing = await prisma.aiEventShare.findUnique({ where: { eventId } });
  const share = existing
    ? await prisma.aiEventShare.update({ where: { id: existing.id }, data: { ...data, shortCode: existing.shortCode || await uniqueShortCode() } })
    : await prisma.aiEventShare.create({ data: { eventId, ...data, shortCode: await uniqueShortCode() } });
  await activity.record(eventId, activity.EVENTS.EVENT_SHARED, activity.staffActor(user), share.shortCode);
  return withLink(share);
}

/**
 * Changes a live link in place, with every value made here - nothing is typed by the studio:
 *
 * - `requirePin: false` clears the PIN: the guest join no longer asks for one (it checks the hash,
 *   and there is none), and no PIN is shown, sent or printed anywhere.
 * - `requirePin: true` keeps the current PIN, or makes one when the link had none.
 * - `newPin: true` (Reset PIN) draws a fresh random PIN, different from the current one, turning
 *   the PIN on if it was off. The old PIN stops opening the link at once; guests already in stay in.
 * - `newCode: true` (New link code) draws a fresh unique code, as a new link gets: the URL changes,
 *   and the old one - with any QR printed from it - stops opening. The token, the PIN, the counts
 *   and the expiry are kept, and so are guests already in (their session names the link, not the
 *   code).
 *
 * A request that names nothing to change changes nothing: opening the dialog never rotates a value.
 * A revoked or never-made link cannot be edited: generating it again is the way back. A PIN is
 * never written to the activity log.
 */
async function update(eventId, { requirePin, newPin = false, newCode = false } = {}, user) {
  await loadEvent(eventId, { includeArchived: false });
  const share = await prisma.aiEventShare.findUnique({ where: { eventId } });
  if (!share || share.status !== "ACTIVE") throw httpError(409, "This event has no active guest link to edit. Generate one first.");
  if (newPin && requirePin === false) throw httpError(400, "A new PIN cannot be made while the PIN is being turned off.");
  const data = {};
  const changes = [];
  const wantsPin = newPin || (requirePin === undefined ? Boolean(share.pinHash) : Boolean(requirePin));
  if (!wantsPin && share.pinHash) { data.pinHash = null; data.pinCipher = null; changes.push("PIN turned off"); }
  if (wantsPin) {
    const current = share.pinCipher ? security.decryptValue(share.pinCipher) : null;
    let next = current || security.generatePin();
    if (newPin) { next = security.generatePin(); while (next === current) next = security.generatePin(); }
    if (next !== current) { data.pinHash = await security.hashPin(next); data.pinCipher = security.encryptValue(next); changes.push(current ? "PIN reset" : "PIN turned on"); }
  }
  if (newCode) changes.push("new link code");
  if (!changes.length) return withLink(share);
  // A code is drawn until it is free; another link taking it in the instant between the check and
  // the write (the column is unique) is a draw again, not an error.
  for (let attempt = 0; ; attempt += 1) {
    if (newCode) { data.shortCode = await uniqueShortCode(); while (data.shortCode === share.shortCode) data.shortCode = await uniqueShortCode(); }
    try {
      const updated = await prisma.aiEventShare.update({ where: { id: share.id }, data });
      await activity.record(eventId, activity.EVENTS.EVENT_SHARED, activity.staffActor(user), `link updated: ${changes.join(", ")}${newCode ? ` (${updated.shortCode})` : ""}`);
      return withLink(updated);
    } catch (error) {
      if (error?.code === "P2002" && newCode && attempt < 4) continue;
      throw error;
    }
  }
}

async function revoke(eventId, user) {
  await loadEvent(eventId);
  const share = await prisma.aiEventShare.findUnique({ where: { eventId } });
  if (!share) throw httpError(404, "This event has not been shared.");
  const updated = await prisma.aiEventShare.update({ where: { id: share.id }, data: { status: "REVOKED", revokedAt: new Date() } });
  await activity.record(eventId, activity.EVENTS.SHARE_REVOKED, activity.staffActor(user));
  return serializeShareSummary(updated);
}

/** Resolves a public code or token to a live share and its event, or 404. */
async function resolve(codeOrToken) {
  const value = String(codeOrToken || "");
  const where = security.TOKEN_PATTERN.test(value) ? { tokenHash: security.hashValue(value) } : SHORT_CODE_PATTERN.test(value) ? { shortCode: value.toUpperCase() } : null;
  if (!where) throw httpError(404, "Event link not found.");
  const share = await prisma.aiEventShare.findUnique({ where, include: { event: { include: { setting: true } } } });
  if (!share || share.status !== "ACTIVE" || share.event.deletedAt || share.event.archivedAt) throw httpError(404, "Event link not found.");
  if (share.expiresAt && share.expiresAt < new Date()) throw expiredLinkError();
  return share;
}

module.exports = { withLink, get, create, update, revoke, resolve, guestUrl };
