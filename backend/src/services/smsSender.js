/**
 * Sends one SMS, through whichever gateway the studio has configured.
 *
 * Built the way `smtpPool.js` is, and for the same reasons: the credentials live in the
 * environment, they are never logged or returned, and a server with nothing configured answers
 * `{ sent: false, reason }` rather than throwing — a studio that has not bought an SMS account yet
 * is a normal state, not a fault.
 *
 * ── Why there is a provider abstraction at all ────────────────────────────────────────────────
 *
 * The application had no SMS channel of any kind when the password-reset OTP was asked for. Its
 * only outbound channels were SMTP and a **QR-paired personal WhatsApp account**, and sending an
 * automated code from that number on every forgotten password is exactly what gets a paired number
 * banned. So a gateway has to be added, and which one is the studio's commercial decision rather
 * than this file's: `msg91` is implemented because it is the usual choice for Indian numbers, and
 * `http` covers any gateway that takes a GET or a POST with an API key, which is nearly all of them.
 *
 * Nothing here retries. An OTP is worth two minutes, and a code that arrives after the box has
 * expired is worse than one that never arrives: the studio asks for another and gets two.
 *
 * **The code is never logged on a deployed server.** Not in a message, not in a URL, not in an
 * error - a log line carrying a live OTP is a way in for anybody who can read the logs, which on a
 * small VPS is more people than can read the database. The single exception is the development
 * echo below, which exists precisely because a developer has no gateway and therefore no other way
 * to see a code at all; it refuses to run anywhere but `NODE_ENV="development"`.
 */

const { normalizePhoneNumber } = require("./phoneNumber");

/** How long the gateway is given before the attempt is abandoned. Longer than any gateway needs. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * What the studio configured, read fresh each send.
 *
 * Read per send rather than once at start-up so credentials corrected on the VPS take effect on the
 * next attempt instead of after a restart — the same reasoning `systemName()` in emailService uses.
 */
function config(env = process.env) {
  const provider = String(env.SMS_PROVIDER || "").trim().toLowerCase();
  if (!provider) return null;
  const apiKey = String(env.SMS_API_KEY || "").trim();
  if (!apiKey) return null;
  return {
    provider,
    apiKey,
    senderId: String(env.SMS_SENDER_ID || "").trim(),
    // MSG91 and most Indian gateways send an approved DLT template rather than free text.
    templateId: String(env.SMS_TEMPLATE_ID || "").trim(),
    baseUrl: String(env.SMS_BASE_URL || "").trim(),
    // `http` only: how the key and the message are named by that gateway.
    keyParam: String(env.SMS_KEY_PARAM || "apikey").trim(),
    toParam: String(env.SMS_TO_PARAM || "to").trim(),
    messageParam: String(env.SMS_MESSAGE_PARAM || "message").trim(),
    senderParam: String(env.SMS_SENDER_PARAM || "sender").trim(),
  };
}

/**
 * The number as a gateway wants it: digits only, with the country code.
 *
 * `normalizePhoneNumber` is the application's own rule and answers `+91 98765 43210`; a gateway
 * takes `919876543210`. A number it refuses is answered here rather than sent, so an unsendable
 * number is a reason rather than a gateway error nobody can read.
 */
function gatewayNumber(value) {
  const normalized = normalizePhoneNumber(value);
  if (!normalized) return null;
  const digits = normalized.replace(/\D/g, "");
  return digits.length >= 10 ? digits : null;
}

/** MSG91's OTP endpoint: an approved template, the number, and the variables it names. */
async function sendViaMsg91(settings, { to, code, message }) {
  const url = new URL(settings.baseUrl || "https://control.msg91.com/api/v5/otp");
  url.searchParams.set("template_id", settings.templateId);
  url.searchParams.set("mobile", to);
  if (settings.senderId) url.searchParams.set("sender", settings.senderId);
  // The variable an OTP template substitutes. `otp` is MSG91's own name for it.
  url.searchParams.set("otp", code);

  const response = await fetch(url, {
    method: "POST",
    headers: { authkey: settings.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`MSG91 answered ${response.status}`);
  const body = await response.json().catch(() => null);
  // MSG91 answers 200 with `{ type: "error" }` for a rejected template or an exhausted balance.
  if (body && String(body.type).toLowerCase() === "error") throw new Error(String(body.message || "MSG91 refused the message"));
  return { sent: true };
}

/** Any gateway that takes an API key, a number and a message as query parameters. */
async function sendViaHttp(settings, { to, message }) {
  if (!settings.baseUrl) throw new Error("SMS_BASE_URL is not set for the http provider.");
  const url = new URL(settings.baseUrl);
  url.searchParams.set(settings.keyParam, settings.apiKey);
  url.searchParams.set(settings.toParam, to);
  url.searchParams.set(settings.messageParam, message);
  if (settings.senderId) url.searchParams.set(settings.senderParam, settings.senderId);

  const response = await fetch(url, { method: "POST", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`The SMS gateway answered ${response.status}`);
  return { sent: true };
}

const PROVIDERS = { msg91: sendViaMsg91, http: sendViaHttp };

/**
 * Whether a code with no gateway behind it may be printed on the server console.
 *
 * Only on a developer's own machine. Buying an SMS account is the studio's commercial decision and
 * nobody makes it in order to run the app locally, so without this a developer cannot reach the
 * screen *after* the code box at all - the code is minted, stored and thrown away, and the form
 * counts down two minutes against something that was never sent anywhere.
 *
 * `=== "development"` rather than `!== "production"` deliberately: a VPS that forgot to set
 * `NODE_ENV` must fall on the safe side of this, and an unset variable is exactly that case. It can
 * also be turned off outright with `SMS_DEV_ECHO="false"` by anybody who would rather it never
 * happened.
 */
function devEchoAllowed(env = process.env) {
  if (String(env.NODE_ENV || "").trim() !== "development") return false;
  return String(env.SMS_DEV_ECHO || "").trim().toLowerCase() !== "false";
}

/**
 * Prints the code where the developer will see it, and says plainly that nothing was sent.
 *
 * Loud on purpose. A quiet line in a busy dev server is missed, and the whole point of this is to
 * be found by somebody who is staring at a code box wondering why their phone is silent.
 */
function echoToConsole({ to, code, message }) {
  console.warn(
    "\n"
    + "  ┌──────────────────────────────────────────────────────────────┐\n"
    + "  │  SMS IS NOT CONFIGURED - development echo, nothing was sent  │\n"
    + "  └──────────────────────────────────────────────────────────────┘\n"
    + `  to:   ${to}\n`
    + `  code: ${code || "(none)"}\n`
    + `  text: ${message || "(none)"}\n`
    + "  Set SMS_PROVIDER and SMS_API_KEY to deliver this for real.\n",
  );
  return { sent: true, channel: "console" };
}

/**
 * Sends one message. Returns `{ sent: true }`, or `{ sent: false, reason }`.
 *
 * Never throws: every caller has the same two things to say, and for an OTP a failed send is a log
 * line and a message on screen rather than a stack trace. The reason is safe to log - it names the
 * gateway's complaint, never the key and never the code.
 *
 * `templateId`, when given, stands in for `SMS_TEMPLATE_ID` on this one send: a gateway that only
 * delivers approved templates (MSG91's DLT) needs a different template per kind of message, and a
 * caller that is not the password reset must never go out under that wording.
 */
async function sendSms({ to, message, code, templateId = null }) {
  const configured = config();
  const settings = configured && templateId ? { ...configured, templateId } : configured;
  if (!settings) {
    // Locally there is no gateway to fail over to, so the console is the delivery. Anywhere else
    // this stays exactly what it was: an honest "nothing was sent", and a reason worth logging.
    if (devEchoAllowed()) return echoToConsole({ to, code, message });
    return { sent: false, reason: "SMS is not configured." };
  }

  const send = PROVIDERS[settings.provider];
  if (!send) return { sent: false, reason: `Unknown SMS_PROVIDER "${settings.provider}". Use one of: ${Object.keys(PROVIDERS).join(", ")}.` };

  const number = gatewayNumber(to);
  if (!number) return { sent: false, reason: "That number is not one this gateway can send to." };

  try {
    return await send(settings, { to: number, message, code });
  } catch (error) {
    // The message only. A thrown fetch error can carry the URL, and the URL can carry the key.
    return { sent: false, reason: error.message };
  }
}

/** What the health check prints: whether sending is possible, and through what. Never the key. */
function describeSms() {
  const settings = config();
  // `devEcho` is how the health check answers "the code never arrived" on a developer's machine:
  // not configured, but not silently dropped either - it is on the server console.
  if (!settings) return { configured: false, provider: null, devEcho: devEchoAllowed() };
  return {
    configured: Boolean(PROVIDERS[settings.provider]),
    provider: settings.provider,
    senderId: settings.senderId || null,
    templateId: settings.templateId || null,
    baseUrl: settings.baseUrl || null,
  };
}

/**
 * Whether a code sent now would reach somebody: a gateway is configured, or this is a development
 * machine echoing to its console. A step that depends on an SMS arriving asks this first, so a
 * server without a gateway does not shut people out.
 */
function smsAvailable(env = process.env) {
  return Boolean(config(env)) || devEchoAllowed(env);
}

module.exports = { smsAvailable, sendSms, describeSms, gatewayNumber, config, devEchoAllowed, PROVIDERS };
