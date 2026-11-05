import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * On the board, the tab counts follow the vertical being read.
 *
 * The table's page read is what sets them, and it stands down on the board - so switching the
 * vertical there re-read every column and left the tab labels on the vertical before.
 */
const PAGE = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "CRMPage.js"), "utf8");

test("the board reads the tab counts itself, with the columns' query and no column status", () => {
  const start = PAGE.indexOf("The tab counts, on the board.");
  assert.notEqual(start, -1);
  const block = PAGE.slice(start, PAGE.indexOf("Nothing is read for a table nobody is looking at.", start));
  assert.match(block, /if \(view !== "board"\) return undefined;/);
  // The same query builder the columns use - board, tab, filters, range, My Leads - with no status.
  assert.match(block, /leadPageQuery\(\{ view: activeTab, offset: 0, limit: 1 \}\)/);
  assert.match(block, /if \(response\?\.counts\) setServerCounts\(response\.counts\);/);
  // Re-read when the board's query changes (the vertical is part of it) or a lead is written.
  assert.match(block, /\}, \[view, leadPageQuery, activeTab, leadsChangedAt\]\);/);
  assert.match(PAGE, /const leadPageQuery = useCallback\([\s\S]*?\}\); \}, \[board, sort, appliedFilters, dateFrom, dateTo, showingAllLeads\]\);/);
});
