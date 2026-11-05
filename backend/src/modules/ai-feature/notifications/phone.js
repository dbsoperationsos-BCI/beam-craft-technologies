const { normalizePhoneNumber } = require("../../../services/phoneNumber");

/**
 * A guest's phone as Meta and the SMS gateway take it: `+<digits>`, or null when it cannot be read
 * as one. The guest page always sends a dial code; a number staff typed without one is refused
 * here rather than guessed at, so nothing is ever sent to a number nobody verified.
 */
function toE164(value) {
  const normalized = normalizePhoneNumber(value);
  return normalized ? `+${normalized.replace(/\D/g, "")}` : null;
}

/** "+91 ••••••3210": enough for the guest to recognise their own number, and all a log row keeps. */
function mask(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 6) return null;
  return `+${digits.slice(0, digits.length - 10 > 0 ? digits.length - 10 : 2)} ••••••${digits.slice(-4)}`;
}

/** Whether the guest's current phone is the one that passed a code check. */
const isVerified = (guest) => Boolean(guest?.verifiedPhone && guest.verifiedPhone === toE164(guest.phone));

/**
 * Where the guest's photo-match message goes: the number they joined with, as Meta takes it. No code
 * proves it - the guest asked for the message by ticking the join card's box (or Turn on) - and
 * consent belongs to that number: staff changing the phone withdraws it (guests/service.update).
 */
const recipient = (guest) => toE164(guest?.phone);

/** Whether the guest has asked for the message and has a number it can go to. */
const canReceive = (guest) => Boolean(guest?.whatsappOptInAt && recipient(guest));

module.exports = { toE164, mask, isVerified, recipient, canReceive };
