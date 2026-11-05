import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { candidateStatusCounts, statusQueryFor, ALL_CANDIDATE_STATUSES } from "../src/constants/interviewConfig.js";

/*
 * The Interview screen reads its register a page at a time.
 *
 * It used to ask for the whole table and filter it in the browser, which is why it sat on "Loading
 * candidates..." once the register ran to thousands: every row had to arrive before one could be
 * drawn. A hundred at a time now - the CRM lead board's own size - with the stage applied by the
 * server, so a tab is a query rather than a filter over everything.
 */

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");
const PAGE = read("components", "hrm", "InterviewPage.js");
const TABLE = read("components", "data-table", "DataTable.js");

test("a tab asks the server for its stage, and All narrows nothing", () => {
  assert.equal(statusQueryFor(ALL_CANDIDATE_STATUSES), "", "All is sending a status, so it would narrow the register to one");
  assert.equal(statusQueryFor("Interview Scheduled"), "Interview Scheduled");
  assert.equal(statusQueryFor(""), "");
});

test("the tab counts come from the register, not from the rows scrolled in", () => {
  /*
   * The whole point of paging is that the screen holds a hundred rows. Counting those would have
   * every tab read "100" - or worse, a number that climbs as somebody scrolls.
   */
  const counts = candidateStatusCounts([{ status: "Selected" }], { "Yet to Connect": 4000, Selected: 880 });
  assert.equal(counts.Selected, 880, "a tab is counting the page instead of the register");
  assert.equal(counts["Yet to Connect"], 4000);
  // All is the sum rather than a count of its own, so it cannot disagree with the tabs beside it.
  assert.equal(counts[ALL_CANDIDATE_STATUSES], 4880);
});

test("with no answer from the server it falls back to what it holds", () => {
  // An unanswered or failed read must leave the tabs reading something rather than nothing.
  const counts = candidateStatusCounts([{ status: "Selected" }, { status: "Selected" }, { status: "On Hold" }], null);
  assert.equal(counts[ALL_CANDIDATE_STATUSES], 3);
  assert.equal(counts.Selected, 2);
});

test("the page appends by id, so a repeated request cannot duplicate a row", () => {
  /*
   * The guard on "one read at a time" is state, not a ref - a ref read while building the import
   * config is what `react-hooks/refs` refuses. State can lag by a frame, so the append is made
   * idempotent instead: a row already on screen is never added twice, and a duplicated request
   * costs a wasted round trip rather than a duplicated candidate.
   */
  assert.match(PAGE, /const held = new Set\(current\.map\(\(candidate\) => candidate\?\.id\)\)/, "an append no longer drops rows it already holds");
  assert.match(PAGE, /page\.filter\(\(candidate\) => !held\.has\(candidate\?\.id\)\)/);
  assert.match(PAGE, /heldRef\.current >= totalRows\) return;/, "the screen will ask for pages past the end of the set");
});

test("the footer says how far through the set the reader is", () => {
  // "Total rows: 100" over a register of 5,880 is a lie the old footer told as soon as paging
  // arrived; what a reader needs is the page against the whole.
  assert.match(PAGE, /Showing \$\{candidates\.length\.toLocaleString\(\)\} of \$\{totalRows\.toLocaleString\(\)\}/);
  assert.match(PAGE, /loadingMore \? "Loading more\.\.\."/, "a page being fetched is not reported in the footer");
});

test("the register hands its paging to the page, not to the table", () => {
  assert.match(PAGE, /infiniteScroll: \{ onEndReached: loadMore \}/,
    "the table is revealing rows of its own again, which makes the footer disagree with what is drawn");
});

test("the scroll guard is a ref, because a scroll fires many times a frame", () => {
  // State lags by a frame, so a state guard starts a request per scroll event, each asking for the
  // same offset. The CRM lead board guards itself the same way.
  assert.match(PAGE, /if \(loadingRef\.current \|\| heldRef\.current >= totalRows\) return;/,
    "the screen can start a request per scroll event again");
  assert.match(PAGE, /\.finally\(\(\) => \{ loadingRef\.current = false; \}\)/, "the in-flight guard is never released");
  // And nothing on the render path touches a ref: `load` reaches JSX through the import config.
  const loadBody = PAGE.slice(PAGE.indexOf("const load = useCallback("), PAGE.indexOf("useEffect(() => { heldRef.current"));
  assert.doesNotMatch(loadBody, /loadingRef\.current|heldRef\.current/, "the reader touches a ref that JSX can reach, which react-hooks/refs refuses");
});

test("a server-paged table draws every row it was given, and reveals none of its own", () => {
  /*
   * Two counters over the same rows is what made the footer read "500" over a table showing three
   * hundred: a fetch triggered near the bottom ran ahead of a reveal that only advanced on a later
   * scroll, so the rows fetched and the rows drawn drifted apart on every page.
   *
   * A table either pages through rows it holds, or is fed pages by its page. Never both.
   */
  // `infiniteScroll` is the resolved option - on by default now - and the server-paged reading of
  // it is still whether the page passed `onEndReached`.
  assert.match(TABLE, /const serverPaged = Boolean\(infiniteScroll\?\.onEndReached\)/,
    "the table no longer knows when the page owns the paging");
  assert.match(TABLE, /const renderedRows = infiniteScroll && !serverPaged \? allRows\.slice\(0, visibleCount\) : allRows;/,
    "a server-paged table is slicing rows it was handed, so the footer and the table will disagree");
});

test("a server-paged table asks 400px from the bottom, the CRM board's own trigger", () => {
  const scroll = TABLE.slice(TABLE.indexOf("function onScroll(event)"));
  const body = scroll.slice(0, scroll.indexOf("\n  }") + 4);
  // Asking at the very bottom means reaching it and then waiting on a round trip with nothing to
  // scroll - the stall a reader reports as the table sticking on every page.
  assert.match(body, /element\.scrollHeight - element\.scrollTop - element\.clientHeight < 400/,
    "the next page is asked for too late, or at a distance the CRM board does not use");
  assert.match(body, /if \(serverPaged\)/, "the two paging arrangements are no longer kept apart");
});

test("column definitions do not depend on the rows, so appending cannot rebuild the table", () => {
  /*
   * This is what made the scroll give out at six or seven hundred rows.
   *
   * `buildTableColumns` took the rows for exactly one thing: the serial column's export value was
   * `rows.indexOf(row)`, searching the list for the row it had just been handed. So every caller's
   * `columns` memo had to list its data as a dependency - and on a screen that appends rows as it
   * scrolls, every page rebuilt all thirty column definitions and the table rebuilt itself around
   * them. The exporter passes the index instead, which also takes the export from quadratic to
   * linear: 5,880 rows was 34 million comparisons.
   */
  const CELLS = read("components", "data-table", "tableCells.js");
  // Comments stripped: the note explaining why the lookup went is allowed to name it.
  const cellsCode = CELLS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(cellsCode, /rows\.indexOf\(row\)/, "the serial column searches the rows again, which is quadratic on export");
  assert.match(CELLS, /export function buildTableColumns\(\{ fields, statusStyles/, "buildTableColumns takes the rows again, so columns depend on data");

  // And the exporter hands it over.
  const EXPORT = read("lib", "tableExport.js");
  assert.match(EXPORT, /rows\.map\(\(row, index\) =>/, "the exporter no longer knows a row's position");
  assert.match(EXPORT, /column\.value\(row, index\)/, "the position is not passed to the column");

  // The register's own memo must not list its rows, or the fix is undone at the call site.
  const memo = PAGE.slice(PAGE.indexOf("const columns = useMemo(() => buildTableColumns({"));
  const deps = memo.slice(memo.indexOf("}), ["), memo.indexOf("]);") + 3);
  assert.doesNotMatch(deps, /visibleCandidates/, "the columns are rebuilt on every appended page again");
});

test("a server-paged table lays itself out fixed, so an append re-measures nothing above it", () => {
  /*
   * `table-auto` sizes columns from their contents, which means measuring every cell in every row -
   * and re-measuring all of them whenever rows are appended. At a hundred rows that is free; at
   * eleven hundred it is the jolt a reader feels each time the next page lands, and it worsens with
   * every page because the work grows with the table.
   *
   * The fixed-width path already existed for a table whose columns had been pulled by hand; a
   * server-paged one takes it from the start, so an append costs only the rows appended.
   */
  // `(serverPaged && !autoLayout)`: a server-paged table is fixed unless it asks to size to its
  // contents, which the register does not - see `table-column-resize` for the one that does.
  assert.match(TABLE, /const fixedWidth = \(resizeEnabled && Object\.keys\(shownSizing\)\.length > 0\) \|\| \(serverPaged && !autoLayout\);/,
    "a server-paged table is sizing its columns from its contents again, which re-measures the whole table on every appended page");
  // And the machinery it turns on is the one that was already there.
  assert.match(TABLE, /tableLayout: "fixed"/);
  assert.match(TABLE, /\{fixedWidth && <colgroup>/, "the fixed layout no longer declares its column widths");
});

test("a row is memoised on its record, the way the CRM lead board's row is", () => {
  /*
   * The whole reason a long table stays usable while it is scrolled, and the one thing the shared
   * table lacked that the CRM lead board has always had.
   *
   * Appending a page of a hundred rows to eleven hundred re-rendered all twelve hundred - and every
   * cell in them, tens of thousands of nodes - because the rows were drawn inline in the body's
   * `map` and nothing told React the ones above had not changed. `LeadTableRow` is `memo()`d and
   * its handlers are held at a stable identity so the memo actually holds; this is that, for every
   * table in the application.
   *
   * The comparison is on `original` rather than on TanStack's row: TanStack rebuilds its row and
   * cell objects whenever the data array changes identity, which is precisely what an append does,
   * so comparing those would defeat the memo on the one render that matters.
   */
  assert.match(TABLE, /const DataTableRow = memo\(function DataTableRow\(/, "the shared table draws its rows inline again, so every row re-renders on every append");
  assert.match(TABLE, /prev\.original === next\.original/, "the row is compared on something other than the record it draws");
  assert.doesNotMatch(TABLE, /prev\.row === next\.row/, "the row is compared on TanStack's row, which is rebuilt on every append");
  assert.match(TABLE, /prev\.renderKey === next\.renderKey/, "nothing outside the row can redraw it, so a column change would not reach the cells");
});

test("everything the memoised row compares is held at a stable identity", () => {
  /*
   * A memo that is handed a fresh function on every render is a memo that never holds - it only
   * adds a comparison to the work it was meant to save. These are the props `DataTableRow`
   * compares, so each has to keep its identity when nothing relevant has changed.
   */
  assert.match(TABLE, /const sizedStyle = useCallback\(/, "sizedStyle is rebuilt each render, which defeats the row memo entirely");
  assert.match(TABLE, /const stickyStyle = useCallback\(/, "stickyStyle is rebuilt each render, which defeats the row memo entirely");
  assert.match(TABLE, /const frozenOffsets = useMemo\(/, "frozenOffsets is a fresh array each render, so stickyStyle changes identity and every row redraws");
  assert.match(TABLE, /const rowRenderKey = useMemo\(/, "the render key is rebuilt each render, so every row redraws");
});

test("a long server-paged table draws only the rows on screen", () => {
  /*
   * Memoising the rows stopped a long table re-rendering itself on every append, but it could not
   * make the rows cost nothing. A thousand of them at thirty columns is thirty thousand cells in
   * the document, most carrying a sticky position, and a browser asked to paint that while somebody
   * flicks the scrollbar gives up and shows a blank band until it catches up - which is exactly what
   * a reader sees.
   *
   * So the rows outside the viewport are not drawn. Two spacers stand in for them, sized to the
   * height those rows would have taken, which is what keeps the scrollbar honest: it stays the
   * length it would be if every row were there, and a position in it means what it says.
   */
  assert.match(TABLE, /const windowRows = windowed \? renderedRows\.slice\(windowStart, windowEnd\) : renderedRows;/,
    "the table draws every row it holds again, however many that is");
  assert.match(TABLE, /const padTop = windowed \? windowStart \* rowHeight : 0;/, "the rows above the window are not accounted for, so the scrollbar will lie");
  assert.match(TABLE, /const padBottom = windowed \? \(renderedRows\.length - windowEnd\) \* rowHeight : 0;/, "the rows below the window are not accounted for");
  assert.match(TABLE, /\{!loading && windowRows\.map\(\(row\) => <DataTableRow/, "the body no longer draws the window");
});

test("windowing is only used where its assumptions hold", () => {
  /*
   * The spacers are one row height multiplied by a count, so every row has to be the same height -
   * which an expandable table's rows are not. And below a certain size the spacers cost more than
   * the rows they save, so a short table is left alone entirely.
   */
  // Any table that has grown past what a document paints comfortably, not only a server-paged one -
  // the assumptions that matter are the ones still named here: one row height, a measured viewport,
  // and never an expandable table, whose rows are not all the same height.
  assert.match(TABLE, /const windowed = !expandable && rowHeight > 0 && viewportHeight > 0 && renderedRows\.length > WINDOW_MIN_ROWS;/,
    "windowing is being applied to tables whose rows are not a uniform height, or that are too short to need it");
  // Measured, never assumed: density, a wrapped cell or a theme's line height all move a row's
  // height, and a wrong one shows as the window drifting away from what is on screen.
  assert.match(TABLE, /const first = bodyRef\.current\?\.querySelector\("tr\[data-row\]"\);/, "the row height is no longer measured from a real row");
  // The header sits above the rows, so scroll position alone would put the window a row or two out.
  assert.match(TABLE, /Math\.max\(0, scrollTop - bodyTop\)/, "the header's height is not allowed for, so the window drifts");
});

test("the footer still counts every row held, not the handful being drawn", () => {
  // Otherwise "Showing 40 of 5,880" as somebody scrolls, which is the window talking rather than
  // the register.
  assert.match(TABLE, /onVisibleRowsChange\?\.\(\{ total: recordCount, showing: renderedRows\.length \}\)/,
    "the reported count follows the window rather than the rows the table holds");
});

test("the board's columns are measured against the server's counts, not only the pages read", () => {
  /*
   * The board holds a hundred candidates at a time, so a column counting its cards read "40" for a
   * stage holding 212 - and only the footer said otherwise. Each column now says "40 of 212" from the
   * tab counts, which count the whole register and so stand down while a column filter narrows it.
   */
  const BOARD = read("components", "data-table", "KanbanBoard.js");
  assert.match(PAGE, /return filtering \? null : serverCounts;/, "the board is handed counts that ignore its filters");
  assert.match(PAGE, /totals=\{boardTotals\}/, "the board is not given the server's counts");
  assert.match(BOARD, /result\[OTHER_COLUMN\.value\] = Object\.entries\(totals\)\.reduce\(\(sum, \[value, count\]\) => \(named\.has\(value\) \? sum : sum \+/,
    "Other is not counted as every status no column names");
  assert.match(BOARD, /of=\{narrowed \|\| searching \? columnRows\.length : total !== null && total > columnRows\.length \? total : null\}/,
    "a partly read column no longer says how many it holds in all");
});

test("a card whose imported status is not on the list says so, and which word it holds", () => {
  // Such a candidate lands in Other, which by itself does not say what the sheet called them.
  assert.match(PAGE, /candidate\.statusKnown === false \? `Status not recognised: \$\{String\(candidate\.status \|\| ""\)\.trim\(\) \|\| "blank"\}` : ""/);
});
