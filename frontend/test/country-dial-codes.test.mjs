import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_DIAL_CODE,
  DIAL_CODE_OPTIONS,
  countryByDial,
  countryByIso,
  flagFor,
} from "../src/lib/countryDialCodes.js";

/*
 * The country picker beside every phone field.
 *
 * Two things decide whether it behaves: the flag has to come out of the country's own letters
 * without shipping an image, and a code that several countries share must not silently move a
 * lead from one country to another.
 */

test("India is the default and leads the list", () => {
  // The studio's clients are overwhelmingly Indian, so it is what a field starts on and the
  // first thing reached for.
  assert.equal(DEFAULT_DIAL_CODE, "+91");
  assert.equal(DIAL_CODE_OPTIONS[0].value, "IN");
  assert.equal(DIAL_CODE_OPTIONS[0].dial, "+91");
});

test("a flag is built from the country's own two letters", () => {
  // Regional-indicator pairs, which an emoji font draws as a flag - no sprite sheet, no package.
  assert.equal(flagFor("IN"), "🇮🇳");
  assert.equal(flagFor("gb"), "🇬🇧");
  assert.equal(flagFor("AE"), "🇦🇪");
  // Anything that is not a country code produces nothing rather than a stray glyph.
  assert.equal(flagFor("XYZ"), "");
  assert.equal(flagFor("1"), "");
  assert.equal(flagFor(""), "");
  assert.equal(flagFor(null), "");
});

test("every option carries a flag, a name and a code", () => {
  for (const option of DIAL_CODE_OPTIONS) {
    assert.match(option.value, /^[A-Z]{2}$/, `${option.name} has a malformed ISO code`);
    assert.match(option.dial, /^\+\d{1,4}$/, `${option.name} has a malformed dialling code`);
    assert.ok(option.name, "every option needs a name to be searched by");
    assert.ok(option.flag, `${option.name} produced no flag`);
    // The row is what a search matches against, so it has to carry all three.
    assert.ok(option.label.includes(option.name) && option.label.includes(option.dial));
  }
});

test("no country is listed twice", () => {
  const seen = new Set();
  for (const option of DIAL_CODE_OPTIONS) {
    assert.equal(seen.has(option.value), false, `${option.value} is listed more than once`);
    seen.add(option.value);
  }
});

test("a shared dialling code resolves to one country, predictably", () => {
  // +1 is the United States, Canada and Puerto Rico. Resolving by code alone has to be stable,
  // and the field remembers the chosen country separately so a picked Canada stays Canada.
  const plusOne = DIAL_CODE_OPTIONS.filter((option) => option.dial === "+1").map((option) => option.value);
  assert.ok(plusOne.length > 1, "the fixture assumes +1 is shared");
  assert.equal(countryByDial("+1").value, plusOne[0]);
  assert.equal(countryByDial("+1").value, countryByDial("+1").value, "resolution must be stable");
});

test("a longer code is not mistaken for a shorter one", () => {
  // "+1264" is Anguilla, not the United States followed by stray digits.
  assert.equal(countryByDial("+1264").value, "AI");
  assert.equal(countryByDial("+91").value, "IN");
  assert.equal(countryByDial("+971").value, "AE");
});

test("an unknown code answers nothing rather than guessing", () => {
  assert.equal(countryByDial("+9999"), null);
  assert.equal(countryByDial(""), null);
  assert.equal(countryByIso("ZZ"), null);
});

test("a country can be found by its own code, in any case", () => {
  assert.equal(countryByIso("in")?.dial, "+91");
  assert.equal(countryByIso("IN")?.name, "India");
});
