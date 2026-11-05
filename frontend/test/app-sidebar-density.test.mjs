import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * How tight the navigation drawer is.
 *
 * A nav of seven groups and twenty screens is read by scanning rather than by aiming, so the drawer
 * has to show as much of itself as it can without being scrolled - the sections at the bottom,
 * Accounts and Resource Management, are the ones nobody discovers when it does not. Every measure
 * here was one step looser and the list ran past the fold on a laptop.
 *
 * Pinned as classes rather than as pixels because that is what the file actually holds, and because
 * the fault this guards against is somebody restoring one of them without noticing the other five:
 * the gaps and the padding were reduced together, and half of the change is worse than neither -
 * rows that sit flush against each other *and* carry the padding of rows that did not.
 */

const SIDEBAR = fs.readFileSync(
  path.join(import.meta.dirname, "..", "src", "components", "app-shell", "AppSidebar.js"),
  "utf8",
);

test("a screen and a group heading are the same height, and rows sit flush", () => {
  // The gaps went first. A row's hover fill already separates it from its neighbours far better than
  // two pixels of nothing did, and the fill is contiguous rather than striped by them.
  assert.doesNotMatch(SIDEBAR, /space-y-0\.5/, "the nav has gaps between its rows again");
  // What is left is the padding inside a row, which is what a press actually lands on: 4px above and
  // below a 20px line, so a row is 28px.
  assert.match(SIDEBAR, /className=\{`block rounded-md px-2\.5 py-1 text-sm hover:bg-slate-50/, "a screen row is padded like a form field again");
  assert.match(SIDEBAR, /className="block cursor-not-allowed rounded-md px-2\.5 py-1 text-sm text-slate-400"/, "an unavailable screen is a different height from an available one");
  // The heading is padded to the same left edge as the rows under it, so the group name and its
  // screens read as one column rather than two.
  assert.match(SIDEBAR, /justify-between px-2 py-1 text-left text-xs font-semibold uppercase/);
});

test("the drawer's own margins are as tight as the rows inside it", () => {
  /*
   * Reducing the rows and leaving the frame is the change that looks like it did nothing: twenty
   * rows six pixels shorter is 120px, and 12px of padding on four edges plus 12px between seven
   * groups is another 100px. Both halves or neither.
   */
  assert.match(SIDEBAR, /<nav className="flex-1 overflow-y-auto px-2 py-1\.5"/, "the nav carries its old padding again");
  assert.match(SIDEBAR, /<section key=\{group\.title\} className="mb-1">/, "the gap between groups is back to what it was");
  assert.match(SIDEBAR, /<div className="border-b border-slate-200 p-2">/, "the search box carries its old padding again");
  assert.match(SIDEBAR, /<div className="border-t border-slate-200 px-3 py-2 text-xs text-slate-400">/, "the footer carries its old padding again");
});

test("the dark theme still reaches every part of it", () => {
  /*
   * `globals.css` recolours this drawer by matching the plain utility classes on it -
   * `text-slate-700`, `border-slate-200`, `hover:bg-slate-50`. Only spacing was changed, so those
   * are all still here; a colour swapped for an arbitrary value would escape the theme and leave a
   * near-black row on a near-black panel, which is the one way this file breaks silently.
   */
  const themed = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "app", "globals.css"), "utf8");
  const rules = themed.slice(themed.indexOf('[data-theme="enhanced-dark"] .app-sidebar'));
  for (const utility of ["text-slate-700", "text-slate-500", "border-slate-200", "border-slate-100"]) {
    assert.ok(SIDEBAR.includes(utility), `the drawer no longer uses ${utility}, which the dark theme recolours by name`);
    assert.ok(rules.includes(utility), `the dark theme no longer recolours ${utility}`);
  }
  assert.ok(SIDEBAR.includes("hover:bg-slate-50"));
});
