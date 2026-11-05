import test from "node:test";
import assert from "node:assert/strict";

import { TEMPORARY_PASSWORD_ALPHABET, TEMPORARY_PASSWORD_PATTERN, generateTemporaryPassword } from "../src/lib/temporaryPassword.mjs";

/*
 * The password a new account is created with.
 *
 * It was one string in the source, shared by every account the studio had ever made — a working
 * password for every employee who had not changed theirs, and nothing yet forces them to. What is
 * tested here is the two things that made that worth replacing: that two accounts do not get the
 * same password, and that the randomness is real and even rather than something that merely looks
 * random. A biased generator and a good one are indistinguishable by eye.
 */

test("every password is a different one", () => {
  const seen = new Set(Array.from({ length: 500 }, () => generateTemporaryPassword()));
  assert.equal(seen.size, 500);
});

test("it is shaped for somebody reading it off a screen and typing it in", () => {
  const password = generateTemporaryPassword();
  assert.match(password, TEMPORARY_PASSWORD_PATTERN);
  // The backend refuses anything under eight characters, and this has to clear that by construction.
  assert.ok(password.length >= 8, password);
});

test("no character that can be mistaken for another is ever produced", () => {
  /*
   * The pairs that turn a correct password into a failed sign-in when it is read off a screen and
   * typed into a box: 0/o, 1/l/i, 2/z and 5/s. One of each pair is enough to break the confusion,
   * so the letters stay and the four digits go — a password is more letters than digits, and
   * losing four digits costs less of the alphabet than losing four letters would.
   */
  for (const ambiguous of ["0", "1", "2", "5", "i", "l", "o"]) {
    assert.equal(TEMPORARY_PASSWORD_ALPHABET.includes(ambiguous), false, ambiguous);
  }
  // Lowercase throughout, so there is no case to get wrong when it is dictated over a phone.
  assert.equal(TEMPORARY_PASSWORD_ALPHABET, TEMPORARY_PASSWORD_ALPHABET.toLowerCase());
  assert.equal(new Set(TEMPORARY_PASSWORD_ALPHABET).size, TEMPORARY_PASSWORD_ALPHABET.length, "a repeated character would be drawn twice as often");

  const drawn = Array.from({ length: 200 }, () => generateTemporaryPassword()).join("").replace(/-/g, "");
  for (const character of new Set(drawn)) assert.ok(TEMPORARY_PASSWORD_ALPHABET.includes(character), character);
});

test("a byte past the alphabet is discarded, not folded back over its first letters", () => {
  /*
   * The bug this exists for is `byte % length`, which is the obvious way to write this and is
   * biased: 256 is not a multiple of 29, so the first few letters come up more often than the last.
   *
   * 29 goes into 256 eight times with 24 left over, so 232 is the last whole multiple and every
   * byte from 232 up has to be thrown away. 233 is the one that tells the two implementations
   * apart: folded, it is `233 % 29`, the alphabet's second letter; discarded, it produces nothing
   * at all. Feeding nothing but 233 and 0 must therefore give the first letter every time.
   */
  const alternating = (array) => {
    for (let index = 0; index < array.length; index += 1) array[index] = index % 2 === 0 ? 233 : 0;
    return array;
  };
  const password = generateTemporaryPassword(alternating).replace(/-/g, "");
  assert.equal(password, TEMPORARY_PASSWORD_ALPHABET[0].repeat(password.length));
});

test("every letter of the alphabet is reachable", () => {
  // The counterpart to the above: discarding correctly is worthless if the draw cannot reach the
  // tail of the alphabet in the first place.
  const drawn = new Set(Array.from({ length: 3000 }, () => generateTemporaryPassword()).join("").replace(/-/g, ""));
  assert.equal(drawn.size, TEMPORARY_PASSWORD_ALPHABET.length);
});

test("there is no fallback to a predictable source of randomness", () => {
  // A password quietly generated from `Math.random` is worse than one that fails loudly: nothing
  // about it looks wrong afterwards.
  assert.throws(() => generateTemporaryPassword(() => { throw new Error("no secure random source"); }), /no secure random source/i);
});
