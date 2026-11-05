import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { SKIPPED_TAB, boardStatusOf, matchesTab, rowsForTab, tabCountsFor } from "../src/lib/payrollTabs.mjs";

const ADVANCE = fs.readFileSync(new URL("../src/components/hrm/PayrollAdvanceSection.js", import.meta.url), "utf8");
const RECOVERY = fs.readFileSync(new URL("../src/components/hrm/PayrollRecoverySection.js", import.meta.url), "utf8");

/*
 * Which deductions somebody has moved off a month on the Main Page was answerable only by filtering
 * the Skipped Months column by hand. It is a tab now, on all three screens that have skips.
 */

const row = (status, skippedMonths = []) => ({ status, skippedMonths });

test("Skipped reads the months moved as well as the status", () => {
  assert.equal(SKIPPED_TAB, "Skipped");
  assert.equal(matchesTab(row("Pending", ["2026-11-01"]), SKIPPED_TAB), true);
  assert.equal(matchesTab(row("Pending"), SKIPPED_TAB), false);
  // A row that has never been near a skip has no such field at all.
  assert.equal(matchesTab({ status: "Active" }, SKIPPED_TAB), false);
  assert.equal(rowsForTab(undefined, SKIPPED_TAB).length, 0, "no rows yet is not a crash");
});

test("a deduction that has been taken leaves Skipped, whatever it was moved through", () => {
  /*
   * The skip is kept on the row for good - it is what the Skipped Months column reads - so without
   * this an advance moved in November and taken in December would sit under Skipped for ever, beside
   * the ones genuinely being pushed month after month. Once the money is back it is Deducted.
   */
  const skip = ["2026-11-01"];
  assert.equal(matchesTab(row("Deducted", skip), SKIPPED_TAB), false, "an advance that has been taken");
  assert.equal(matchesTab(row("Deducted", skip), "Deducted"), true, "and it reads under Deducted");
  assert.equal(matchesTab(row("Completed", skip), SKIPPED_TAB), false, "a recovery or policy breach run that has finished");
  assert.equal(matchesTab(row("Completed", skip), "Completed"), true);
});

test("a skipped deduction still owed keeps its status, so it is on both tabs", () => {
  // Skipping moves when a deduction is taken; until then it is still owed, so Pending stays the
  // honest "still to come" list and Skipped answers a different question of the same rows.
  const skippedAndPending = row("Pending", ["2026-11-01"]);
  assert.equal(matchesTab(skippedAndPending, "Pending"), true);
  assert.equal(matchesTab(skippedAndPending, SKIPPED_TAB), true);
  assert.equal(matchesTab(row("Active", ["2026-11-01"]), SKIPPED_TAB), true, "and a run still going");
});

test("the counts are per tab, and All is every row", () => {
  const rows = [row("Pending"), row("Pending", ["2026-11-01"]), row("Deducted", ["2026-09-01", "2026-10-01"])];
  assert.deepEqual(tabCountsFor(rows, ["All", "Pending", "Deducted", SKIPPED_TAB]), {
    All: 3, Pending: 2, Deducted: 1, Skipped: 1,
  });
  assert.deepEqual(rowsForTab(rows, SKIPPED_TAB), [rows[1]], "the deducted one has left the list");
});

test("all three screens carry the tab, and read it from the one definition", () => {
  // Advance Salary, and the one component that serves Recovery and Policy Breach.
  assert.match(ADVANCE, /const TABS = \["All", "Pending", "Deducted", SKIPPED_TAB\];/);
  assert.match(RECOVERY, /const TABS = \["All", "Active", "Completed", SKIPPED_TAB\];/);
  for (const source of [ADVANCE, RECOVERY]) {
    assert.match(source, /from "@\/lib\/payrollTabs\.mjs"/);
    assert.match(source, /tabCountsFor\(rows, TABS\)/);
    assert.match(source, /rowsForTab\(rows, activeTab\)/);
    // The hand-written status filter each one had cannot answer Skipped, so neither keeps a copy.
    assert.doesNotMatch(source, /rows\.filter\(\(row\) => row\.status === activeTab\)/);
  }
});

test("on the Board a skipped deduction still owed is under Skipped, and a settled one under its status", () => {
  assert.equal(boardStatusOf(row("Pending", ["2026-11"])), SKIPPED_TAB);
  assert.equal(boardStatusOf(row("Active", ["2026-11"])), SKIPPED_TAB);
  assert.equal(boardStatusOf(row("Deducted", ["2026-11"])), "Deducted");
  assert.equal(boardStatusOf(row("Completed", ["2026-11"])), "Completed");
  assert.equal(boardStatusOf(row("Pending")), "Pending");
  for (const section of [ADVANCE, RECOVERY]) {
    assert.match(section, /import \{ SKIPPED_TAB, boardStatusOf, rowsForTab, tabCountsFor \} from "@\/lib\/payrollTabs\.mjs";/);
    assert.match(section, /statusOf=\{boardStatusOf\}/);
    assert.doesNotMatch(section, /const boardStatusOf = \(row\) => row\.status;/);
    assert.match(section, /\[SKIPPED_TAB\]: "bg-sky-500"/);
  }
});
