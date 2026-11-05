import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { MENU_GAP, MENU_MAX_HEIGHT, MENU_MIN_HEIGHT, MENU_MIN_WIDTH, VIEWPORT_EDGE, placeDropdownMenu } from "../src/lib/dropdownMenu.mjs";

/** A trigger 200px wide and 36px tall, with its top edge at `top`. */
function trigger(top, { left = 100, width = 200, height = 36 } = {}) {
  return { top, bottom: top + height, left, right: left + width, width, height };
}

const WINDOW = { viewportWidth: 1440, viewportHeight: 900 };

/*
 * An upward menu is pinned by its bottom edge and has no `top`: `maxHeight` is the ceiling it may
 * grow to, not the height it takes, so only the browser knows where its top lands. These read the
 * edges of a placement whichever way it opened, taking `maxHeight` as the worst case.
 */
const bottomEdge = (placed, viewportHeight = WINDOW.viewportHeight) =>
  placed.openUpward ? viewportHeight - placed.bottom : placed.top + placed.maxHeight;
const topEdge = (placed, viewportHeight = WINDOW.viewportHeight) =>
  placed.openUpward ? bottomEdge(placed, viewportHeight) - placed.maxHeight : placed.top;

test("with room below, the menu opens under its trigger", () => {
  const placed = placeDropdownMenu({ rect: trigger(100), ...WINDOW });
  assert.equal(placed.openUpward, false);
  assert.equal(placed.top, 140); // 100 + 36 + MENU_GAP
  assert.equal(placed.maxHeight, MENU_MAX_HEIGHT);
});

// The bug this file exists for: the Shoot Type picker sits near the foot of the lead popup, and the
// menu used to be clamped upward until it covered the row it belonged to.
test("a trigger low on the page never gets a menu over itself", () => {
  const rect = trigger(820); // bottom at 856, only ~36px of room below
  const placed = placeDropdownMenu({ rect, ...WINDOW });
  assert.equal(placed.openUpward, true, "flips above rather than clamping over the field");
  assert.ok(bottomEdge(placed) <= rect.top - MENU_GAP + 1, "the menu ends before the trigger begins");
  assert.ok(topEdge(placed) >= VIEWPORT_EDGE);
});

test("opening downward, the menu still ends inside the window", () => {
  // Enough room below to stay downward, but not a full menu's worth.
  const rect = trigger(600);
  const placed = placeDropdownMenu({ rect, ...WINDOW });
  assert.ok(placed.top + placed.maxHeight <= WINDOW.viewportHeight - VIEWPORT_EDGE + 1);
});

test("opening upward, the menu stays inside the window", () => {
  const placed = placeDropdownMenu({ rect: trigger(870), ...WINDOW });
  assert.equal(placed.openUpward, true);
  assert.ok(topEdge(placed) >= VIEWPORT_EDGE);
  assert.ok(bottomEdge(placed) <= WINDOW.viewportHeight - VIEWPORT_EDGE + 1);
});

// A trigger at the very top has nothing above it, so downward is the only choice even when the room
// there is tight — flipping would put the menu off the top of the window.
test("a trigger at the top of the window opens downward", () => {
  const placed = placeDropdownMenu({ rect: trigger(0), viewportWidth: 1440, viewportHeight: 300 });
  assert.equal(placed.openUpward, false);
  assert.ok(placed.top >= 0);
});

// Short of a full menu, it takes the room it actually has rather than a fixed height.
test("a short window gives the menu the room that is there", () => {
  const placed = placeDropdownMenu({ rect: trigger(120), viewportWidth: 1440, viewportHeight: 200 });
  assert.equal(placed.maxHeight, 108); // the 120px above, less the gap and the margin
  assert.ok(placed.maxHeight < MENU_MAX_HEIGHT);
});

// Tighter than the floor on both sides, the menu holds at the floor and scrolls internally: a
// menu sized to 40px of room would show half a row and read as broken.
test("cramped on both sides, the menu holds at its minimum", () => {
  const placed = placeDropdownMenu({ rect: trigger(60), viewportWidth: 1440, viewportHeight: 150 });
  assert.equal(placed.maxHeight, MENU_MIN_HEIGHT);
  // Held to the floor there is no room above the trigger for it, so it is pushed down to the
  // margin and overlaps the field rather than running off the top of the window.
  assert.ok(topEdge(placed, 150) >= VIEWPORT_EDGE);
  assert.ok(bottomEdge(placed, 150) <= 150 - VIEWPORT_EDGE + 1);
});

test("the menu never runs off the right edge", () => {
  const placed = placeDropdownMenu({ rect: trigger(100, { left: 1380, width: 200 }), ...WINDOW });
  assert.equal(placed.left, 1440 - 200 - VIEWPORT_EDGE);
});

test("a trigger off the left edge is pulled back to the margin", () => {
  const placed = placeDropdownMenu({ rect: trigger(100, { left: -40 }), ...WINDOW });
  assert.equal(placed.left, VIEWPORT_EDGE);
});

// Both modes match the control they hang from — the mode no longer changes the answer.
test("the menu is its trigger's width whatever the mode", () => {
  for (const width of [90, 160, 300]) {
    assert.equal(placeDropdownMenu({ rect: trigger(100, { width }), ...WINDOW }).width, width);
  }
});

/*
 * A deliberately narrow field can still open a readable menu.
 *
 * The country picker sits in a box a few characters wide. Matching the menu to it wrapped every
 * country over three lines, which is unreadable and looks broken - so a caller may ask for more
 * width than its trigger has.
 */
test("a narrow trigger can ask for a wider menu", () => {
  const narrow = trigger(100, { width: 76 });
  assert.equal(placeDropdownMenu({ rect: narrow, ...WINDOW }).width, 76, "unchanged when nothing is asked for");
  assert.equal(placeDropdownMenu({ rect: narrow, ...WINDOW, minWidth: 288 }).width, 288);
});

test("a menu never grows wider than the window, however much is asked for", () => {
  // Asking for more than fits is safe: a phone in portrait must not get a menu running off both
  // edges, and the left clamp below can only help if the width is sane to begin with.
  const placed = placeDropdownMenu({
    rect: trigger(100, { width: 76 }),
    viewportWidth: 360,
    viewportHeight: WINDOW.viewportHeight,
    minWidth: 2000,
  });
  assert.ok(placed.width <= 360 - VIEWPORT_EDGE * 2, `menu was ${placed.width} in a 360 window`);
  assert.ok(placed.left >= VIEWPORT_EDGE);
});

test("asking for less than the trigger's own width changes nothing", () => {
  assert.equal(placeDropdownMenu({ rect: trigger(100, { width: 300 }), ...WINDOW, minWidth: 100 }).width, 300);
});

/* ─────────────────────────────────────────────── the menu is the shape of its trigger ── */

/*
 * A list hanging off a control that is not the shape of that control reads as broken before anybody
 * has chosen anything from it - and that is what the calendar's source switch looked like. The
 * trigger was `inline-flex`, so with "All" selected it was about sixty pixels wide; the menu took a
 * 160px floor and came out nearly three times the width of the thing it belonged to, overhanging it
 * on the right. Choosing "Employee Attendance" then *resized the control*.
 *
 * Holding the trigger at that same 160px settled those two and bought a third fault: Client Gifts
 * switches between "Welcome Gift" and "Shoot Completed Gift", so the box was 160px of which about
 * 125 was used, and the menu - correctly matching the box - had its edges a finger's width past the
 * chevron. The floor is gone from both sides now. The trigger takes its width from its own longest
 * option, which is the number the floor was guessing at, and the menu simply matches it.
 */

test("a menu is exactly as wide as the control it hangs from", () => {
  for (const width of [128, 204, 320]) {
    const placed = placeDropdownMenu({ rect: trigger(100, { width }), ...WINDOW });
    assert.equal(placed.width, width, `a ${width}px trigger got a ${placed.width}px menu`);
    assert.equal(placed.left, 100, "the menu's left edge left its trigger's");
  }
});

test("a switch trigger is sized by its own options, not by a fixed floor", () => {
  const dropdown = fs.readFileSync(new URL("../src/components/shared/Dropdown.js", import.meta.url), "utf8");
  const switchClass = dropdown.slice(dropdown.indexOf("    : `flex w-full items-center rounded-lg bg-white font-medium"), dropdown.indexOf("  /*\n   * What the closed trigger reads"));

  assert.match(switchClass, /w-full/, "a switch that does not fill its box resizes as you choose from it");
  assert.doesNotMatch(switchClass, /min-w-\d/, "a fixed floor leaves spare width behind the chevron of every shorter switch");
  /*
   * Label and chevron stay together as one control - `justify-between` threw the arrow against the
   * far edge, a hand's width from the word it belongs to, and the pair stopped reading as one
   * thing. And no `gap` between them: the Material glyph carries its own inset already.
   */
  assert.match(switchClass, /justify-start/);
  assert.doesNotMatch(switchClass, /justify-between/);
  assert.doesNotMatch(switchClass, /gap-\d/);

  // What replaces the floor: every option's label stacked into one grid cell, all but the chosen
  // one invisible, so the box is the width of the longest of them whatever is selected.
  const sizer = dropdown.slice(dropdown.indexOf("const sizerLabels"), dropdown.indexOf("const standardTrigger"));
  assert.match(sizer, /invisible col-start-1 row-start-1/);
  assert.match(sizer, /aria-hidden="true"/, "the labels holding the width must not be read out as well");

  // Still the clamp for a window narrower than the menu, and no longer a floor on any trigger.
  assert.equal(MENU_MIN_WIDTH, 160);
});

test("a field that asks for a wider menu than itself still gets one", () => {
  // The country picker: a box a few characters wide whose menu would otherwise wrap every country
  // name over three lines. The exception is deliberate and stays.
  const placed = placeDropdownMenu({ rect: trigger(100, { width: 76 }), ...WINDOW, minWidth: 288 });
  assert.equal(placed.width, 288);
});
