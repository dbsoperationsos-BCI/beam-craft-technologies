import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../src/components/${file}`, import.meta.url), "utf8");

/*
 * A Board card's ⋮ is its table row's ⋮: each board below passes `cardActions` built by the very
 * function that fills the row's menu, so the two cannot drift apart - nor offer a control the
 * row's permission checks leave out.
 */
test("ProjectDataTable's project row ⋮ is one exported function, used by the table and by boards", () => {
  const table = read("data-table/ProjectDataTable.js");
  assert.match(table, /export function projectRowActionItems\(project, \{[^}]*\bcan \}\)/);
  assert.match(table, /items=\{projectRowActionItems\(project, \{ \.\.\.options, can: hasPermission \}\)\}/);
  assert.match(table, /export function useProjectRowActions\(options\) \{/);
  assert.match(table, /return \(project\) => projectRowActionItems\(project, \{ \.\.\.options, can: hasPermission, onJump:/);
});

test("Projects, Bookings & Converted and the workflow boards hand their board the table's own ⋮", () => {
  for (const file of ["project-management/ProjectsPage.js", "sales/SalesManagerPage.js", "project-management/ProjectWorkflowModulePage.js"]) {
    const page = read(file);
    assert.match(page, /const projectActions = useProjectRowActions\(\{/, file);
    assert.match(page, /cardActions=\{projectActions\}/, file);
    assert.match(page, /initialTab=\{(boardTab|viewingTab)\}/, `${file}: "View activity" opens the record on Activity`);
  }
  // The same permission answers the tables are handed.
  const projects = read("project-management/ProjectsPage.js");
  assert.match(projects, /onUpdateStatus: canPlanProjects \? \(project\) => setStatusTarget\(\{ project \}\) : undefined,/);
  assert.match(projects, /onSendBack: canWrite \? setSendingBack : undefined,/);
  assert.match(projects, /readOnly: !canPlanProjects && !canEditSale,/);
  const sales = read("sales/SalesManagerPage.js");
  assert.match(sales, /onDuplicate: canWrite \? \(project\) => void openDuplicate\(project\) : undefined,/);
  assert.match(sales, /canEditSale: canWrite,/);
  assert.match(sales, /readOnly: !canWrite,/);
  assert.match(read("project-management/ProjectWorkflowModulePage.js"), /board: moduleKey,[\s\S]*?readOnly: true,/);
});

test("Pre Production and Production: a card is a project, so it takes the project row's ⋮", () => {
  for (const file of ["project-management/PreProductionPage.js", "project-management/production/ProductionPage.js"]) {
    const page = read(file);
    assert.match(page, /const projectActions = useCallback\(\(project\) => \[/, file);
    assert.match(page, /items=\{projectActions\(row\.original\)\}/, file);
    assert.match(page, /cardActions=\{projectActions\}/, file);
  }
});

test("Client Gifts and Feedback: the row's ⋮ function is the card's", () => {
  const gifts = read("project-management/ClientGiftsPage.js");
  assert.match(gifts, /items=\{giftActions\(row\.original\)\}/);
  assert.match(gifts, /cardActions=\{giftActions\}/);
  // The table drops its ⋮ column without write, so the card has none either.
  assert.match(gifts, /const giftActions = useCallback\(\(row\) => \(canWrite \? statuses/);
  const feedback = read("project-management/FeedbackPage.js");
  assert.match(feedback, /items=\{feedbackActions\(row\.original\)\}/);
  assert.match(feedback, /cardActions=\{feedbackActions\}/);
});

test("Project Settings' service and deliverable cards offer their rows' ⋮, lifted over the settings panel", () => {
  const panel = fs.readFileSync(new URL("../src/components/project-management/ProjectSettingsPanel.js", import.meta.url), "utf8");
  assert.match(panel, /cardActions=\{cardActions\}\n\s+cardMenuProps=\{\{ menuZIndexClassName: layers\.menuOverPanel \}\}/);
  assert.match(panel, /items=\{serviceActionItems\(row\)\}/);
  assert.match(panel, /cardActions=\{serviceActionItems\}/);
  assert.match(panel, /items=\{deliverableActionItems\(row\)\}/);
  assert.match(panel, /cardActions=\{\(row\) => \(row\.isLine \? null : deliverableActionItems\(row\)\)\}/);
});
