import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/*
 * Where focus is while an overlay is open.
 *
 * `useEscapeKey` says of itself that it is "not a focus trap and not a substitute for one", and
 * that where focus should be while an overlay is open is answered by `Dialog` and the panels — and
 * for a long time nothing answered it. A dialog opened with focus left on the button behind it, so
 * the first Tab walked the page the dialog was covering rather than the dialog's own fields: on
 * Settings → Project → Services → Edit Service, every field was behind a full lap of the page. A
 * dialog marked `aria-modal="true"` that does not hold focus is telling a screen reader one thing
 * and doing another.
 *
 * Read from the source, the way the other layout and control tests in this suite do: there is no
 * DOM here.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

/**
 * The source with its comments taken out.
 *
 * For the assertions that say something is *not* there. These files explain themselves at length,
 * and every one of these tests names the thing it is ruling out — so `focusin` and `offsetParent`
 * both appear in the prose saying why they are not used, and a plain search finds the explanation
 * and calls it the mistake.
 */
const codeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const TRAP = read("components", "shared", "useFocusTrap.js");
const DIALOG = read("components", "ui", "Dialog.js");
const PANEL = read("components", "schema-form", "SchemaFormPanel.js");

test("the trap moves focus in, holds it, and hands it back", () => {
  // In: the overlay itself takes focus, so Tab reaches the first control immediately and the
  // dialog's name is announced rather than a field label out of context.
  assert.match(TRAP, /container\.focus\(\{ preventScroll: true \}\)/);
  assert.match(TRAP, /if \(!container\.contains\(document\.activeElement\)\)/, "focus already inside must not be overruled");
  // Held: Tab off either end wraps to the other rather than leaving for the page behind.
  assert.match(TRAP, /event\.key !== "Tab"/);
  assert.match(TRAP, /last\.focus\(\)/);
  assert.match(TRAP, /first\.focus\(\)/);
  // Back: to whatever opened it, and only if that is still on the page.
  assert.match(TRAP, /opener instanceof HTMLElement && document\.contains\(opener\)/);
});

test("the innermost overlay answers a Tab, so nested ones do not argue", () => {
  // A Dialog opened from a panel is a DOM descendant of it, and a confirmation opened from a
  // Dialog is one of those in turn, so a Tab inside the innermost bubbles to every trap above it.
  assert.match(TRAP, /data-focus-trap/, "a trapped container has to be findable from a descendant");
  assert.match(TRAP, /target\.closest\(`\[\$\{TRAP_ATTRIBUTE\}\]`\) !== container/, "a trap must stand down for one nested inside it");
});

test("the trap never drags focus back on its own", () => {
  /*
   * A `Dropdown`'s list is portalled to the body, outside the dialog's DOM, and so are
   * `DropdownMenu` and the date picker. A `focusin` guard that pulled focus back inside the
   * container would fight every one of them and make those lists unusable, so Tab is trapped and
   * nothing else is.
   */
  assert.doesNotMatch(codeOf(TRAP), /focusin/);
  // And the same for the check that finds the Tab stops: `offsetParent` is null for anything
  // positioned fixed, and every dialog here sits inside a fixed overlay, so it would have found
  // nothing at all.
  assert.doesNotMatch(codeOf(TRAP), /offsetParent/);
});

test("the container is focusable but is not itself a Tab stop", () => {
  assert.match(TRAP, /setAttribute\("tabindex", "-1"\)/);
  // And the selector that finds the Tab stops leaves `-1` out, or the container would find itself.
  assert.match(TRAP, /\[tabindex\]:not\(\[tabindex='-1'\]\)/);
});

test("the Tab stops are read fresh on every press", () => {
  // A dialog's controls come and go as it is filled in — a pricing line added, a field that appears
  // because the answer above it changed, a button disabled while saving — so a list captured when
  // the dialog opened would send focus at something no longer there.
  const handler = TRAP.slice(TRAP.indexOf("function onKeyDown"));
  assert.match(handler, /tabbableWithin\(container\)/, "the stops are gathered inside the handler");
  // Visibility is judged by whether the element is actually drawn. Deliberately not `offsetParent`,
  // which is null for anything positioned fixed — and every dialog here is inside a fixed overlay,
  // so that check would have found no Tab stops at all.
  assert.match(TRAP, /getClientRects\(\)\.length > 0/);
});

test("both overlays use the one trap, on the element that claims to be the dialog", () => {
  for (const [name, source, element] of [["Dialog", DIALOG, "Card"], ["SchemaFormPanel", PANEL, "form"]]) {
    assert.match(source, /import useFocusTrap from "@\/components\/shared\/useFocusTrap";/, name);
    assert.match(source, /= useFocusTrap\(\)/, name);
    // The ref goes on the thing carrying role="dialog", not the backdrop around it: nothing in a
    // backdrop is meant to be reached by Tab.
    const marked = new RegExp(`<${element}[^>]*ref=\\{\\w+Ref\\}`);
    assert.match(source.replace(/\n/g, " "), marked, `${name} puts the trap on its dialog element`);
    assert.match(source, /role="dialog"/, name);
  }
});

test("neither overlay keeps its own copy of the focus restore", () => {
  // Both used to remember the opener and put focus back themselves, which was the only part of
  // this they did. It moved into the hook so there is one answer rather than one per overlay; a
  // second copy left behind would fight it for where focus lands.
  for (const [name, source] of [["Dialog", DIALOG], ["SchemaFormPanel", PANEL]]) {
    assert.doesNotMatch(codeOf(source), /const opener = document\.activeElement/, `${name} still restores focus itself`);
  }
  // What stays in that effect is the page lock, which is a different job.
  assert.match(DIALOG, /document\.body\.style\.overflow = "hidden"/);
  assert.match(PANEL, /document\.body\.style\.overflow = "hidden"/);
});

test("no control switches the focus ring off without drawing its own", () => {
  /*
   * `outline-none` with nothing in its place means a keyboard user cannot see where they are. Two
   * controls were doing it: the shared close ×, which is the first thing Tab reaches in a dialog,
   * and the calendar's month and year pickers.
   *
   * `focus-visible` rather than `focus`, so the ring is there for somebody tabbing and a control
   * clicked with a mouse looks exactly as it did.
   */
  for (const file of [["components", "shared", "CloseButton.js"], ["components", "shared", "CalendarPanel.js"]]) {
    const source = read(...file);
    const name = file[file.length - 1];
    for (const line of source.split("\n")) {
      if (!/\boutline-none\b/.test(line)) continue;
      assert.match(line, /focus-visible:ring-2|focus-within:ring-2/, `${name} suppresses the outline with nothing in its place`);
    }
  }
});
