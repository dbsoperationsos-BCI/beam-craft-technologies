import assert from "node:assert/strict";
import test from "node:test";
import { timeAgo, updatedAgo } from "../src/lib/relativeTime.mjs";

const NOW = Date.parse("2026-09-04T12:00:00.000Z");
const ago = (seconds) => timeAgo(new Date(NOW - seconds * 1000), NOW);

test("anything within the last minute reads as just now", () => {
  assert.equal(ago(0), "just now");
  assert.equal(ago(44), "just now");
});

test("minutes, hours and days each get their own short unit", () => {
  assert.equal(ago(45), "1 min. ago");
  assert.equal(ago(5 * 60), "5 min. ago");
  assert.equal(ago(60 * 60), "1 h ago");
  assert.equal(ago(3 * 60 * 60 + 100), "3 h ago");
  assert.equal(ago(24 * 60 * 60), "1 d ago");
  assert.equal(ago(6 * 24 * 60 * 60), "6 d ago");
});

test("months and years, the way the reference comment reads", () => {
  assert.equal(ago(30 * 24 * 60 * 60), "1 mo. ago");
  assert.equal(ago(80 * 24 * 60 * 60), "2 mo. ago");
  assert.equal(ago(400 * 24 * 60 * 60), "1 y ago");
});

test("a clock running behind the server never reads as the future", () => {
  assert.equal(timeAgo(new Date(NOW + 90 * 1000), NOW), "just now");
});

test("a string timestamp is accepted, and nonsense answers nothing", () => {
  assert.equal(timeAgo("2026-09-04T11:00:00.000Z", NOW), "1 h ago");
  assert.equal(timeAgo("not a date", NOW), "");
  assert.equal(timeAgo(null, NOW), "");
  assert.equal(timeAgo(undefined, NOW), "");
});

const updatedNow = Date.parse("2026-09-26T12:00:00Z");
const before = (seconds) => new Date(updatedNow - seconds * 1000).toISOString();

test("the workspace's Updated label reads the same for the project and the album", () => {
  assert.equal(updatedAgo(null, updatedNow), "recently");
  assert.equal(updatedAgo(before(30), null), "recently");
  assert.equal(updatedAgo("not a date", updatedNow), "recently");
  assert.equal(updatedAgo(before(30), updatedNow), "just now");
  assert.equal(updatedAgo(before(60), updatedNow), "1 min ago");
  assert.equal(updatedAgo(before(5 * 60), updatedNow), "5 mins ago");
  assert.equal(updatedAgo(before(3 * 3600), updatedNow), "3 hours ago");
  assert.equal(updatedAgo(before(26 * 3600), updatedNow), "1 day ago");
  assert.equal(updatedAgo(new Date(updatedNow + 5000), updatedNow), "just now", "a clock slightly behind the server is still now");
});
