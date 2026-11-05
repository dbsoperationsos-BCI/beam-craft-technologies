import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");

test("the touchpad history swipe is off while any overlay is open, in every browser", () => {
  const css = read("app", "globals.css");
  assert.match(css, /html:has\(\[role="dialog"\], \[aria-modal="true"\]\),\nhtml:has\(\[role="dialog"\], \[aria-modal="true"\]\) body \{\n  overscroll-behavior-x: none;/);
  const guard = read("components", "shared", "SwipeNavigationGuard.js");
  assert.match(guard, /window\.addEventListener\("wheel", onWheel, \{ passive: false \}\)/);
  // Only a sideways swipe, only with an overlay open, and never where something can still scroll.
  assert.match(guard, /if \(Math\.abs\(event\.deltaX\) <= Math\.abs\(event\.deltaY\)\) return;/);
  assert.match(guard, /if \(!document\.querySelector\(OVERLAY_SELECTOR\)\) return;/);
  assert.match(guard, /if \(scrollsSideways\(event\.target, event\.deltaX\)\) return;/);
  assert.match(read("app", "layout.js"), /<SwipeNavigationGuard \/>/);
});
