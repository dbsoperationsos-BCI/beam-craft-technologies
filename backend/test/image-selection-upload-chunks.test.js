const test = require("node:test");
const assert = require("node:assert/strict");
const { contiguousChunkCount } = require("../src/modules/image-selection/uploads/service");

test("counts an unbroken run of chunks from zero", () => {
  assert.equal(contiguousChunkCount(["0.part", "1.part", "2.part"], 3), 3);
});

test("reports nothing done until chunk zero has landed", () => {
  // The old count-the-files version answered 1 here, so the browser resumed at index 1 and
  // chunk 0 was never sent — the exact shape of the "Chunk 0 is missing." failure.
  assert.equal(contiguousChunkCount(["1.part"], 2), 0);
});

test("stops at the first gap rather than counting past it", () => {
  assert.equal(contiguousChunkCount(["0.part", "2.part", "3.part"], 4), 1);
});

test("ignores chunk files beyond the declared total", () => {
  assert.equal(contiguousChunkCount(["0.part", "1.part", "9.part"], 2), 2);
});

test("ignores anything that is not a numbered chunk", () => {
  assert.equal(contiguousChunkCount(["0.part", "notes.txt", ".DS_Store", "1.part.tmp"], 2), 1);
});

test("an empty directory means nothing has arrived", () => {
  assert.equal(contiguousChunkCount([], 3), 0);
});
