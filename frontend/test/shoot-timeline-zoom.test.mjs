import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { ZOOM_LEVELS, ZOOM_FLOOR, dayWidthStyle, zoomStep, wholeRangeFits } from "../src/lib/shootBoard.mjs";

/*
 * The timeline's zoom: how wide a day is.
 *
 * The range filter decides which days are loaded; zoom decides how many of them are on screen at
 * once. Zooming out stops at whichever comes first - the whole range on screen, or a day narrow
 * enough that its header stops reading - so "This week" reaches the whole week while "Next 3
 * months" gets as close as a legible date allows and still scrolls.
 *
 * **Only the day columns scale.** The project column, the header text and the bars are untouched:
 * this is not the browser's zoom, it is the width of a day.
 */

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), ...parts), "utf8");
const TIMELINE = read("src", "components", "project-management", "shoot-board", "ShootTimeline.js");

test("the levels run from a full day to the narrowest that still reads", () => {
  assert.equal(ZOOM_LEVELS[0], 1, "the first level is the width the board has always had");
  // Each one narrower than the last, and none of them wider than the base or at nothing.
  for (let index = 1; index < ZOOM_LEVELS.length; index += 1) {
    assert.ok(ZOOM_LEVELS[index] < ZOOM_LEVELS[index - 1], `level ${index}`);
    assert.ok(ZOOM_LEVELS[index] > 0, `level ${index}`);
  }
  assert.ok(ZOOM_LEVELS.length >= 4 && ZOOM_LEVELS.length <= 6, "enough steps to be useful, few enough to press through");
  // The floor is narrow enough for a month on one screen; what the header does there is
  // `headerDetail`'s, not the width's.
  assert.equal(ZOOM_FLOOR, "1.5rem");
});

test("a level is a width that scales the breakpoint's own day width and never goes under the floor", () => {
  /*
   * `max()` in CSS rather than arithmetic here: the base is 7rem on a phone and 11rem from `sm`, so
   * the floor has to hold at both and only the stylesheet knows which applies.
   */
  assert.equal(dayWidthStyle(0), "max(1.5rem, calc(var(--day-base) * 1))");
  assert.match(dayWidthStyle(ZOOM_LEVELS.length - 1), /^max\(1\.5rem, calc\(var\(--day-base\) \* 0\.\d+\)\)$/);
  // Out of range reads as the nearest level rather than as no width at all.
  assert.equal(dayWidthStyle(-3), dayWidthStyle(0));
  assert.equal(dayWidthStyle(99), dayWidthStyle(ZOOM_LEVELS.length - 1));
});

test("zooming stops at both ends", () => {
  assert.equal(zoomStep(0, 1), 1, "out one level");
  assert.equal(zoomStep(1, -1), 0, "in one level");
  assert.equal(zoomStep(0, -1), 0, "already as wide as it goes");
  const last = ZOOM_LEVELS.length - 1;
  assert.equal(zoomStep(last, 1), last, "already as narrow as it goes");
});

test("the whole range is on screen when every day fits in the days' half of the board", () => {
  // The project column is not part of it: it is sticky, and the days scroll past it.
  assert.equal(wholeRangeFits(7, 100, 700), true, "exactly");
  assert.equal(wholeRangeFits(7, 100, 699), false, "one pixel short");
  /*
   * What a 4rem day (64px) buys on a laptop, where the days have about 820px beside the sidebar and
   * the project column: twelve of them. That is the width at which the whole header still reads,
   * which is why going below it means thinning the header (`headerDetail`) rather than only the
   * column.
   */
  assert.equal(wholeRangeFits(7, 64, 820), true, "a week fits at the floor");
  assert.equal(wholeRangeFits(12, 64, 820), true);
  assert.equal(wholeRangeFits(31, 64, 820), false, "a month does not, at a width its dates still read at");
  assert.equal(wholeRangeFits(92, 64, 1216), false, "and three months will not on any screen here");
  // Nothing measured yet, or no days: not a claim that everything fits.
  for (const args of [[0, 100, 700], [7, 0, 700], [7, 100, 0]]) assert.equal(wholeRangeFits(...args), false, JSON.stringify(args));
});

test("only the day columns are zoomed - not the project column, and not the page", () => {
  // The base widths stay in the stylesheet, responsive; zoom sets `--day-width` from the level.
  assert.match(TIMELINE, /\[--day-base:7rem\]/);
  assert.match(TIMELINE, /sm:\[--day-base:11rem\]/);
  // One place decides how wide a date is, filtered or not: the zoom. Picking a project zooms the
  // board out to its range rather than drawing the dates to a width of its own.
  assert.match(TIMELINE, /"--day-width": dayWidthStyle\(zoom\)/);
  // The width is set in one place, and the project column's is the literal it always was.
  assert.equal((TIMELINE.match(/dayWidthStyle\(/g) || []).length, 1, "one place decides how wide a day is");
  assert.match(TIMELINE, /\[--label-width:8\.5rem\] sm:\[--day-base:11rem\] sm:\[--label-width:13rem\]/);
  // A seam's width comes from the same constant the fitting maths measures it by, so the stylesheet
  // and the arithmetic cannot drift apart.
  assert.match(TIMELINE, /"--seam-width": `\$\{SEAM_REM\}rem`/);
  // And nothing reaches for the browser's own zoom or a transform over the whole board.
  assert.equal(/style\.zoom|scale\(/.test(TIMELINE), false);
});

test("the controls say what they do, and stop when there is nothing left to do", () => {
  assert.match(TIMELINE, /label="Zoom out"/);
  assert.match(TIMELINE, /label="Zoom in"/);
  // Out is spent when the whole range is already on screen or the floor is reached; in, at level 0.
  assert.match(TIMELINE, /disabled=\{!canZoomOut\}/);
  assert.match(TIMELINE, /disabled=\{zoom === 0\}/);
});

test("a zoom keeps the day you were looking at, and remeasures", () => {
  /*
   * Scroll position is pixels, and a zoom changes what a pixel means: without an anchor, zooming out
   * on the 20th of the month left you somewhere in the previous week. The first day on screen is
   * held, and the window is measured again because the number of days that fit has changed.
   */
  assert.match(TIMELINE, /anchorRef\.current = view\.first;/);
  assert.match(TIMELINE, /useLayoutEffect\(\(\) => \{ axisRef\.current = axis; measure\(\); \}, \[measure, axis, zoom\]\);/);
  assert.match(TIMELINE, /scrollToDay\(anchorRef\.current, "auto"\)/);
});

/*
 * What the review of this control found, each pinned here.
 *
 * On a phone the base day is 7rem, so most of the ladder lands on the floor: several of the levels
 * were the same width, and − stayed enabled across them doing nothing. And the controls, in one
 * unwrapping row, overflowed a 360px screen.
 */

test("the floor is known in rem, so a measured day can be told to be on it", async () => {
  const { ZOOM_FLOOR_REM, isAtFloor } = await import("../src/lib/shootBoard.mjs");
  assert.equal(ZOOM_FLOOR_REM, 1.5);
  assert.equal(ZOOM_FLOOR, `${ZOOM_FLOOR_REM}rem`, "the CSS and the arithmetic agree on one number");
  assert.equal(isAtFloor(24, 16), true, "exactly on it");
  assert.equal(isAtFloor(23, 16), true, "and under it, which a sub-pixel layout can give");
  assert.equal(isAtFloor(25, 16), false);
  // A browser with a larger root font has a larger floor.
  assert.equal(isAtFloor(30, 20), true);
  assert.equal(isAtFloor(31, 20), false);
  // Nothing measured yet is not a claim that the board is at the floor.
  assert.equal(isAtFloor(0, 16), false);
});

test("zooming out stops where the days stop getting narrower, not at the last level", async () => {
  /*
   * The level index is not the question - the width is. On a 7rem phone, levels 2, 3 and 4 all clamp
   * to the 4rem floor, so a − that only counted levels was enabled for three presses that changed
   * nothing on screen.
   */
  assert.match(TIMELINE, /const canZoomOut = !measured\.fits && !isAtFloor\(measured\.dayWidth, measured\.rem\) && zoom < ZOOM_LEVELS\.length - 1;/);
  assert.match(TIMELINE, /dayWidth: width, rem/, "the measured width and the root font size are kept");
});

test("the controls fit a 360px screen, and the hint says what is actually true", () => {
  // Two clusters in the wrapping row - zoom, and moving through the days - so the break falls
  // between them rather than mid-cluster, where the row overflowed at 360px.
  assert.match(TIMELINE, /flex-wrap/);
  assert.equal((TIMELINE.match(/<ControlGroup label="Zoom">/g) || []).length, 1);
  assert.equal((TIMELINE.match(/<ControlGroup label="Days shown">/g) || []).length, 1);
  // The group squares its own children, so no caller has to remember to.
  assert.equal(/shape="square"/.test(TIMELINE), false);
  /*
   * "Scroll sideways for more days" is false once the whole range is on screen, and says nothing
   * about why − has stopped when the floor is what stopped it. It answers for all three states.
   */
  assert.equal(/>Scroll sideways for more days</.test(TIMELINE), false, "not unconditionally");
  assert.match(TIMELINE, /Days are at their narrowest - scroll for more/);
});

/*
 * Far enough out that a month fits.
 *
 * A 4rem day keeps the whole header - weekday, a circled date, the month - and fits twelve days on a
 * laptop, so Next 30 days still scrolled. Thirty-one days in the same ~820px is about 26px each,
 * which no circled date fits in. So the floor comes down and the **header gives way instead**: the
 * weekday goes, then the circle, then everything but the number. Three months still does not fit at
 * any width, which is the honest answer for 92 days.
 */

test("the narrowest day is a month to six weeks on screen, and no narrower", async () => {
  const { ZOOM_FLOOR_REM, ZOOM_LEVELS: levels, wholeRangeFits: fits } = await import("../src/lib/shootBoard.mjs");
  const floorPx = ZOOM_FLOOR_REM * 16;
  /*
   * A month on one screen is what zoom is for; past about six weeks the days are too thin to be
   * worth reading and the board should be scrolled instead. So the floor is set by that, and a
   * longer range scrolls at the narrowest level rather than being squeezed into it.
   */
  const laptop = 820; // the days' half of the board beside the sidebar and the project column
  assert.ok(laptop / floorPx >= 30, "a month fits");
  assert.ok(laptop / floorPx <= 45, "and it stops there - no squeezing a quarter onto one screen");
  assert.equal(fits(31, floorPx, laptop), true, "Next 30 days, the default range, on one screen");
  // On a 1024px laptop, where the sidebar and the project column leave about 566px.
  assert.equal(fits(31, floorPx, 566), false, "a narrow window scrolls, which is the honest answer");
  // Three months never fits, and is not meant to.
  assert.equal(fits(92, floorPx, 1216), false);
  // The ladder reaches the floor from both bases, or the last levels are unreachable steps.
  assert.ok(11 * levels.at(-1) <= ZOOM_FLOOR_REM, `11rem * ${levels.at(-1)} must reach ${ZOOM_FLOOR_REM}rem`);
  assert.ok(levels.length >= 5, "the step from a full day to a month's worth needs more than four");
  // Each step is a real change of scale, not a nudge: a third off at least.
  for (let index = 1; index < levels.length; index += 1) assert.ok(levels[index] <= levels[index - 1] * 0.7, `level ${index}`);
});

test("the day header gives way as the day narrows, rather than being cut off", async () => {
  const { headerDetail } = await import("../src/lib/shootBoard.mjs");
  // The whole header: weekday, the date in its circle, the month.
  assert.equal(headerDetail(176), "full");
  assert.equal(headerDetail(64), "full", "4rem is where it still all reads");
  // The circle is 2.5rem on its own, so it goes first - the weekday shortens to a letter.
  assert.equal(headerDetail(63), "compact");
  assert.equal(headerDetail(40), "compact");
  // Narrower than that, the number alone.
  assert.equal(headerDetail(39), "minimal");
  assert.equal(headerDetail(24), "minimal");
  // Nothing measured yet draws the full header rather than the barest one.
  assert.equal(headerDetail(0), "full");
});

test("the timeline draws the header the measured width allows", () => {
  assert.match(TIMELINE, /const detail = headerDetail\(measured\.dayWidth\);/);
  // The weekday and the month are the first to go; the date is the one thing every level keeps.
  assert.match(TIMELINE, /detail === "full"/);
  assert.match(TIMELINE, /detail === "minimal"/);
  // Today stays findable at every width: the tint and the colour carry it where the word cannot.
  assert.match(TIMELINE, /isToday \? "Today" : weekdayName\(day\)/);
  assert.match(TIMELINE, /weekdayInitial/);
});

/*
 * The row these controls sit in.
 *
 * Six loose controls in a line, two of them magnifiers that differ only by the sign inside the lens,
 * and Today sitting at the far right among them: the row read as a row of icons rather than as two
 * controls with a job each. It is Today at the left where the eye starts, then one bordered group
 * for how wide a day is and one for which days are shown.
 */

test("Today is at the left, always there, and says when it has nothing to do", () => {
  // Rendered once, not twice, and at the start of the row rather than among the day controls.
  assert.equal((TIMELINE.match(/>Today<\/Button>/g) || []).length, 1);
  assert.ok(TIMELINE.indexOf(">Today</Button>") < TIMELINE.indexOf('label="Zoom out"'), "before the zoom controls");
  /*
   * Disabled rather than hidden, as ‹ and › are at the ends of the range: at the left of the row it
   * would otherwise appear and disappear under the pointer and shove the line about.
   */
  assert.match(TIMELINE, /disabled=\{todayIndex < 0 \|\| view\.first === todayIndex\}/);
});

test("the zoom controls are a minus and a plus, not two magnifying glasses", () => {
  // Two lenses with a tiny sign inside are one glyph at 20px. A − and a + are two.
  assert.match(TIMELINE, /import RemoveRounded from "@mui\/icons-material\/RemoveRounded";/);
  assert.match(TIMELINE, /import AddRounded from "@mui\/icons-material\/AddRounded";/);
  assert.equal(/ZoomOutRounded|ZoomInRounded/.test(TIMELINE), false);
});

test("the controls are two bordered groups rather than six loose buttons", async () => {
  const group = fs.readFileSync(path.join(process.cwd(), "src", "components", "shared", "ControlGroup.js"), "utf8");
  // One reusable component, in the shared folder, not markup typed into the timeline.
  assert.match(group, /export default function ControlGroup/);
  assert.match(group, /role="group"/);
  assert.match(group, /aria-label=\{label\}/);
  assert.match(TIMELINE, /<ControlGroup label="Zoom">/);
  assert.match(TIMELINE, /<ControlGroup label="Days shown">/);
  assert.equal(/role="group" aria-label="Zoom"/.test(TIMELINE), false, "the group's own markup lives in the component");
  // The pill wears the module's own corners and border, or it reads as a control from another app.
  assert.match(group, /rounded-\[14px\] border border-slate-300/);
  // It owns its children's corners, so a rounded child cannot leave a sliver of the pill showing.
  assert.match(group, /\[&>button\]:rounded-none/);
});

test("a button with nothing to do looks like one", () => {
  /*
   * The `plain` variant carries no colours at all - that is what it is for - so a disabled − or ‹
   * inside the pill was the same slate as a live one, with only the cursor differing. Inside a
   * bordered group an enabled-looking dead button is worse than it was loose in the row.
   */
  const group = fs.readFileSync(path.join(process.cwd(), "src", "components", "shared", "ControlGroup.js"), "utf8");
  assert.match(group, /\[&_button:disabled\]:text-slate-300/);
  // Today is outside the group and says it the same way; it is disabled far more often than not.
  assert.match(TIMELINE, /disabled:text-slate-400/);
});

test("the row holds together at 360px", () => {
  // The two pills can drop to their own line rather than running off the side of a phone.
  assert.match(TIMELINE, /ml-auto flex flex-wrap items-center justify-end/);
  // Today keeps its size while the hint beside it gives way.
  assert.match(TIMELINE, /<Button type="button" size="md" className="shrink-0/);
  /*
   * The range label keeps a width at every size: without a base one the pill grew and shrank as the
   * label changed between "6 - 12 Oct 2026" and "29 Sep - 5 Oct 2026", moving ‹ and › under the
   * pointer.
   */
  assert.match(TIMELINE, /min-w-\[8rem\][^"]*sm:min-w-\[9rem\]/);
  // The hint wraps onto its own line on a phone rather than truncating away the useful half.
  assert.match(TIMELINE, /md:truncate/);
});
