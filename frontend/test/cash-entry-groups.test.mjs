import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { groupCashEntriesByProject, GROUPED_CASH_TABS } from "../src/lib/cashEntryGroups.mjs";

const entry = (id, projectId, entryType, amount, entryDate, overrides = {}) => ({
  id, projectId, entryType, amount, entryDate, projectCode: projectId && `EVT-${projectId}`, clientName: projectId && `Client ${projectId}`,
  signedAmount: entryType === "Spent" ? -amount : amount, ...overrides,
});

test("All, Received and Spent show one row per project, money in and out under it", () => {
  assert.deepEqual(GROUPED_CASH_TABS, ["All", "Received", "Spent"]);
  const rows = groupCashEntriesByProject([
    entry("r1", "p1", "Received", 10000, "2026-10-30"),
    entry("x1", null, "Spent", 500, "2026-10-29"),
    entry("s1", "p1", "Spent", 2500, "2026-10-28"),
    entry("r2", "p2", "Received", 4000, "2026-10-27"),
    entry("r3", "p1", "Received", 5000, "2026-10-26"),
  ]);
  assert.deepEqual(rows.map((row) => row.id), ["project:EVT-p1", "x1", "r2"], "an entry on no project, or alone on its project, stays its own row");
  const [project] = rows;
  assert.equal(project.isProjectGroup, true);
  // Grouped by its Event ID, which leads the row.
  assert.equal(project.entryId, "EVT-p1 · 3 entries");
  assert.equal(project.projectCode, "EVT-p1");
  assert.equal(project.entryType, "Received / Spent");
  assert.equal(project.entryDate, "2026-10-30", "its latest date");
  assert.equal(project.amount, 12500, "money in less money out where the two mix");
  assert.deepEqual(project.entries.map((member) => member.id), ["r1", "s1", "r3"]);
  // All one way: the plain total.
  const [received] = groupCashEntriesByProject([entry("a", "p9", "Received", 100, "2026-10-01"), entry("b", "p9", "Received", 250, "2026-10-02")]);
  assert.equal(received.amount, 350);
});

test("each entry keeps its own ⋮ and tick box; the project row's box ticks its entries, it opens nothing, and the CSV lists entries", () => {
  const table = readFileSync(new URL("../src/components/accounts/AccountsTable.js", import.meta.url), "utf8");
  assert.match(table, /renderActions: \(entry\) => \(entry\.isProjectGroup \? null : <OptionsMenu/);
  // The project row is not a record; its box ticks the entries under it (`subRows`).
  assert.match(table, /\{ \.\.\.selection, subRows: true,/);
  assert.match(table, /canSelectRow: \(row\) => !row\.isProjectGroup/);
  assert.match(table, /onRowClick=\{entryOnly\(onRowClick\)\}/);
  assert.match(table, /onRowDoubleClick=\{entryOnly\(onRowDoubleClick\)\}/);
  assert.match(table, /rows\.flatMap\(\(row\) => \(row\.isProjectGroup \? row\.entries : \[row\]\)\)/);
  const page = readFileSync(new URL("../src/components/accounts/AccountsManagerPage.js", import.meta.url), "utf8");
  /*
   * Grouping is the **reader's** choice now, not the tab's: it was always on for the three tabs with
   * a project behind them, and Accounts Manager carries a Group / Ungroup switch instead, ungrouped
   * by default - "what came in today" is the question the page is opened with, and a project row sits
   * where its first entry would, so today's receipt sat under a wedding from August.
   *
   * It is still offered only on the tabs a project can group (`GROUPED_CASH_TABS`), and never on the
   * Board, which groups by its own columns.
   */
  assert.match(page, /const canGroup = GROUPED_CASH_TABS\.includes\(activeTab\) && !onBoard;/);
  assert.match(page, /const grouped = canGroup && grouping === "grouped";/);
  assert.match(page, /grouped=\{grouped\}/);
  assert.match(page, /\{canGroup && <CashEntryGroupingSwitch value=\{grouping\} onChange=\{setGrouping\} \/>\}/);
});
