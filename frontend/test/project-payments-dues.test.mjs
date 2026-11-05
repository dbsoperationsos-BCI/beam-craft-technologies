import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("a project's Payments tab lists its unpaid scheduled payments and records against them in Accounts' own panel", () => {
  const view = read("src/components/project-management/ProjectPaymentsView.js");
  assert.match(view, /getScheduledPayments\(\{ projectId \}\)/);
  assert.match(view, /<DuesList dues=\{dues\} onRecord=\{canRecordCash \? \(due\) => void recordDue\(due\) : null\}/, "Record only for somebody who may write cash");
  assert.match(view, /<ScheduledPaymentPanel[\s\S]*?recording[\s\S]*?zIndexClassName="z-\[130\]"/);
  const service = read("src/services/accounts/scheduled-payments.service.js");
  assert.match(service, /\$\{base\}\?projectId=\$\{encodeURIComponent\(projectId\)\}/);
  const controller = fs.readFileSync(new URL("../../backend/src/modules/accounts/scheduled-payments/controller.js", import.meta.url), "utf8");
  assert.match(controller, /where: \{ \.\.\.\(await inReach\(req\)\), \.\.\.\(projectId \? \{ projectId \} : \{\}\) \}/, "still inside the caller's reach");
});

test("a date range with no last day - Upcoming - or no days - Unknown date - opens without crashing", () => {
  const filter = read("src/components/project-management/shoot-board/ShootDateRangeFilter.js");
  assert.match(filter, /range\?\.from \? \{ from: dayKey\(range\.from\), to: dayKey\(range\.to \|\| range\.from\) \} : \{ from: "", to: "" \}/);
});
