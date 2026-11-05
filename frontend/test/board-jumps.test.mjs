import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PROJECT_BOARDS, boardHref, boardJumpItems } from "../src/lib/boardJumps.mjs";

/*
 * "Navigate to…" between the four project boards.
 *
 * A project is worked on five screens and moving between them meant going back to the menu, opening
 * the other board and finding the project again. Each row's ⋮ offers the others - but only the ones
 * the viewer may open **and** the project is actually on, because a jump to a board that would
 * refuse them is a link to a refusal, and one to a board the project is not on is a dead end the
 * reader cannot tell from a board still loading.
 *
 * One **Navigate to** line with the boards inside it, the way the table's own Freeze Columns is built:
 * four lines each beginning "Navigate to" buried the menu's own Edit and Update status under a list of
 * near-identical labels.
 */
const HERE = import.meta.dirname;
const src = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");
const everywhere = () => true;
// What the submenu offers - the one item is always "Navigate to", which `the entry is one line` pins.
const labels = (items) => (items[0]?.submenu || []).map((item) => item.label);

test("the entry is one line with the boards inside it, in the order the work runs", () => {
  assert.deepEqual(PROJECT_BOARDS.map((board) => board.key), ["bookings", "projects", "pre-production", "production", "post-production"]);
  const items = boardJumpItems({ from: "projects", boards: PROJECT_BOARDS.map((board) => board.key), eventId: "DBS-EV-1", can: everywhere, onJump: () => {} });
  // One item in the menu, and the boards hang off it - the shape `OptionsMenu` draws with a chevron.
  assert.equal(items.length, 1);
  assert.equal(items[0].label, "Navigate to");
  assert.deepEqual(labels(items), ["Bookings & Converted", "Pre Production", "Production", "Post Production"]);
  // Never the board you are on.
  assert.ok(!labels(items).includes("Projects"));
  // The same shape as Freeze Columns, so one menu component draws both.
  assert.match(src("lib", "tableMenuItems.mjs"), /label: "Freeze Columns",\n\s+submenu: /);
  assert.match(src("components", "ui", "OptionsMenu.js"), /if \(item\.submenu\) \{/);
});

test("only the boards this viewer holds", () => {
  // The studio's own example: somebody with Production and Post Production and neither of the others.
  const can = (module, feature) => ["Production", "Post Production"].includes(feature);
  const all = PROJECT_BOARDS.map((board) => board.key);
  assert.deepEqual(labels(boardJumpItems({ from: "production", boards: all, eventId: "DBS-EV-1", can, onJump: () => {} })), ["Post Production"]);
  assert.deepEqual(labels(boardJumpItems({ from: "post-production", boards: all, eventId: "DBS-EV-1", can, onJump: () => {} })), ["Production"]);
  // And nothing at all where no other board applies: no empty Navigate to line to open.
  assert.deepEqual(boardJumpItems({ from: "production", boards: ["production"], eventId: "DBS-EV-1", can, onJump: () => {} }), []);
});

test("only the boards the project is on", () => {
  // A project with no production raised is not on Production, so the jump is absent rather than
  // landing somewhere it cannot be found.
  const items = boardJumpItems({ from: "projects", boards: ["projects", "pre-production"], eventId: "DBS-EV-1", can: everywhere, onJump: () => {} });
  assert.deepEqual(labels(items), ["Pre Production"], "no Bookings entry either: the row did not say it was there");
  // And a row the server told nothing about offers none at all, rather than guessing.
  assert.deepEqual(boardJumpItems({ from: "projects", eventId: "DBS-EV-1", can: everywhere, onJump: () => {} }), []);
});

test("the jump names the project by Event ID, which is what the board filters by", () => {
  const preProduction = PROJECT_BOARDS.find((board) => board.key === "pre-production");
  assert.equal(boardHref(preProduction, "DBS EV 1"), "/project-management/pre-production?project=DBS%20EV%201");
  let went = "";
  boardJumpItems({ from: "projects", boards: ["pre-production"], eventId: "DBS-EV-1", can: everywhere, onJump: (href) => { went = href; } })[0].submenu[0].onSelect();
  assert.equal(went, "/project-management/pre-production?project=DBS-EV-1");
});

test("a jump always brings the board to All, whatever tab was left open", () => {
  /*
   * A board opens on whichever tab was last used. A jump used to come to All only when the project
   * was on another tab, so a project on the remembered tab landed on that filtered tab - and
   * clearing the project filter then showed a slice of the board nobody had asked for. Now any
   * jump comes to All, on all four boards.
   */
  const hook = src("components", "shared", "useLinkedProject.js");
  assert.match(hook, /if \(!linkedEventId \|\| tab === allTab\) return;/);
  assert.match(hook, /onTab\?\.\(allTab\);/);
  assert.doesNotMatch(hook, /onThisTab|onTheBoard/, "no longer depends on which tab holds the project");
  for (const [file, where] of [
    [["components", "project-management", "ProjectsPage.js"], "Projects"],
    [["components", "project-management", "ProjectWorkflowModulePage.js"], "Post Production"],
    [["components", "project-management", "PreProductionPage.js"], "Pre Production"],
    [["components", "project-management", "production", "ProductionPage.js"], "Production"],
  ]) {
    assert.match(src(...file), /useLinkedProject\(\{ tab: activeTab, onTab: setActiveTab \}\)/, where);
  }
});

test("arriving filters the board to that project, and opens nothing", () => {
  /*
   * Scrolling to the row was the first attempt and a poor one: on a board of hundreds it moved a
   * highlight somewhere below the fold, which is the hunting it was meant to spare the reader.
   * Filtering says what happened - the project is the row on screen, the filter box holds its id,
   * and clearing it gives the whole board back.
   */
  assert.match(src("components", "data-table", "DataTable.js"), /const \[id, value\] = presetKey\.split\("\\u0000"\);\n\s+setLocalColumnFilters\(\[\{ id, value \}\]\);/);
  for (const [file, where] of [
    [["components", "data-table", "ProjectDataTable.js"], "Projects and Post Production"],
    [["components", "project-management", "PreProductionPage.js"], "Pre Production"],
    [["components", "project-management", "production", "ProductionPage.js"], "Production"],
  ]) {
    assert.match(src(...file), /filterPreset=\{landedOn \? \{ id: "eventId", value: landedOn \} : undefined\}/, where);
  }
  // Nothing scrolls, and nothing opens: the earlier attempt is gone rather than left beside this.
  for (const file of [["components", "data-table", "DataTable.js"], ["components", "data-table", "ProjectDataTable.js"]]) {
    assert.doesNotMatch(src(...file), /revealRowId|data-reveal|scrollIntoView/);
  }
});

test("the sale is one of them, and knows which board it is", () => {
  // Bookings & Converted is where a project starts, and jumping back to the sale is as much a jump
  // as any other. Its tabs are All and Sent Back: a jump always brings it to All, as on Projects.
  const sale = src("components", "sales", "SalesManagerPage.js");
  assert.match(sale, /board="bookings"/);
  assert.match(sale, /useLinkedProject\(\{ tab: activeTab, onTab: setActiveTab \}\)/);
  assert.match(sale, /revealEventId=\{linkedEventId\} onRevealed=\{clearLinkedProject\}/);
  assert.match(src("lib", "boardJumps.mjs"), /key: "bookings", label: "Bookings & Converted", path: "\/sales\/manager", module: "SALES", feature: "Sales Manager"/);
});

test("a project row built from shoots still knows which boards it is on", async () => {
  /*
   * Pre Production and Production list *shoots*, folded into one row per project - and those rows
   * are built field by field, so the server's `boards` was dropped on the way. The menus asked
   * about a project that claimed to be on nothing, and offered no jump at all: the two boards that
   * most need it were the two without it.
   */
  const { productionProjects } = await import("../src/lib/productionBoard.mjs");
  const [row] = productionProjects([{ projectId: "p1", eventId: "DBS-EV-1", boards: ["bookings", "projects", "production"], shootId: "s1", shootDate: "2026-11-12" }]);
  assert.deepEqual(row.boards, ["bookings", "projects", "production"]);
  // Pre Production folds its own rows the same way.
  assert.match(src("components", "project-management", "PreProductionPage.js"), /boards: first\.boards \|\| \[\],/);
  // And a row the server told nothing about reads as "nowhere", which offers nothing rather than
  // offering everything.
  assert.deepEqual(productionProjects([{ projectId: "p2", shootId: "s2" }])[0].boards, []);
});

test("every board tells the menu which board it is", () => {
  assert.match(src("components", "project-management", "ProjectsPage.js"), /board="projects"/);
  assert.match(src("components", "project-management", "ProjectWorkflowModulePage.js"), /board=\{moduleKey\}/);
  assert.match(src("components", "project-management", "PreProductionPage.js"), /from: "pre-production"/);
  assert.match(src("components", "project-management", "production", "ProductionPage.js"), /from: "production"/);
});
