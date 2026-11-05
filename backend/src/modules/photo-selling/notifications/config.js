const { getProvider } = require("../../image-selection/whatsapp/providers");

/**
 * Photo Selling's WhatsApp photo-match messages, as this server is set up for them. Its own switch -
 * `PHOTO_SELLING_WHATSAPP_ENABLED`, off unless exactly "true" - so turning the AI Feature's on never
 * starts these, and the reverse. The provider is the shared one (`WHATSAPP_PROVIDER` = meta or mock,
 * `META_WHATSAPP_*`); the template is named here: the approved `photos_ready` (Utility) - a fixed
 * header, body {{1}} guest name, {{2}} new photos, {{3}} gallery name, and a URL button taking the
 * store link's path. Read on every call so a test can change it; nothing here leaves the server.
 */
const SEND_TIMEOUT_MS = 15000;
const flag = (value) => String(value || "").trim().toLowerCase() === "true";

function enabled(env = process.env) { return flag(env.PHOTO_SELLING_WHATSAPP_ENABLED); }
function templateName(env = process.env) { return String(env.PHOTO_SELLING_WHATSAPP_TEMPLATE_NAME || "").trim() || null; }
function templateLanguage(env = process.env) { return String(env.PHOTO_SELLING_WHATSAPP_TEMPLATE_LANGUAGE || "").trim() || "en"; }

/** The dial codes a message may go to (comma-separated, default India); "*" allows any. */
function dialCodeAllowed(phone, env = process.env) {
  const list = String(env.PHOTO_SELLING_WHATSAPP_DIAL_CODES || "91").split(",").map((code) => code.trim().replace(/^\+/, "")).filter(Boolean);
  return list.includes("*") || list.some((code) => String(phone || "").startsWith(`+${code}`));
}

/** The shared provider, every request bounded. A send that times out is never retried (see service.deliver). */
function provider(env = process.env, request = fetch) {
  const bounded = (url, options = {}) => request(url, { ...options, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
  return getProvider(env, bounded);
}

/** What the staff screens are told: whether each part is in place - never a token, id or raw error. */
function readiness(env = process.env) {
  const providerName = String(env.WHATSAPP_PROVIDER || "").toLowerCase();
  const providerReady = providerName === "mock" || (providerName === "meta" && Boolean(env.META_WHATSAPP_API_VERSION && env.META_WHATSAPP_PHONE_NUMBER_ID && env.META_WHATSAPP_ACCESS_TOKEN));
  return { serverEnabled: enabled(env), providerReady, templateConfigured: Boolean(templateName(env)), templateName: templateName(env) };
}

module.exports = { SEND_TIMEOUT_MS, enabled, templateName, templateLanguage, dialCodeAllowed, provider, readiness };
