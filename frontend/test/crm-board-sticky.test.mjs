import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { boardOptions } from "../src/lib/crmBoards.js";

/*
 * What the CRM board remembers between visits, and what the notifications panel does when it grows.
 *
 * `CRMPage.js` is JSX and cannot be imported by `node --test`, so this reads it as text - the same
 * way `crm-bulk-import.test.mjs` reads the dialog.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");
const PAGE = read("components", "sales", "CRMPage.js");
const NOTIFICATIONS = read("components", "app-shell", "AppNotifications.js");
const MENU = read("components", "ui", "OptionsMenu.js");

test("the board a reader was last on survives a reload", () => {
  /*
   * It was `useState("Dum Dum")`, so somebody who works Qua Qua was put back on the wedding board
   * every time they refreshed - and refreshing is exactly what you do on a board you are working
   * through. `useStickyTab` is the same mechanism the tab strip beside it already used, so the
   * board is remembered in the same place and follows the person to another machine.
   */
  assert.match(PAGE, /const \[board, setBoard\] = useStickyTab\("crm-board", "Dum Dum", boardIds\);/);
  assert.doesNotMatch(PAGE, /const \[board, setBoard\] = useState\(/, "the board is back to plain state");
});

test("a remembered board is checked against the boards the dropdown actually offers", () => {
  /*
   * `useStickyTab` hands back the fallback for a value it does not recognise, so the guard is what
   * keeps a board that has since been renamed or removed from filtering the table by a vertical
   * nothing matches - which reads as an empty board with no explanation. Built from `boardOptions`
   * rather than written out, so the guard and the dropdown can never name different sets.
   */
  assert.match(PAGE, /const boardIds = boardOptions\.map\(\(option\) => option\.value\);/);
  assert.ok(boardOptions.length >= 4, "the CRM no longer offers the three verticals and the Call Box");
  assert.deepEqual(
    boardOptions.map((option) => option.value),
    ["Dum Dum", "Qua Qua", "Corp", "Calls"],
    "the boards changed - check that a stored board from the old set still falls back cleanly",
  );
});

test("the tab strip is resolved against the remembered board's own tabs", () => {
  /*
   * The two are remembered together, and the order matters: the board resolves first, from the same
   * cache `PreferencesProvider` has on the first client render, so `boardTabIds` is the *remembered*
   * board's tabs from the outset. A Qua Qua reader lands back on Qua Qua's Newborns rather than on
   * Dum Dum's All - and, worse, rather than on a tab Dum Dum does not have and so cannot show.
   */
  const boardAt = PAGE.indexOf('useStickyTab("crm-board"');
  const tabsAt = PAGE.indexOf("const boardTabIds = useMemo(");
  const stripAt = PAGE.indexOf('useStickyTab("crm", "all", boardTabIds)');
  assert.ok(boardAt > 0 && tabsAt > 0 && stripAt > 0, "the board, its tabs or the strip is gone");
  assert.ok(boardAt < tabsAt && tabsAt < stripAt, "the tab strip is resolved before the board it belongs to");
});

test("the notifications panel is capped, and only its rows scroll", () => {
  /*
   * This is the one menu whose length is the studio's rather than the code's: every unplaced call
   * and every overdue follow-up is a row, so it ran to hundreds. A `fixed` menu with no cap simply
   * grows past the bottom of the window and the rows beyond it cannot be reached at all - the page
   * behind does not scroll the menu, and the menu had no scroller of its own.
   *
   * The cap is on the rows and not on the panel. Capping the panel and sticking the heading to the
   * top of it leaves the panel's own `py-1` above the stuck heading, and scrolled rows show through
   * those four pixels as a line of text floating over the title - which is exactly what it did.
   */
  const body = NOTIFICATIONS.match(/menuBodyClassName="([^"]+)"/);
  assert.ok(body, "the notifications rows are no longer given their own scroller");
  assert.match(body[1], /max-h-\[/, "the notifications panel is uncapped again");
  assert.match(body[1], /overflow-y-auto/, "the notifications panel cannot be scrolled again");
  // So the wheel stops at the end of the list instead of carrying on into the board behind it.
  assert.match(body[1], /overscroll-contain/);

  const panel = NOTIFICATIONS.match(/menuClassName="([^"]+)"/);
  assert.ok(panel, "the notifications panel no longer sets its own width");
  assert.doesNotMatch(panel[1], /overflow-y-auto|max-h-\[/, "the whole panel scrolls again, which puts a seam above the heading");
});

test("a menu with a scrolling body keeps its heading outside the scroller", () => {
  // And a menu that asks for no scrolling body renders its rows exactly as it always did, so this
  // costs the other menus in the application nothing.
  assert.match(MENU, /\{menuBodyClassName \? <div className=\{menuBodyClassName\}>\{items\.map\(renderItem\)\}<\/div> : items\.map\(renderItem\)\}/);
  assert.doesNotMatch(MENU, /\$\{headingClass\} sticky/, "the heading is stuck inside the scroller again");
});

test("a CRM is an active Sales employee, everywhere the board names one", () => {
  /*
   * The list used to be the roster *plus* every name already sitting on a loaded lead. Those names
   * are not people: a CSV or a sheet writes whatever its CRM column says, so the list filled with
   * people who had left, people who were never employees, and misspellings of people who are - and
   * picking one wrote it straight back onto the leads. A studio that had not added its Sales
   * employees yet saw a list made entirely of names off its own imports.
   *
   * **Assigning** a lead reads the roster and nothing else, which is the half that matters: Update
   * Details, Add Lead and Import Leads all write a name onto a lead, and a name that is not an
   * employee is how the mess got in.
   *
   * **Filtering** is the other half and asks a different question. A filter does not write anything;
   * it finds rows that exist, and rows do exist against names the roster no longer holds. So the
   * column filter offers the values that column actually holds on the tab being read - the
   * spreadsheet's question, answered by `/column-values`. Otherwise a lead assigned to somebody who
   * has left could be seen on the board and not found by the filter above it.
   *
   * The roster is **no longer its fallback**. It was, while the answer was in flight - and a
   * single-select could live with that, since a stale menu offering a name no row holds just empties
   * the board. A multi-select cannot: Select all against the fallback chose names the real answer
   * did not have, and those choices went on filtering from off the list with nothing on screen able
   * to reach them. The menu is empty under "Loading..." instead, which is the honest answer.
   */
  const PAGE_SRC = read("components", "sales", "CRMPage.js");

  assert.match(PAGE_SRC, /const crmChoices = useMemo\(\(\) => crmOptionsFrom\(crmEmployees\), \[crmEmployees\]\);/,
    "the CRM list is drawn from something other than the roster");
  assert.doesNotMatch(PAGE_SRC, /crmOptionsFrom\(crmEmployees, crmNamesFromRows\(leads\)\)/,
    "the CRM list offers the names written on the leads again");

  // The filter asks the column what it holds, and offers that and nothing else. The board hands
  // the two to `DataTable` as its `filterValues`, and the table draws the menu from them alone.
  assert.match(PAGE_SRC, /onOpen: openColumnFilter,/, "the column filter no longer asks what the column holds");
  assert.match(PAGE_SRC, /get: columnFilterValues,/, "the column filter no longer offers what the column holds");
  assert.match(read("components", "data-table", "DataTable.js"), /options=\{filterValues \? \(filterValues\.get\(column\.id\) \|\| \[\]\) : filterChoices\[column\.id\]\}/, "the table has grown a fallback again");
  assert.match(PAGE_SRC, /crmOptions=\{crmChoices\}/, "Import Leads assigns from something else");
  assert.match(PAGE_SRC, /options=\{crmChoices\}\n\s+values=\{bulkUpdateCrms\}/, "Update Details assigns from something else");
  assert.match(PAGE_SRC, /value=\{addLeadForm\.crm\}.*?options=\{crmChoices\}/, "Add Lead assigns from something else");

  // Assigned Branch reads the same way: the values the column holds on this tab, and no register
  // behind them. A branch written on a lead is still found, because the column is what is asked.
  assert.match(PAGE_SRC, /columnId === "assignedBranch"/, "the branch column is no longer a choice filter");
});

test("the Sales roster is fetched once per mount", () => {
  // Two identical copies of the effect had accumulated, so the board asked for the roster twice
  // every time it opened.
  const PAGE_SRC = read("components", "sales", "CRMPage.js");
  const fetches = PAGE_SRC.match(/void getCrmEmployees\(\)/g) || [];
  assert.equal(fetches.length, 1, `the roster is fetched ${fetches.length} times per mount`);
});
