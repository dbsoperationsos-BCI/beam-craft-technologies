/**
 * The password a new account is created with.
 *
 * It was one string in the source — `123qweasdzxc` — shared by every account the studio had ever
 * made. That is a single working password for every employee whose own has not been changed, and
 * nothing yet forces a change: accounts are created with `mustChangePassword: true` and no screen
 * reads that flag. Anybody who has ever been onboarded, or seen this repository, could sign in as
 * anybody else. A password per account is what stops one leak being all of them.
 *
 * ── What it is made of ──
 *
 * Somebody reads this off a dialog and types it into a sign-in box, or dictates it over a phone —
 * so no two characters in it can be mistaken for each other. The confusable pairs are `0`/`o`,
 * `1`/`l`/`i`, `2`/`z` and `5`/`s`, and breaking a pair only takes dropping one half of it: the
 * four digits go and the letters stay, which costs less of the alphabet than the other way round.
 * Lowercase throughout, so there is no case to get wrong. No punctuation: it survives being pasted
 * through a spreadsheet, a WhatsApp message and a terminal without anything quoting or escaping it.
 *
 * Groups of four separated by hyphens, the way a licence key is written, because a password read
 * off one screen and typed into another is read in chunks. The hyphens are part of the password.
 *
 * ── Why the randomness is what it is ──
 *
 * `crypto.getRandomValues`, not `Math.random`: this is a credential, and `Math.random` is a
 * predictable sequence in every engine that implements it. Rejection sampling rather than `% n`,
 * which would quietly favour the first few letters of the alphabet.
 *
 * 12 characters from an alphabet of 30 is a little over 58 bits — far past anything worth guessing
 * at for a password that is meant to be replaced on first sign-in, and short enough to type.
 */

/** No character that can be mistaken for another when this is read off a screen and typed. */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz346789";

const GROUP = 4;
const GROUPS = 3;

/**
 * Unbiased random characters from `ALPHABET`.
 *
 * A byte is 0–255 and the alphabet does not divide into 256, so the last, short stretch of values
 * is thrown away rather than folded back over the start — folding is how `% length` makes the
 * first few letters more likely than the last few. Bytes are drawn in batches, since the discard
 * rate means a fixed-size draw would sometimes come up short.
 */
function randomCharacters(count, randomValues) {
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  const out = [];
  while (out.length < count) {
    const bytes = new Uint8Array(count * 2);
    randomValues(bytes);
    for (const byte of bytes) {
      if (byte >= limit) continue;
      out.push(ALPHABET[byte % ALPHABET.length]);
      if (out.length === count) break;
    }
  }
  return out;
}

/**
 * The source of randomness, which has to be a real one.
 *
 * Every browser this runs in has `crypto.getRandomValues`, and so does Node from v19. There is
 * deliberately no `Math.random` fallback: a password quietly generated from a predictable sequence
 * is worse than one that fails loudly, because nothing about it looks wrong afterwards.
 */
function secureRandomValues(array) {
  const source = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (!source?.getRandomValues) throw new Error("No secure random source is available to generate a password.");
  return source.getRandomValues(array);
}

/** A fresh password: `k7np-hq4d-mr8t`. */
export function generateTemporaryPassword(randomValues = secureRandomValues) {
  const characters = randomCharacters(GROUP * GROUPS, randomValues);
  return Array.from({ length: GROUPS }, (unused, group) => characters.slice(group * GROUP, (group + 1) * GROUP).join("")).join("-");
}

/** What the alphabet and the shape are, for anything that has to check one. */
export const TEMPORARY_PASSWORD_ALPHABET = ALPHABET;
export const TEMPORARY_PASSWORD_PATTERN = new RegExp(`^([${ALPHABET}]{${GROUP}}-){${GROUPS - 1}}[${ALPHABET}]{${GROUP}}$`);
