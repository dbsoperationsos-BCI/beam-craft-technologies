import test from "node:test";
import assert from "node:assert/strict";

import { ALL_STATUSES, TASK_STATUS_FILTERS, taskStatusCounts, tasksForStatus } from "../src/constants/taskConfig.js";

/*
 * The count on each status tab.
 *
 * It showed nothing at all, and the reason was upstream of the tab bar: the status was sent to the
 * server, so the browser only ever held the rows for the status it was showing. Every other tab had
 * nothing to count. The fix was to fetch the view whole and filter here, which is why these two
 * functions have to agree — a count that disagreed with the rows its tab opens is worse than no
 * count, because it reads as authoritative.
 *
 * The case that catches a lazy implementation is **Cancelled**: it has no tab of its own but its
 * tasks are still in the list, so `All` has to count them even though nothing else does.
 */

const tasks = [
  { id: 1, status: "PENDING" },
  { id: 2, status: "PENDING" },
  { id: 3, status: "IN_PROGRESS" },
  { id: 4, status: "COMPLETED" },
  { id: 5, status: "CANCELLED" },
];

test("All counts every task, including the cancelled ones with no tab of their own", () => {
  assert.equal(taskStatusCounts(tasks)[ALL_STATUSES], 5);
});

test("each status counts its own", () => {
  const counts = taskStatusCounts(tasks);
  assert.equal(counts.PENDING, 2);
  assert.equal(counts.IN_PROGRESS, 1);
  assert.equal(counts.COMPLETED, 1);
  assert.equal(counts.CANCELLED, 1);
});

test("a status nothing is in counts nothing rather than going missing", () => {
  // The tab still renders, so the count has to resolve — `undefined` would print "(NaN)" or drop
  // the brackets and read as a tab that has not loaded.
  const counts = taskStatusCounts(tasks);
  assert.equal(counts.REVERTED ?? 0, 0);
});

test("every count matches the rows its own tab opens", () => {
  // The property that actually matters: what the label promises is what pressing it shows.
  const counts = taskStatusCounts(tasks);
  for (const filter of TASK_STATUS_FILTERS) {
    assert.equal(counts[filter.id] ?? 0, tasksForStatus(tasks, filter.id).length, filter.id);
  }
});

test("All shows everything and a status shows only its own", () => {
  assert.equal(tasksForStatus(tasks, ALL_STATUSES).length, 5);
  assert.deepEqual(tasksForStatus(tasks, "PENDING").map((task) => task.id), [1, 2]);
});

test("an empty view counts zero rather than failing", () => {
  assert.equal(taskStatusCounts([])[ALL_STATUSES], 0);
  assert.equal(taskStatusCounts(undefined)[ALL_STATUSES], 0);
  assert.deepEqual(tasksForStatus(undefined, "PENDING"), []);
});

test("filtering hands back a new list rather than the one it was given", () => {
  // The table sorts and slices what it is handed; handing back the state array itself would let it
  // be reordered underneath the counts.
  assert.notEqual(tasksForStatus(tasks, ALL_STATUSES), tasks);
});
