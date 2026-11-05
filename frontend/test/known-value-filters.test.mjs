import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/*
 * Known-value columns: a column whose answers come from a list the studio keeps - its own list (a
 * status column's statuses) or a reference list it names (branch, department, vertical) - always
 * filters by a dropdown of that list, whatever the rows on screen hold.
 */
const CELLS = fs.readFileSync(new URL("../src/components/data-table/tableCells.js", import.meta.url), "utf8");
const TABLE = fs.readFileSync(new URL("../src/components/data-table/DataTable.js", import.meta.url), "utf8");

function load() {
  const start = CELLS.indexOf("export const KNOWN_LISTS");
  const end = CELLS.indexOf("/**\n * What to call a stored file in a cell:");
  const source = CELLS.slice(start, end).replaceAll("export ", "");
  const displayValue = (value) => (value === null || value === undefined || value === "" ? "—" : String(value));
  const partsStart = CELLS.indexOf("export const listParts");
  const listParts = new Function(`${CELLS.slice(partsStart, CELLS.indexOf("\n", partsStart)).replace("export ", "")}; return listParts;`)();
  return { listParts, ...new Function("displayValue", "listParts", `${source}; return { KNOWN_LISTS, knownListFor, knownFilterValues };`)(displayValue, listParts) };
}
const { knownListFor, knownFilterValues, listParts } = load();

test("branch, department and vertical columns are recognised by key or heading", () => {
  assert.equal(knownListFor({ accessorKey: "sourceBranch", header: "Branch" }), "branches");
  assert.equal(knownListFor({ accessorKey: "dept", header: "Department" }), "departments");
  assert.equal(knownListFor({ accessorKey: "verticals", header: "Verticals" }), "verticals");
  assert.equal(knownListFor({ accessorKey: "employeeName", header: "Employee Name" }), null);
  assert.equal(knownListFor({ accessorKey: "x", meta: { knownList: "branches" } }), "branches", "a column may say so itself");
});

test("the dropdown lists the whole known list, plus any value only the rows hold", () => {
  const rows = [{ branch: "Erode" }, { branch: "Old Branch" }, { branch: "" }];
  assert.deepEqual(knownFilterValues(rows, "branch", undefined, [["Erode", "Coimbatore", "Tiruppur"]]), ["Coimbatore", "Erode", "Old Branch", "Tiruppur"]);
  assert.deepEqual(knownFilterValues([], "branch", undefined, [["Erode"]]), ["Erode"], "an empty table still offers the list");
  // Ten rows in ten branches would read as an identifier column to the row-based guess; not here.
  const many = Array.from({ length: 10 }, (_, index) => ({ branch: `Branch ${index}` }));
  assert.equal(knownFilterValues(many, "branch", undefined, []).length, 10);
});

test("a status column carries its module's statuses, and the table uses known lists before guessing", () => {
  assert.match(CELLS, /type === "status" && statusStyles && Object\.keys\(statusStyles\)\.length \? \{ filterOptions: Object\.keys\(statusStyles\) \}/);
  assert.match(TABLE, /if \(ownList \|\| listKind\) \{\s*choices\[key\] = knownFilterValues\(/);
  assert.match(TABLE, /filterKindFor\(column\) === "text"\) continue;/, "a column marked text keeps its typed box");
});

test("a cell naming several departments offers each once, and ticking one finds every row naming it", () => {
  const rows = [{ dept: "Management" }, { dept: "Management, Sales" }, { dept: "Operations, Accounts" }];
  assert.deepEqual(knownFilterValues(rows, "dept", undefined, [["Management", "Sales"]]), ["Accounts", "Management", "Operations", "Sales"]);
  assert.deepEqual(listParts("Management, Sales"), ["Management", "Sales"]);
  assert.deepEqual(listParts("₹1,000"), ["₹1,000"], "a number keeps its comma");
  assert.match(CELLS, /query\.includes\(shown\) \|\| listParts\(shown\)\.some\(\(part\) => query\.includes\(part\)\)/);
});
