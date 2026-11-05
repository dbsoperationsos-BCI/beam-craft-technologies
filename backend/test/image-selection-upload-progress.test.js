const test = require("node:test");
const assert = require("node:assert/strict");
const { serializeBatch } = require("../src/modules/image-selection/uploads/progress");

const batch = (overrides) => ({ totalFiles: 18, uploadedFiles: 0, compressedFiles: 0, failedFiles: 0, status: "UPLOADING", startedAt: new Date(Date.now() - 60_000), ...overrides });

test("a batch with nothing done yet reports no progress", () => {
  const result = serializeBatch(batch({}));
  assert.equal(result.overallProgress, 0);
  assert.equal(result.remainingQueue, 0);
});

test("every photo sent but one still compressing is the 97% the card used to sit at", () => {
  // The shape of the stall: 18 sent, 17 finished, one row that nothing would ever move.
  const result = serializeBatch(batch({ uploadedFiles: 18, compressedFiles: 17 }));
  assert.equal(result.overallProgress, 97);
  assert.equal(result.remainingQueue, 1);
});

test("a completed batch reads 100% and an empty queue", () => {
  const result = serializeBatch(batch({ uploadedFiles: 18, compressedFiles: 18, status: "COMPLETED" }));
  assert.equal(result.overallProgress, 100);
  assert.equal(result.remainingQueue, 0);
  assert.equal(result.etaSeconds, 0);
});

test("a photo counted twice by a repaired batch never reads past its total", () => {
  // A run interrupted before the fix counted the arrival of its last photo but not its finish.
  // Re-sending it counts the arrival again, which must not surface as "19 of 18" or a bar past 100%.
  const result = serializeBatch(batch({ uploadedFiles: 19, compressedFiles: 18, status: "COMPLETED" }));
  assert.equal(result.uploadedFiles, 18);
  assert.equal(result.compressedFiles, 18);
  assert.equal(result.overallProgress, 100);
  assert.equal(result.remainingQueue, 0);
});

test("failures count towards the total so a batch that gave up still finishes", () => {
  const result = serializeBatch(batch({ uploadedFiles: 18, compressedFiles: 16, failedFiles: 2, status: "COMPLETED_WITH_ERRORS" }));
  assert.equal(result.overallProgress, 100);
  assert.equal(result.remainingQueue, 0);
});
