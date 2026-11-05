import test from "node:test";
import assert from "node:assert/strict";

import { branchLabel, branchMatchesSearch, branchOptionLabel, branchesMatchingSearch } from "../src/lib/branchName.js";

/*
 * The state is dropped for reading and for reading only. These assertions are as much about what
 * must NOT change as about what does: the stored name is what every branch-scoped query, saved
 * record and generated identifier matches on, so a helper that rewrote it would detach rows from
 * the branch they belong to without anything on screen saying so.
 */

test("the state is dropped from the six branches the studio runs", () => {
  assert.equal(branchLabel("Erode TN"), "Erode");
  assert.equal(branchLabel("Tiruppur TN"), "Tiruppur");
  assert.equal(branchLabel("Coimbatore TN"), "Coimbatore");
  assert.equal(branchLabel("Bangalore KA"), "Bangalore");
  assert.equal(branchLabel("Hyderabad TL"), "Hyderabad");
  assert.equal(branchLabel("Visakhapatnam AP"), "Visakhapatnam");
});

test("a name carrying no state is left exactly as it is", () => {
  for (const name of ["Erode", "Remote", "Work From Home", "On Field", "Others"]) {
    assert.equal(branchLabel(name), name);
  }
});

test("a trailing two letters that is not a state is not a state", () => {
  // The loose rule - strip any two capitals - would have eaten these.
  assert.equal(branchLabel("Head Office HQ"), "Head Office HQ");
  assert.equal(branchLabel("Studio TV"), "Studio TV");
});

test("nothing in, nothing out, and no exception either way", () => {
  assert.equal(branchLabel(null), "");
  assert.equal(branchLabel(undefined), "");
  assert.equal(branchLabel(""), "");
  assert.equal(branchLabel("   Erode TN  "), "Erode");
});

test("the row form reads the name off a locations record", () => {
  assert.equal(branchOptionLabel({ id: 1, name: "Erode TN" }), "Erode");
  assert.equal(branchOptionLabel(null), "");
});

/*
 * ── Searching the register ────────────────────────────────────────────────────────────────────
 *
 * The point of these is that a branch is looked up by whatever the person has in front of them:
 * a name, a code, an IFSC on a statement, a GSTIN on an invoice, part of a phone number.
 */

const erode = {
  id: 1, code: "ERODE_TN", name: "Erode TN",
  address: "12 Perundurai Road, Erode, Tamil Nadu 638011",
  gstNumber: "33ABCDE1234F1Z5", panNumber: "ABCDE1234F",
  phone: "9876543210", alternatePhone: "04242223333", email: "erode@example.com",
  bankAccountName: "Beam Craft", bankName: "Union Bank — Erode",
  bankAccountNumber: "123456789012", bankIfsc: "UBIN0801234",
};
const bangalore = { id: 2, code: "BANGALORE_KA", name: "Bangalore KA", address: null, gstNumber: null, phone: null, bankIfsc: null };

test("an empty search hides nothing", () => {
  assert.equal(branchMatchesSearch(erode, ""), true);
  assert.equal(branchMatchesSearch(erode, "   "), true);
  assert.equal(branchMatchesSearch(bangalore, ""), true);
  assert.deepEqual(branchesMatchingSearch([erode, bangalore], "").map((row) => row.id), [1, 2]);
});

test("a branch is found by anything it is written down as", () => {
  for (const query of ["erode", "ERODE", "erode tn", "erode  tn", "ERODE_TN", "perundurai", "33ABCDE1234F1Z5", "abcde1234f", "ubin0801234", "union bank", "erode@example.com", "beam craft"]) {
    assert.equal(branchMatchesSearch(erode, query), true, query);
  }
  assert.equal(branchMatchesSearch(erode, "tiruppur"), false);
  assert.equal(branchMatchesSearch(bangalore, "erode"), false);
});

test("a number is matched on its digits, however it was typed", () => {
  // Read off a statement with spaces in it; stored without them.
  assert.equal(branchMatchesSearch(erode, "98765 43210"), true);
  assert.equal(branchMatchesSearch(erode, "9876-543210"), true);
  assert.equal(branchMatchesSearch(erode, "1234 5678 9012"), true, "part of an account number");
  assert.equal(branchMatchesSearch(erode, "0424"), true, "the second number");
  assert.equal(branchMatchesSearch(erode, "555000"), false);
  // A branch with none of those numbers is not dragged in by a digit search.
  assert.equal(branchMatchesSearch(bangalore, "9876"), false);
});

test("a search with letters in it stays a text search", () => {
  // "1234F" is text, so it is not folded to digits and matched against the account number.
  assert.equal(branchMatchesSearch(erode, "1234f"), true, "it is in the PAN, as text");
  assert.equal(branchMatchesSearch(erode, "z9999"), false);
});

test("a missing field never matches and never throws", () => {
  assert.equal(branchMatchesSearch(bangalore, "bangalore"), true);
  assert.equal(branchMatchesSearch({}, "anything"), false);
  assert.equal(branchMatchesSearch(null, "anything"), false);
  assert.deepEqual(branchesMatchingSearch(null, "erode"), []);
  assert.deepEqual(branchesMatchingSearch([erode, bangalore], "ka").map((row) => row.id), [2]);
});
