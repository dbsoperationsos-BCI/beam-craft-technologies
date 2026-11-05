const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizePhoneNumber, isValidPhoneNumber, nationalNumberLimits } = require("../src/services/phoneNumber");

/*
 * One rule, shared by every phone field in the OS.
 *
 * It used to be `/^\+(\d{1,4})\s*(\d{10})$/`, copied into three modules — ten digits, whatever the
 * country. The picker beside these fields offers 185 countries and most of them are not ten digits,
 * so the rule refused numbers that were correct and accepted one that had been silently cut short.
 */

test("an Indian number is exactly ten digits, and nothing else will do", () => {
  assert.equal(normalizePhoneNumber("+91 9876543210"), "+91 9876543210");
  // Nine and eleven are the typos a strict rule exists to catch.
  assert.equal(normalizePhoneNumber("+91 987654321"), null);
  assert.equal(normalizePhoneNumber("+91 98765432100"), null);
});

test("a shorter national number abroad is accepted, where a flat ten refused it", () => {
  // Singapore is 8 digits. Under the old rule this was rejected on save.
  assert.equal(normalizePhoneNumber("+65 61234567"), "+65 61234567");
  // UAE and Australia are 9.
  assert.equal(normalizePhoneNumber("+971 501234567"), "+971 501234567");
  assert.equal(normalizePhoneNumber("+61 412345678"), "+61 412345678");
});

test("a longer national number abroad is kept whole, not cut to ten", () => {
  // A Chinese mobile is 11 digits. The field used to drop the last one and the server accepted the
  // result, storing a number that belonged to nobody and looked perfectly valid.
  assert.equal(normalizePhoneNumber("+86 13812345678"), "+86 13812345678");
});

test("the E.164 ceiling of fifteen digits still holds, code included", () => {
  // +1 leaves 14 for the national number.
  assert.equal(nationalNumberLimits("+1").max, 14);
  // +971 leaves 12.
  assert.equal(nationalNumberLimits("+971").max, 12);
  assert.equal(normalizePhoneNumber("+971 1234567890123"), null, "13 digits behind a 3-digit code is over the ceiling");
});

test("India's limit is the same whichever way the code is written", () => {
  for (const code of ["91", "+91"]) {
    assert.deepEqual(nationalNumberLimits(code), { min: 10, max: 10 });
  }
});

test("a number that cannot be read is refused, never quietly corrected", () => {
  for (const bad of ["", null, undefined, "9876543210", "call the office", "+91", "+91 abc", "919876543210"]) {
    assert.equal(normalizePhoneNumber(bad), null, `${JSON.stringify(bad)} must not normalize`);
  }
});

test("spacing around the number is tidied, and the stored shape is always one space", () => {
  assert.equal(normalizePhoneNumber("  +91  9876543210  "), "+91 9876543210");
  assert.equal(normalizePhoneNumber("+919876543210"), "+91 9876543210");
});

test("isValidPhoneNumber agrees with normalize on every case", () => {
  for (const value of ["+91 9876543210", "+65 61234567", "+86 13812345678", "+91 123", "nonsense"]) {
    assert.equal(isValidPhoneNumber(value), normalizePhoneNumber(value) !== null);
  }
});
