const prisma = require("../../../config/db");
const storage = require("../shared/storage");
const { httpError } = require("../../ai-feature/shared/http");
const security = require("../shared/security");
const config = require("../shared/config");
const pricing = require("../pricing/pricing");
const payments = require("../payments/service");
const watermarks = require("../watermarks/service");
const settingsService = require("../settings/service");
const { generateShortCode } = require("../../../services/shortCode");

/**
 * Orders: made from what the buyer asked for, priced only by `pricing.priceCart` from the store's own
 * rows, and opened only by the device that made them or by the order key handed out once.
 *
 * What an item delivers is the photo's untouched original, streamed from the private originals
 * bucket - and only once the order is PAID, which only a verified payment makes it
 * (payments/service.js). Each download needs a fresh ticket: one item, ten minutes, one use. A
 * bought photo can be downloaded again as often, and for as long after payment, as the policy the
 * order was sold under says - Photo Selling's settings at checkout, frozen on the order.
 *
 * AWAITING_STUDIO and DELIVERED are on orders made while originals were delivered by hand; they are
 * shown as they are and never set any more.
 */
const ITEM = Object.freeze({ PENDING_PAYMENT: "PENDING_PAYMENT", READY: "READY", AWAITING_STUDIO: "AWAITING_STUDIO", DELIVERED: "DELIVERED", UNAVAILABLE: "UNAVAILABLE" });
// A download in flight; it becomes SERVED when the last byte is sent, or FAILED.
const DOWNLOAD = Object.freeze({ STARTED: "STARTED", SERVED: "SERVED", FAILED: "FAILED" });
const PAGE_SIZE = 50;

async function uniqueOrderRef() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const ref = `PS-${generateShortCode(10)}`;
    if (!(await prisma.photoSaleOrder.findUnique({ where: { orderRef: ref }, select: { id: true } }))) return ref;
  }
  throw httpError(500, "Could not allocate an order reference.");
}

/** What a store offers: photos on sale in it whose original is stored. A photo id from anywhere else is not one. */
const FOR_SALE = (gallery) => ({ galleryId: gallery.id, available: true, removedAt: null, originalKey: { not: null } });

/**
 * The store's photos a cart names, checked: on offer in this store, available, not deleted, with an
 * original to sell. Answers the lines for `priceCart`, or throws 409 naming every photo that cannot
 * be bought so the cart can drop them and say why.
 */
async function eligibleLines(gallery, items) {
  const ids = [...new Set(items.map((item) => item.photoId))];
  const offers = await prisma.photoSalePhoto.findMany({ where: { ...FOR_SALE(gallery), id: { in: ids } } });
  const byId = new Map(offers.map((photo) => [photo.id, photo]));
  const unavailable = items.filter((item) => !byId.has(item.photoId)).map((item) => item.photoId);
  if (unavailable.length) throw httpError(409, unavailable.length === 1 ? "A photo in your cart is no longer for sale." : `${unavailable.length} photos in your cart are no longer for sale.`, { unavailable: [...new Set(unavailable)] });
  return items.map((item) => ({ photoId: item.photoId, photo: byId.get(item.photoId) }));
}

/** What a cart costs, for the cart screen. Nothing is written. */
async function quote(gallery, items) {
  const lines = await eligibleLines(gallery, items);
  const priced = pricing.priceCart(gallery, lines, gallery.packages || []);
  return serializeQuote(priced);
}

function serializeQuote(priced) {
  return {
    currency: priced.currency,
    lines: priced.lines.map((line) => ({ photoId: line.photoId, kind: line.kind, unitPricePaise: line.unitPricePaise, chargedPaise: line.chargedPaise, packageId: line.packageId || null })),
    subtotalPaise: priced.subtotalPaise, discountPaise: priced.discountPaise, taxPaise: priced.taxPaise, totalPaise: priced.totalPaise,
    packagesApplied: priced.snapshot.packages, taxRateBps: priced.snapshot.taxRateBps, pricesIncludeTax: priced.snapshot.pricesIncludeTax,
  };
}

/**
 * Makes the order and its first payment attempt. The order and its items are one transaction with
 * prices frozen on every line; Cashfree is asked after it commits, so a slow provider never holds a
 * database transaction open.
 */
async function create(gallery, session, { buyer, items }) {
  const phone = payments.normalizeIndianPhone(buyer.phone);
  if (!phone) throw httpError(400, "Enter a 10-digit Indian mobile number.");
  const settings = config.cashfree();
  if (!settings.enabled) throw httpError(503, settings.guestReason);
  const lines = await eligibleLines(gallery, items);
  const priced = pricing.priceCart(gallery, lines, gallery.packages || []);
  if (priced.totalPaise < 100) throw httpError(400, "The order total must be at least ₹1.");
  const orderKey = security.randomKey();
  const orderRef = await uniqueOrderRef();
  const order = await prisma.$transaction(async (tx) => tx.photoSaleOrder.create({
    data: {
      orderRef, galleryId: gallery.id, buyerName: buyer.name, buyerPhone: phone, buyerEmail: buyer.email || null,
      buyerSessionHash: session.sessionHash, accessKeyHash: security.hash(orderKey), currency: priced.currency,
      subtotalPaise: priced.subtotalPaise, discountPaise: priced.discountPaise, taxPaise: priced.taxPaise, totalPaise: priced.totalPaise,
      // The download policy is frozen with the prices: what the buyer was told at checkout is what they get.
      pricingSnapshot: { ...priced.snapshot, downloads: (await settingsService.get()).downloads },
      items: { create: priced.lines.map((line) => ({ photoId: line.photoId, kind: line.kind, fileName: line.photo.fileName, relativePath: line.photo.relativePath, contentHash: line.photo.contentHash, unitPricePaise: line.unitPricePaise, chargedPaise: line.chargedPaise })) },
    },
  }));
  const checkout = await payments.startCheckout(order, gallery);
  return { orderRef: order.orderRef, orderKey, checkout };
}

/**
 * An order the caller may open: by the device's own session, or by the order key. Anything else is
 * "not found", whether or not the order exists - an order reference on its own opens nothing.
 */
async function authorize(gallery, orderRef, { authHeader, orderKey }) {
  const order = await prisma.photoSaleOrder.findFirst({ where: { orderRef: String(orderRef || "").toUpperCase(), galleryId: gallery.id } });
  if (!order) throw httpError(404, "Order not found.");
  let session = null;
  try { session = security.readSession(authHeader, gallery.id, { required: false }); } catch { session = null; }
  const bySession = session && security.safeEqualHex(session.sessionHash, order.buyerSessionHash);
  const byKey = orderKey && security.KEY_PATTERN.test(String(orderKey)) && security.safeEqualHex(security.hash(orderKey), order.accessKeyHash);
  if (!bySession && !byKey) throw httpError(404, "Order not found.");
  return order;
}

/** The download policy an order was sold under; for an order from before it was frozen, today's. */
async function policyFor(order) {
  const frozen = order?.pricingSnapshot?.downloads;
  if (frozen && Number.isInteger(frozen.limit) && Number.isInteger(frozen.days)) return frozen;
  return (await settingsService.get()).downloads;
}

/** Whether a paid item may be downloaded again now, and if not, why - the repeat-download policy. */
function downloadAllowance(order, item, policy) {
  const until = order.paidAt ? new Date(new Date(order.paidAt).getTime() + policy.days * 86400000) : null;
  const used = item.downloadCount || 0;
  let reason = null;
  if (until && until.getTime() < Date.now()) reason = `Downloads for this photo ended on ${until.toISOString().slice(0, 10)}, ${policy.days} days after payment. Please contact the studio.`;
  else if (used >= policy.limit) reason = `This photo has been downloaded ${used} times, the most allowed. Please contact the studio.`;
  return { allowed: !reason, reason, remaining: Math.max(0, policy.limit - used), until };
}

function buyerItem(item, hash, paid, order, policy) {
  // A bought photo taken off sale has no watermarked copy any more; a paid order shows its clean thumbnail, which the buyer owns.
  // A deleted gallery's files are gone: no picture and no download, only the record.
  const deleted = Boolean(order.gallery?.deletedAt);
  const onSale = item.photoId && item.photo?.available && !item.photo?.removedAt;
  const thumbs = deleted ? { thumbnailUrl: null } : onSale ? watermarks.addressesFor(item.photoId, hash) : { thumbnailUrl: paid && item.photo ? storage.publicUrl(item.photo.thumbnailKey) : null };
  const allowance = paid && item.fulfilment === ITEM.READY && !deleted ? downloadAllowance(order, item, policy) : null;
  return {
    id: item.id, photoId: item.photoId, kind: item.kind, fileName: item.fileName, unitPricePaise: item.unitPricePaise, chargedPaise: item.chargedPaise,
    fulfilment: item.fulfilment, deliveredAt: item.deliveredAt, deliveryNote: item.deliveryNote, deliveryUrl: item.deliveryUrl,
    downloadCount: item.downloadCount, thumbnailUrl: thumbs.thumbnailUrl,
    canDownload: Boolean(allowance?.allowed), downloadsLeft: allowance ? allowance.remaining : null, downloadUntil: allowance?.until || null, downloadBlockedReason: allowance && !allowance.allowed ? allowance.reason : null,
  };
}

/** The order as the buyer sees it: what they bought, its state, and what they can download. */
async function forBuyer(gallery, order) {
  const full = await prisma.photoSaleOrder.findUnique({ where: { id: order.id }, include: { items: { orderBy: { createdAt: "asc" }, include: { photo: { select: { available: true, removedAt: true, thumbnailKey: true } } } }, payments: { orderBy: { attempt: "desc" }, take: 1 } } });
  const latest = full.payments[0] || null;
  const hash = watermarks.lookHash(gallery.watermarkSnapshot);
  return {
    orderRef: full.orderRef, status: full.status, createdAt: full.createdAt, paidAt: full.paidAt, currency: full.currency,
    buyerName: full.buyerName, subtotalPaise: full.subtotalPaise, discountPaise: full.discountPaise, taxPaise: full.taxPaise, totalPaise: full.totalPaise,
    pricesIncludeTax: full.pricingSnapshot?.pricesIncludeTax ?? true, taxRateBps: full.pricingSnapshot?.taxRateBps ?? 0, packagesApplied: full.pricingSnapshot?.packages || [],
    payment: latest ? { status: latest.status, attempt: latest.attempt, failureReason: latest.status === "SUCCESS" ? null : latest.failureReason } : null,
    canRetryPayment: ["PENDING", "FAILED"].includes(full.status) && (!latest || latest.status !== "PENDING"),
    downloads: await policyFor(full),
    items: await (async () => { const policy = await policyFor(full); return full.items.map((item) => buyerItem(item, hash, full.status === "PAID", full, policy)); })(),
  };
}

/** This device's orders in a store, newest first. */
async function listForSession(gallery, session) {
  const rows = await prisma.photoSaleOrder.findMany({ where: { galleryId: gallery.id, buyerSessionHash: session.sessionHash }, orderBy: { createdAt: "desc" }, take: 50, include: { _count: { select: { items: true } } } });
  return rows.map((row) => ({ orderRef: row.orderRef, status: row.status, totalPaise: row.totalPaise, currency: row.currency, createdAt: row.createdAt, paidAt: row.paidAt, itemCount: row._count.items }));
}

/**
 * A short-lived, single-use address that downloads one purchased original. Only for a PAID order -
 * which only a verified payment makes it - and only for an item of that order that is ready and
 * still within the repeat-download policy.
 */
async function downloadTicket(order, itemId) {
  if (order.status !== "PAID") throw httpError(402, "This order is not paid yet.");
  const item = await prisma.photoSaleOrderItem.findFirst({ where: { id: String(itemId), orderId: order.id } });
  if (!item) throw httpError(404, "That photo is not part of this order.");
  if (item.kind !== pricing.KINDS.ORIGINAL) throw httpError(409, "This photo was bought as a web-size copy before originals were sold. Please contact the studio.");
  if (item.fulfilment !== ITEM.READY) throw httpError(409, "This photo is no longer available to download. Please contact the studio.");
  const allowance = downloadAllowance(order, item, await policyFor(order));
  if (!allowance.allowed) throw httpError(409, allowance.reason);
  const ticket = security.signTicket({ orderId: order.id, itemId: item.id });
  return { url: `/api/public/photo-selling/download/${encodeURIComponent(item.id)}?t=${encodeURIComponent(ticket)}`, expiresInSeconds: security.TICKET_TTL_SECONDS, downloadsLeft: allowance.remaining };
}

/** The name a download is saved under: the original's own name, made header-safe, its extension kept. */
const downloadName = (fileName) => storage.safeFileName(fileName);

/**
 * Opens a purchased original for streaming. The ticket names the item; the order, the item and the
 * policy are checked again, now, so a ticket outlives nothing - not a refund, not a removed photo.
 * The download is then counted, atomically against the limit (a conditional increment, so tickets
 * redeemed in parallel cannot run past it), and the ticket claimed (its id, hashed, is unique on the
 * download record) before a byte is read, so it serves one download however many times it is
 * presented. A download that fails or is interrupted gives its count back.
 *
 * Answers `{ body, contentLength, contentType, fileName, finish(ok, error) }`; the caller streams
 * `body` and calls `finish` once, when the last byte is sent or the stream fails.
 */
async function openDownload(itemId, ticket, clientHash) {
  const payload = security.readTicket(ticket, String(itemId));
  const item = await prisma.photoSaleOrderItem.findFirst({ where: { id: payload.itemId, orderId: payload.orderId }, include: { order: { select: { status: true, paidAt: true, pricingSnapshot: true } }, photo: { select: { originalKey: true, mimeType: true } } } });
  if (!item || item.order.status !== "PAID" || item.kind !== pricing.KINDS.ORIGINAL || item.fulfilment !== ITEM.READY) throw httpError(404, "This download is not available.");
  const policy = await policyFor(item.order);
  const allowance = downloadAllowance(item.order, item, policy);
  if (!allowance.allowed) throw httpError(409, allowance.reason);
  const counted = await prisma.photoSaleOrderItem.updateMany({ where: { id: item.id, downloadCount: { lt: policy.limit } }, data: { downloadCount: { increment: 1 } } });
  if (!counted.count) throw httpError(409, downloadAllowance(item.order, { downloadCount: policy.limit }, policy).reason);
  const giveBack = () => prisma.photoSaleOrderItem.update({ where: { id: item.id }, data: { downloadCount: { decrement: 1 } } });
  let claim;
  try { claim = await prisma.photoSaleDownload.create({ data: { orderItemId: item.id, status: DOWNLOAD.STARTED, clientHash, ticketHash: security.hash(payload.jti) } }); }
  catch (error) {
    await giveBack();
    if (error?.code === "P2002") throw httpError(410, "This download link has already been used. Go back to your order and download again.");
    throw error;
  }
  const fail = async (message, status, error) => {
    await prisma.$transaction([prisma.photoSaleDownload.update({ where: { id: claim.id }, data: { status: DOWNLOAD.FAILED, error } }), giveBack()]);
    return httpError(status, message);
  };
  if (!item.photo?.originalKey) {
    await prisma.photoSaleOrderItem.update({ where: { id: item.id }, data: { fulfilment: ITEM.UNAVAILABLE } });
    throw await fail("The studio has removed this photo. Please contact them.", 410, "Original missing");
  }
  let object;
  try { object = await storage.getOriginal(item.photo.originalKey); }
  catch (error) { throw await fail("This photo could not be fetched just now. Please try the download again.", 503, `Storage: ${String(error?.message || error).slice(0, 200)}`); }
  let finished = false;
  const finish = async (ok, error) => {
    if (finished) return;
    finished = true;
    if (ok) {
      await prisma.$transaction([
        prisma.photoSaleDownload.update({ where: { id: claim.id }, data: { status: DOWNLOAD.SERVED } }),
        prisma.photoSaleOrderItem.update({ where: { id: item.id }, data: { lastDownloadedAt: new Date() } }),
      ]);
    } else {
      await prisma.$transaction([
        prisma.photoSaleDownload.update({ where: { id: claim.id }, data: { status: DOWNLOAD.FAILED, error: String(error || "Interrupted").slice(0, 255) } }),
        giveBack(),
      ]);
    }
  };
  return { body: object.body, contentLength: object.contentLength, contentType: item.photo.mimeType || object.contentType, fileName: downloadName(item.fileName), finish };
}

/* ------------------------------------------------------------------ staff */

function staffOrder(row) {
  return {
    id: row.id, orderRef: row.orderRef, status: row.status, createdAt: row.createdAt, paidAt: row.paidAt, currency: row.currency,
    buyerName: row.buyerName, buyerPhone: row.buyerPhone, buyerEmail: row.buyerEmail,
    subtotalPaise: row.subtotalPaise, discountPaise: row.discountPaise, taxPaise: row.taxPaise, totalPaise: row.totalPaise,
    gallery: row.gallery ? { id: row.gallery.id, title: row.gallery.title, shortCode: row.gallery.shortCode, deleted: Boolean(row.gallery.deletedAt) } : null,
    itemCount: row._count?.items ?? row.items?.length ?? 0,
  };
}

/** The first moment of a rolling range of orders placed - the last 7 or 30 days, 3 or 6 months up to `now` - or null for all of them. */
function rangeStart(range, now = new Date()) {
  if (range === "7d" || range === "30d") return new Date(now.getTime() - (range === "7d" ? 7 : 30) * 24 * 60 * 60 * 1000);
  if (range === "3m" || range === "6m") { const since = new Date(now); since.setMonth(since.getMonth() - (range === "3m" ? 3 : 6)); return since; }
  return null;
}

async function list({ galleryId, status, search = "", page = 1, range = "all" } = {}) {
  const since = rangeStart(range);
  // Everything but the status: what the status tabs count (All, Paid, Awaiting payment, Payment failed).
  const scope = {
    ...(galleryId ? { galleryId } : {}),
    ...(since ? { createdAt: { gte: since } } : {}),
    ...(search ? { OR: [{ orderRef: { contains: search.toUpperCase() } }, { buyerName: { contains: search } }, { buyerPhone: { contains: search } }, { buyerEmail: { contains: search } }] } : {}),
  };
  const where = {
    ...(galleryId ? { galleryId } : {}),
    ...(status ? { status } : {}),
    ...(since ? { createdAt: { gte: since } } : {}),
    ...(search ? { OR: [{ orderRef: { contains: search.toUpperCase() } }, { buyerName: { contains: search } }, { buyerPhone: { contains: search } }, { buyerEmail: { contains: search } }] } : {}),
  };
  const current = Math.max(1, Number(page) || 1);
  const [total, rows, byStatus] = await Promise.all([
    prisma.photoSaleOrder.count({ where }),
    prisma.photoSaleOrder.findMany({ where, orderBy: { createdAt: "desc" }, skip: (current - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { gallery: { select: { id: true, title: true, shortCode: true, deletedAt: true } }, _count: { select: { items: true } } } }),
    prisma.photoSaleOrder.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
  ]);
  const counts = Object.fromEntries(byStatus.map((row) => [row.status, row._count._all]));
  counts.ALL = byStatus.reduce((sum, row) => sum + row._count._all, 0);
  return { items: rows.map(staffOrder), total, page: current, pageSize: PAGE_SIZE, counts };
}

async function get(id) {
  const row = await prisma.photoSaleOrder.findUnique({
    where: { id: String(id) },
    include: {
      gallery: true,
      items: { orderBy: { createdAt: "asc" }, include: { photo: { select: { available: true, removedAt: true, thumbnailKey: true } }, deliveredByUser: { select: { id: true, name: true } }, downloads: { orderBy: { createdAt: "desc" }, take: 5, select: { status: true, error: true, createdAt: true } } } },
      payments: { orderBy: { attempt: "desc" } },
      paymentEvents: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!row) throw httpError(404, "Order not found.");
  const hash = watermarks.lookHash(row.gallery.watermarkSnapshot);
  return {
    ...staffOrder(row),
    pricesIncludeTax: row.pricingSnapshot?.pricesIncludeTax ?? true, taxRateBps: row.pricingSnapshot?.taxRateBps ?? 0, packagesApplied: row.pricingSnapshot?.packages || [],
    downloads: await policyFor(row),
    items: await (async () => { const policy = await policyFor(row); return row.items.map((item) => ({ ...buyerItem(item, hash, row.status === "PAID", row, policy), relativePath: item.relativePath, deliveredBy: item.deliveredByUser ? { id: item.deliveredByUser.id, name: item.deliveredByUser.name } : null, lastDownloadedAt: item.lastDownloadedAt, downloads: item.downloads })); })(),
    payments: row.payments.map((payment) => ({ id: payment.id, attempt: payment.attempt, environment: payment.environment, providerOrderId: payment.providerOrderId, status: payment.status, amountPaise: payment.amountPaise, cfPaymentId: payment.cfPaymentId, paymentGroup: payment.paymentGroup, failureReason: payment.failureReason, createdAt: payment.createdAt, verifiedAt: payment.verifiedAt })),
    events: row.paymentEvents.map((event) => ({ id: event.id, source: event.source, eventType: event.eventType, providerStatus: event.providerStatus, amountPaise: event.amountPaise, signatureValid: event.signatureValid, createdAt: event.createdAt })),
  };
}

/** Asks Cashfree about every open attempt now; for the studio's "Check payment" button. */
async function verify(id) {
  const row = await prisma.photoSaleOrder.findUnique({ where: { id: String(id) }, select: { id: true } });
  if (!row) throw httpError(404, "Order not found.");
  if (!config.cashfree().enabled) throw httpError(503, config.cashfree().blockedReason);
  await payments.refreshOrder(row.id, { force: true });
  return get(row.id);
}

/** A fresh order link for the buyer - the old key stops opening it. For a buyer who lost theirs. */
async function reissueLink(id) {
  const row = await prisma.photoSaleOrder.findUnique({ where: { id: String(id) }, include: { gallery: { select: { shortCode: true, deletedAt: true } } } });
  if (!row) throw httpError(404, "Order not found.");
  if (row.gallery.deletedAt) throw httpError(409, "This order's gallery was deleted, so its order page no longer opens.");
  const orderKey = security.randomKey();
  await prisma.photoSaleOrder.update({ where: { id: row.id }, data: { accessKeyHash: security.hash(orderKey) } });
  return { url: `${config.storeBaseUrl()}/${row.gallery.shortCode}/orders/${row.orderRef}#k=${orderKey}` };
}

module.exports = { ITEM, DOWNLOAD, FOR_SALE, eligibleLines, quote, create, authorize, forBuyer, listForSession, policyFor, downloadAllowance, downloadTicket, openDownload, rangeStart, list, get, verify, reissueLink, serializeQuote };
