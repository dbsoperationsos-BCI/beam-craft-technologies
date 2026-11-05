import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/*
 * Edit and Remove sit on the pin bubble's header line, not in a band under the comment.
 *
 * The bubble hangs over the very photograph being judged, and the two actions used to take a row of
 * their own behind a rule — so a two-word correction opened a card three bands tall, most of it
 * chrome. A pencil and a bin are the two symbols nobody has to read, so they cost a corner of the
 * line the author and the time were already on.
 *
 * Read from the source, the way the other control tests in this suite do: there is no DOM here.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

/** The source with its comments taken out — for the assertions that say something is *not* there. */
const codeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const CANVAS = read("components", "image-selection", "album-proofing", "ProofSpreadCanvas.js");
const QC = read("components", "image-selection", "album-proofing", "QcReviewPanel.js");
const CLIENT = read("components", "image-selection", "album-proofing", "client", "ClientProofViewer.js");

/** The bubble's header line: from the row that opens it to the comment text under it. */
const header = () => {
  const from = CANVAS.indexOf('<div className="flex items-center gap-2">');
  const to = CANVAS.indexOf("<p className=\"mt-2 whitespace-pre-wrap", from);
  assert.ok(from > -1 && to > from, "the bubble's header line is no longer drawn the way this test finds it");
  return CANVAS.slice(from, to);
};

test("Edit and Remove are icons, and they are on the header line", () => {
  const row = header();
  assert.match(row, /iconActions\.map\(/, "the header line carries no actions");
  // And the list it draws is really the actions that have an icon. Asserting only on the markup
  // above passes just as well when `iconActions` is always empty, which is the whole of the bug
  // this test exists to catch.
  assert.match(CANVAS, /const iconActions = actions\.filter\(\(action\) => ICON_ACTIONS\[action\.label\]\);/);
  assert.match(row, /<Icon style=\{\{ fontSize: 15 \}\} \/>/);
  // Right-aligned, whatever the name and the time take up.
  assert.match(row, /ml-auto/);
  // The two icons themselves, and both are the pair the rest of the app already uses.
  assert.match(CANVAS, /import DeleteOutlineRounded from "@mui\/icons-material\/DeleteOutlineRounded";/);
  assert.match(CANVAS, /import EditRounded from "@mui\/icons-material\/EditRounded";/);
  assert.match(CANVAS, /Edit: \{ Icon: EditRounded/);
  assert.match(CANVAS, /Remove: \{ Icon: DeleteOutlineRounded/);
});

test("an icon-only button still says what it is", () => {
  const row = header();
  // The shape is the label for most people; these two are the label for everyone else. Both come
  // from the action itself, so they cannot drift from what the button does.
  assert.match(row, /aria-label=\{action\.label\}/);
  assert.match(row, /title=\{action\.label\}/);
  // And it is still reachable and visible from the keyboard, on a bubble that is not white.
  assert.match(row, /focus-visible:outline-white/);
});

test("pressing an icon does not also press the spread underneath", () => {
  // The bubble floats over a canvas that pans, zooms and starts a new correction on a click, so
  // every control inside it has to stop the event the way the worded buttons already did.
  assert.match(header(), /onClick=\{\(event\) => \{ event\.stopPropagation\(\); action\.onSelect\(\); \}\}/);
});

test("an action with no icon keeps its words, under the comment", () => {
  /*
   * The map is keyed by label precisely so this stays true. The pin also carries **Reopen** when a
   * resolved correction is being reviewed, and there is no symbol for "reopen — not fixed" that a
   * reviewer would read correctly the first time — so it is worded, in the row that is still there
   * for it.
   */
  assert.match(CANVAS, /const wordedActions = actions\.filter\(\(action\) => !ICON_ACTIONS\[action\.label\]\);/);
  assert.match(CANVAS, /\{wordedActions\.length > 0 && <div/, "the worded row is gone, so Reopen has nowhere to go");
  assert.match(CANVAS, /\{wordedActions\.map\(\(action\) => <button/);
  // Nothing draws the whole action list any more; that is what put Edit and Remove below.
  assert.doesNotMatch(codeOf(CANVAS), /pin\.actions\?\.length > 0/);

  // And Reopen really is one of the actions a pin can carry, so this is not a hypothetical.
  assert.match(QC, /actions\.push\(\{ label: "Reopen"/);
});

test("both reviews send Edit and Remove under those exact labels", () => {
  // The icons are chosen by label, so a caller renaming one would quietly put it back below the
  // comment as words rather than break.
  for (const [name, source] of [["QC review", QC], ["client review", CLIENT]]) {
    assert.match(source, /\{ label: "Edit", disabled: busy/, `${name} no longer sends an Edit action`);
    assert.match(source, /\{ label: "Remove", (tone: "danger", )?disabled: busy/, `${name} no longer sends a Remove action`);
  }
});
