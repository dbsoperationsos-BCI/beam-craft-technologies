import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * The Interview register's filter row, checked as wiring.
 *
 * The register arrives a hundred rows at a time, so the table cannot answer a filter from the rows
 * it holds - it filtered the hundred scrolled into view, and a value the column plainly listed
 * answered "no records found" over a stage holding hundreds of them. Every part of the filter row
 * therefore goes through the server: what the menu offers, which rows are drawn, and which ids a
 * select-all resolves to.
 *
 * Source text rather than a rendered table, like the select-all test beside it: each line below is
 * one somebody can delete without any other test noticing, and the failure it causes is a register
 * that looks right and quietly answers over a hundred rows.
 */

const HERE = import.meta.dirname;
const src = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");
const PAGE = src("components", "hrm", "InterviewPage.js");
const DATA_TABLE = src("components", "data-table", "DataTable.js");
const SERVICE = src("services", "hrm", "interview.service.js");

test("a server-filtered table stops filtering the rows it was handed", () => {
  // Both at once would filter twice: the server answers the stage, and the table would then filter
  // that answer again against the same boxes - harmless while they agree, and a table showing
  // nothing the moment they do not (a `contains` on the server, an exact match here).
  assert.match(DATA_TABLE, /const serverFiltered = Boolean\(onColumnFilters\);/);
  assert.match(DATA_TABLE, /getFilteredRowModel: filtering && !serverFiltered \? getFilteredRowModel\(\) : undefined,/);
  // The state is still kept, because the boxes have to show what was typed into them.
  assert.match(DATA_TABLE, /onColumnFilters\?\.\(Object\.fromEntries\(resolved\.map\(\(entry\) => \[entry\.id, entry\.value\]\)\)\);/);
});

test("the register reports its filters and reads under them", () => {
  assert.match(PAGE, /onColumnFilters: setColumnFilters,/);
  assert.match(PAGE, /getCandidates\(statusQueryFor\(statusFilter\), \{ offset: append \? offset : 0, appending: append, filters: appliedFilters \}\)/);
});

test("the filters are debounced, and an unchanged set keeps its identity", () => {
  // `load` depends on the applied filters, so a fresh object on every report - including the empty
  // one the table sends when the row is first drawn - would re-read the register forever.
  assert.match(PAGE, /window\.setTimeout\(\s*\(\) => setAppliedFilters\(\(current\) => \(sameFilters\(current, columnFilters\) \? current : columnFilters\)\),/);
  assert.match(PAGE, /function sameFilters\(left, right\)/);
});

test("select-all resolves to the filtered set, not the whole stage", () => {
  // Otherwise ticking the header box over a filtered register offers "5,769" and deletes rows the
  // reader had filtered away - the worst shape this bug can take.
  assert.match(PAGE, /getCandidateIds\(statusFilter === ALL_CANDIDATE_STATUSES \? "" : statusFilter, appliedFilters\)/);
});

test("each menu is built under the other columns' filters, so they cascade", () => {
  // Column 2's menu offers what column 1's filter leaves standing. The column's own filter is left
  // out by the server, or ticking one value would narrow that menu to the one value ticked.
  assert.match(PAGE, /getCandidateColumnValues\(column, statusFilter === ALL_CANDIDATE_STATUSES \? "" : statusFilter, appliedFilters\)/);
});

test("the menu does not empty under the hand of the reader using it", () => {
  /*
   * The filters are sent with the read but are **not** part of the key the answer is cached under.
   *
   * Keyed on them, ticking a value threw the cached list away while the menu was still open - these
   * are multi-selects, so the reader is still in the menu - and after Select all it read "No
   * matches." over a filter of three. The CRM board settled this exact question the same way: the
   * list stays put while it is being used and re-narrows the next time it is opened.
   */
  assert.match(PAGE, /const columnValuesKey = statusFilter;/);
  assert.doesNotMatch(PAGE, /JSON\.stringify\(\[statusFilter, appliedFilters\]\)/);
  // A read that fails is remembered as empty rather than retried on every press; the box under the
  // menu still takes typing.
  assert.match(PAGE, /\.catch\(\(\) => setColumnValues\(\(latest\) => \(latest\.key === columnValuesKey/);
});

test("changing tab drops the filters with the selection", () => {
  // A stage is its own set of values, so a filter carried across a tab is an empty table over a
  // stage that has rows - and a filter the reader has no reason to look for.
  assert.match(PAGE, /const changeTab = useCallback\(\(next\) => \{\s*clearSelection\(\);\s*setColumnFilters\(\{\}\);\s*setAppliedFilters\(\{\}\);\s*setStatusFilter\(next\);/);
});

test("the filters travel as one encoded parameter on all three reads", () => {
  assert.match(SERVICE, /const withFilters = \(params, filters\) =>/);
  assert.equal((SERVICE.match(/withFilters\(/g) || []).length, 3);
});
