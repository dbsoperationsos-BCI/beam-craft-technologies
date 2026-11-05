/**
 * The one rule for a stored phone number, shared by everything that validates one.
 *
 * Stored as `+<dial code> <national number>` — "+91 9876543210". Three modules were each carrying
 * their own copy of `/^\+(\d{1,4})\s*(\d{10})$/`, which quietly assumed every number in the world is
 * ten digits long. The picker beside these fields offers 185 countries, and most of them are not:
 * a Singapore number is 8 digits and was refused, a Chinese one is 11 and was *truncated* to ten by
 * the field before it ever reached here — stored wrong, and valid-looking enough that nothing
 * flagged it.
 *
 * So the length is E.164's: a national number of 4 to 14 digits, with the dial code and the number
 * together never more than 15.
 *
 * India is the exception, and deliberately. Almost every number the studio holds is Indian, an
 * Indian mobile is exactly ten digits, and a loose 4-to-14 rule would accept the nine- and
 * eleven-digit typos that a strict one catches. Strict where the volume is, correct everywhere else.
 */

const E164_MAX_DIGITS = 15;
const INDIA_DIAL_CODE = "91";
const INDIA_NATIONAL_DIGITS = 10;
const MIN_NATIONAL_DIGITS = 4;

/** How long the national number may be for a given dial code, as `{ min, max }`. */
function nationalNumberLimits(dialCode) {
  const code = String(dialCode || "").replace(/\D/g, "");
  if (code === INDIA_DIAL_CODE) return { min: INDIA_NATIONAL_DIGITS, max: INDIA_NATIONAL_DIGITS };
  return { min: MIN_NATIONAL_DIGITS, max: Math.max(MIN_NATIONAL_DIGITS, E164_MAX_DIGITS - code.length) };
}

/**
 * The number in its stored shape, or null when it is not one.
 *
 * Null is a refusal, never a correction: a number that cannot be read is reported back so the
 * studio can fix it, rather than quietly cleared or trimmed to fit.
 */
function normalizePhoneNumber(value) {
  const raw = String(value ?? "").trim();

  // Separated, which is the shape the field emits and the shape everything is stored in. The split
  // is given rather than guessed, so the national number can be any length its country allows.
  const separated = raw.match(/^\+(\d{1,4})\s+(\d+)$/);
  if (separated) return withinLimits(separated[1], separated[2]);

  /*
   * One unbroken run of digits, which is what an import or a pasted number looks like.
   *
   * There is nothing in `+919876543210` that says where the code ends: read greedily it is +9198
   * followed by eight digits, which is a real dial code and a plausible length. So the split is not
   * guessed — the last ten digits are taken as the national number and the rest as the code, which
   * is what this has always assumed and is right for every Indian number, the overwhelming majority
   * of what the studio holds.
   *
   * A country whose numbers are not ten digits therefore has to arrive separated. That is a
   * limitation of the input, not of the rule: unseparated, it genuinely cannot be read.
   */
  const unseparated = raw.replace(/[^\d+]/g, "").match(/^\+(\d+)$/);
  if (!unseparated) return null;
  const digits = unseparated[1];
  if (digits.length <= INDIA_NATIONAL_DIGITS) return null;
  return withinLimits(digits.slice(0, -INDIA_NATIONAL_DIGITS), digits.slice(-INDIA_NATIONAL_DIGITS));
}

/** The pair as a stored number, or null when the national part is the wrong length for its code. */
function withinLimits(code, national) {
  const { min, max } = nationalNumberLimits(code);
  if (national.length < min || national.length > max) return null;
  return `+${code} ${national}`;
}

const isValidPhoneNumber = (value) => normalizePhoneNumber(value) !== null;

/** What to tell somebody whose number was refused. */
function phoneNumberMessage(dialCode) {
  const { min, max } = nationalNumberLimits(dialCode);
  return min === max
    ? `Phone number must include a country code and exactly ${min} digits`
    : `Phone number must include a country code and ${min}-${max} digits`;
}

module.exports = {
  nationalNumberLimits,
  normalizePhoneNumber,
  isValidPhoneNumber,
  phoneNumberMessage,
  E164_MAX_DIGITS,
  INDIA_DIAL_CODE,
  INDIA_NATIONAL_DIGITS,
  MIN_NATIONAL_DIGITS,
};
