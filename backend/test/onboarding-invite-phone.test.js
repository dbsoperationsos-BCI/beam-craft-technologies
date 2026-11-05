const test = require("node:test");
const assert = require("node:assert/strict");
const { phonesMatch } = require("../src/modules/hrm/onboarding-invites/controller");

/*
 * Whether two phone numbers are the same number.
 *
 * This decides two things and would fail silently in opposite directions on each. It is what lets a
 * candidate open their own invite — too strict and they are turned away from it, with a message
 * saying their number does not match a number that is theirs — and it is what catches a second
 * invite for somebody already invited, where too loose would refuse an invite for a stranger.
 *
 * The case that made it necessary: HR types the number into a field that stores `+91 9876543210`,
 * and the candidate types the ten digits they would give anybody.
 */

test("a candidate typing their bare number matches the invite HR stored with a country code", () => {
  assert.equal(phonesMatch("+91 9876543210", "9876543210"), true);
  assert.equal(phonesMatch("9876543210", "+91 9876543210"), true, "and the same either way round");
});

test("the shapes a number gets typed in are all one number", () => {
  for (const typed of ["9876543210", "98765-43210", "98765 43210", "+91 9876543210", "+919876543210", "(+91) 9876543210"]) {
    assert.equal(phonesMatch("+91 9876543210", typed), true, typed);
  }
});

test("a different number is a different number", () => {
  assert.equal(phonesMatch("+91 9876543210", "9876543211"), false);
  assert.equal(phonesMatch("+91 9876543210", "+91 9123456789"), false);
});

test("a short tail matches nothing, which is what stops it opening everybody's invite", () => {
  // Without the floor, "3210" would be the tail of every number ending in those digits — and this
  // is one half of what gates a public onboarding link.
  assert.equal(phonesMatch("+91 9876543210", "3210"), false);
  assert.equal(phonesMatch("+91 9876543210", "543210"), false, "six digits is still short of a national number");
  assert.equal(phonesMatch("+91 9876543210", "6543210"), true, "seven is the shortest national number in use");
});

test("an empty number matches nothing, including another empty one", () => {
  assert.equal(phonesMatch("", "9876543210"), false);
  assert.equal(phonesMatch("9876543210", ""), false);
  assert.equal(phonesMatch("", ""), false);
  assert.equal(phonesMatch(null, undefined), false);
});

test("numbers outside India work the same way", () => {
  // The rule is about a dialling prefix on one side, not about +91 in particular.
  assert.equal(phonesMatch("+1 4155550123", "4155550123"), true);
  assert.equal(phonesMatch("+44 7700900123", "7700900123"), true);
});
