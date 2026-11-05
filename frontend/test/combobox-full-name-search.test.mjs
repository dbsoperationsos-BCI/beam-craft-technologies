import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Typing a name in full finds it, the way typing part of it does.
 *
 * The list was filtered unless the text matched an option exactly, on the reading that an exact
 * match is a choice already made rather than a search. That is right when the field is reopened on
 * a saved answer - the other districts have to stay reachable - and wrong while somebody is typing:
 * "Coimbatore" in full listed every district, and rubbing out the last letter narrowed it to the
 * one. The same action twice, two different answers.
 *
 * So it asks who put the text there instead: typing searches, opening the field or choosing from it
 * shows the whole list again. One shared field, so District, State and every other combo box on the
 * OS behave alike.
 */
const COMBO = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "shared", "ComboBoxField.js"), "utf8");

test("what is typed filters the list, whatever it comes to", () => {
  assert.match(COMBO, /const shown = typed && searching \? options\.filter\(\(option\) => matchesWordChunks\(option, typed\)\) : options;/);
  // The old rule is gone: an exact match is no longer a reason to show everything.
  assert.doesNotMatch(COMBO, /const exact = options\.some/);
  assert.match(COMBO, /setSearching\(true\);/);
});

test("an answer already given opens the whole list again", () => {
  // Opening the field, choosing with the mouse, and choosing with Enter all end the search.
  assert.match(COMBO, /onFocus=\{\(\) => \{ if \(!inert\) \{ setSearching\(false\); setOpen\(true\); \} \}\}/);
  assert.equal((COMBO.match(/setSearching\(false\);/g) || []).length, 3);
});
