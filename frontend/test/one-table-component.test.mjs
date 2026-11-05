import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * One table component, and one small one - and no `<table>` anywhere else.
 *
 * The application had three answers to "how is a table drawn": `DataTable`, the CRM board's own
 * `<table>` with its own row, header, filter row and arrangement hook, and the Schedule's own on
 * top of that - plus fifteen small lists inside forms and dialogs, each spelling out a header, a
 * body and an empty-state line of its own. Every one of them was a place for the next correction
 * to miss, and two of them did miss: the cell clipping and the column filters were each fixed on
 * one table and not the other.
 *
 * So the CRM board and the Schedule draw through `DataTable`, with what only they did - the
 * server's sort, a calendar under a date column, columns sized to their contents, a right-click
 * menu - added to it as props that every other table leaves off. The small lists draw through
 * `SimpleTable`. This file is the tripwire: a `<table>` written anywhere else is the fourth copy
 * starting again.
 */

const HERE = import.meta.dirname;
const SRC = path.join(HERE, "..", "src");
const read = (...parts) => fs.readFileSync(path.join(SRC, ...parts), "utf8");

/** Every .js file under src/, recursively. */
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : full.endsWith(".js") ? [full] : [];
  });
}

/** The lines of a file that are code rather than comment - a `<table>` named in a comment is history, not markup. */
const codeLines = (text) => text.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line));

test("no component draws its own <table>", () => {
  const allowed = new Set(["components/data-table/DataTable.js", "components/data-table/SimpleTable.js"]);
  const offenders = walk(SRC)
    .filter((file) => !allowed.has(path.relative(SRC, file)))
    .filter((file) => codeLines(fs.readFileSync(file, "utf8")).some((line) => line.includes("<table")))
    .map((file) => path.relative(SRC, file));
  assert.deepEqual(offenders, [], `a table is drawn by hand again in: ${offenders.join(", ")}`);
});

test("the CRM board and the Schedule draw through DataTable", () => {
  for (const [name, file] of [["the CRM board", "CRMPage.js"], ["the Schedule", "MeetingsPage.js"]]) {
    const source = read("components", "sales", file);
    assert.match(source, /import DataTable from "@\/components\/data-table\/DataTable";/, `${name} no longer imports DataTable`);
    assert.match(source, /<DataTable\n/, `${name} no longer renders a DataTable`);
  }
  // The hook that arranged a hand-drawn table is gone with the last table it arranged.
  assert.equal(fs.existsSync(path.join(SRC, "components", "data-table", "useTableArrangement.js")), false, "useTableArrangement is back");
});

test("what only those two did is a prop on the table, off by default", () => {
  const table = read("components", "data-table", "DataTable.js");
  // The page's own sort and filters, where the page owns them.
  assert.match(table, /const controlledSort = features\.sorting && typeof features\.sorting === "object" && features\.sorting\.onChange \? features\.sorting : null;/);
  assert.match(table, /manualSorting: Boolean\(controlledSort\),/);
  assert.match(table, /const controlledFilters = serverFiltered && features\.filters && typeof features\.filters === "object" \? features\.filters : null;/);
  // Columns sized to their contents until one is pulled - the CRM board's layout.
  assert.match(table, /const autoLayout = features\.layout === "auto";/);
  // A calendar, a clock or a typed list under a heading, where the column says so.
  assert.match(table, /filterKindFor\(column\.columnDef\) === "date"/);
  assert.match(table, /filterKindFor\(column\.columnDef\) === "time"/);
  assert.match(table, /filterKindFor\(column\.columnDef\) === "combobox"/);
  // A right-click, a hover tint, a table id and the page's own scroll handle.
  assert.match(table, /onContextMenu=\{onRowContextMenu \? \(event\) => onRowContextMenu\(original, event\) : undefined\}/);
  assert.match(table, /rowHoverClassName = "hover:bg-slate-50",/);
  assert.match(table, /<table id=\{tableId\}/);
  assert.match(table, /if \(scrollerRef\) scrollerRef\.current = node;/);
});

test("the CRM board keeps what only it knows, and hands the table the rest", () => {
  const crm = read("components", "sales", "CRMPage.js");
  // The board's own rules, still its own: what a cell says, which columns take a calendar or a
  // clock, and the server's values for a list.
  assert.match(crm, /accessorFn: \(lead\) => getLeadCellValue\(lead, column\.id\),/);
  assert.match(crm, /const kind = columnFilterKind\(column\.id\);/);
  assert.match(crm, /filterValues: leadFilterValues,/);
  // The table's, asked for by name: the board's layout, its sort, its scroll and its row menu.
  assert.match(crm, /layout: "auto",/);
  assert.match(crm, /sorting: \{ sort, onChange: setSort \},/);
  assert.match(crm, /infiniteScroll: \{ onEndReached: loadMoreLeads \},/);
  assert.match(crm, /onRowContextMenu=\{openLeadRowMenu\}/);
  // The arrangement is kept under the key the board's own hook always used, so nothing anybody
  // arranged is lost by the move.
  assert.match(crm, /columnOrderKey=\{`CRM \$\{board\}`\}/);
  // And the header keeps the board's own Update Details over a selection.
  assert.match(crm, /publish: false,/);
});

test("the row handlers the table's memo compares are stable", () => {
  /*
   * The table's rows are memoised and compare the handlers they are given. A fresh arrow on every
   * render of a 10,000-line page would redraw every row on every render - which is the fault the
   * memo exists to remove, and the one typing in a filter box used to trip.
   */
  const crm = read("components", "sales", "CRMPage.js");
  for (const name of ["activateLeadRow", "openLeadRow", "openLeadRowMenu", "renderLeadActions", "selectionHeaderLabel"]) {
    assert.match(crm, new RegExp(`const ${name} = useCallback\\(`), `${name} is rebuilt every render`);
  }
  const schedule = read("components", "sales", "MeetingsPage.js");
  for (const name of ["selectRow", "rowActions", "renderRowActions"]) {
    assert.match(schedule, new RegExp(`const ${name} = useCallback\\(`), `${name} is rebuilt every render`);
  }
});

test("SimpleTable owns the structure and a caller only says what is in it", () => {
  const simple = read("components", "data-table", "SimpleTable.js");
  // Three families of list, and a caller's own classes laid over any part of one.
  assert.match(simple, /const VARIANTS = \{\s*\n\s*card: \{/);
  assert.match(simple, /plain: \{/);
  assert.match(simple, /form: \{/);
  assert.match(simple, /const part = \(name\) => join\(styles\[name\], classNames\[name\]\);/);
  // The empty line, the loader and the footer are drawn once, here.
  assert.match(simple, /\{!loading && rows\.length === 0 && emptyMessage && \(/);
  assert.match(simple, /<Loader label=\{loadingMessage\} \/>/);
  assert.match(simple, /\{footer && <tfoot>\{footer\}<\/tfoot>\}/);
  // A record that is more than one row draws its own rows; the header is still the columns'.
  assert.match(simple, /if \(renderRow\) return renderRow\(row, index\);/);
});
