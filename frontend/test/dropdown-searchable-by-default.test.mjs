import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * A dropdown in a field is searchable unless it says otherwise.
 *
 * It was opt-in, and so the answer to "can I type to find it" depended on whether whoever wrote that
 * particular form had thought to pass the prop. Sixty-eight components draw one; ninety-odd call sites
 * had remembered. The rest were lists of branches, designations, employees and master data that could
 * only be scrolled.
 *
 * Decided once here rather than at each call site, which is also the only way the ones nobody has looked
 * at get it. A picker that genuinely should not be typed into passes `searchable={false}` and says why.
 */

const DROPDOWN = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "shared", "Dropdown.js"), "utf8");

test("a field dropdown searches by default", () => {
  assert.match(DROPDOWN, /searchable = mode === "input"/);
});

test("the section switch is not a search box", () => {
  /*
   * `mode="switch"` is the picker beside a module heading - a handful of sections, sized to its own longest
   * option so it never resizes as you choose from it. Turning that into a text input would be a heading you
   * can type into, and it is not a question with an answer being looked up.
   */
  assert.match(DROPDOWN, /const trigger = searchable && isInput \? searchableTrigger : standardTrigger;/);
});

test("focus alone does not open the menu", () => {
  /*
   * The consequence of making search the default, and the reason it needed handling rather than shipping.
   *
   * The searchable trigger is a text input and it opened its menu `onFocus`, which was fine while search was
   * something a form asked for: a field you are meant to type into may as well open when you reach it. As the
   * default it would mean **tabbing through a form pops a menu at every dropdown** - ten of them on some of
   * these screens - and none of those fields asked for that.
   *
   * Every way in is still there: a click opens it, typing opens it, and ArrowUp / ArrowDown open it. What is
   * gone is the one that fired without anybody asking for anything.
   */
  assert.equal(/onFocus=\{openMenu\}/.test(DROPDOWN), false, "reaching a field is not asking to see its list");
  assert.match(DROPDOWN, /onClick=\{openMenu\}/);
  // Typing opens it, which is what makes the search reachable from the keyboard without the focus handler.
  assert.match(DROPDOWN, /onChange=\{\(event\) => \{\s*setSearch\(event\.target\.value\);[\s\S]*?setOpen\(true\);/);
  // And so do the arrows, from the shared key handler.
  assert.match(DROPDOWN, /if \(event\.key === "ArrowDown" \|\| event\.key === "ArrowUp"\) \{[\s\S]*?if \(!open\) \{\s*openMenu\(\);/);
});

test("what is typed is the search, never the answer", () => {
  /*
   * The property that makes this safe to turn on everywhere. The box is a `combobox` with
   * `aria-autocomplete="list"`: typing filters, and the value only moves when an option is chosen - so a
   * half-typed word in a branch field cannot be stored as a branch. It is why this can be a default rather
   * than a decision per form.
   */
  assert.match(DROPDOWN, /role="combobox"/);
  assert.match(DROPDOWN, /aria-autocomplete="list"/);
  assert.match(DROPDOWN, /value=\{open \? search : \(\(selected && triggerLabel\) \|\| selected\?\.label \|\| ""\)\}/);
});
