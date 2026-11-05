import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { moneyColumn, moneyFlag } from "../src/lib/projectMoney.mjs";

const read = (file) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");

/*
 * The project Boards show what a project's Payments tab shows - received and still to receive - for
 * somebody who may see it, totalled under each column and "To receive ₹…" on a card still owed.
 */
const money = { p1: { received: 281500, spent: 37500, toReceive: 833 }, p2: { received: 5000, spent: 0, toReceive: 0 } };

test("a column totals its projects once each; a card shows only what is still owed", () => {
  // Pre Production and Production stand one project in several columns, and twice in none.
  const rows = [{ id: "p1:Planned", projectId: "p1" }, { id: "p1:Hold", projectId: "p1" }, { id: "p2" }];
  assert.equal(moneyColumn(rows, money).text, "Client paid ₹2,86,500 · Balance due ₹833");
  assert.equal(moneyColumn([{ id: "p9" }], money), null, "nothing known, nothing shown");
  assert.equal(moneyFlag({ projectId: "p1" }, money), "Balance due ₹833");
  assert.equal(moneyFlag({ id: "p2" }, money), "", "nothing owed, no tag");
});

test("only somebody the Payments tab answers is asked, and only while the Board is open", () => {
  const hook = read("components/project-management/useProjectMoney.js");
  assert.match(hook, /hasPermission\("ACCOUNTS", "Cash Management", "READ"\)\n\s+&& \["Projects", "Production", "Pre Production"\]\.some\(\(feature\) => hasPermission\("PROJECT", feature, "READ"\)\)/);
  assert.match(hook, /return allowed && key \? money : null;/);
  for (const [file, rows, fallback] of [
    ["components/project-management/ProjectsPage.js", "projects", "projectColumnAmount"],
    ["components/sales/SalesManagerPage.js", "tabProjects", "projectColumnAmount"],
    ["components/project-management/ProjectWorkflowModulePage.js", "moduleProjects", "projectColumnAmount"],
    ["components/project-management/PreProductionPage.js", "boardRows", "\\(rows\\) => columnShoots\\(rows\\)"],
    ["components/project-management/production/ProductionPage.js", "boardRows", "\\(rows\\) => columnShoots\\(rows\\)"],
  ]) {
    const page = read(file);
    assert.match(page, new RegExp(`const money = useProjectMoney\\(onBoard \\? ${rows} : null\\);`), file);
    // Without the money, the board keeps the figure it had.
    assert.match(page, new RegExp(`columnAmount=\\{money \\? \\(rows\\) => moneyColumn\\(rows, money\\) : ${fallback}\\}\\n\\s+cardFlag=\\{money \\? \\(row\\) => moneyFlag\\(row, money\\) : undefined\\}`), file);
  }
});
