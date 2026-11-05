const { CallyzerRequestError } = require("./validation");

/**
 * Calling Callyzer, rather than being called by it.
 *
 * The webhook is the other direction and has nothing to do with this: it proves a delivery came
 * from Callyzer using `CALLYZER_WEBHOOK_SECRET`. Reading their reports needs an AccessKey and a
 * SecretKey issued in the Callyzer dashboard - a different credential entirely, and one that must
 * never reach the frontend.
 *
 * How those two values are carried is the one thing their published docs do not state in the
 * section we have, so it is configuration rather than a guess baked into the code:
 *
 *   CALLYZER_API_BASE_URL     https://api.callyzer.co/v1   (whatever their docs say)
 *   CALLYZER_API_KEY          the AccessKey
 *   CALLYZER_API_SECRET       the SecretKey
 *   CALLYZER_API_AUTH_STYLE   bearer | header | body       (default: bearer)
 *   CALLYZER_API_KEY_HEADER   used when the style is "header" (default: x-access-key)
 *   CALLYZER_API_SECRET_HEADER                             (default: x-secret-key)
 *
 * Whichever scheme their documentation specifies, it is set once in `.env` and no code changes.
 */

const TIMEOUT_MS = Number(process.env.CALLYZER_API_TIMEOUT_MS || 30_000);

class CallyzerApiError extends Error {
  constructor(status, message, { body } = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function config() {
  return {
    baseUrl: String(process.env.CALLYZER_API_BASE_URL || "").trim().replace(/\/+$/, ""),
    key: String(process.env.CALLYZER_API_KEY || "").trim(),
    secret: String(process.env.CALLYZER_API_SECRET || "").trim(),
    style: String(process.env.CALLYZER_API_AUTH_STYLE || "bearer").trim().toLowerCase(),
    keyHeader: String(process.env.CALLYZER_API_KEY_HEADER || "x-access-key").trim(),
    secretHeader: String(process.env.CALLYZER_API_SECRET_HEADER || "x-secret-key").trim(),
  };
}

/** Whether this server can call Callyzer at all. Read by the health endpoint and the controller. */
function isConfigured() {
  const { baseUrl, key } = config();
  return Boolean(baseUrl && key);
}

/**
 * The credentials, in whichever envelope the account uses.
 *
 * `body` returns fields rather than headers - some of their SDKs put the keys in the JSON payload -
 * so the caller merges them into the request body instead.
 */
function authFor(settings) {
  const { style, key, secret, keyHeader, secretHeader } = settings;
  if (style === "header") {
    const headers = { [keyHeader]: key };
    if (secret) headers[secretHeader] = secret;
    return { headers, fields: {} };
  }
  if (style === "body") {
    return { headers: {}, fields: secret ? { access_key: key, secret_key: secret } : { access_key: key } };
  }
  // Bearer, the most common shape and the default. A secret, where one is used alongside a bearer
  // token, still travels in its own header.
  const headers = { authorization: `Bearer ${key}` };
  if (secret) headers[secretHeader] = secret;
  return { headers, fields: {} };
}

/**
 * One POST to a Callyzer report endpoint.
 *
 * Their errors are mapped onto ours by status, using the messages their documentation lists, so
 * the CRM can say what actually happened rather than "request failed". 403 in particular is worth
 * passing through verbatim - an expired subscription is not something a retry fixes.
 */
async function callyzerPost(path, body) {
  const settings = config();
  if (!settings.baseUrl || !settings.key) {
    throw new CallyzerApiError(503, "Callyzer API credentials are not configured on this server.");
  }

  const auth = authFor(settings);
  let response;
  try {
    response = await fetch(`${settings.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth.headers },
      body: JSON.stringify({ ...body, ...auth.fields }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new CallyzerApiError(504, `Could not reach Callyzer: ${error.message}`);
  }

  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }

  if (response.ok) return payload?.result ?? null;

  // Their body carries the reason in `message`; it is safe to surface - it describes the request,
  // never the credentials.
  const detail = String(payload?.message || "").trim();
  if (response.status === 401) {
    throw new CallyzerApiError(502, "Callyzer refused the credentials. Check CALLYZER_API_KEY and CALLYZER_API_SECRET.");
  }
  if (response.status === 403) {
    throw new CallyzerApiError(502, detail || "Callyzer refused the request. The subscription may have expired.");
  }
  if (response.status === 400) {
    throw new CallyzerRequestError(detail || "Callyzer rejected the request body.");
  }
  throw new CallyzerApiError(502, detail || `Callyzer responded ${response.status}.`, { body: payload });
}

module.exports = { callyzerPost, isConfigured, config, authFor, CallyzerApiError };
