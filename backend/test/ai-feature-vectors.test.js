const test = require("node:test");
const assert = require("node:assert/strict");
const vectors = require("../src/modules/ai-feature/shared/vectors");

test("a vector survives encode and decode as a unit vector", () => {
  const encoded = vectors.encode([3, 4, 0, 0]);
  const decoded = vectors.decode(encoded);
  assert.equal(decoded.length, 4);
  assert.ok(Math.abs(decoded[0] - 0.6) < 1e-6);
  assert.ok(Math.abs(decoded[1] - 0.8) < 1e-6);
  assert.ok(Math.abs(vectors.similarity(decoded, decoded) - 1) < 1e-6);
});

test("similarity is the cosine of two unit vectors", () => {
  const a = vectors.normalize([1, 0]); const b = vectors.normalize([0, 1]); const c = vectors.normalize([1, 1]);
  assert.ok(Math.abs(vectors.similarity(a, b)) < 1e-6);
  assert.ok(Math.abs(vectors.similarity(a, c) - Math.SQRT1_2) < 1e-6);
});

test("the running centroid moves toward a new member and stays unit length", () => {
  const first = vectors.normalize([1, 0]);
  const next = vectors.updateCentroid(first, 1, vectors.normalize([0, 1]));
  assert.ok(Math.abs(next[0] - next[1]) < 1e-6);
  assert.ok(Math.abs(vectors.similarity(next, next) - 1) < 1e-6);
  assert.deepEqual(Array.from(vectors.updateCentroid(null, 0, [0, 2])), [0, 1]);
});

test("bands follow the event's two thresholds", () => {
  const thresholds = { high: 0.62, medium: 0.48 };
  assert.equal(vectors.bandFor(0.7, thresholds), "HIGH");
  assert.equal(vectors.bandFor(0.62, thresholds), "HIGH");
  assert.equal(vectors.bandFor(0.5, thresholds), "MEDIUM");
  assert.equal(vectors.bandFor(0.2, thresholds), "LOW");
});

test("topMatches ranks candidates best first and honours the floor", () => {
  const query = vectors.normalize([1, 0]);
  const candidates = [{ id: "far", vector: vectors.normalize([0, 1]) }, { id: "near", vector: vectors.normalize([1, 0.1]) }, { id: "mid", vector: vectors.normalize([1, 1]) }];
  const ranked = vectors.topMatches(query, candidates, { k: 5, floor: 0.5 });
  assert.deepEqual(ranked.map((hit) => hit.id), ["near", "mid"]);
  assert.equal(vectors.topMatches(query, candidates, { k: 1 }).length, 1);
});
