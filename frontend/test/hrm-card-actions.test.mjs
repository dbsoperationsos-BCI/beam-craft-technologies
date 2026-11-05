import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../src/components/hrm/${file}`, import.meta.url), "utf8");

/*
 * The HRM Boards whose table rows carry a ⋮ hand the card the same function the row's ⋮ is built
 * from, so the two offer the same items under the same permission - and nothing without write.
 */
test("Salary advance and recovery cards offer the row's ⋮, and nothing without write", () => {
  for (const file of ["PayrollAdvanceSection.js", "PayrollRecoverySection.js"]) {
    const source = read(file);
    assert.match(source, /const rowActionItems = useCallback\(\(row\) => \(canWrite \? \[/);
    assert.match(source, /items=\{rowActionItems\(row\.original\)\}/);
    assert.match(source, /cardActions=\{rowActionItems\}/);
  }
});

test("Referral cards offer the row's ⋮, and nothing without write", () => {
  const source = read("EmployeeReferralsPage.js");
  assert.match(source, /const rowActionItems = useCallback\(\(referral\) => \{\n\s+if \(!canWrite\) return undefined;/);
  assert.match(source, /const items = rowActionItems\(row\.original\);/);
  assert.match(source, /cardActions=\{rowActionItems\}/);
});

test("Speak-up review cards offer the row's decisions, only to somebody who may decide", () => {
  const source = read("SpeakUpReviewPanel.js");
  assert.match(source, /if \(!canDecide \|\| row\.status !== "PENDING"\) return undefined;/);
  assert.match(source, /const items = rowActionItems\(row\);/);
  assert.match(source, /cardActions=\{rowActionItems\}/);
});

test("Task cards offer the row's ⋮, and nothing without write", () => {
  const source = read("TasksPage.js");
  assert.match(source, /const taskActionItems = useCallback\(\(task\) => \{\n\s+if \(!canWrite\) return undefined;/);
  assert.match(source, /items=\{taskActionItems\(task\)\}/);
  assert.match(source, /cardActions=\{taskActionItems\}/);
});

test("Boards whose table rows have no ⋮ get none either", () => {
  assert.doesNotMatch(read("PayrollMainSection.js"), /cardActions/);
  assert.doesNotMatch(read("SpeakUpPanel.js"), /cardActions/);
});
