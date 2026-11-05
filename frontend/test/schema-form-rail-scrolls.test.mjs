import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/*
 * The schema form's rail scrolls inside itself.
 *
 * Settings is the form that grew past a laptop's viewport first: User Settings down to Holidays
 * filled the screen, and Login Slide and Application Monitoring below them were not merely out of
 * reach but absent, with nothing on screen to say the list had been cut off. The rail is a flex
 * child of a row that is exactly the panel's height and carries `overflow-hidden`, so it is handed a
 * fixed height whatever it holds; without a scroll container of its own the remainder is clipped,
 * and the page behind it cannot scroll to it either, because the app shell never scrolls as a page.
 *
 * Pinned here because it is invisible until a form has enough sections to overflow, and the form
 * that does today is not the one somebody will be editing when it breaks again.
 *
 * Read from the source, the way the other layout tests in this suite do: there is no DOM here.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

const SIDEBAR = read("components", "schema-form", "SchemaFormSidebar.js");
const PANEL = read("components", "schema-form", "SchemaFormPanel.js");

/** The one `<aside>` in the sidebar — the wide-screen rail, as opposed to the narrow strip. */
const asideClasses = () => {
  const match = SIDEBAR.match(/<aside className="([^"]+)"/);
  assert.ok(match, "the wide-screen rail is no longer a plain <aside> with a class list");
  return match[1];
};

test("the wide-screen rail is its own scroll container", () => {
  const classes = asideClasses();
  assert.match(classes, /\boverflow-y-auto\b/, "a rail taller than the panel clips its last entries");
  // Reaching the end of the list must not start scrolling whatever is behind the panel — the same
  // pair the form's own content pane beside it carries.
  assert.match(classes, /\boverscroll-contain\b/);
  // It only scrolls; it never widens. The rail is a fixed 15rem column and a long label truncates.
  assert.match(classes, /\bw-60\b/);
  assert.match(classes, /\bshrink-0\b/);
});

test("the rail is given a height to scroll within", () => {
  // `overflow-y-auto` above does nothing unless this row is bounded: `flex-1` inside a panel that
  // is exactly the viewport's height, `min-h-0` so it may be smaller than its content, and
  // `overflow-hidden` so it cannot grow instead. The rail stretches to it and scrolls inside.
  const row = PANEL.match(/className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row"/);
  assert.ok(row, "the row holding the rail and the content pane no longer bounds their height");
  assert.match(PANEL, /<form[^>]*className="flex h-dvh min-h-0 flex-col overflow-hidden/, "the panel is no longer the height of the viewport");
});

test("the rail's nav does not try to stick", () => {
  // It never could: before this the aside did not scroll, so there was nothing to stick against,
  // and now that it does the nav fills it exactly and has nowhere to move. A rule that cannot fire
  // reads as a decision somebody made.
  // A rail with a search hides its nav under a search rather than unmounting it, so the class is a template.
  const nav = SIDEBAR.match(/<nav className=\{`([^`]+)`\} aria-label=\{ariaLabel\}>\s*\{sections\.map\(\(section\) => entry\(section, false\)\)\}/);
  assert.ok(nav, "the wide-screen nav is no longer drawn the way this test reads it");
  assert.doesNotMatch(nav[1], /\bsticky\b/);
});

test("the narrow strip still scrolls sideways instead", () => {
  // Below `lg` the rail is one horizontal strip of every screen, groups flattened into it. That is
  // a different answer to the same problem and this change must not have disturbed it.
  // Under a search the strip lists the results in place of the screens; otherwise it is the screens as before.
  const strip = SIDEBAR.match(/<nav className="([^"]+)" aria-label=\{ariaLabel\}>\s*\{searching \? <SearchResults search=\{search\} mobile \/> : sections\.map\(\(section\) => entry\(section, true\)\)\}/);
  assert.ok(strip, "the narrow-screen strip is no longer drawn the way this test reads it");
  assert.match(strip[1], /\boverflow-x-auto\b/);
  assert.match(strip[1], /\blg:hidden\b/);
});

test("a panel's submit stops at its own form, so a panel stacked on another never submits the one beneath", () => {
  const panel = fs.readFileSync(new URL("../src/components/schema-form/SchemaFormPanel.js", import.meta.url), "utf8");
  const handler = panel.slice(panel.indexOf("function handleSubmit(event) {"), panel.indexOf("onSubmit(event);", panel.indexOf("function handleSubmit(event) {")));
  assert.match(handler, /event\.stopPropagation\(\);\n\s+if \(loading\)/);
});

test("the status-history remark is drawn on <body>, so it shows above a stage editor stacked on the project panel", () => {
  const dialog = fs.readFileSync(new URL("../src/components/project-management/StageUpdateRemarkDialog.js", import.meta.url), "utf8");
  assert.match(dialog, /return createPortal\(<ConfirmDialog/);
  assert.match(dialog, /<\/ConfirmDialog>, document\.body\);/);
});
