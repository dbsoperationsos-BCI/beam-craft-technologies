import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const DASHBOARD = fs.readFileSync(new URL("../src/components/hrm/TaskDashboard.js", import.meta.url), "utf8");

test("Recent Tasks opens on a Task ID column of its own, before the task", () => {
  assert.match(DASHBOARD, /\{ id: "taskCode", header: "Task ID", accessorFn: \(row\) => row\.taskCode \|\| "", width: 130 \},\n\s+\{ id: "task", header: "Task",/);
  assert.doesNotMatch(DASHBOARD, /text-\[10px\] text-slate-400">\{row\.original\.taskCode\}/, "the ID is no longer a grey line under the name");
});

test("the column saying whose task it is reads Who Given", () => {
  assert.match(DASHBOARD, /\{ id: "side", header: "Who Given", accessorFn:/);
});
