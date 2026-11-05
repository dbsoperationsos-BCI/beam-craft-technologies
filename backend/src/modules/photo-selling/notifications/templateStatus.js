const config = require("./config");

/**
 * Whether the photo-match template is approved in Meta, for the staff settings screen. Asked of the
 * Graph API (`GET /<WABA>/message_templates?name=`) only where the server knows its WhatsApp Business
 * Account (`META_WHATSAPP_BUSINESS_ACCOUNT_ID`) and runs the Meta provider; otherwise the answer is
 * "not checked", never a guess. Read-only, bounded, and kept for ten minutes so opening the screen
 * never costs a call each time. Only the template's status, category and language come back - no
 * token, id or provider message ever reaches a screen.
 */
const CACHE_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 5000;
let cached = null;

async function templateStatus({ env = process.env, request = fetch, now = Date.now() } = {}) {
  const name = config.templateName(env);
  if (!name) return { checked: false, status: "NOT_CONFIGURED" };
  const waba = String(env.META_WHATSAPP_BUSINESS_ACCOUNT_ID || "").trim();
  const token = env.META_WHATSAPP_ACCESS_TOKEN;
  const version = env.META_WHATSAPP_API_VERSION;
  if (String(env.WHATSAPP_PROVIDER || "").toLowerCase() !== "meta" || !waba || !token || !version) return { checked: false, status: "NOT_CHECKED" };
  const key = `${waba}:${name}:${config.templateLanguage(env)}`;
  if (cached?.key === key && now - cached.at < CACHE_MS) return cached.value;
  let value;
  try {
    const response = await request(`https://graph.facebook.com/${version}/${encodeURIComponent(waba)}/message_templates?name=${encodeURIComponent(name)}&fields=name,status,category,language`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const data = await response.json().catch(() => null);
    if (!response.ok) value = { checked: false, status: "UNREACHABLE" };
    else {
      const found = (data?.data || []).find((row) => row.name === name && row.language === config.templateLanguage(env));
      value = found ? { checked: true, status: String(found.status || "UNKNOWN"), category: found.category || null, language: found.language } : { checked: true, status: "NOT_FOUND" };
    }
  } catch {
    value = { checked: false, status: "UNREACHABLE" };
  }
  cached = { key, at: now, value };
  return value;
}

const resetCache = () => { cached = null; };

module.exports = { templateStatus, resetCache };
