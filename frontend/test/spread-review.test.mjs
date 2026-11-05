import assert from "node:assert/strict";
import test from "node:test";
import { hasSeenEvery, seenCount, spreadReviewKey, unseenSpreads } from "../src/lib/spreadReview.mjs";

test("progress is kept per album and per version", () => {
  assert.equal(spreadReviewKey("album-1", 2), "album-proof-reviewed:album-1:2");
  assert.notEqual(spreadReviewKey("album-1", 1), spreadReviewKey("album-1", 2));
  assert.notEqual(spreadReviewKey("album-1", 1), spreadReviewKey("album-2", 1));
  // The client is named by their own link, never by an id.
  assert.equal(spreadReviewKey("tok3n", 1), "album-proof-reviewed:tok3n:1");
  // Nothing to key by yet, while the room is still loading.
  assert.equal(spreadReviewKey(null, 1), null);
  assert.equal(spreadReviewKey("album-1", undefined), "album-proof-reviewed:album-1:current");
});

test("what is left to look at, in the order the spreads are shown", () => {
  const pages = ["a", "b", "c"];
  assert.deepEqual(unseenSpreads(pages, new Set(["b"])), ["a", "c"]);
  assert.deepEqual(unseenSpreads(pages, ["a", "b", "c"]), []);
  assert.deepEqual(unseenSpreads(pages, new Set()), pages);
  // A spread seen on an earlier round that is no longer shown does not count against these.
  assert.deepEqual(unseenSpreads(["a"], new Set(["a", "z"])), []);
});

test("the count the panel shows never exceeds what is in front of the reviewer", () => {
  assert.equal(seenCount(["a", "b", "c"], new Set(["a"])), 1);
  assert.equal(seenCount(["a", "b"], new Set(["a", "b", "z"])), 2);
  assert.equal(seenCount([], new Set(["a"])), 0);
});

test("approval waits until every spread shown has been seen", () => {
  assert.equal(hasSeenEvery(["a", "b"], new Set(["a"])), false);
  assert.equal(hasSeenEvery(["a", "b"], new Set(["a", "b"])), true);
  // A filtered round is judged on what it shows: seeing the changed spreads is enough.
  assert.equal(hasSeenEvery(["b"], new Set(["b"])), true);
  // Nothing on screen is not "all reviewed".
  assert.equal(hasSeenEvery([], new Set()), false);
  assert.equal(hasSeenEvery(undefined, new Set()), false);
});
