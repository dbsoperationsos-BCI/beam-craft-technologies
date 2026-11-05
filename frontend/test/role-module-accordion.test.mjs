import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * A role form's module rows open and close as an accordion: one chevron at the left end of the row,
 * down while the sub-modules are put away and up while they are on screen, with the state and the
 * panel it controls said to a screen reader. The "−" that used to close a module from the right end
 * is gone, and so is the module name as a second, unmarked toggle.
 */

const DIALOG = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "admin", "RoleDialog.js"), "utf8");
const block = DIALOG.slice(DIALOG.indexOf("export function ModuleBlock"));
const header = block.slice(block.indexOf("<header"), block.indexOf("</header>"));

test("the chevron is the first thing in the module row", () => {
  assert.ok(header.indexOf("<IconButton") > -1, "the toggle is an IconButton");
  assert.ok(header.indexOf("<IconButton") < header.indexOf("{label}</span>"), "and it sits before the module name");
  assert.ok(header.indexOf("<IconButton") < header.indexOf("<Dropdown"), "and before the access dropdown");
});

test("it points down while closed and up while open", () => {
  assert.match(header, /<ChevronIcon direction=\{open \? "up" : "down"\}/);
});

test("it says whether it is open, what it opens, and what pressing it will do", () => {
  assert.match(header, /aria-expanded=\{open\}/);
  assert.match(header, /aria-controls=\{open \? panelId : undefined\}/);
  assert.match(header, /label=\{`\$\{open \? "Hide" : "Show"\} \$\{label\} sub-modules`\}/);
  assert.match(block, /<div id=\{panelId\} role="region" aria-labelledby=\{`\$\{panelId\}-label`\}>/);
});

test("the old right-hand minus and the name-as-button are gone", () => {
  assert.doesNotMatch(block, /text-lg leading-none">−</);
  assert.doesNotMatch(header, /<button/);
});

test("a search can open a disabled module, so its matching permissions can be read", () => {
  assert.match(header, /\{granting \|\| searching\s*\? <IconButton/);
});

test("a disabled module keeps the chevron's space so the names still line up", () => {
  assert.match(header, /: <span aria-hidden="true" className="h-8 w-8 shrink-0" \/>/);
});
