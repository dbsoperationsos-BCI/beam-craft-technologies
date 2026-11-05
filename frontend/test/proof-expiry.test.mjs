import assert from "node:assert/strict";
import test from "node:test";
import { earliestExpiryKey, expiryDateKey, expiryInstant } from "../src/lib/proofExpiry.mjs";

test("a stored instant reads as the day it falls on, and nonsense reads as nothing", () => {
  assert.equal(expiryDateKey(new Date(2027, 2, 19, 23, 59, 59)), "2027-03-19");
  // Single digits are padded — the calendar keys on the string, not on the date.
  assert.equal(expiryDateKey(new Date(2027, 0, 5, 8, 0, 0)), "2027-01-05");
  for (const empty of ["", null, undefined, "not a date"]) assert.equal(expiryDateKey(empty), "");
});

test("a chosen day expires at the end of it, so the client can still open the link that day", () => {
  const instant = new Date(expiryInstant("2027-03-19"));
  assert.equal(expiryDateKey(instant), "2027-03-19", "the day moved");
  assert.equal(instant.getHours(), 23);
  assert.equal(instant.getMinutes(), 59);
  // The last moment of the chosen day is still in the future at the start of it.
  assert.ok(instant.getTime() > new Date("2027-03-19T00:00:00").getTime());
  for (const empty of ["", null, undefined, "not a date"]) assert.equal(expiryInstant(empty), null);
});

test("a day chosen on the calendar survives the round trip in every month", () => {
  for (let month = 0; month < 12; month += 1) {
    const key = expiryDateKey(new Date(2027, month, 28));
    assert.equal(expiryDateKey(new Date(expiryInstant(key))), key, `${key} did not survive`);
  }
});

test("the calendar cannot offer today or anything behind it", () => {
  const now = new Date(2026, 8, 19, 15, 30);
  assert.equal(earliestExpiryKey(now), "2026-09-20");
  // Across a month end, and across a year end.
  assert.equal(earliestExpiryKey(new Date(2026, 8, 30, 23, 0)), "2026-10-01");
  assert.equal(earliestExpiryKey(new Date(2026, 11, 31, 12, 0)), "2027-01-01");
});
