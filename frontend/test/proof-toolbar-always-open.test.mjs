import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/*
 * The marking tools are on screen, not behind a chevron.
 *
 * The toolbar used to start folded, as a single chevron in the corner of the spread, and unfold
 * sideways when it was pressed. On the one screen whose whole purpose is marking corrections, that
 * put every tool a press behind a control which said nothing about what was inside it — and it was
 * folded again on every spread and every visit, because the fold was component state that nothing
 * carried forward.
 *
 * One toolbar serves both reviews, the QC Lead's and the client's, so this is a single component
 * and both get the same answer. What it shows *within* itself is still decided per reviewer:
 * `canMark` for the marking tools, `onToggleComments` for the corrections rail.
 *
 * Read from the source, the way the other control tests in this suite do: there is no DOM here.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

/** The source with its comments taken out — for the assertions that say something is *not* there. */
const codeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const TOOLBAR = read("components", "image-selection", "album-proofing", "ProofToolbar.js");
const QC = read("components", "image-selection", "album-proofing", "QcReviewPanel.js");
const CLIENT = read("components", "image-selection", "album-proofing", "client", "ClientProofViewer.js");

test("the toolbar has no open and closed state left to be in", () => {
  const code = codeOf(TOOLBAR);
  // The fold was the component's only piece of state; with it gone there is nothing to remember.
  assert.doesNotMatch(code, /useState/, "the toolbar is holding state again");
  assert.doesNotMatch(code, /\bopen\b/, "something still reads as an open flag");
});

test("neither chevron is drawn any more", () => {
  const code = codeOf(TOOLBAR);
  assert.doesNotMatch(code, /KeyboardArrowLeftRounded|KeyboardArrowRightRounded/, "a chevron icon is back");
  // The two labels those buttons carried. Their absence is what says the controls are gone rather
  // than merely renamed.
  assert.doesNotMatch(code, /Show the marking tools|Hide the marking tools/);
  // And nothing claims to expand or collapse: `aria-expanded` on a bar that is always open would
  // be telling a screen reader about a fold that no longer exists.
  assert.doesNotMatch(code, /aria-expanded/);
});

test("what each reviewer may do still decides what is in the bar", () => {
  // Removing the fold must not have removed the gating. The marking tools belong to whoever may
  // rule on the album; the corrections rail belongs to anyone looking.
  assert.match(TOOLBAR, /\{canMark && TOOLS\.map\(/, "the tools are no longer gated on canMark");
  assert.match(TOOLBAR, /\{canMark && tool === "pen" &&/, "the palette is no longer gated on canMark");
  assert.match(TOOLBAR, /\{onToggleComments && <button/, "the corrections button is no longer conditional");
  // A reviewer who may neither mark nor read corrections is shown no bar at all, rather than an
  // empty pill sitting over the spread.
  assert.match(TOOLBAR, /if \(!canMark && !onToggleComments\) return null;/);
});

test("blue means the marking tool, and only the marking tool", () => {
  /*
   * Two different kinds of state sit on this bar. The corrections button is an independent toggle;
   * the circle and the pen are a radio group with exactly one chosen. Both used to draw their
   * active state as the same `bg-blue-100 text-blue-700`, so in the ordinary case — rail open,
   * circle in hand — two buttons looked equally chosen and the bar read as two tools at once.
   */
  const chat = TOOLBAR.slice(TOOLBAR.indexOf("{onToggleComments && <button"), TOOLBAR.indexOf("<ChatBubbleOutlineRounded"));
  assert.doesNotMatch(chat, /bg-blue-100/, "the corrections toggle is wearing the tool's colour again");
  // It says "on" in neutral instead: a wash pressed *into* the glass, where hover lifts out of it
  // toward white, so the two cannot be mistaken for one another.
  assert.match(chat, /commentsOpen \? "bg-slate-900\/10/);

  // And the tool keeps the blue, which is now the one thing it means.
  const tools = TOOLBAR.slice(TOOLBAR.indexOf("{canMark && TOOLS.map("), TOOLBAR.indexOf("{canMark && tool === \"pen\""));
  assert.match(tools, /tool === id \? "bg-blue-100 text-blue-700"/);
});

test("a rule separates the panel toggle from the tools", () => {
  const start = TOOLBAR.indexOf("{onToggleComments && canMark && <span");
  assert.ok(start > -1, "there is no rule between the two groups");
  const rule = TOOLBAR.slice(start, TOOLBAR.indexOf("/>", start));
  /*
   * Drawn only with something on both sides of it, and hidden exactly where the button on its left
   * is hidden: that button is `lg` and up only, so below `lg` this would be a rule with nothing
   * before it, opening the bar on a stray line.
   */
  assert.match(rule, /hidden/);
  assert.match(rule, /lg:block/);
  assert.match(rule, /aria-hidden="true"/, "a decorative rule must not be announced");
  // It sits between the two groups, not at either end.
  assert.ok(start > TOOLBAR.indexOf("<ChatBubbleOutlineRounded"), "the rule is before the corrections button");
  assert.ok(start < TOOLBAR.indexOf("{canMark && TOOLS.map("), "the rule is after the tools");
});

test("both reviews get the toolbar from the one component", () => {
  // QC review and the client's review render the same file, so "always open" cannot be true on one
  // screen and false on the other.
  assert.match(QC, /import ProofToolbar from "\.\/ProofToolbar";/);
  assert.match(CLIENT, /import ProofToolbar from "\.\.\/ProofToolbar";/);
  for (const [name, source] of [["QC review", QC], ["client review", CLIENT]]) {
    assert.match(source, /<ProofToolbar/, `${name} no longer renders the toolbar`);
  }
});
