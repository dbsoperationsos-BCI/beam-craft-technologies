import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { employmentStatusLabel } from "../src/lib/employmentStatus.mjs";

const read = (file) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");

/*
 * User Management: somebody serving notice reads "Active (Serving Notice)" in Employment Status -
 * on the table, its CSV, the Board card, the Info panel and the record view - not a bare "Active".
 */
test("a person serving notice reads their status with (Serving Notice) after it", () => {
  assert.equal(employmentStatusLabel({ employmentStatus: "Active", dateOfRelieving: "2026-11-30" }), "Active (Serving Notice)");
  assert.equal(employmentStatusLabel({ employmentStatus: "in Training", dateOfRelieving: "2026-11-30" }), "in Training (Serving Notice)");
  assert.equal(employmentStatusLabel({ employmentStatus: "Active" }), "Active");
  // Left already: the relieving date is history, not notice.
  assert.equal(employmentStatusLabel({ employmentStatus: "Relieved", dateOfRelieving: "2026-10-01" }), "Relieved");
  assert.equal(employmentStatusLabel({}), "");
});

test("the table, its CSV, the Board card and both panels read it; colour and filter stay on the stored status", () => {
  const table = read("components/employees/EmployeeTable.js");
  assert.match(table, /column\.accessorKey === "employmentStatus" \? \{/);
  assert.match(table, /exportValue: employmentStatusLabel,/);
  assert.match(table, /<TableCellValue value=\{row\.original\.employmentStatus\} type="status" statusStyles=\{statusStyles\} statusLabel=\{employmentStatusLabel\(row\.original\)\} \/>/);
  assert.match(read("components/data-table/tableCells.js"), /<span className="truncate">\{statusLabel \|\| displayValue\(value\)\}<\/span>/);
  const page = read("components/employees/EmployeeVerificationPage.js");
  assert.match(page, /meta: \(row\) => \[employmentStatusLabel\(row\),/);
  assert.match(page, /<DataTableInfoPanel title="Info" entity=\{shownRecord\(infoEmployee\)\}/);
  assert.match(page, /<RecordViewPanel title=\{viewingRow\.employeeName \|\| "Record"\} entity=\{shownRecord\(viewingRow\)\}/);
});
