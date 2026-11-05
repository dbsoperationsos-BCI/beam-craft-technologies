import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");

/*
 * The Sales boards' cards offer the ⋮ their table rows offer: one function builds the items, and
 * both the row's ⋮ and the card's `cardActions` call it, so the two cannot drift apart and every
 * permission check stays where it was.
 */
test("CRD Documents: the row's ⋮ and the card's ⋮ are one list", () => {
  const page = read("components/sales/CrdDocumentsPage.js");
  assert.match(page, /const documentActions = useCallback\(\(document\) => \[/);
  assert.match(page, /items=\{documentActions\(row\.original\)\}/);
  assert.match(page, /cardActions=\{documentActions\}/);
  // Send Link stays a write.
  assert.match(page, /\.\.\.\(canWrite \? \[\{ label: linkNotSent\(document\)/);
});

test("Quotations: the row's ⋮ and the card's ⋮ are one list", () => {
  const page = read("components/sales/QuotationPage.js");
  assert.match(page, /const quotationActions = useCallback\(\(quotation\) => \[/);
  assert.match(page, /items=\{quotationActions\(row\.original\)\}/);
  assert.match(page, /cardActions=\{quotationActions\}/);
});

test("Schedule: the card offers the row's own ⋮", () => {
  const page = read("components/sales/MeetingsPage.js");
  assert.match(page, /items=\{rowActions\(row\)\}/);
  assert.match(page, /cardActions=\{rowActions\}/);
});

test("CRM Reports has no row ⋮, so its cards have none either", () => {
  assert.doesNotMatch(read("components/sales/CrmReportsPage.js"), /cardActions=/);
});

test("CRM leads: the board card's ⋮ is the table row's, beside the open button", () => {
  const page = read("components/sales/CRMPage.js");
  assert.match(page, /const leadActionItems = useCallback\(\(lead, open\) => \[/);
  assert.match(page, /items=\{leadActionItems\(lead, openLeadRow\)\}/);
  // On the board the lead opens through `openBoardLead`, since the table's rows are not loaded there.
  assert.match(page, /const boardLeadActions = useCallback\(\(lead\) => leadActionItems\(lead, openBoardLead\)/);
  assert.match(page, /leadActions=\{boardLeadActions\}/);
  // Delete stays on the deletion permission.
  assert.match(page, /\.\.\.\(canDeleteLeads && !lead\.callRow \? \[\{ label: "Delete"/);

  const board = read("components/sales/CrmKanbanBoard.js");
  assert.match(board, /actions=\{leadActions\?\.\(lead\)\}/);
  assert.match(board, /const menu = Array\.isArray\(actions\) && actions\.length > 0;/);
  // The open button closes before the ⋮: a button never holds another, and the frame is dragged.
  assert.match(board, /<\/button>\n\s+\{menu && <span className="shrink-0 p-1\.5"><OptionsMenu/);
  assert.match(board, /return <div\n[\s\S]*?draggable/);
});
