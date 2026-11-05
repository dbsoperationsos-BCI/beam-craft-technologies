import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { OVERDUE, daysOverdue, taskIsOverdue, taskStatusCounts, tasksForStatus } from "../src/constants/taskConfig.js";

const TODAY = "2026-10-31";
const task = (id, status, dueOn, extra = {}) => ({ id, status, dueOn, ...extra });

test("a task is overdue when its due day has passed and it is still owed", () => {
  assert.equal(daysOverdue(task(1, "PENDING", "2026-10-28T00:00:00.000Z"), "given", TODAY), 3);
  assert.equal(daysOverdue(task(2, "IN_PROGRESS", "2026-10-30"), "given", TODAY), 1);
  // Finished & sent back but not yet approved is still owed to whoever set it.
  assert.equal(taskIsOverdue(task(3, "SUBMITTED", "2026-10-01"), "given", TODAY), true);
});

test("due today, not yet due, finished, called off or undated is never overdue", () => {
  assert.equal(taskIsOverdue(task(1, "PENDING", TODAY), "given", TODAY), false, "due today is not late yet");
  assert.equal(taskIsOverdue(task(2, "PENDING", "2026-11-05"), "given", TODAY), false);
  assert.equal(taskIsOverdue(task(3, "COMPLETED", "2026-10-01"), "given", TODAY), false);
  assert.equal(taskIsOverdue(task(4, "CANCELLED", "2026-10-01"), "given", TODAY), false);
  assert.equal(taskIsOverdue(task(5, "PENDING", null), "given", TODAY), false);
  // Passed on to somebody else: no longer this reader's to owe.
  assert.equal(taskIsOverdue(task(6, "PENDING", "2026-10-01", { passedOn: true }), "given", TODAY), false);
  // In My Tasks, work you sent back is done on your side.
  assert.equal(taskIsOverdue(task(7, "SUBMITTED", "2026-10-01"), "mine", TODAY), false);
});

test("the Overdue tab lists exactly what its count says, and every task keeps its status tab", () => {
  const rows = [task(1, "PENDING", "2000-01-01"), task(2, "IN_PROGRESS", "2000-01-01"), task(3, "COMPLETED", "2000-01-01"), task(4, "PENDING", "2999-01-01")];
  const counts = taskStatusCounts(rows, "given");
  assert.equal(counts[OVERDUE], 2);
  assert.deepEqual(tasksForStatus(rows, OVERDUE, "given").map((row) => row.id), [1, 2]);
  assert.equal(counts.PENDING, 2, "an overdue Pending task is still counted under Pending");
});

test("the table marks a late due date in red under every tab, and the board has no Overdue column", () => {
  const page = fs.readFileSync(new URL("../src/components/hrm/TasksPage.js", import.meta.url), "utf8");
  assert.match(page, /filter\.id !== ALL_STATUSES && filter\.id !== OVERDUE/);
  assert.match(page, /const late = daysOverdue\(row\.original, view\?\.id\);/);
  assert.match(page, /className="font-medium text-red-600"/);
});
