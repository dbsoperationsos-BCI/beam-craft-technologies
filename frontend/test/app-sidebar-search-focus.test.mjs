import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * The hamburger opens the nav with the cursor in its Search box - on a mouse or trackpad screen
 * only, so a phone does not raise its keyboard over the nav - and however the nav is closed the box
 * lets go of the cursor and is emptied.
 */

const SIDEBAR = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "app-shell", "AppSidebar.js"), "utf8");

test("opening the nav focuses Search on a fine pointer only, without scrolling the shell", () => {
  assert.match(SIDEBAR, /<input ref=\{searchRef\} value=\{query\}/);
  assert.match(SIDEBAR, /if \(window\.matchMedia\?\.\("\(pointer: fine\)"\)\.matches\) input\?\.focus\(\{ preventScroll: true \}\);/);
});

test("closing the nav, the hamburger included, blurs and empties Search", () => {
  assert.match(SIDEBAR, /if \(input && document\.activeElement === input\) input\.blur\(\);/);
  assert.match(SIDEBAR, /if \(wasOpen !== open\) \{\s*setWasOpen\(open\);\s*if \(!open\) setQuery\(""\);\s*\}/);
});
