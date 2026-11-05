const crypto = require("crypto");
const prisma = require("../../../config/db");
const { httpError } = require("../../ai-feature/shared/http");
const config = require("../shared/config");
const cashfree = require("./cashfree");
const { toRupees, fromRupees } = require("../pricing/pricing");

/**
 * Taking payment for an order, and deciding - only ever from Cashfree's own answer - that it is paid.
 *
 * Rules this file keeps:
 * - An order is PAID only after this server asked Cashfree (`reconcile`) and Cashfree said a payment
 *   succeeded for exactly the order's amount and currency. A browser returning from checkout, or a
 *   webhook's body, is a prompt to ask - never the answer itself.
 * - Each attempt is its own Cashfree order (`<orderRef>-<attempt>`), so retrying can never double-
 *   charge an earlier attempt, and a still-open checkout is handed back rather than replaced.
 * - Marking paid is a conditional update inside a transaction: however many webhooks and status
 *   checks arrive at once, and in whatever order, one of them flips the order and unlocks the items;
 *   the rest find nothing to change. A FAILED notice arriving after SUCCESS changes nothing.
 * - A second successful attempt for an order already paid is recorded as a duplicate to refund,
 *   never as a second purchase.
 */
const PAYMENT = Object.freeze({ CREATED: "CREATED", PENDING: "PENDING", SUCCESS: "SUCCESS", FAILED: "FAILED", CANCELLED: "CANCELLED", EXPIRED: "EXPIRED", MISMATCH: "MISMATCH" });
const OPEN = [PAYMENT.CREATED, PAYMENT.PENDING];
const CHECKOUT_TTL_MS = 30 * 60 * 1000;
const RECHECK_MS = 4000;

const lastChecked = new Map();

function normalizeIndianPhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

async function record(db, { orderId = null, paymentId = null, source, eventType, dedupeKey, signatureValid = false, providerStatus = null, amountPaise = null, summary = null }) {
  try {
    return await db.photoSalePaymentEvent.create({ data: { orderId, paymentId, source, eventType, dedupeKey: String(dedupeKey).slice(0, 191), signatureValid, providerStatus, amountPaise, summary: summary || undefined } });
  } catch (error) {
    if (error?.code === "P2002") return null;
    throw error;
  }
}

/** The return address after checkout: the buyer's order page in the store. */
function returnUrl(gallery, order) {
  return `${config.storeBaseUrl()}/${gallery.shortCode}/orders/${order.orderRef}`;
}

/**
 * Opens checkout for an order: hands back the still-open attempt if there is one, otherwise makes
 * attempt n+1. Refuses while a payment is still being confirmed, so a buyer cannot pay twice.
 */
async function startCheckout(order, gallery) {
  if (order.status === "PAID") throw httpError(409, "This order is already paid.");
  if (order.status === "CANCELLED") throw httpError(409, "This order was cancelled.");
  const settings = config.cashfree();
  if (!settings.enabled) throw httpError(503, settings.guestReason);

  const latest = await prisma.photoSalePayment.findFirst({ where: { orderId: order.id }, orderBy: { attempt: "desc" } });
  if (latest && OPEN.includes(latest.status)) {
    // Asked first: the last attempt may have been paid a moment ago. If Cashfree cannot be asked, no
    // new attempt is made either - that is how a buyer ends up paying twice.
    try { await reconcilePayment(latest.id, { source: "RETRY" }); } catch { throw httpError(503, "We could not confirm your last payment just now. Please try again in a moment."); }
    const fresh = await prisma.photoSalePayment.findUnique({ where: { id: latest.id } });
    const orderNow = await prisma.photoSaleOrder.findUnique({ where: { id: order.id }, select: { status: true } });
    if (orderNow.status === "PAID") return { paid: true };
    if (fresh.status === PAYMENT.PENDING) throw httpError(409, "Your last payment is still being confirmed by the bank. Please wait a few minutes before trying again.");
    if (fresh.status === PAYMENT.CREATED && fresh.paymentSessionId && fresh.expiresAt && fresh.expiresAt.getTime() > Date.now() + 2 * 60 * 1000 && fresh.environment === settings.environment) {
      return { paid: false, paymentSessionId: fresh.paymentSessionId, environment: fresh.environment, attempt: fresh.attempt };
    }
  }

  const attempt = (latest?.attempt || 0) + 1;
  if (attempt > 20) throw httpError(429, "Too many payment attempts for this order. Please contact the studio.");
  const providerOrderId = `${order.orderRef}-${attempt}`;
  const expiresAt = new Date(Date.now() + CHECKOUT_TTL_MS);
  let payment;
  try {
    payment = await prisma.photoSalePayment.create({ data: { orderId: order.id, attempt, environment: settings.environment, providerOrderId, amountPaise: order.totalPaise, expiresAt } });
  } catch (error) {
    if (error?.code === "P2002") throw httpError(409, "A payment is already being started for this order. Please try again in a moment.");
    throw error;
  }
  if (order.status === "FAILED") await prisma.photoSaleOrder.updateMany({ where: { id: order.id, status: "FAILED" }, data: { status: "PENDING" } });
  try {
    const created = await cashfree.createOrder({
      providerOrderId,
      amount: toRupees(order.totalPaise),
      currency: order.currency,
      customer: { id: `ps_${order.buyerSessionHash.slice(0, 24)}`, name: order.buyerName, phone: order.buyerPhone, email: order.buyerEmail },
      returnUrl: returnUrl(gallery, order),
      note: `${gallery.title} - ${order.orderRef}`.slice(0, 200),
      expiresAt,
    });
    await prisma.photoSalePayment.update({ where: { id: payment.id }, data: { cfOrderId: created.cfOrderId, paymentSessionId: created.paymentSessionId } });
    await record(prisma, { orderId: order.id, paymentId: payment.id, source: "RETRY", eventType: attempt === 1 ? "CHECKOUT_CREATED" : "CHECKOUT_RETRIED", dedupeKey: `checkout:${providerOrderId}`, providerStatus: created.orderStatus, amountPaise: order.totalPaise });
    return { paid: false, paymentSessionId: created.paymentSessionId, environment: settings.environment, attempt };
  } catch (error) {
    await prisma.photoSalePayment.update({ where: { id: payment.id }, data: { status: PAYMENT.FAILED, failureReason: "Checkout could not be started" } }).catch(() => {});
    throw error;
  }
}

/**
 * Unlocks what an order bought: each item whose original is stored becomes downloadable. Run once,
 * inside the transaction of whichever caller flipped the order to PAID - so nothing is ever
 * downloadable before a payment has been verified.
 */
async function unlockItems(tx, orderId) {
  const items = await tx.photoSaleOrderItem.findMany({ where: { orderId }, include: { photo: { select: { originalKey: true } } } });
  for (const item of items) {
    const fulfilment = item.kind === "ORIGINAL" && item.photo?.originalKey ? "READY" : "UNAVAILABLE";
    await tx.photoSaleOrderItem.update({ where: { id: item.id }, data: { fulfilment } });
  }
}

/**
 * Applies what Cashfree said about one attempt. Idempotent: calling it again with the same answer,
 * or an older one, changes nothing.
 */
async function applyProviderState(payment, order, { orderStatus, payments }, source) {
  const success = payments.find((item) => item.status === "SUCCESS");
  const now = new Date();
  if (success || orderStatus === "PAID") {
    const amountPaise = fromRupees(success?.amount);
    const currency = success?.currency || order.currency;
    if (!success || amountPaise !== payment.amountPaise || amountPaise !== order.totalPaise || currency !== order.currency) {
      await prisma.photoSalePayment.updateMany({ where: { id: payment.id, status: { notIn: [PAYMENT.SUCCESS, PAYMENT.MISMATCH] } }, data: { status: PAYMENT.MISMATCH, failureReason: "Paid amount does not match the order", verifiedAt: now } });
      await record(prisma, { orderId: order.id, paymentId: payment.id, source, eventType: "AMOUNT_MISMATCH", dedupeKey: `mismatch:${payment.id}:${success?.cfPaymentId || "none"}`, providerStatus: orderStatus, amountPaise: Number.isFinite(amountPaise) ? amountPaise : null });
      return { outcome: "MISMATCH" };
    }
    const result = await prisma.$transaction(async (tx) => {
      const flippedPayment = await tx.photoSalePayment.updateMany({ where: { id: payment.id, status: { not: PAYMENT.SUCCESS } }, data: { status: PAYMENT.SUCCESS, cfPaymentId: success.cfPaymentId, paymentGroup: success.group, verifiedAt: now, failureReason: null } });
      const flippedOrder = await tx.photoSaleOrder.updateMany({ where: { id: order.id, status: { not: "PAID" } }, data: { status: "PAID", paidAt: now } });
      if (flippedOrder.count) await unlockItems(tx, order.id);
      return { flippedPayment: flippedPayment.count, flippedOrder: flippedOrder.count };
    });
    if (result.flippedPayment && !result.flippedOrder) {
      // This attempt succeeded but another one had already paid the order: money to give back.
      await prisma.photoSalePayment.update({ where: { id: payment.id }, data: { failureReason: "Duplicate payment - refund due" } });
      await record(prisma, { orderId: order.id, paymentId: payment.id, source, eventType: "DUPLICATE_PAYMENT", dedupeKey: `duplicate:${payment.id}`, providerStatus: "SUCCESS", amountPaise, summary: { note: "Order was already paid by another attempt; refund this payment in the Cashfree dashboard." } });
      return { outcome: "DUPLICATE" };
    }
    if (result.flippedOrder) await record(prisma, { orderId: order.id, paymentId: payment.id, source, eventType: "ORDER_PAID", dedupeKey: `paid:${order.id}`, providerStatus: "SUCCESS", amountPaise, summary: { group: success.group || null } });
    return { outcome: "PAID" };
  }

  if (payments.some((item) => item.status === "PENDING")) {
    await prisma.photoSalePayment.updateMany({ where: { id: payment.id, status: PAYMENT.CREATED }, data: { status: PAYMENT.PENDING, verifiedAt: now } });
    return { outcome: "PENDING" };
  }

  const latestAttempt = [...payments].sort((a, b) => String(b.time || "").localeCompare(String(a.time || "")))[0];
  let terminal = null;
  if (orderStatus === "EXPIRED") terminal = PAYMENT.EXPIRED;
  else if (orderStatus === "TERMINATED" || orderStatus === "TERMINATION_REQUESTED") terminal = PAYMENT.CANCELLED;
  else if (latestAttempt && ["FAILED", "VOID"].includes(latestAttempt.status)) terminal = PAYMENT.FAILED;
  else if (latestAttempt && ["USER_DROPPED", "CANCELLED"].includes(latestAttempt.status)) terminal = PAYMENT.CANCELLED;
  if (!terminal) return { outcome: "OPEN" };

  const changed = await prisma.photoSalePayment.updateMany({ where: { id: payment.id, status: { in: OPEN } }, data: { status: terminal, failureReason: latestAttempt?.message || (terminal === PAYMENT.EXPIRED ? "Checkout expired" : null), verifiedAt: now } });
  if (changed.count) {
    const newest = await prisma.photoSalePayment.findFirst({ where: { orderId: order.id }, orderBy: { attempt: "desc" }, select: { id: true } });
    if (newest?.id === payment.id) await prisma.photoSaleOrder.updateMany({ where: { id: order.id, status: "PENDING" }, data: { status: "FAILED" } });
    await record(prisma, { orderId: order.id, paymentId: payment.id, source, eventType: `PAYMENT_${terminal}`, dedupeKey: `terminal:${payment.id}:${terminal}`, providerStatus: latestAttempt?.status || orderStatus });
  }
  return { outcome: terminal };
}

/** Asks Cashfree about one attempt and applies the answer. */
async function reconcilePayment(paymentId, { source = "VERIFY" } = {}) {
  const payment = await prisma.photoSalePayment.findUnique({ where: { id: paymentId }, include: { order: true } });
  if (!payment) throw httpError(404, "Payment not found.");
  if (payment.environment !== config.cashfree().environment) return { outcome: "OTHER_ENVIRONMENT" };
  const [order, payments] = await Promise.all([cashfree.getOrder(payment.providerOrderId), cashfree.getPayments(payment.providerOrderId)]);
  return applyProviderState(payment, payment.order, { orderStatus: order.orderStatus, payments }, source);
}

/**
 * Brings an order's open attempts up to date, at most once every few seconds per order: the order
 * page polls while a buyer waits, and Cashfree is asked, not hammered.
 */
async function refreshOrder(orderId, { force = false } = {}) {
  const now = Date.now();
  if (!force && (lastChecked.get(orderId) || 0) > now - RECHECK_MS) return;
  lastChecked.set(orderId, now);
  if (lastChecked.size > 5000) for (const [key, at] of lastChecked) if (at < now - 60_000) lastChecked.delete(key);
  // Reading what Cashfree says of attempts already made goes on while new checkouts are off (keys
  // refused): money may already have been paid.
  if (!config.cashfreeSettings().enabled) return;
  const open = await prisma.photoSalePayment.findMany({ where: { orderId, status: { in: OPEN } }, select: { id: true } });
  for (const payment of open) {
    try { await reconcilePayment(payment.id, { source: "VERIFY" }); } catch (error) { console.error("[photo-selling] payment check failed:", payment.id, error.message); }
  }
}

/**
 * Asks Cashfree about every attempt still open after a couple of minutes - a buyer who closed the tab
 * on a payment that went through, with no webhook to say so, is still unlocked within one sweep. Run
 * by the worker; the oldest first, a bounded batch each time, and only attempts of this server's
 * environment and the last week (a checkout expires in half an hour).
 */
async function reconcileStale({ olderThanMs = 2 * 60 * 1000, limit = 50 } = {}) {
  const settings = config.cashfreeSettings();
  if (!settings.enabled) return 0;
  const now = Date.now();
  const rows = await prisma.photoSalePayment.findMany({
    where: { status: { in: OPEN }, environment: settings.environment, createdAt: { lt: new Date(now - olderThanMs), gt: new Date(now - 7 * 24 * 60 * 60 * 1000) } },
    orderBy: { createdAt: "asc" }, take: limit, select: { id: true },
  });
  let checked = 0;
  for (const row of rows) {
    try { await reconcilePayment(row.id, { source: "SWEEP" }); checked += 1; } catch (error) { console.error("[photo-selling] payment sweep failed:", row.id, error.message); }
  }
  return checked;
}

/**
 * A Cashfree webhook. Answers `{ status, body }` for the router. The signature is checked over the
 * raw bytes; a notice is recorded once (by Cashfree's idempotency key, or a key made from what it
 * says) and then Cashfree is asked for the truth. If acting on it fails, the record is taken back
 * and Cashfree is told to try again.
 */
async function handleWebhook({ rawBody, headers }) {
  const signature = headers["x-webhook-signature"];
  const timestamp = headers["x-webhook-timestamp"];
  if (!config.cashfreeSettings().clientSecret) return { status: 503, body: { message: "Payments are not configured." } };
  if (!cashfree.verifyWebhookSignature(rawBody, timestamp, signature)) {
    console.warn("[photo-selling] webhook refused: signature did not verify");
    return { status: 401, body: { message: "Invalid signature." } };
  }
  let payload;
  try { payload = JSON.parse(Buffer.from(rawBody).toString("utf8")); } catch { return { status: 400, body: { message: "Invalid body." } }; }
  const type = String(payload?.type || "UNKNOWN").slice(0, 60);
  const providerOrderId = payload?.data?.order?.order_id ? String(payload.data.order.order_id) : null;
  const cfPaymentId = payload?.data?.payment?.cf_payment_id != null ? String(payload.data.payment.cf_payment_id) : "";
  const status = payload?.data?.payment?.payment_status ? String(payload.data.payment.payment_status) : null;
  if (!providerOrderId) return { status: 200, body: { received: true } };
  const payment = await prisma.photoSalePayment.findUnique({ where: { providerOrderId }, select: { id: true, orderId: true } });
  if (!payment) return { status: 200, body: { received: true } };

  const dedupeKey = headers["x-idempotency-key"]
    ? `webhook:${String(headers["x-idempotency-key"]).slice(0, 150)}`
    : `webhook:${crypto.createHash("sha256").update(`${type}|${providerOrderId}|${cfPaymentId}|${status}`).digest("hex")}`;
  const event = await record(prisma, {
    orderId: payment.orderId, paymentId: payment.id, source: "WEBHOOK", eventType: type, dedupeKey, signatureValid: true, providerStatus: status,
    amountPaise: payload?.data?.payment?.payment_amount != null ? fromRupees(payload.data.payment.payment_amount) : null,
    summary: { group: payload?.data?.payment?.payment_group || null, eventTime: payload?.event_time || null },
  });
  if (!event) return { status: 200, body: { received: true, duplicate: true } };
  if (type === "PAYMENT_CHARGES_WEBHOOK") return { status: 200, body: { received: true } };
  try {
    await reconcilePayment(payment.id, { source: "WEBHOOK" });
    return { status: 200, body: { received: true } };
  } catch (error) {
    console.error("[photo-selling] webhook could not be applied, Cashfree will retry:", error.message);
    await prisma.photoSalePaymentEvent.delete({ where: { id: event.id } }).catch(() => {});
    return { status: 500, body: { message: "Try again." } };
  }
}

module.exports = { PAYMENT, OPEN, normalizeIndianPhone, startCheckout, reconcilePayment, reconcileStale, refreshOrder, applyProviderState, handleWebhook, returnUrl };
