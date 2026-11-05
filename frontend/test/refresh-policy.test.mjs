import assert from "node:assert/strict";
import test from "node:test";
import { MIN_GAP_MS, REFRESH_INTERVALS, isStale } from "../src/lib/refreshPolicy.mjs";

test("each Visual Curation dashboard re-reads on a light interval of its own, never every second", () => {
  assert.equal(REFRESH_INTERVALS.imageSelection, 60_000);
  assert.equal(REFRESH_INTERVALS.albumProofing, 60_000);
  // The engine changes these numbers in the background, so the AI dashboard keeps its half minute.
  assert.equal(REFRESH_INTERVALS.aiFeature, 30_000);
  assert.ok(Object.values(REFRESH_INTERVALS).every((ms) => ms >= 30_000));
});

test("a tab flipped back within a few seconds is not stale; one left for longer is", () => {
  const now = 1_000_000;
  assert.equal(isStale(now - 2_000, now), false);
  assert.equal(isStale(now - MIN_GAP_MS, now), true);
  assert.equal(isStale(null, now), true, "nothing read yet is stale");
  assert.equal(MIN_GAP_MS, 10_000);
});
