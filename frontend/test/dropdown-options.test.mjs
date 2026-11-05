import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOptions, sortOptionsByLabel } from "../src/lib/dropdownOptions.mjs";

// The bug this exists for: the CRM's shoot types are a plain list of strings, and the Shoot Type
// picker in Event Details rendered a menu of blank rows because a string has no `.label`.
test("a plain list of strings becomes label/value pairs", () => {
  assert.deepEqual(normalizeOptions(["Haldi", "Wedding", "Reception"]), [
    { label: "Haldi", value: "Haldi" },
    { label: "Wedding", value: "Wedding" },
    { label: "Reception", value: "Reception" },
  ]);
});

test("options already given as pairs are passed through untouched", () => {
  const options = [{ label: "Dum Dum", value: "dum-dum" }, { label: "Corp", value: "corp", disabled: true }];
  assert.deepEqual(normalizeOptions(options), options);
});

// A label has to be a string for the menu's own search to lowercase it, but the value keeps the
// type it came in as, so a numeric option still matches the state holding it.
test("a numeric option keeps its value and gains a string label", () => {
  assert.deepEqual(normalizeOptions([0, 5, 10]), [
    { label: "0", value: 0 },
    { label: "5", value: 5 },
    { label: "10", value: 10 },
  ]);
});

test("nothing to offer is an empty list rather than a throw", () => {
  assert.deepEqual(normalizeOptions([]), []);
  assert.deepEqual(normalizeOptions(), []);
  assert.deepEqual(normalizeOptions(null), []);
  assert.deepEqual(normalizeOptions("Haldi"), []);
});

// A gap in the list would otherwise reach `option.value` on null and take the menu down with it.
test("blanks in the list are dropped", () => {
  assert.deepEqual(normalizeOptions(["Haldi", null, undefined, "Wedding"]), [
    { label: "Haldi", value: "Haldi" },
    { label: "Wedding", value: "Wedding" },
  ]);
});

// An empty string is a real option - the "no shoot type chosen" row - so it must survive.
test("an empty string stays an option", () => {
  assert.deepEqual(normalizeOptions([""]), [{ label: "", value: "" }]);
});

// The menu shows options in alphabetical order whatever order the caller holds them in; callers
// pass master data as it was typed, and the menu is where the order becomes visible.
test("options are sorted by label, ascending and case-insensitive", () => {
  const sorted = sortOptionsByLabel(normalizeOptions(["Wedding", "haldi", "Reception"]));
  assert.deepEqual(sorted.map((option) => option.label), ["haldi", "Reception", "Wedding"]);
});

test("digits in labels compare as numbers, not letters", () => {
  const sorted = sortOptionsByLabel(normalizeOptions(["Shoot 10", "Shoot 2", "Shoot 1"]));
  assert.deepEqual(sorted.map((option) => option.label), ["Shoot 1", "Shoot 2", "Shoot 10"]);
});

test("sorting returns a new list and leaves the caller's untouched", () => {
  const options = normalizeOptions(["B", "A"]);
  const sorted = sortOptionsByLabel(options);
  assert.deepEqual(sorted.map((option) => option.label), ["A", "B"]);
  assert.deepEqual(options.map((option) => option.label), ["B", "A"]);
});
