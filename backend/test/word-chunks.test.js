const test = require("node:test");
const assert = require("node:assert/strict");
const { wordChunks, everyChunk, matchesWordChunks } = require("../src/services/wordChunks");

// Word Chunk Search: every chunk typed appears somewhere, in any order - the screen's rule, on the server.

test("chunks split at any run of spaces, and a pasted paragraph is capped", () => {
  assert.deepEqual(wordChunks("  Lok  NAI "), ["Lok", "NAI"]);
  assert.deepEqual(wordChunks(""), []);
  assert.equal(wordChunks("a b c d e f g h i j").length, 8);
});

test("one clause per chunk, each over every column", () => {
  const clauses = everyChunk("naidu lokesh", (chunk) => ({ OR: [{ name: { contains: chunk } }, { email: { contains: chunk } }] }));
  assert.deepEqual(clauses, [
    { OR: [{ name: { contains: "naidu" } }, { email: { contains: "naidu" } }] },
    { OR: [{ name: { contains: "lokesh" } }, { email: { contains: "lokesh" } }] },
  ]);
  assert.deepEqual(everyChunk("   ", () => ({})), []);
});

test("the examples the studio asked for", () => {
  assert.equal(matchesWordChunks("Lokesh Naidu", "naidu lokesh"), true);
  assert.equal(matchesWordChunks("Lokesh Naidu", "lok nai"), true);
  assert.equal(matchesWordChunks("DBS-17", "dbs 17"), true);
  assert.equal(matchesWordChunks("lokesh.naidu41@gmail.com", "gmail lokesh"), true);
  assert.equal(matchesWordChunks("Lokesh Naidu", "lok xyz"), false);
});
