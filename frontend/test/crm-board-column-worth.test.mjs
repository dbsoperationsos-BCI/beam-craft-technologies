import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const BOARD = fs.readFileSync(new URL("../src/components/sales/CrmKanbanBoard.js", import.meta.url), "utf8");
const PAGE = fs.readFileSync(new URL("../src/components/sales/CRMPage.js", import.meta.url), "utf8");

test("a column's first page asks what its leads are worth; the trend's one-row reads do not", () => {
  assert.match(PAGE, /if \(offset === 0 && limit > 1\) query\.set\("values", "true"\);/);
});

test("under the heading: Converted for the Converted column and Est. for every other; the count stays up top", () => {
  assert.match(BOARD, /if \(offset === 0\) setWorth\(response\?\.values \|\| null\);/);
  // The shared `ColumnAmount`, the one Bookings draws its converted value with.
  assert.match(BOARD, /aside=\{loaded && worth \? <ColumnAmount/);
  assert.match(BOARD, /label=\{column\.value === "Converted" \? "Converted" : "Est\."\}/);
  assert.match(BOARD, /amount=\{column\.value === "Converted" \? worth\.converted : worth\.estimated\}/);
});

test("every project board - Bookings, Projects, Post Production - shows each card's converted value and each column's total", () => {
  const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
  const statuses = read("../src/lib/projectStatuses.mjs");
  assert.match(statuses, /export const convertedValueOf = \(project\) => Number\(project\?\.initialConvertedValue\) \|\| 0;/);
  assert.match(statuses, /convertedValueOf\(project\) \? formatRupees\(convertedValueOf\(project\)\) : ""/);
  assert.match(statuses, /label: "Converted",\n\s+amount: rows\.reduce\(\(sum, project\) => sum \+ convertedValueOf\(project\), 0\)/);
  for (const page of ["../src/components/sales/SalesManagerPage.js", "../src/components/project-management/ProjectsPage.js", "../src/components/project-management/ProjectWorkflowModulePage.js"]) {
    assert.match(read(page), /card=\{PROJECT_BOARD_CARD\}\n\s+columnAmount=\{money \? \(rows\) => moneyColumn\(rows, money\) : projectColumnAmount\}/, page);
  }
  // Over the cards the column shows - narrowed by its period and search, as its count is.
  assert.match(read("../src/components/data-table/KanbanBoard.js"), /const amount = columnAmount \? columnAmount\(rows, column\) : null;/);
});
