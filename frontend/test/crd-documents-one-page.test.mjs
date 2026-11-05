import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * CRD Documents is one list, not one list per vertical.
 *
 * It opened on Dum Dum with a picker beside the heading, and Qua Qua's documents were behind it - a
 * reader who did not notice the picker saw a page that was simply missing rows. The vertical is a column
 * on the row, so it can be read, sorted and filtered there like everything else, and the studio sees the
 * whole of what it is owed on one page.
 */

const PAGE = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "CrdDocumentsPage.js"), "utf8");

test("nothing narrows the table to one vertical", () => {
  assert.equal(PAGE.includes("activeVertical"), false, "the vertical no longer narrows the list");
  assert.equal(PAGE.includes("verticalFilters"), false, "and the picker that set it is gone");
  // The divider that made it read as a split beside the heading went with it.
  assert.equal(PAGE.includes('border-l border-slate-200 pl-3'), false, "the split beside the heading is gone");
});

test("the vertical is still readable, as the column it already was", () => {
  /*
   * The column is what replaces the picker: it was already in the table and already sortable and
   * filterable, so a reader who wants one vertical filters that column and one who wants both does
   * nothing. Removing the picker without this would lose the ability to tell the two apart.
   */
  assert.match(PAGE, /\{ id: "vertical", label: "Vertical" \}/);
  assert.match(PAGE, /verticalLabel\(value\) \|\| "-"/);
});

test("the status tabs count the whole list", () => {
  /*
   * They counted within the chosen vertical, so the numbers described what the reader was looking at.
   * With one list they describe the list - which is the same rule, now that there is nothing narrowing
   * it above them.
   */
  assert.match(PAGE, /tab === "All" \? documents\.length : documents\.filter\(\(document\) => document\.status === tab\)\.length/);
  assert.match(PAGE, /activeTab === "All" \? documents : documents\.filter\(\(document\) => document\.status === activeTab\)/);
});

test("the row says who it is on", () => {
  /*
   * The reason the old vertical split felt necessary and the reason it was the wrong answer: a list
   * narrowed to the reader's own work looked exactly like a list of everybody's, because no column said
   * whose it was.
   *
   * The owner is the project's **pre-production coordinator**, which is not a new field - that person is
   * already named on the project and already one of the five columns `dataScope` narrows the register by,
   * so they are the reason the row reaches this reader at all. The column shows the fact that was already
   * deciding what is on screen.
   */
  assert.match(PAGE, /\{ id: "assignedTo", label: "Assigned To" \}/);
  // A standalone document belongs to no project, so it has no coordinator - and says so rather than
  // borrowing one.
  assert.match(PAGE, /if \(column\.id === "assignedTo"\) return value \|\| "-";/);
});

test("My Documents narrows the list to the reader's own, and is offered only where it means something", () => {
  /*
   * The scope widens "mine" to "mine and my team's" - it follows `reportsToEmployeeId` the whole way down -
   * which is the right default and also why a coordinator with a team cannot find their own work: eleven
   * rows, one of them theirs. The switch is the CRM board's own, down to the reasons.
   *
   * Drawn only for somebody who has a team, because for everybody else the two states are the same list and
   * a switch that changes nothing invites a reader to flip it, see no difference and conclude the screen is
   * broken. The server answers that question - it knows the org chart - and the client only draws it.
   */
  assert.match(PAGE, /<ToggleSwitch/);
  assert.match(PAGE, /label="My Documents"/);
  /*
   * In `leadingActions`, which is where the CRM board draws My Leads: the slot for a control that scopes
   * what the page is *showing* rather than doing something to it. It sits with the actions on the right
   * and ahead of the Nebula icon, because everything after that icon is an action and this is not one.
   */
  assert.match(PAGE, /leadingActions=\{managesAnyone && <ToggleSwitch/);
  assert.equal(/titleAddon=\{managesAnyone/.test(PAGE), false, "it is an action-row control, not a title decoration");
  // Remembered per person: somebody who works their own list should not turn it on every morning.
  assert.match(PAGE, /usePreference\("crd:my-documents", false\)/);
  // Re-read from the server rather than filtered here - the rows are a different set, and the server is
  // the only thing that knows who each document is on.
  assert.match(PAGE, /getCrdDocuments\(\{ mine: mineOnly \}\)/);
  // And re-reads when it moves: the loader depends on the switch.
  assert.match(PAGE, /\}, \[showError, mineOnly\]\);/);
});
