const crypto = require("crypto");

/**
 * The short public code behind every shortened link the studio shares — first the client gallery
 * (/g/A7K9C2), now onboarding invites too. No 0/O, 1/I or L, so a code read out loud or retyped
 * from a WhatsApp screenshot cannot be mistyped into someone else's link. Random, never derived
 * from an id, and single-purpose per table: each caller stores it under its own unique column.
 */
const SHORT_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const SHORT_CODE_LENGTH = 6;
// Accepts the length being generated and the shorter codes of the mock-ups.
const SHORT_CODE_PATTERN = /^[A-Za-z0-9]{4,8}$/;

function generateShortCode(length = SHORT_CODE_LENGTH) {
  return Array.from({ length }, () => SHORT_CODE_ALPHABET[crypto.randomInt(SHORT_CODE_ALPHABET.length)]).join("");
}

module.exports = { SHORT_CODE_ALPHABET, SHORT_CODE_LENGTH, SHORT_CODE_PATTERN, generateShortCode };
