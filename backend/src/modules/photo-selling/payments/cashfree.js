const crypto = require("crypto");
const config = require("../shared/config");
const { httpError } = require("../../ai-feature/shared/http");

/**
 * Cashfree Payment Gateway, server side only. Credentials come from the environment and never leave
 * this file: not in a response, not in a log line, not in the audit table.
 *
 * Endpoints (PG API, x-api-version CASHFREE_API_VERSION):
 *   POST /pg/orders                       create a payment order  → payment_session_id
 *   GET  /pg/orders/{order_id}            its status: ACTIVE | PAID | EXPIRED | TERMINATED | TERMINATION_REQUESTED
 *   GET  /pg/orders/{order_id}/payments   its payment attempts:  SUCCESS | FAILED | PENDING | USER_DROPPED | CANCELLED | VOID | NOT_ATTEMPTED
 *
 * Webhooks are signed: x-webhook-signature = Base64(HMAC-SHA256(x-webhook-timestamp + rawBody,
 * client secret)). The raw bytes are the ones Cashfree sent; parsing and re-serialising the JSON
 * changes them (170.00 becomes 170) and the signature never matches.
 *
 * `fetchImpl` is injectable so the tests can stand in for Cashfree without the network.
 */
const TIMEOUT_MS = 15_000;
const CHECK_VALID_MS = 30 * 60 * 1000;
const CHECK_RETRY_MS = 5 * 60 * 1000;
let fetchImpl = (...args) => fetch(...args);
const setFetch = (impl) => { fetchImpl = impl || ((...args) => fetch(...args)); };

async function call(method, path, body, { idempotencyKey, expected = [] } = {}) {
  const settings = config.cashfreeSettings();
  if (!settings.enabled) throw httpError(503, settings.blockedReason);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(`${settings.baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-api-version": settings.apiVersion,
        "x-client-id": settings.clientId,
        "x-client-secret": settings.clientSecret,
        ...(idempotencyKey ? { "x-idempotency-key": idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    throw httpError(502, error?.name === "AbortError" ? "The payment provider did not answer in time. Please try again." : "The payment provider could not be reached. Please try again.");
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) {
    if (expected.includes(response.status)) return { status: response.status, data };
    // Cashfree's own message is safe to log (it names a field, never a credential), not to show.
    console.error(`[photo-selling] Cashfree ${method} ${path.replace(/orders\/[^/]+/, "orders/:id")} → ${response.status}: ${data?.message || data?.code || "no message"}`);
    const error = httpError(response.status === 404 ? 404 : 502, "The payment provider refused the request. Please try again.");
    error.providerStatus = response.status;
    error.providerCode = data?.code || null;
    throw error;
  }
  return data;
}

/**
 * Whether Cashfree accepts this server's keys, asked by looking up an order that cannot exist: a
 * "not found" answer comes only after the keys are accepted, a 401/403 means they were refused (wrong
 * keys, or sandbox keys against production). Remembered per set of keys - a fingerprint, never the
 * keys - for half an hour when accepted and five minutes otherwise; one check runs at a time.
 * Answers VALID | INVALID | UNREACHABLE | NOT_CONFIGURED.
 */
let lastCheck = null;
let running = null;
const fingerprint = (s) => crypto.createHash("sha256").update(`${s.environment}|${s.clientId}|${s.clientSecret}`).digest("hex");

function credentialState() {
  const settings = config.cashfreeSettings();
  if (!settings.enabled) return "NOT_CONFIGURED";
  return lastCheck && lastCheck.fingerprint === fingerprint(settings) ? lastCheck.state : "UNCHECKED";
}

async function checkCredentials({ force = false } = {}) {
  const settings = config.cashfreeSettings();
  if (!settings.enabled) return "NOT_CONFIGURED";
  const key = fingerprint(settings);
  if (!force && lastCheck?.fingerprint === key && Date.now() - lastCheck.at < (lastCheck.state === "VALID" ? CHECK_VALID_MS : CHECK_RETRY_MS)) return lastCheck.state;
  if (running) return running;
  running = (async () => {
    let state;
    try {
      const answer = await call("GET", `/orders/dbs-key-check-${crypto.randomBytes(6).toString("hex")}`, null, { expected: [401, 403, 404] });
      if (answer?.status === 404) state = "VALID";
      else if (answer?.status === 401 || answer?.status === 403) state = "INVALID";
      else state = "UNREACHABLE";
    } catch { state = "UNREACHABLE"; }
    if (state !== "VALID") console.warn(`[photo-selling] Cashfree key check: ${state}`);
    lastCheck = { fingerprint: key, state, at: Date.now() };
    return state;
  })().finally(() => { running = null; });
  return running;
}

/** Creates the Cashfree order for one payment attempt. Only what checkout needs comes back. */
async function createOrder({ providerOrderId, amount, currency, customer, returnUrl, note, expiresAt }) {
  const settings = config.cashfree();
  const body = {
    order_id: providerOrderId,
    order_amount: Number(amount),
    order_currency: currency,
    customer_details: { customer_id: customer.id, customer_name: customer.name, customer_phone: customer.phone, ...(customer.email ? { customer_email: customer.email } : {}) },
    order_meta: { return_url: returnUrl, ...(settings.notifyUrl ? { notify_url: settings.notifyUrl } : {}) },
    order_note: note,
    ...(expiresAt ? { order_expiry_time: expiresAt.toISOString() } : {}),
  };
  const data = await call("POST", "/orders", body, { idempotencyKey: providerOrderId });
  if (!data?.payment_session_id) throw httpError(502, "The payment provider did not start a checkout. Please try again.");
  return { cfOrderId: data.cf_order_id ? String(data.cf_order_id) : null, paymentSessionId: data.payment_session_id, orderStatus: data.order_status || "ACTIVE" };
}

async function getOrder(providerOrderId) {
  const data = await call("GET", `/orders/${encodeURIComponent(providerOrderId)}`);
  return { orderStatus: data?.order_status || null, orderAmount: data?.order_amount, orderCurrency: data?.order_currency || null, cfOrderId: data?.cf_order_id ? String(data.cf_order_id) : null };
}

async function getPayments(providerOrderId) {
  const data = await call("GET", `/orders/${encodeURIComponent(providerOrderId)}/payments`);
  const list = Array.isArray(data) ? data : [];
  return list.map((payment) => ({
    cfPaymentId: payment?.cf_payment_id != null ? String(payment.cf_payment_id) : null,
    status: payment?.payment_status || null,
    amount: payment?.payment_amount,
    currency: payment?.payment_currency || null,
    group: payment?.payment_group || null,
    message: payment?.payment_message ? String(payment.payment_message).slice(0, 200) : null,
    time: payment?.payment_completion_time || payment?.payment_time || null,
  }));
}

/** True only for a signature Cashfree made with this server's secret over exactly these bytes. */
function verifyWebhookSignature(rawBody, timestamp, signature, secret = config.cashfree().clientSecret) {
  if (!secret || !rawBody || !timestamp || !signature) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), "utf8");
  const expected = crypto.createHmac("sha256", secret).update(Buffer.concat([Buffer.from(String(timestamp), "utf8"), body])).digest("base64");
  const left = Buffer.from(expected);
  const right = Buffer.from(String(signature));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

module.exports = { createOrder, getOrder, getPayments, verifyWebhookSignature, credentialState, checkCredentials, setFetch, _resetCredentialCheck: () => { lastCheck = null; running = null; } };
