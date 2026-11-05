import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { classifyTouch, isDoubleTap, SWIPE_MIN_PX, TAP_MAX_PX, TAP_MAX_MS, DOUBLE_TAP_MS, DOUBLE_TAP_PX } from "../src/lib/viewerGesture.mjs";

const VIEWER = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "image-selection", "client-gallery", "ImageViewer.js"), "utf8");

test("a swipe is a clear horizontal move: left is next, right is previous", () => {
  assert.equal(classifyTouch({ dx: -80, dy: 10, ms: 200 }), "next");
  assert.equal(classifyTouch({ dx: 80, dy: -10, ms: 200 }), "prev");
  assert.equal(classifyTouch({ dx: -SWIPE_MIN_PX, dy: 0, ms: 900 }), "next", "a slow swipe is still a swipe");
  assert.equal(classifyTouch({ dx: -(SWIPE_MIN_PX - 1), dy: 0, ms: 200 }), null, "short of the threshold is nothing");
});

test("a mostly vertical drag is never navigation", () => {
  assert.equal(classifyTouch({ dx: -60, dy: 90, ms: 200 }), null);
  assert.equal(classifyTouch({ dx: 70, dy: 70, ms: 200 }), null, "a diagonal does not count");
});

test("a tap barely moves and is short; one gesture is never both", () => {
  assert.equal(classifyTouch({ dx: 3, dy: -4, ms: 120 }), "tap");
  assert.equal(classifyTouch({ dx: TAP_MAX_PX, dy: TAP_MAX_PX, ms: TAP_MAX_MS }), "tap");
  assert.equal(classifyTouch({ dx: 0, dy: 0, ms: TAP_MAX_MS + 1 }), null, "a long press is not a tap");
  assert.equal(classifyTouch({ dx: 25, dy: 0, ms: 150 }), null, "a drift is neither");
  for (const dx of [-200, -60, 60, 200]) assert.notEqual(classifyTouch({ dx, dy: 0, ms: 100 }), "tap");
});

test("the viewer uses its own handlers, on phones only, and keeps every other control", () => {
  // The arrows over the picture are not drawn below `sm`; the bottom bar is untouched.
  assert.equal((VIEWER.match(/z-10 hidden h-10 w-10 [^"]*sm:grid"/g) || []).length, 2);
  assert.match(VIEWER, /<button type="button" onClick=\{onPrev\} disabled=\{!hasPrev\} aria-label="Previous"/);
  assert.match(VIEWER, /<button type="button" onClick=\{onNext\} disabled=\{!hasNext\} aria-label="Next"/);
  // Gestures only below the same breakpoint, through the same three handlers and the same stops.
  assert.match(VIEWER, /const PHONE_QUERY = "\(max-width: 639px\)";/);
  assert.match(VIEWER, /if \(gesture === "next" && hasNext\) onNext\(\);\s*\n\s*else if \(gesture === "prev" && hasPrev\) onPrev\(\);/);
  assert.doesNotMatch(VIEWER, /preventDefault\(\)[^\n]*touch|touch[^\n]*preventDefault\(\)/, "no touch is prevented");
  assert.match(VIEWER, /\{feedback\?\.id === image\.id && <div aria-hidden="true" className="pointer-events-none absolute inset-0/, "never lingers over the next photo, never takes a finger");
  // Keyboard navigation for larger screens is still there.
  assert.match(VIEWER, /event\.key === "ArrowLeft" && hasPrev/);
});

test("the pick feedback follows the real result: shown only when the photo actually flipped", () => {
  // A tap only asks; the render that sees `image.selected` change turns it into feedback.
  assert.match(VIEWER, /asked\.from !== Boolean\(image\.selected\)\) \{\s*\n\s*setFeedback\(\{ kind: image\.selected \? "selected" : "unselected"/);
  // Moving to another photo drops what the last one asked or showed.
  assert.match(VIEWER, /if \(seen\.id !== image\.id\) \{[\s\S]{0,200}setAsked\(null\);\s*\n\s*setFeedback\(null\);/);
  // No cross for an unpick, and no second selection state: the feedback is only ever transient.
  assert.doesNotMatch(VIEWER, /icons-material\/Close/);
  assert.equal((VIEWER.match(/onToggleSelect\(image\)/g) || []).length, 3, "tap, tick, keyboard - the one handler");
  // The bottom tick shares it on a phone only; larger screens are unchanged.
  assert.match(VIEWER, /onClick=\{\(\) => \{ if \(isPhone\(\)\) askFeedback\(\); onToggleSelect\(image\); \}\}/);
});

test("the animation is transform and opacity only, with a reduced-motion fade", () => {
  const css = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "app", "globals.css"), "utf8");
  const block = css.slice(css.indexOf("@keyframes selection-confirm"), css.indexOf("/* Keep icon-only controls"));
  for (const name of ["selection-confirm", "selection-ring", "selection-release", "selection-press"]) assert.match(block, new RegExp(`@keyframes ${name}`));
  assert.doesNotMatch(block, /filter:|width:|height:|top:|left:|margin/, "nothing that reflows or blurs");
  assert.match(block, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: selection-fade 220ms linear both;/);
});

test("a double tap is two taps close in time and place", () => {
  const first = { at: 1000, x: 100, y: 200 };
  assert.equal(isDoubleTap(null, first), false, "a first tap is only a first tap");
  assert.equal(isDoubleTap(first, { at: 1000 + DOUBLE_TAP_MS, x: 110, y: 210 }), true);
  assert.equal(isDoubleTap(first, { at: 1000 + DOUBLE_TAP_MS + 1, x: 100, y: 200 }), false, "too slow");
  assert.equal(isDoubleTap(first, { at: 1100, x: 100 + DOUBLE_TAP_PX + 1, y: 200 }), false, "too far");
});

test("on a phone a single tap does nothing, a double tap only picks, and unpicking is the tick's alone", () => {
  const branch = VIEWER.slice(VIEWER.indexOf('else if (gesture === "tap") {'), VIEWER.indexOf("\n  }\n", VIEWER.indexOf('else if (gesture === "tap") {')));
  assert.match(branch, /if \(!isDoubleTap\(lastTapRef\.current, tap\)\) \{ lastTapRef\.current = tap; return; \}/, "a single tap only waits for the second");
  assert.match(branch, /if \(image\.selected \|\| !source \|\| pickingRef\.current\) return;/, "never unpicks, never on the placeholder, one pick at a time");
  assert.match(branch, /Promise\.resolve\(onToggleSelect\(image\)\)\.finally\(\(\) => \{ pickingRef\.current = false; \}\);/);
  // A swipe ends any double tap in progress.
  assert.match(VIEWER, /if \(gesture !== "tap"\) lastTapRef\.current = null;/);
  // The bottom tick still picks and unpicks.
  assert.match(VIEWER, /onClick=\{\(\) => \{ if \(isPhone\(\)\) askFeedback\(\); onToggleSelect\(image\); \}\}/);
  // The browser's own double-tap zoom is held off on the photo on a phone; pinch stays.
  assert.match(VIEWER, /bg-slate-50 max-sm:touch-manipulation/);
});
