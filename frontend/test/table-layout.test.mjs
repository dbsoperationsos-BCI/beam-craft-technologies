import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { EXPAND_COLUMN_ID, SELECT_COLUMN_ID, effectiveFreezeCount, reorderColumnOrder, slugify, tableLayoutKey, weaveColumnOrder } from "../src/components/data-table/tableLayout.js";

/*
 * How a table's arrangement is named, and how a remembered one is laid back over the table.
 *
 * This matters more now than when the order lived in the browser. A layout is saved against the
 * login and read back on another machine, possibly weeks later and possibly after the table itself
 * has gained or lost a column - so "what happens when the stored order no longer matches the
 * table" is the normal case rather than the edge one, and it must never drop a column or draw one
 * twice. Either would read as data missing from the screen.
 */

/* --------------------------------------------------------------------------- naming the layout */

test("a table's name becomes a key that survives being a key", () => {
  assert.equal(slugify("Employee Repository"), "employee-repository");
  assert.equal(slugify("Asset Requests / Management"), "asset-requests-management");
  assert.equal(slugify("  Padded  "), "padded");
  // Never empty and never punctuation: the key is written into a URL path and matched against a
  // pattern on the server, and a table named only in symbols must still have somewhere to save to.
  assert.equal(slugify(""), "table");
  assert.equal(slugify("!!!"), "table");
  assert.equal(slugify(null), "table");
});

test("the key is namespaced, so one table cannot collide with the density or a remembered tab", () => {
  assert.equal(tableLayoutKey(slugify("Employee Repository")), "table:employee-repository");
  assert.ok(tableLayoutKey("x").startsWith("table:"));
});

/* ----------------------------------------------------------------- laying a saved order back on */

const columns = (...ids) => ids.map((id) => (id.startsWith("*") ? { id: id.slice(1), meta: { fixed: true } } : { id }));
const ids = (...args) => weaveColumnOrder(...args);

test("no saved order leaves the table in the order it declares", () => {
  assert.deepEqual(ids(columns("a", "b", "c"), null), ["a", "b", "c"]);
  assert.deepEqual(ids(columns("a", "b", "c"), []), ["a", "b", "c"]);
});

test("a saved order is applied", () => {
  assert.deepEqual(ids(columns("a", "b", "c"), ["c", "a", "b"]), ["c", "a", "b"]);
});

test("a fixed column keeps its slot however the rest were dragged", () => {
  // The expand chevron leads and the actions menu trails; neither is a drag source or a drop
  // target, so a stored order must not be able to move them - hiding the chevron would leave the
  // rows under a row unreachable.
  assert.deepEqual(ids(columns("*expand", "a", "b", "*actions"), ["b", "a"]), ["expand", "b", "a", "actions"]);
});

test("a column added since the layout was saved lands after the ones it names", () => {
  // The case that makes this safe to read back weeks later: the table gained a column in a release
  // the saved order predates. It must appear, and it must not be put at the front of an
  // arrangement somebody chose on purpose.
  assert.deepEqual(ids(columns("a", "b", "c"), ["c", "a"]), ["c", "a", "b"]);
});

test("a column added since lands beside the column it follows in the table, not at the far end", () => {
  // Payroll's extra Earnings column, declared after Incentive: it must stay in the Earnings band of a
  // layout somebody dragged, not land past the Payment columns.
  assert.deepEqual(ids(columns("base", "incentive", "travel", "total", "net"), ["incentive", "base", "total", "net"]), ["incentive", "travel", "base", "total", "net"]);
  // One with nothing before it still goes after the rest rather than to the front.
  assert.deepEqual(ids(columns("first", "a", "b"), ["b", "a"]), ["b", "a", "first"]);
});

test("a column the table no longer has is ignored rather than leaving a hole", () => {
  assert.deepEqual(ids(columns("a", "b"), ["b", "gone", "a"]), ["b", "a"]);
});

test("every column is drawn exactly once, whatever the saved order says", () => {
  // The one invariant worth stating outright: a duplicate or a dropped id here is a column missing
  // from the screen, which reads as missing data rather than as a layout fault.
  const table = columns("*expand", "a", "b", "c", "*actions");
  for (const stored of [["c", "c", "a"], ["b"], [], ["z", "y"], ["c", "b", "a", "extra"]]) {
    const woven = ids(table, stored);
    assert.deepEqual([...woven].sort(), ["a", "actions", "b", "c", "expand"], `stored order ${JSON.stringify(stored)} lost or repeated a column`);
    assert.equal(new Set(woven).size, woven.length);
  }
});

/* --------------------------------------------------- how many columns "freeze 2" actually pins */

/*
 * The chevron is a real 34px column at index 0 of every expandable table, so a freeze count taken
 * straight off the leaf columns pinned it and called it one - and the first column anybody can read
 * only pinned on the second notch. It is still frozen whenever anything is, because it belongs to
 * its row; it just is not one of the columns the reader is counting.
 */

const withChevron = [{ id: "__expand" }, { id: "quotationId" }, { id: "quotationName" }, { id: "brandName" }, { id: "actions" }];
const plain = [{ id: "employeeId" }, { id: "employeeName" }, { id: "branch" }, { id: "actions" }];

test("the chevron is frozen with the first column, not counted as it", () => {
  assert.equal(effectiveFreezeCount(withChevron, 1), 2, "freeze 1 pins the chevron and Quotation ID");
  assert.equal(effectiveFreezeCount(withChevron, 2), 3);
  assert.equal(effectiveFreezeCount(withChevron, 3), 4);
});

test("a table without a chevron is untouched", () => {
  // Employee Repository and every other non-expandable table must count exactly as they always did.
  assert.equal(effectiveFreezeCount(plain, 1), 1);
  assert.equal(effectiveFreezeCount(plain, 2), 2);
  assert.equal(effectiveFreezeCount(plain, 3), 3);
});

test("freezing nothing freezes nothing, chevron included", () => {
  // Zero has to stay zero: the chevron is frozen *with* a column, never on its own.
  assert.equal(effectiveFreezeCount(withChevron, 0), 0);
  assert.equal(effectiveFreezeCount(plain, 0), 0);
});

test("a count past the end of the table stops at the end", () => {
  assert.equal(effectiveFreezeCount(withChevron, 99), withChevron.length);
  assert.equal(effectiveFreezeCount(plain, 99), plain.length);
});

test("nothing to freeze, or nothing sensible asked for, answers zero", () => {
  assert.equal(effectiveFreezeCount([], 3), 0);
  assert.equal(effectiveFreezeCount(undefined, 3), 0);
  assert.equal(effectiveFreezeCount(withChevron, -2), 0);
  assert.equal(effectiveFreezeCount(withChevron, "abc"), 0);
});

/* ------------------------------------------------------------------------- dragging a column */

/*
 * The move a drag makes, and the inverse of `weaveColumnOrder` above: one writes the stored order,
 * the other reads it back - so the arrangement a reader builds is the same array that is read
 * back, whichever release wrote it.
 */
const ORDER = ["name", "phone", "city", "remarks", "source"];

test("a column dropped before another lands in front of it", () => {
  assert.deepEqual(reorderColumnOrder(ORDER, "source", "city", "before"), ["name", "phone", "source", "city", "remarks"]);
});

test("a column dropped after another lands behind it", () => {
  assert.deepEqual(reorderColumnOrder(ORDER, "name", "remarks", "after"), ["phone", "city", "remarks", "name", "source"]);
});

test("a column dragged rightwards lands where the drop bar was, not one short of it", () => {
  /*
   * The whole reason the source is removed before the target is located. With "name" still in the
   * array, "city" sits at index 2 and inserting after it puts the column at 3 - which is *before*
   * "city" once "name" is finally taken out, one place short of where the reader let go.
   */
  assert.deepEqual(reorderColumnOrder(ORDER, "name", "city", "after"), ["phone", "city", "name", "remarks", "source"]);
  // And leftwards, which the same arithmetic has to leave alone.
  assert.deepEqual(reorderColumnOrder(ORDER, "source", "phone", "before"), ["name", "source", "phone", "city", "remarks"]);
});

test("the ends of the table are reachable", () => {
  assert.deepEqual(reorderColumnOrder(ORDER, "source", "name", "before"), ["source", "name", "phone", "city", "remarks"]);
  assert.deepEqual(reorderColumnOrder(ORDER, "name", "source", "after"), ["phone", "city", "remarks", "source", "name"]);
});

test("a drop that says nothing changes nothing, and says so by identity", () => {
  /*
   * The same array back, not a copy: both callers save only when the answer differs from what they
   * passed, so a drop on a column's own header must not write a preference and re-render the table.
   */
  assert.equal(reorderColumnOrder(ORDER, "city", "city", "before"), ORDER);
  assert.equal(reorderColumnOrder(ORDER, "", "city", "before"), ORDER);
  assert.equal(reorderColumnOrder(ORDER, "city", "unknown-column", "after"), ORDER);
});

test("no column is lost or duplicated, wherever it is dropped", () => {
  // The failure that reads as data missing from the screen rather than as a layout fault.
  for (const source of ORDER) {
    for (const target of ORDER) {
      for (const side of ["before", "after"]) {
        const next = reorderColumnOrder(ORDER, source, target, side);
        assert.equal(next.length, ORDER.length, `${source} -> ${side} ${target} changed the column count`);
        assert.deepEqual([...next].sort(), [...ORDER].sort(), `${source} -> ${side} ${target} lost or repeated a column`);
      }
    }
  }
});

test("an order that is not an array is treated as no order at all", () => {
  // It arrives from the server, so it can be anything an older release or a stale cache left.
  assert.deepEqual(reorderColumnOrder(undefined, "a", "b", "after"), []);
  assert.deepEqual(reorderColumnOrder(null, "a", "b", "after"), []);
});

/*
 * The tick-box column is pinned whatever Freeze Columns says - with nothing frozen as well - so the
 * selection never scrolls out of reach. Freeze Columns itself still counts only the data columns.
 */
test("the tick-box column is always pinned, separately from Freeze Columns", () => {
  const selectable = [{ id: SELECT_COLUMN_ID }, { id: "name" }, { id: "phone" }];
  assert.equal(effectiveFreezeCount(selectable, 0), 1, "nothing frozen still pins the tick box");
  assert.equal(effectiveFreezeCount(selectable, 1), 2, "freeze 1 pins the tick box and the first data column");
  const both = [{ id: SELECT_COLUMN_ID }, { id: EXPAND_COLUMN_ID }, { id: "name" }];
  assert.equal(effectiveFreezeCount(both, 0), 1, "only the tick box - the chevron waits for a freeze");
  assert.equal(effectiveFreezeCount(both, 1), 3);
  assert.equal(effectiveFreezeCount([{ id: "name" }], 0), 0, "a table with no tick box pins nothing");
});

test("the tick box pinned on its own wears no frozen-column divider", () => {
  const table = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "data-table", "DataTable.js"), "utf8");
  assert.match(table, /boxShadow: frozen && index === effectiveFreezeCount - 1 && column\.id !== SELECT_COLUMN_ID \?/);
});
