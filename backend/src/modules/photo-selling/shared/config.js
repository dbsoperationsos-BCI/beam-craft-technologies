/**
 * What this server's Photo Selling is switched on for, read from the environment on every call so a
 * test can change it. Nothing here is a secret that leaves the server: `status()` is what the staff
 * screens are told, and it says only whether each part is ready.
 *
 * Payments
 *   CASHFREE_ENV                         sandbox (default) or production
 *   CASHFREE_CLIENT_ID / CASHFREE_CLIENT_SECRET   the Cashfree PG credentials for that environment
 *   CASHFREE_API_VERSION                 the x-api-version header (default 2025-01-01)
 *   PHOTO_SELLING_PRODUCTION_PAYMENTS    must be "true" as well before production money is collected
 *   PHOTO_SELLING_NOTIFY_URL             the public https address of the webhook, sent with each order
 *   PHOTO_SELLING_PUBLIC_URL             the store's public base, default FRONTEND_URL + "/s"
 *
 * Originals - what a buyer downloads.
 *   Originals go to the studio's existing R2 bucket (R2_BUCKET_NAME), in Photo Selling's own folder:
 *   photo-selling/gallery-<id>/originals/<random uuid>/<name>. No bucket of its own is needed. That
 *   bucket is served publicly (R2_PUBLIC_BASE_URL), so what keeps an original from being opened is
 *   that its address cannot be known: a 122-bit random folder, a key that never leaves this server
 *   (no response, page or log carries it) and downloads streamed through the server after payment.
 *   R2_PRIVATE_BUCKET_NAME / PHOTO_SELLING_ORIGINALS_BUCKET   optional: name a bucket with public
 *                                        access off and originals go there instead.
 *   PHOTO_SELLING_MAX_ORIGINAL_MB        the largest original accepted (default 200)
 *   PHOTO_SELLING_DOWNLOAD_LIMIT         downloads per photo bought (default 20)
 *   PHOTO_SELLING_DOWNLOAD_DAYS          days after payment a photo can be downloaded (default 365)
 *
 * Face matching - the only way guests find their photos (a selfie), so no gallery is published
 * without it. It is the AI Feature's own engine (ai-feature/face-engine, InsightFace buffalo_l), run
 * by this server - the same detector, embeddings and similarity the AI Feature's selfie search uses:
 *   AI_FACE_ENGINE_ENABLED               "true" switches it on, for both modules.
 * There is no Photo Selling setting of its own: where the AI Feature recognises faces, Photo Selling
 * can too, and readiness is the engine running (`faceMatching`), never a flag.
 */
const aiFaceEngine = () => require("../../ai-feature/face-engine/engine");
const paymentProvider = () => require("../payments/cashfree");

const PRODUCTION = "PRODUCTION";
const SANDBOX = "SANDBOX";

const flag = (name) => String(process.env[name] || "").trim().toLowerCase() === "true";

function cashfreeEnvironment() {
  return String(process.env.CASHFREE_ENV || "sandbox").trim().toLowerCase() === "production" ? PRODUCTION : SANDBOX;
}

/**
 * The Cashfree settings as the environment gives them, before anything is asked of Cashfree. Only the
 * provider module (payments/cashfree.js) reads this one; everything else asks `cashfree()`.
 */
function cashfreeSettings() {
  const environment = cashfreeEnvironment();
  const clientId = String(process.env.CASHFREE_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.CASHFREE_CLIENT_SECRET || "").trim();
  const credentials = Boolean(clientId && clientSecret);
  const productionAllowed = flag("PHOTO_SELLING_PRODUCTION_PAYMENTS");
  let blockedReason = null;
  if (!credentials) blockedReason = "Online payments are not set up on this server yet.";
  else if (environment === PRODUCTION && !productionAllowed) blockedReason = "Production payments are locked on this server (PHOTO_SELLING_PRODUCTION_PAYMENTS).";
  return {
    environment,
    clientId,
    clientSecret,
    apiVersion: String(process.env.CASHFREE_API_VERSION || "2025-01-01").trim(),
    baseUrl: environment === PRODUCTION ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg",
    enabled: !blockedReason,
    blockedReason,
    notifyUrl: /^https:\/\//i.test(String(process.env.PHOTO_SELLING_NOTIFY_URL || "")) ? String(process.env.PHOTO_SELLING_NOTIFY_URL).trim() : null,
  };
}

/**
 * Whether this server can take payment: its settings, and what Cashfree said of its keys the last
 * time they were checked (`credentials`: NOT_CONFIGURED | UNCHECKED | VALID | INVALID | UNREACHABLE -
 * payments/cashfree.js checkCredentials). Keys Cashfree refused turn checkout off; a check that could
 * not reach Cashfree does not (a passing outage), but is said.
 */
function cashfree() {
  const settings = cashfreeSettings();
  const credentials = settings.enabled ? paymentProvider().credentialState() : "NOT_CONFIGURED";
  // `guestReason` is what a buyer is told: never which setting is missing or that keys were refused.
  const guestReason = settings.enabled ? null : settings.clientId && settings.clientSecret ? "Online payment isn't available right now. Please try again later." : settings.blockedReason;
  if (credentials !== "INVALID") return { ...settings, credentials, guestReason };
  const keys = settings.environment === PRODUCTION ? "production" : "sandbox";
  return { ...settings, credentials, enabled: false, guestReason: "Online payment isn't available right now. Please try again later.", blockedReason: `Cashfree refused this server's payment keys. Check that CASHFREE_CLIENT_ID and CASHFREE_CLIENT_SECRET are the Payment Gateway ${keys} keys (CASHFREE_ENV is ${keys}).` };
}

function storeBaseUrl() {
  const explicit = String(process.env.PHOTO_SELLING_PUBLIC_URL || "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  return `${String(process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/+$/, "")}/s`;
}

const ENGINES = Object.freeze({ INSIGHTFACE: "insightface" });

/** Which face engine Photo Selling may use on this server, and if none, why - in the studio's words. */
function faceEngine() {
  if (!flag("AI_FACE_ENGINE_ENABLED")) return { engine: null, reason: "Selfie search is not set up on this server: the face engine is switched off (AI_FACE_ENGINE_ENABLED)." };
  return { engine: ENGINES.INSIGHTFACE, reason: null };
}

/**
 * Whether selfie search works on this server right now - not only whether it is set up. `state`:
 *   NOT_CONFIGURED   the face engine is switched off (AI_FACE_ENGINE_ENABLED)
 *   MODEL_MISSING    the local engine's model files are not on disk
 *   ENGINE_OFFLINE   the local engine was started and could not load
 *   STARTING         the local engine is loading (asked to start here if nothing had)
 *   READY            the engine answered ready
 *   WORKER_ELSEWHERE searches run in another process (PHOTO_SELLING_EMBEDDED_WORKER=false), whose
 *                    engine this one cannot see; photos being indexed is what proves it there
 * Cheap: the AI Feature engine's own `health()` - no spawn, no model load per call. A gallery is
 * still not published until its photos were indexed, which only a working engine does.
 */
let lastOfflineRetry = 0;
function faceMatching({ start = true } = {}) {
  const { engine, reason } = faceEngine();
  const answer = (state, why = null) => ({ engine, state, available: state === "READY" || state === "WORKER_ELSEWHERE", reason: why });
  if (!engine) return answer("NOT_CONFIGURED", reason);
  if (process.env.PHOTO_SELLING_EMBEDDED_WORKER === "false") return answer("WORKER_ELSEWHERE", "Selfie searches run in a separate worker process, so this one cannot check its face engine; photos are findable once that worker has indexed them.");
  const local = aiFaceEngine();
  const health = local.health();
  if (health.status === "ready") return answer("READY");
  // The engine reads its switch strictly ("true"); a value only this file reads as on is still off there.
  if (health.status === "disabled") return answer("NOT_CONFIGURED", "The local face engine is switched off on this server (AI_FACE_ENGINE_ENABLED must be exactly \"true\").");
  if (!health.models.complete) return answer("MODEL_MISSING", "The face engine's model files are not on this server yet. An administrator sets them up with backend/scripts/face-engine-setup.sh.");
  if (health.status === "offline") {
    // A failed start is tried again from a staff read, at most once a minute - otherwise a passing
    // fault (the engine's environment not there yet at boot) would keep selfie search closed until
    // a photo happened to be indexed.
    if (start && Date.now() - lastOfflineRetry >= positiveInt("AI_FACE_ENGINE_RETRY_MS", 60_000)) { lastOfflineRetry = Date.now(); local.isReady().catch(() => {}); }
    return answer("ENGINE_OFFLINE", "The face engine could not start on this server. An administrator can see why in the face engine's health check (/api/health/face-engine), and repair it with backend/scripts/face-engine-setup.sh.");
  }
  // Selfie searches and indexing run in this process (the embedded worker), so this is where the
  // engine has to be loaded; nothing waits on it here. Never from a guest's request (`start: false`):
  // finding the interpreter blocks the process for seconds, which no anonymous caller may cause.
  if (start) local.isReady().catch(() => {});
  return answer("STARTING", "The face engine is loading - this takes a few seconds. Check again shortly.");
}
const faceMatchingAvailable = () => faceMatching().available;

/**
 * The bucket originals go to. Read on every call, like the rest. A separate bucket when one is named
 * (PHOTO_SELLING_ORIGINALS_BUCKET, else R2_PRIVATE_BUCKET_NAME); otherwise the studio's existing
 * bucket, R2_BUCKET_NAME, in Photo Selling's own originals folder - the studio's choice (2026-10-27).
 * `shared` says which: true when originals sit in the publicly served bucket behind unguessable keys.
 */
function originalsStore() {
  const publicBucket = String(process.env.R2_BUCKET_NAME || "").trim();
  const separate = String(process.env.PHOTO_SELLING_ORIGINALS_BUCKET || "").trim() || String(process.env.R2_PRIVATE_BUCKET_NAME || "").trim();
  const r2 = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"].every((key) => String(process.env[key] || "").trim());
  const bucket = separate || publicBucket;
  let reason = null;
  if (!r2 || !bucket) reason = "Cloudflare R2 storage is not configured on this server, so photos cannot be uploaded.";
  return { bucket: reason ? null : bucket, ready: !reason, reason, shared: !reason && bucket === publicBucket };
}

const positiveInt = (name, fallback) => { const value = Number(process.env[name]); return Number.isInteger(value) && value > 0 ? value : fallback; };

/** The largest original accepted, in bytes. */
const maxOriginalBytes = () => positiveInt("PHOTO_SELLING_MAX_ORIGINAL_MB", 200) * 1024 * 1024;

/** How often, and for how long after payment, a bought photo can be downloaded again. */
const downloadPolicy = () => ({ limit: positiveInt("PHOTO_SELLING_DOWNLOAD_LIMIT", 20), days: positiveInt("PHOTO_SELLING_DOWNLOAD_DAYS", 365) });

/** What the staff screens are told about this server. */
function status() {
  const payments = cashfree();
  const originals = originalsStore();
  return {
    payments: { provider: "CASHFREE", environment: payments.environment, enabled: payments.enabled, reason: payments.blockedReason, credentials: payments.credentials, webhookAddressSet: Boolean(payments.notifyUrl) },
    faceMatching: faceMatching(),
    originals: { ready: originals.ready, reason: originals.reason, shared: Boolean(originals.shared), maxBytes: maxOriginalBytes() },
    downloads: downloadPolicy(),
  };
}

module.exports = { PRODUCTION, SANDBOX, ENGINES, cashfree, cashfreeEnvironment, storeBaseUrl, cashfreeSettings, faceEngine, faceMatching, faceMatchingAvailable, originalsStore, maxOriginalBytes, downloadPolicy, status };
