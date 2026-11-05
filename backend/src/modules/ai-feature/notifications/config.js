/**
 * What the guest WhatsApp summary is allowed to do on this server, read fresh on every call so a
 * value corrected on the VPS takes effect without a restart.
 *
 * Off unless `AI_FEATURE_WHATSAPP_ENABLED` is exactly "true": an unset or mistyped value falls on
 * the safe side, and production delivery is a deliberate act, never a default. The provider itself
 * is the Image Selection one (`WHATSAPP_PROVIDER` = meta or mock, `META_WHATSAPP_*`), reused rather
 * than copied; only the template is this feature's own, because its wording and parameters are.
 */
const { getProvider } = require("../../image-selection/whatsapp/providers");

/** How long one send may take before it is given up on - and treated as possibly delivered. */
const SEND_TIMEOUT_MS = 15_000;

const flag = (value) => String(value || "").trim().toLowerCase() === "true";

function enabled(env = process.env) { return flag(env.AI_FEATURE_WHATSAPP_ENABLED); }
function templateName(env = process.env) { return String(env.META_WHATSAPP_AI_TEMPLATE_NAME || "").trim() || null; }
function templateLanguage(env = process.env) { return String(env.META_WHATSAPP_AI_TEMPLATE_LANGUAGE || "").trim() || "en"; }

/**
 * The shared provider, with every request bounded. A send that times out is not retried (see
 * service.deliver): Meta may have taken it, and a second message is worse than a missing one.
 */
function provider(env = process.env, request = fetch) {
  const bounded = (url, options = {}) => request(url, { ...options, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
  return getProvider(env, bounded);
}

module.exports = { SEND_TIMEOUT_MS, enabled, templateName, templateLanguage, provider };
