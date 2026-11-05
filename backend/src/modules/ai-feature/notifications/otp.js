const crypto = require("node:crypto");
const prisma = require("../../../config/db");
const { httpError } = require("../shared/http");
const smsSender = require("../../../services/smsSender");
const { toE164, mask } = require("./phone");

/**
 * Proving a guest holds the phone their WhatsApp summary would go to. A tick on the join card is
 * consent from whoever typed the number, not from whoever owns it, so nothing is ever sent until a
 * code sent by SMS to that number comes back. Built as the password-reset code is
 * (controllers/authController.js): six digits from `crypto`, only a hash kept, a short life, a
 * handful of guesses, and the code never logged.
 *
 * The code proves the number it was sent to. A guest whose phone is later changed by staff is no
 * longer verified (phone.isVerified compares the two), and has to prove the new one.
 *
 * MSG91 delivers only DLT-approved templates, and the one `SMS_TEMPLATE_ID` names is the password
 * reset's. A guest code therefore needs `SMS_GUEST_OTP_TEMPLATE_ID` there; without it the request is
 * refused rather than sent in another message's words.
 *
 * Joining takes any number, so every limit that stops this being used to text strangers is on what
 * is sent, not on who asks: per guest (a gap, and three an hour), per number (five a day across every
 * guest and event), per event (an hourly ceiling), and only to the dial codes the studio serves. The
 * counts and the new code are one SERIALIZABLE transaction, so requests sent at once cannot all pass
 * a count none of them has added to yet; the one that loses the race is told to try again.
 */
const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_HOUR = 3;
const MAX_SENDS_PER_NUMBER_PER_DAY = 5;
const RESEND_GAP_MS = 45 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Codes one event may send in an hour, across all its guests. */
const eventHourlyLimit = (env) => Number.parseInt(env.AI_FEATURE_OTP_EVENT_HOURLY_LIMIT || "", 10) || 60;
/** The dial codes a code may be sent to (comma-separated, default India), so the gateway cannot be pointed at premium-rate numbers abroad. "*" allows any. */
function dialCodeAllowed(phone, env) {
  const list = String(env.SMS_GUEST_ALLOWED_DIAL_CODES || "91").split(",").map((code) => code.trim().replace(/^\+/, "")).filter(Boolean);
  return list.includes("*") || list.some((code) => phone.startsWith(`+${code}`));
}
const tooMany = (message) => httpError(429, message);
const REFUSED = "That code is not right, or it has expired. Ask for a new one.";
const UNAVAILABLE = "We can't send a verification code right now. Please try again later.";

const hash = (code) => crypto.createHash("sha256").update(String(code)).digest("hex");
const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
const sameHash = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));

/** The template the gateway needs for a guest code, or `false` when this gateway cannot send one. */
function guestTemplate(env = process.env) {
  const settings = smsSender.config(env);
  if (settings?.provider !== "msg91") return null;
  return String(env.SMS_GUEST_OTP_TEMPLATE_ID || "").trim() || false;
}

/** LOGIN proves the phone to join as a protected guest; WHATSAPP proves it to receive the summary. */
const PURPOSES = Object.freeze({ LOGIN: "LOGIN", WHATSAPP: "WHATSAPP" });
const MESSAGES = {
  LOGIN: (code) => `${code} is your code to open your photos for this event. It expires in 5 minutes. Do not share it with anyone.`,
  WHATSAPP: (code) => `${code} is your code to get your event photo summary on WhatsApp. It expires in 5 minutes. Do not share it with anyone.`,
};

/**
 * Whether a code can be sent to this number at all, without sending one: "OK", or why not -
 * NO_NUMBER (not a number with a dial code), COUNTRY (a dial code the studio does not send to) or
 * UNAVAILABLE (no gateway, or MSG91 without the guest template). Joining asks this first, so a
 * guest who cannot be sent a code is told so, and is never let in unverified where a code is due.
 */
function sendability(phoneValue, env = process.env) {
  const phone = toE164(phoneValue);
  if (!phone) return "NO_NUMBER";
  if (!dialCodeAllowed(phone, env)) return "COUNTRY";
  return gatewayReady(env) ? "OK" : "UNAVAILABLE";
}

/** Whether a guest code can be sent at all: a gateway (or the development echo), and under MSG91 the guest template. */
function gatewayReady(env = process.env) {
  const settings = smsSender.config(env);
  // No gateway: only the development echo (the code on the console, never anywhere deployed) can stand in.
  if (!settings) return Boolean(smsSender.devEchoAllowed?.(env));
  if (smsSender.PROVIDERS && !smsSender.PROVIDERS[settings.provider]) return false;
  return guestTemplate(env) !== false;
}

/**
 * Refuses turning on Confirm phone numbers by SMS where no code can be sent: with it on, every phone
 * join waits on a code, so on a server without a gateway nobody could join with a phone at all.
 */
function assertCanRequireCodes(guestAccess, env = process.env) {
  if (guestAccess?.verifyPhone === true && !gatewayReady(env)) throw httpError(409, "Confirm phone numbers by SMS needs an SMS gateway, and none is set up on this server. Ask your administrator to configure SMS first.");
}

/**
 * Sends a fresh code for `purpose` to the phone stored on the guest - never a number from the
 * request - after spending any code of that purpose still open. The limits count every purpose.
 */
async function requestCode(guest, { purpose = PURPOSES.WHATSAPP, db = prisma, send = smsSender.sendSms, now = Date.now(), env = process.env } = {}) {
  if (!PURPOSES[purpose]) throw new Error(`Unknown code purpose ${purpose}`);
  const phone = toE164(guest.phone);
  if (!phone) throw httpError(400, purpose === PURPOSES.LOGIN ? "This guest has no mobile number we can send a code to. Please ask the host." : "We need your mobile number with its country code to send the summary. Leave and join again with it.");
  if (!dialCodeAllowed(phone, env)) throw httpError(400, purpose === PURPOSES.LOGIN ? "We can't send a code to this country's numbers. Please ask the host." : "WhatsApp summaries can't be set up for this country's numbers. You can still see your photos here.");
  const templateId = guestTemplate(env);
  if (templateId === false) throw httpError(503, UNAVAILABLE);

  const code = newCode();
  let row;
  try {
    row = await db.$transaction(async (tx) => {
      const recent = await tx.aiEventGuestPhoneOtp.findMany({ where: { guestId: guest.id, createdAt: { gte: new Date(now - HOUR_MS) } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
      if (recent.length >= MAX_SENDS_PER_HOUR) throw tooMany("You've asked for several codes already. Please try again in an hour.");
      const waited = recent[0] ? now - new Date(recent[0].createdAt).getTime() : Infinity;
      if (waited < RESEND_GAP_MS) throw tooMany(`Please wait ${Math.ceil((RESEND_GAP_MS - waited) / 1000)} seconds before asking for another code.`);
      if (await tx.aiEventGuestPhoneOtp.count({ where: { phone, createdAt: { gte: new Date(now - DAY_MS) } } }) >= MAX_SENDS_PER_NUMBER_PER_DAY) throw tooMany("This number has had several codes today. Please try again tomorrow.");
      if (await tx.aiEventGuestPhoneOtp.count({ where: { guest: { eventId: guest.eventId }, createdAt: { gte: new Date(now - HOUR_MS) } } }) >= eventHourlyLimit(env)) throw tooMany("We're sending a lot of codes for this event right now. Please try again later.");
      await tx.aiEventGuestPhoneOtp.updateMany({ where: { guestId: guest.id, purpose, usedAt: null }, data: { usedAt: new Date(now) } });
      return tx.aiEventGuestPhoneOtp.create({ data: { guestId: guest.id, phone, purpose, codeHash: hash(code), expiresAt: new Date(now + CODE_TTL_MS), createdAt: new Date(now) } });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    // Two requests at once: InnoDB stops one of them. Never sent, so nothing to undo.
    if (error?.code === "P2034") throw tooMany("Please wait a moment and try again.");
    throw error;
  }
  const result = await send({ to: phone, code, templateId, message: MESSAGES[purpose](code) });
  if (!result?.sent) {
    await db.aiEventGuestPhoneOtp.update({ where: { id: row.id }, data: { usedAt: new Date(now) } }).catch(() => {});
    // The gateway's reason, never the number or the code.
    console.warn(`[ai-feature] guest verification code not sent: ${result?.reason || "unknown reason"}`);
    throw httpError(503, UNAVAILABLE);
  }
  return { sentTo: mask(phone), expiresInSeconds: CODE_TTL_MS / 1000, resendInSeconds: RESEND_GAP_MS / 1000 };
}

/**
 * Checks a code of `purpose`, and returns the guest as it now stands. Each guess is counted by one
 * conditional UPDATE before it is compared, so guesses sent at once cannot share an attempt, and the
 * code is spent at the limit whatever was guessed. On success:
 *
 * - LOGIN proves the phone: the verified number is recorded and `sessionVersion` raised, which ends
 *   every other session for this guest (the caller issues the new one). Consent is not touched.
 * - WHATSAPP proves the phone and records consent together, with the consent baseline (below).
 */
async function verifyCode(guest, code, { purpose = PURPOSES.WHATSAPP, db = prisma, now = Date.now() } = {}) {
  const phone = toE164(guest.phone);
  const record = await db.aiEventGuestPhoneOtp.findFirst({ where: { guestId: guest.id, purpose, usedAt: null }, orderBy: { createdAt: "desc" } });
  if (!phone || !record || new Date(record.expiresAt).getTime() < now || record.phone !== phone) throw httpError(400, REFUSED);
  const { count } = await db.aiEventGuestPhoneOtp.updateMany({ where: { id: record.id, usedAt: null, attempts: { lt: MAX_ATTEMPTS } }, data: { attempts: { increment: 1 } } });
  if (!count) throw httpError(400, REFUSED);
  if (!sameHash(hash(String(code || "").trim()), record.codeHash)) {
    if (record.attempts + 1 >= MAX_ATTEMPTS) await db.aiEventGuestPhoneOtp.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: new Date(now) } });
    throw httpError(400, REFUSED);
  }
  const spent = await db.aiEventGuestPhoneOtp.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: new Date(now) } });
  if (!spent.count) throw httpError(400, REFUSED);
  const at = new Date(now);
  if (purpose === PURPOSES.LOGIN) {
    return db.aiEventGuest.update({ where: { id: guest.id }, data: { verifiedPhone: phone, phoneVerifiedAt: at, sessionVersion: { increment: 1 }, joinedAt: guest.joinedAt || at, lastSeenAt: at } });
  }
  return consent(db, guest, { verifiedPhone: phone, phoneVerifiedAt: at, whatsappOptInAt: at }, at);
}

/**
 * Consent, given by the guest themselves - the join card's box or Turn on - for the number they joined
 * with. No code: the photo-match message needs no login code (owner's decision, 2026-10-29). The
 * number must be one a message can go to, in a country the studio serves.
 */
async function optIn(guest, { db = prisma, now = Date.now(), env = process.env } = {}) {
  const phone = toE164(guest.phone);
  if (!phone) throw httpError(400, "We need your mobile number with its country code to send the message. Leave and join again with it.");
  if (!dialCodeAllowed(phone, env)) throw httpError(400, "WhatsApp messages can't be set up for this country's numbers. You can still see your photos here.");
  const at = new Date(now);
  return consent(db, guest, { whatsappOptInAt: at }, at);
}

/**
 * Records consent and, in the same transaction, the consent baseline: the guest's visible matches
 * nobody has reported are marked as counted, so the first summary after consent reports what is new
 * from then on - never a catch-up of photos the guest may already have browsed.
 */
function consent(db, guest, data, at) {
  return db.$transaction(async (tx) => {
    const updated = await tx.aiEventGuest.update({ where: { id: guest.id }, data });
    await require("./service").baselineConsent(tx, updated, at);
    return updated;
  });
}

/** Withdraws consent. Takes effect at once: a summary still waiting re-checks consent before it is sent. */
async function optOut(guest, { db = prisma, now = Date.now() } = {}) {
  await db.aiEventGuestPhoneOtp.updateMany({ where: { guestId: guest.id, purpose: PURPOSES.WHATSAPP, usedAt: null }, data: { usedAt: new Date(now) } });
  return db.aiEventGuest.update({ where: { id: guest.id }, data: { whatsappOptInAt: null, whatsappOptOutAt: new Date(now) } });
}

module.exports = { PURPOSES, CODE_TTL_MS, MAX_ATTEMPTS, MAX_SENDS_PER_HOUR, MAX_SENDS_PER_NUMBER_PER_DAY, RESEND_GAP_MS, dialCodeAllowed, sendability, gatewayReady, assertCanRequireCodes, hash, guestTemplate, requestCode, verifyCode, optIn, optOut };
