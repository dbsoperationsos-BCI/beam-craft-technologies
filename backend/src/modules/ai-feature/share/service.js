const QRCode = require("qrcode");
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
  const share = await prisma.aiEventShare.findUnique({ where, include: { event: { include: { setting: true, subEvents: { orderBy: { sortOrder: "asc" } } } } } });
  if (!share || share.status !== "ACTIVE" || share.event.deletedAt || share.event.archivedAt) throw httpError(404, "Event link not found.");
  if (share.expiresAt && share.expiresAt < new Date()) throw httpError(410, "This event link has expired.");
  return share;
}

module.exports = { get, create, revoke, resolve, guestUrl };
