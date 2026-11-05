import assert from "node:assert/strict";
import test from "node:test";

import { normalizeOptions, typeaheadIndex } from "../src/lib/dropdownOptions.mjs";

/*
 * Type-to-select: the rule a dropdown follows when somebody types at it.
 *
 * A list answered the arrows, Enter and Home/End, which is enough to operate one but not enough to
 * use one: a shoot type list is a dozen entries, and arrowing to the right one is a dozen presses
 * for something the person can already name. A native `<select>` has always done this, so it is the
 * behaviour people bring with them to anything that looks like one — and these are its rules, not
 * an invention.
 */

const SHOOT_TYPES = normalizeOptions(["Studio / In-House", "Outdoor", "Destination", "Studio / Rented", "Drone"]);
const label = (index) => (index === -1 ? null : SHOOT_TYPES[index].label);

test("a letter goes to the first option starting with it", () => {
  assert.equal(label(typeaheadIndex(SHOOT_TYPES, "o", -1)), "Outdoor");
  assert.equal(label(typeaheadIndex(SHOOT_TYPES, "d", -1)), "Destination");
  // Case is not part of what was meant: the list is Capitalised and nobody types it that way.
  assert.equal(label(typeaheadIndex(SHOOT_TYPES, "S", -1)), "Studio / In-House");
});

test("letters typed together make a word, narrowing rather than moving on", () => {
  // `d` alone is Destination; `dr` is Drone. The second letter narrows the same run.
  assert.equal(label(typeaheadIndex(SHOOT_TYPES, "d", -1)), "Destination");
  assert.equal(label(typeaheadIndex(SHOOT_TYPES, "dr", 2)), "Drone");
  // And a word searches from the top, so it finds its answer wherever the highlight happens to be.
  assert.equal(label(typeaheadIndex(SHOOT_TYPES, "dr", 4)), "Drone");
  assert.equal(label(typeaheadIndex(SHOOT_TYPES, "out", 0)), "Outdoor");
});

test("the same letter repeated walks that letter's options", () => {
  // `s` reaches the first Studio, `ss` the second, `sss` back round to the first - a repeat is a
  // second press of one letter, never a search for a doubled one.
  const first = typeaheadIndex(SHOOT_TYPES, "s", -1);
  assert.equal(label(first), "Studio / In-House");
  const second = typeaheadIndex(SHOOT_TYPES, "ss", first);
  assert.equal(label(second), "Studio / Rented");
  assert.equal(label(typeaheadIndex(SHOOT_TYPES, "sss", second)), "Studio / In-House");
});

test("a single letter moves on from where the highlight is", () => {
  // Pressing `s` while sitting on the first Studio reaches the next one rather than sticking.
  assert.equal(label(typeaheadIndex(SHOOT_TYPES, "s", 0)), "Studio / Rented");
  // With only one match it comes back round to it rather than reporting nothing.
  assert.equal(label(typeaheadIndex(SHOOT_TYPES, "o", 1)), "Outdoor");
});

test("it matches the start of an option, never the middle of one", () => {
  // The `s` in "In-House" and the `t` in "Outdoor" are not what somebody typing means.
  assert.equal(typeaheadIndex(normalizeOptions(["Album Designing"]), "s", -1), -1);
  assert.equal(typeaheadIndex(normalizeOptions(["Album Designing"]), "a", -1), 0);
});

test("nothing that starts with it means the highlight does not move", () => {
  // -1 rather than 0: a mistyped letter must cost nothing, and jumping to the top of the list is
  // not nothing - it is a different answer sitting under Enter.
  assert.equal(typeaheadIndex(SHOOT_TYPES, "z", 2), -1);
  assert.equal(typeaheadIndex([], "a", -1), -1);
  assert.equal(typeaheadIndex(SHOOT_TYPES, "", 1), -1);
  assert.equal(typeaheadIndex(null, "a", -1), -1);
});

test("separators and headings are stepped over, as they are by the arrows", () => {
  /*
   * A grouped list carries `{ heading }` and `{ separator }` rows, and `Dropdown` marks both
   * disabled so the arrow keys skip them. Typing has to skip them for the same reason: neither is
   * an answer, and landing on one would put Enter over nothing.
   */
  const grouped = [
    { heading: "Studio", disabled: true },
    { label: "Studio / In-House", value: "in" },
    { separator: true, disabled: true },
    { heading: "Dum Dum", disabled: true },
    { label: "Destination", value: "dest" },
  ];
  assert.equal(grouped[typeaheadIndex(grouped, "s", -1)].label, "Studio / In-House");
  // "Dum Dum" starts with d and is a heading, so d has to reach Destination past it.
  assert.equal(grouped[typeaheadIndex(grouped, "d", -1)].label, "Destination");
});

test("a disabled option is not an answer", () => {
  const options = [{ label: "Outdoor", value: "out", disabled: true }, { label: "Overseas", value: "ovr" }];
  assert.equal(options[typeaheadIndex(options, "o", -1)].label, "Overseas");
});

test("Yes and No are reached by their own first letter", () => {
  // The case the studio actually asked about: the Yes/No dropdowns all over Settings.
  const booleans = normalizeOptions([{ label: "Yes", value: "true" }, { label: "No", value: "false" }]);
  assert.equal(booleans[typeaheadIndex(booleans, "y", -1)].value, "true");
  assert.equal(booleans[typeaheadIndex(booleans, "n", -1)].value, "false");
});
