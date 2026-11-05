import test from "node:test";
import assert from "node:assert/strict";
import { matchesWordChunks, wordChunks } from "../src/lib/wordChunks.mjs";

// Word Chunk Search: every chunk of what was typed appears somewhere, in any order, ignoring case.

test("the typed text splits into lowercase chunks at any run of spaces", () => {
  assert.deepEqual(wordChunks("  Lok  NAI "), ["lok", "nai"]);
  assert.deepEqual(wordChunks(""), []);
  assert.deepEqual(wordChunks(null), []);
});

test("the examples the studio asked for", () => {
  assert.equal(matchesWordChunks("Lokesh Naidu", "naidu lokesh"), true);
  assert.equal(matchesWordChunks("Lokesh Naidu", "lok nai"), true);
  for (const name of ["Lokesh Naidu", "Karthik Naidu", "Revathi Naidu", "Sathish Naidu"]) assert.equal(matchesWordChunks(name, "nai"), true);
  assert.equal(matchesWordChunks("Lokesh Murugan", "nai"), false);
  assert.equal(matchesWordChunks("DBS-17", "dbs 17"), true);
  assert.equal(matchesWordChunks("lokesh.naidu41@gmail.com", "gmail lokesh"), true);
  assert.equal(matchesWordChunks("Lokesh Naidu", "lok xyz"), false);
});

test("a blank search keeps everything, and an empty value matches only a blank search", () => {
  assert.equal(matchesWordChunks("anything", "   "), true);
  assert.equal(matchesWordChunks("", "lok"), false);
  assert.equal(matchesWordChunks(undefined, ""), true);
});

// Every search box and table filter on the screen goes through this rule: whatever is typed is matched
// as the characters typed - punctuation, symbols and other scripts included - never as a pattern.
test("special characters are matched as themselves, in every search and table filter", () => {
  const rows = ["WED other studio", "John's Album", "A&B Studio", "Order #123", "100% done", "1000 photos", "file_name.jpg", "fileXname.jpg", "C++ workshop", "a/b split", "\"quoted text\" here", "<test> tag", "back\slash", "ராஜா திருமணம்"];
  const found = (query) => rows.filter((row) => matchesWordChunks(row, query));
  assert.deepEqual(found("WED other"), ["WED other studio"]);
  assert.deepEqual(found("we ot"), ["WED other studio"]);
  assert.deepEqual(found("John's Album"), ["John's Album"]);
  assert.deepEqual(found("A&B Studio"), ["A&B Studio"]);
  assert.deepEqual(found("#123"), ["Order #123"]);
  assert.deepEqual(found("100%"), ["100% done"]);
  assert.deepEqual(found("file_name"), ["file_name.jpg"]);
  assert.deepEqual(found("C++"), ["C++ workshop"]);
  assert.deepEqual(found("a/b"), ["a/b split"]);
  assert.deepEqual(found("\"quoted text\""), ["\"quoted text\" here"]);
  assert.deepEqual(found("<test>"), ["<test> tag"]);
  assert.deepEqual(found("back\slash"), ["back\slash"]);
  assert.deepEqual(found("ராஜா"), ["ராஜா திருமணம்"]);
  assert.deepEqual(found("~!@#$%^&*()_+-={}[]:;\"'?,./\|"), []);
  assert.deepEqual(found("' OR 1=1 --"), []);
  assert.deepEqual(found("   "), rows, "spaces only is no filter");
  assert.deepEqual(found(""), rows);
});
