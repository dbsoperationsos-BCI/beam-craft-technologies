/**
 * How long a national number may be, given the country it belongs to.
 *
 * The same rule the server holds in backend/src/services/phoneNumber.js, and it has to stay the
 * same: the field caps what can be typed, and the server refuses what arrives, so a number the
 * field allows must be one the server accepts.
 *
 * The cap used to be a flat ten, from when the studio only ever held Indian numbers. The picker
 * now offers 185 countries and most of them are not ten digits — an eight-digit Singapore number
 * was refused on save, and an eleven-digit Chinese one was cut to ten here before it was ever
 * sent, which stored a wrong number that looked perfectly valid.
 *
 * India stays exactly ten on purpose: nearly every number the studio holds is Indian, and a loose
 * range would accept the nine- and eleven-digit typos that a strict one catches.
 */
const E164_MAX_DIGITS = 15;
const INDIA_DIAL_CODE = "91";
const INDIA_NATIONAL_DIGITS = 10;
const MIN_NATIONAL_DIGITS = 4;

export function nationalNumberLimits(dialCode) {
  const code = String(dialCode || "").replace(/\D/g, "");
  if (code === INDIA_DIAL_CODE) return { min: INDIA_NATIONAL_DIGITS, max: INDIA_NATIONAL_DIGITS };
  return { min: MIN_NATIONAL_DIGITS, max: Math.max(MIN_NATIONAL_DIGITS, E164_MAX_DIGITS - code.length) };
}

/** The placeholder a field shows, which is the shape of the number it is asking for. */
export function phonePlaceholder(dialCode) {
  const { max } = nationalNumberLimits(dialCode);
  return max === INDIA_NATIONAL_DIGITS ? "12345-12345" : `${"".padEnd(Math.min(max, 12), "0").replace(/0/g, "9")}`;
}

/**
 * Whether a number is finished - a country code and a national part of the length that code
 * allows.
 *
 * The same question `isValidPhoneNumber` answers on the server, asked here so a field can act the
 * moment a number becomes whole rather than waiting to be told by a save. The shape is the one
 * `PhoneField` emits: `+91 9876543210`, the code and the digits separated by a space.
 *
 * Ten digits for an Indian number, exactly - which is what makes "type the tenth digit and it
 * saves" a rule rather than a guess. Half a number is not a number, and neither is eleven digits.
 */
export function isCompletePhoneNumber(value) {
  const match = String(value ?? "").trim().match(/^\+(\d{1,4})\s+(\d+)$/);
  if (!match) return false;
  const { min, max } = nationalNumberLimits(match[1]);
  return match[2].length >= min && match[2].length <= max;
}

export { E164_MAX_DIGITS, INDIA_DIAL_CODE, INDIA_NATIONAL_DIGITS, MIN_NATIONAL_DIGITS };

/**
 * A stored number split into the country code and the national part.
 *
 * Lived privately inside `PhoneField` until the Quotation Generator needed to prefill a number
 * from a CRM lead: the lead's columns are free text written by four different producers, so a
 * number arrives as "9876543210", "+91 98765 43210" or "919876543210" depending on which one
 * wrote it, and only this rule decides what each of those means. One copy, so the field and
 * everything that fills the field cannot read the same number two different ways.
 */
export function parsePhoneNumber(value) {
  const raw = String(value || "").trim();
  const separated = raw.match(/^\s*(\+\d{1,4})[\s-]+(\d{0,10})\s*$/);
  if (separated) return { countryCode: separated[1], number: separated[2] };
  // A run of digits with no separator. India is assumed, because that is what the studio types:
  // anything longer than a ten-digit national number is read as a code in front of one.
  const explicitDigits = raw.replace(/[^\d+]/g, "").match(/^\+(\d+)$/);
  if (explicitDigits) {
    const digits = explicitDigits[1];
    return { countryCode: digits.length > 10 ? `+${digits.slice(0, -10)}` : "+91", number: digits.slice(-10) };
  }
  const digits = raw.replace(/\D/g, "");
  return { countryCode: "+91", number: digits.length > 10 ? digits.slice(-10) : digits.slice(0, 10) };
}

/**
 * Any number, in the shape `PhoneField` saves: `+91 9876543210`.
 *
 * What a number must be turned into before it is written to a form's state from somewhere other
 * than the field itself. Left raw, a lead's "98765 43210" would sit in the payload looking right
 * on screen - `PhoneField` parses whatever it is handed - while being stored in a shape nothing
 * else matches, until somebody happened to edit the field and it silently changed.
 *
 * Empty in, empty out: a lead with no number must leave the field blank rather than "+91 ".
 */
export function toStoredPhoneNumber(value) {
  const { countryCode, number } = parsePhoneNumber(value);
  const digits = number.slice(0, nationalNumberLimits(countryCode).max);
  return digits ? `${countryCode || "+91"} ${digits}` : "";
}
