const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * What a column filter's dropdown offers on the CRM board.
 *
 * It used to offer the registers: every employee on the Sales roster under CRM, every branch the
 * studio maintains under Assigned Branch, the whole list of shoot types under the three columns that
 * use it. So most of a menu was values no row in front of the reader held - a reader working one tab
 * of one vertical was handed fifty names, picked one, and emptied the board.
 *
 * A spreadsheet's filter answers a different question, and it is the one people expect: what is *in*
 * this column, here, on what I am looking at. That answer has to come from the server, because the
 * board is paged - the browser holds a hundred rows of a vertical that has thirty thousand.
 *
 * Read from source, the way the tab tests beside this are, so they run anywhere with no MySQL.
 */

const CRM = path.join(__dirname, "..", "src", "modules", "sales", "crm-leads");
const QUERY_SERVICE = fs.readFileSync(path.join(CRM, "leadQueryService.js"), "utf8");
const CALL_BOARD = fs.readFileSync(path.join(CRM, "callBoardService.js"), "utf8");
const CONTROLLER = fs.readFileSync(path.join(CRM, "controller.js"), "utf8");
const ROUTES = fs.readFileSync(path.join(CRM, "routes.js"), "utf8");
const BOARD = fs.readFileSync(
  path.join(__dirname, "..", "..", "frontend", "src", "components", "sales", "CRMPage.js"),
  "utf8",
);
// The board draws through the shared `DataTable`, so half of what these pin is the table's: the
// board says which columns are lists and what they hold, and the table draws the menu from that.
const TABLE = fs.readFileSync(
  path.join(__dirname, "..", "..", "frontend", "src", "components", "data-table", "DataTable.js"),
  "utf8",
);

const leadValues = () => QUERY_SERVICE.slice(
  QUERY_SERVICE.indexOf("async function crmLeadColumnValues("),
  QUERY_SERVICE.indexOf("\n}\n", QUERY_SERVICE.indexOf("async function crmLeadColumnValues(")),
);
const callValues = () => CALL_BOARD.slice(
  CALL_BOARD.indexOf("async function callBoardColumnValues("),
  CALL_BOARD.indexOf("\n}\n", CALL_BOARD.indexOf("async function callBoardColumnValues(")),
);

test("both boards answer for their own store, and only through a known column", () => {
  for (const [what, body, sqlFor] of [
    ["the lead table", leadValues(), "columnSql(column, { board, today })"],
    ["the call log", callValues(), "callColumnSql(column)"],
  ]) {
    assert.ok(body, `${what} has no column-values query`);
    // The column arrives from a query string. It is a *name* to look up, never SQL: both maps answer
    // null for anything they do not hold, and an empty list is the honest reply to a column that is
    // not one - a filter with no menu still takes typing.
    assert.match(body, new RegExp(`const valueSql = ${sqlFor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")};`), what);
    assert.match(body, /if \(!valueSql\) return \[\];/, what);
    assert.ok(!/\$\{column\}/.test(body), `${what} interpolates the caller's column name into SQL`);
  }
});

/*
 * The one rule that makes these menus usable, and the one a first attempt always gets wrong: a
 * dropdown narrowed by its *own* selection offers exactly one value the moment one is chosen, and
 * there is no way back to the others without clearing it first. Every spreadsheet drops the column's
 * own filter when it builds that column's list.
 */
test("a column's own filter does not narrow its own menu, and the others do", () => {
  for (const [what, body] of [["the lead table", leadValues()], ["the call log", callValues()]]) {
    assert.match(body, /const others = \{ \.\.\.filters \};\n\s*delete others\[column\];/, what);
    // And the rest of the filters are passed through, or the menu would describe rows the reader is
    // not being shown.
    assert.match(body, /filters: others/, what);
  }
});

test("the menu describes the rows the board is showing, and nothing wider", () => {
  const body = leadValues();
  // The same `buildWhere` the page runs, so the board, the tab, the header's date range and the
  // reader's own data scope all narrow the menu exactly as they narrow the rows.
  // `mine` travels with `scope` everywhere: a filter's menu describes the rows the board is
  // showing, so it has to narrow by the board's "only mine" toggle as well.
  assert.match(body, /buildWhere\(\{ board, view, filters: others, today, scope, mine, dateFrom, dateTo \}\)/);
  assert.match(body, /SELECT DISTINCT/);
  // Capped: the same endpoint answers for any filterable column, and a free-text one over a whole
  // vertical would otherwise build a menu of thirty thousand names nobody can use.
  assert.match(body, /LIMIT \$\{COLUMN_VALUES_LIMIT\}/);
  assert.match(QUERY_SERVICE, /const COLUMN_VALUES_LIMIT = \d+;/);
  // Blanks are dropped rather than offered: "no value" is what clearing the filter already means.
  assert.match(body, /\.filter\(Boolean\)/);
});

test("the endpoint is guarded like the board it describes", () => {
  /*
   * No permission of its own, deliberately: these are values off rows the caller is already being
   * served by `/page`, narrowed by the same scope. A finer permission here would be a screen held to
   * a rule its own data is not (CLAUDE.md Rule 4), and a wider one would leak a vertical's CRMs to
   * somebody who cannot open it.
   */
  assert.match(ROUTES, /router\.get\("\/column-values", columnValues\);/);
  const routeAt = ROUTES.indexOf('router.get("/column-values"');
  const idRouteAt = ROUTES.indexOf('router.get("/:id"');
  assert.ok(routeAt !== -1 && (idRouteAt === -1 || routeAt < idRouteAt), "a fixed segment must sit above the \":id\" routes");
  const handler = CONTROLLER.slice(CONTROLLER.indexOf("async function columnValues("), CONTROLLER.indexOf("// Resolves \"select all\""));
  // Both narrowings, resolved together: the scope says what this reader may see at all, and `mine`
  // says which of that the board's "My Leads" switch is showing. A menu narrowed by one and not the
  // other would offer values off rows that are not on screen.
  assert.match(handler, /leadScope\(req\)/, "the menu is not narrowed to what this reader may see");
  assert.match(handler, /leadMine\(req, parsed\.data\.mine === "true"\)/, "the menu ignores the My Leads switch");
  assert.match(handler, /isCallsBoard\(parsed\.data\.board\)/, "the Calls board is answered from the lead table");
  assert.match(CONTROLLER, /const columnValuesQuerySchema = z\.object\(\{[\s\S]*?column: z\.string\(\)/);
});

test("the board asks when a menu opens, not before, and forgets when the question changes", () => {
  /*
   * There is one of these per column. Asking for every column's values up front would be a dozen
   * queries over the whole board to fill menus nobody opened.
   */
  // The board hands the table `openColumnFilter` as its `onOpen`, and the table asks it with the
  // column when - and only when - that column's menu opens. Status and the choice columns alike.
  assert.match(BOARD, /onOpen: openColumnFilter,/);
  assert.match(BOARD, /has: \(columnId\) => \["status", "choice"\]\.includes\(columnFilterKind\(columnId\)\),/);
  assert.match(TABLE, /onOpen=\{filterValues\?\.onOpen \? \(\) => filterValues\.onOpen\(column\.id\) : undefined\}/);
  /*
   * Held against the question it answers - board, tab, range - so a menu read under one board is
   * never shown under another. An answer that arrives after the reader has moved on is dropped for
   * the same reason.
   *
   * **The other filters are deliberately not part of it.** They were, so the cached answer was
   * thrown away the moment anybody filtered anything - invisible with a single-select, which closed
   * on picking, and fatal with a multi-select, where the reader is still in the menu: ticking the
   * first value emptied the list under their hand. The cost is the cascade (the list no longer
   * narrows as other columns are filtered) and the gain is a menu that does not move while it is
   * being used.
   */
  // `showingAllLeads` is part of the question too - the "My Leads" switch crossed with whether it
  // is this reader's to make. Turning it changes which rows the menu is describing, so one cached
  // against the old answer would offer values that are no longer on the board.
  assert.match(BOARD, /const columnValuesKey = useMemo\(\s*\(\) => JSON\.stringify\(\[board, activeTab, dateFrom, dateTo, showingAllLeads\]\)/);
  assert.match(BOARD, /columnValues\.key === columnValuesKey \? columnValues\.byColumn\[column\] : null/);
  assert.match(BOARD, /setColumnValues\(\(held\) => \(held\.key === columnValuesKey/);
  /*
   * And the registers are **no longer** the fallback.
   *
   * They were, on the argument that a filter offering the old list beats one offering nothing while
   * the answer is in flight. A multi-select turns that round: Select all against the fallback chose
   * values the real answer did not have, and they went on filtering the board from off the list.
   * The menu offers what the column holds, and "Loading..." while it is being asked.
   */
  assert.match(BOARD, /get: columnFilterValues,/);
  assert.match(TABLE, /options=\{filterValues \? \(filterValues\.get\(column\.id\) \|\| \[\]\) : filterChoices\[column\.id\]\}/);
});

test("the combobox says which of 'nothing yet' and 'nothing at all' it means", () => {
  const combobox = fs.readFileSync(
    path.join(__dirname, "..", "..", "frontend", "src", "components", "shared", "FilterCombobox.js"),
    "utf8",
  );
  assert.match(combobox, /\{loading \? "Loading\.\.\." : "No matches\."\}/);
  // The callback hangs off the open state rather than off one gesture: the field taking focus,
  // typing into it and the chevron all open the list, and a menu opened by the gesture nobody wired
  // would sit empty.
  assert.match(combobox, /useEffect\(\(\) => \{\n\s*if \(open\) onOpenRef\.current\?\.\(\);\n\s*\}, \[open\]\);/);
  // Through a ref, so an inline arrow - which every caller passes - does not re-ask on every render.
  assert.match(combobox, /const onOpenRef = useRef\(onOpen\);/);
});
