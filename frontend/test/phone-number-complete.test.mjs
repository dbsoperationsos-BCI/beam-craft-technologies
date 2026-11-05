import test from "node:test";
import assert from "node:assert/strict";

import { isCompletePhoneNumber } from "../src/lib/phoneNumber.js";

/*
 * When a typed number counts as finished.
 *
 * This is the rule behind the one field on the lead popup that does not wait for Update: the
 * WhatsApp Number saves itself the moment it is whole, because the WhatsApp Chat panel beside it
 * can only hold a conversation with a number the server knows.
 *
 * That makes "whole" load-bearing in both directions. Too loose and a half-typed number is written
 * to the lead on the way to typing the real one; too strict and the field never saves at all.
 */

test("an Indian number is finished at the tenth digit and not before", () => {
  assert.equal(isCompletePhoneNumber("+91 9876543210"), true);
  for (const partial of ["+91 9", "+91 98765", "+91 987654321"]) {
    assert.equal(isCompletePhoneNumber(partial), false, `"${partial}" is not a number yet`);
  }
});

test("and not after: eleven digits is a typo, not a longer number", () => {
  // The strictness is deliberate for +91 - nearly every number the studio holds is Indian, and a
  // loose range would accept exactly the nine- and eleven-digit typos a strict one catches.
  assert.equal(isCompletePhoneNumber("+91 98765432101"), false);
});

test("other countries are finished at their own lengths", () => {
  // An eight-digit Singapore number is whole; the field must not hold out for ten.
  assert.equal(isCompletePhoneNumber("+65 61234567"), true);
  assert.equal(isCompletePhoneNumber("+44 7911123456"), true);
  // Below the floor is still not a number anybody can be reached on.
  assert.equal(isCompletePhoneNumber("+65 612"), false);
});

test("an empty or half-formed field never counts as finished", () => {
  for (const value of ["", "   ", "+", "+91", "+91 ", "9876543210", "not a number", null, undefined]) {
    assert.equal(isCompletePhoneNumber(value), false, `"${value}" should not have counted`);
  }
});

test("the country code and the digits must be separated, which is the shape the field emits", () => {
  // `PhoneField` writes "+91 9876543210". An unbroken run has nothing in it saying where the code
  // ends, so it is not treated as finished here - the save path would have to guess.
  assert.equal(isCompletePhoneNumber("+919876543210"), false);
  assert.equal(isCompletePhoneNumber("+91 9876543210"), true);
});

test("surrounding whitespace does not make a whole number unfinished", () => {
  assert.equal(isCompletePhoneNumber("  +91 9876543210  "), true);
});
