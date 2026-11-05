import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { crmBoardColumnStatuses } from "../src/lib/crmBoardOrder.mjs";

/*
 * Every lead the table lists on a tab stands in exactly one column of the board on that tab.
 *
 * The board is server-paged per column - each lane is `status IN [its value]` - so there is no
 * catch-all lane, and a fixed list of columns hid every lead whose status it did not name: an
 * imported "Inactive" (`statusDisplaySql` passes unknown text through), Converted & Followup on a
 * vertical other than Qua Qua (the server reads it onto that label everywhere), and an Unassigned
 * lead shown to a reader who manages nobody (one they typed in, through `createdByUserId`).
 */

const src = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");
const PAGE = src("components", "sales", "CRMPage.js");

const DUM_DUM = ["Followup", "Interested", "CNA", "Converted", "Rejected", "Invalid"];
const QUA_QUA = ["Followup", "Interested", "CNA", "Converted & Followup", "Converted", "Rejected", "Invalid"];

test("before the statuses are known the board stands in its fixed columns, as it always did", () => {
  assert.deepEqual(crmBoardColumnStatuses({ offered: DUM_DUM, occurring: null, showUnassigned: false }),
    ["Yet to connect", ...DUM_DUM, "Project deleted"]);
  assert.deepEqual(crmBoardColumnStatuses({ offered: DUM_DUM, occurring: null, showUnassigned: true }),
    ["Unassigned", "Yet to connect", ...DUM_DUM, "Project deleted"]);
});

test("a status the vertical does not offer gets a column after the known ones, before Project deleted", () => {
  const columns = crmBoardColumnStatuses({ offered: DUM_DUM, occurring: ["CNA", "Inactive", "Followup", "Yet to connect"] });
  assert.deepEqual(columns, ["Yet to connect", ...DUM_DUM, "Inactive", "Project deleted"]);
});

test("Converted & Followup has a column on any vertical whose leads read as it, in the pipeline's place", () => {
  const columns = crmBoardColumnStatuses({ offered: DUM_DUM, occurring: ["Converted & Followup", "Inactive"] });
  assert.deepEqual(columns, ["Yet to connect", "Followup", "Interested", "CNA", "Converted & Followup", "Converted", "Rejected", "Invalid", "Inactive", "Project deleted"]);
  // And never twice where it is offered already.
  assert.deepEqual(crmBoardColumnStatuses({ offered: QUA_QUA, occurring: ["Converted & Followup"] }),
    ["Yet to connect", ...QUA_QUA, "Project deleted"]);
});

test("Unassigned is shown whenever this reader's tab holds an unassigned lead, managing anybody or not", () => {
  assert.deepEqual(crmBoardColumnStatuses({ offered: DUM_DUM, occurring: ["Unassigned"], showUnassigned: false })[0], "Unassigned");
  // Still offered to somebody who hands work out, as before, even with none on the tab.
  assert.deepEqual(crmBoardColumnStatuses({ offered: DUM_DUM, occurring: [], showUnassigned: true })[0], "Unassigned");
  assert.equal(crmBoardColumnStatuses({ offered: DUM_DUM, occurring: ["CNA"], showUnassigned: false }).includes("Unassigned"), false);
});

test("each occurring status lands in exactly one column, compared as MySQL compares the filter", () => {
  const occurring = ["interested", "Inactive", "INACTIVE", " Hot ", "Project deleted", "", null];
  const columns = crmBoardColumnStatuses({ offered: DUM_DUM, occurring, showUnassigned: true });
  const keys = columns.map((status) => status.toLowerCase());
  assert.equal(new Set(keys).size, keys.length, "no status has two columns");
  for (const status of occurring.filter((value) => String(value ?? "").trim())) {
    assert.ok(keys.includes(String(status).trim().toLowerCase()), `${status} has no column`);
  }
  assert.deepEqual(columns.slice(-3), ["Inactive", "Hot", "Project deleted"]);
});

test("the page learns the statuses from the Status column's own scoped values, and only on the board", () => {
  assert.match(PAGE, /const \[boardStatuses, setBoardStatuses\] = useState\(null\);/);
  // The very endpoint the filter menus read: same board, tab, range, filters and My Leads as the rows.
  assert.match(PAGE, /fetchColumnValues\("status"\)/);
  assert.match(PAGE, /if \(view !== "board" \|\| board === CALLS_BOARD\) return undefined;/);
  assert.match(PAGE, /\}, \[view, board, activeTab, appliedFilters, dateFrom, dateTo, showingAllLeads, leadsChangedAt\]\);/);
  assert.match(PAGE, /occurring: boardStatuses,/);
  // The state is declared above the memo that reads it, or every render throws.
  assert.ok(PAGE.indexOf("const [boardStatuses, setBoardStatuses] = useState(null);") < PAGE.indexOf("const pipelineColumns = useMemo("));
});
