import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { groupPaymentsByProject, GROUPED_PAYMENT_TABS } from "../src/lib/scheduledPayments.mjs";

const pay = (id, projectId, overrides = {}) => ({ id, projectId, eventId: `EVT-${projectId}`, clientName: `Client ${projectId}`, category: "Advance", status: "Overdue", amount: 1000, pending: 1000, dueDate: "2026-10-01", ...overrides });

test("Due and Overdue show one row per project, its payments under it", () => {
  assert.deepEqual(GROUPED_PAYMENT_TABS, ["Due", "Overdue"]);
  const rows = groupPaymentsByProject([
    pay("a", "p1", { category: "Advance", dueDate: "2026-10-01", pending: 400 }),
    pay("b", "p2"),
    pay("c", "p1", { category: "Second", dueDate: "2026-10-20", amount: 2500, pending: 2500 }),
  ]);
  assert.deepEqual(rows.map((row) => row.id), ["project:p1", "b"], "a project sits where its earliest payment would; a lone payment stays its own row");
  const [project] = rows;
  assert.equal(project.isProjectGroup, true);
  assert.equal(project.category, "2 payments");
  assert.equal(project.dueDate, "2026-10-01");
  assert.deepEqual([project.amount, project.pending], [3500, 2900]);
  // Each payment under it is the payment itself, so its own ⋮ View / Record opens that one.
  assert.deepEqual(project.payments.map((payment) => payment.id), ["a", "c"]);
});

test("each payment keeps its own ⋮ Record; the project row has none and a double click on it opens nothing", () => {
  const table = readFileSync(new URL("../src/components/accounts/ScheduledPaymentsTable.js", import.meta.url), "utf8");
  assert.match(table, /row\.original\.isProjectGroup \? null : <OptionsMenu/);
  assert.match(table, /\{ label: "Record", onSelect: \(\) => onOpen\(row, true\) \}/);
  assert.match(table, /items=\{paymentActionItems\(row\.original, \{ canWrite, onOpen \}\)\}/);
  assert.match(table, /onRowDoubleClick=\{\(row\) => \{ if \(!row\.isProjectGroup\) onOpen\(row\); \}\}/);
  assert.match(table, /getSubRows: \(row\) => row\.payments \|\| \[\]/);
  // The CSV is the payments, never the project rows that sum them.
  assert.match(table, /shown\.flatMap\(\(row\) => \(row\.isProjectGroup \? row\.payments : \[row\]\)\)/);
  const page = readFileSync(new URL("../src/components/accounts/AccountsManagerPage.js", import.meta.url), "utf8");
  assert.match(page, /grouped=\{GROUPED_PAYMENT_TABS\.includes\(activeTab\)\}/);
});
