import test from "node:test";
import assert from "node:assert/strict";

import { ACTIVITY_EVENTS, HEARTBEAT_MS, IDLE_AFTER_MS, isActive } from "../src/lib/usageHeartbeat.js";

/*
 * When the application counts as being used.
 *
 * This is the whole of what the usage reports now measure, so it is the rule most worth pinning
 * down. It replaced an inference - the gaps between somebody's recorded actions - which credited
 * them with every minute spent in another application between two saved leads.
 *
 * Two conditions, and the report is only honest while both are required.
 */

const NOW = 1_700_000_000_000;

test("a visible tab someone is using counts", () => {
  assert.equal(isActive({ visible: true, lastInteractionAt: NOW - 1000, now: NOW }), true);
});

test("a tab in the background never counts, however recently it was touched", () => {
  /*
   * The condition the old measure had no way of expressing. An application behind another window
   * is not being used no matter how much is going on inside it - a poll firing every few seconds
   * is the application working, not a person.
   */
  assert.equal(isActive({ visible: false, lastInteractionAt: NOW, now: NOW }), false);
  assert.equal(isActive({ visible: false, lastInteractionAt: NOW - 1, now: NOW }), false);
});

test("a tab nobody has touched for a while stops counting", () => {
  // Otherwise a tab left open on an empty desk reports a full working day.
  assert.equal(isActive({ visible: true, lastInteractionAt: NOW - IDLE_AFTER_MS - 1, now: NOW }), false);
});

test("but reading is still using: the threshold is minutes, not seconds", () => {
  // Somebody studying a lead's remarks or listening on a call may touch nothing for a minute or
  // two. At the edge they still count - the boundary is inclusive on purpose.
  assert.equal(isActive({ visible: true, lastInteractionAt: NOW - IDLE_AFTER_MS, now: NOW }), true);
  assert.ok(IDLE_AFTER_MS >= 60_000, "a threshold under a minute would record a reader as having stopped");
});

test("a page opened and never touched is not usage", () => {
  // Restored into a background tab, or opened and left. Nothing has happened, so nothing counts.
  assert.equal(isActive({ visible: true, lastInteractionAt: null, now: NOW }), false);
  assert.equal(isActive({ visible: true, lastInteractionAt: 0, now: NOW }), false);
});

test("nothing at all is not usage", () => {
  assert.equal(isActive({}), false);
  assert.equal(isActive(), false);
});

test("the beat is frequent enough to be worth measuring in minutes", () => {
  // Each beat is evidence of the interval behind it, so the interval is the resolution of every
  // usage figure in the reports.
  assert.ok(HEARTBEAT_MS <= 60_000, "a beat slower than a minute cannot measure a short sitting");
  assert.ok(HEARTBEAT_MS >= 10_000, "a beat faster than this is a request every few seconds, per person");
});

test("the events watched cover a mouse, a keyboard, a touchscreen and reading", () => {
  // Reading a long table is use even when nothing is clicked, and a phone moves no pointer at all.
  for (const event of ["pointermove", "pointerdown", "keydown", "scroll", "wheel", "touchstart"]) {
    assert.ok(ACTIVITY_EVENTS.includes(event), `${event} is not counted as somebody using the application`);
  }
  // `mousemove` is deliberately absent: `pointermove` already covers it, and listening to both
  // doubles the work on the busiest event a browser has.
  assert.equal(ACTIVITY_EVENTS.includes("mousemove"), false);
});
