import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const PAGE = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "hrm", "TasksPage.js"), "utf8");

test("Duplicate Task is offered only on a task written by hand", () => {
  // A task raised from a speak-up or a feedback issue carries `canDuplicate: false` from the server.
  assert.match(PAGE, /if \(canWrite && task\.canDuplicate\) items\.push\(\{ label: "Duplicate Task"/);
});

test("the ⋮ reads View, Edit Task, Duplicate Task, Cancel Task, Delete Task - the two that end a task last", () => {
  const order = ["\"View\"", "\"Edit Task\"", "\"Duplicate Task\"", "\"Cancel Task\"", "\"Delete Task\""].map((label) => PAGE.indexOf(`label: ${label}`));
  for (const at of order) assert.notEqual(at, -1);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});
