import assert from "node:assert/strict";
import test from "node:test";
import { getAutoConcurrency, readProcessingSettings } from "../src/lib/imageSelectionProcessingSettings.mjs";

/** A stand-in for the browser, so the machine-sizing rule can be exercised off a page. */
function withNavigator(values, run) {
  const previous = globalThis.navigator;
  Object.defineProperty(globalThis, "navigator", { value: values, configurable: true, writable: true });
  try { return run(); } finally { Object.defineProperty(globalThis, "navigator", { value: previous, configurable: true, writable: true }); }
}

// The preview quality is no longer this computer's own choice: it is the studio's preset pair per
// module (Visual Curation Settings → Processing / Compression). What is left here is how many
// photos this machine works on at once, and that is derived, never stored.
test("the concurrency is sized to the machine - half the cores, capped by memory, between 2 and 16", () => {
  assert.equal(withNavigator({ hardwareConcurrency: 8, deviceMemory: 8 }, getAutoConcurrency), 4);
  assert.equal(withNavigator({ hardwareConcurrency: 16, deviceMemory: 8 }, getAutoConcurrency), 8);
  assert.equal(withNavigator({ hardwareConcurrency: 32, deviceMemory: 64 }, getAutoConcurrency), 16, "capped at 16");
  assert.equal(withNavigator({ hardwareConcurrency: 8, deviceMemory: 1 }, getAutoConcurrency), 2, "a 1 GB machine never queues eight decodes");
  assert.equal(withNavigator({ hardwareConcurrency: 2, deviceMemory: 8 }, getAutoConcurrency), 2, "never below 2");
  assert.equal(withNavigator({}, getAutoConcurrency), 2, "unknown cores and memory read as a small machine");
  assert.equal(withNavigator(undefined, getAutoConcurrency), 4, "no navigator at all - the server - answers the old default");
});

test("the settings answer nothing but the concurrency: no quality is read from this machine any more", () => {
  const settings = withNavigator({ hardwareConcurrency: 8, deviceMemory: 8 }, readProcessingSettings);
  assert.deepEqual(settings, { concurrency: 4 });
});
