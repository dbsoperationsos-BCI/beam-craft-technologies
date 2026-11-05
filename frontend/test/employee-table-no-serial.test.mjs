import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * The Employee Repository has no row-number column.
 *
 * A serial number counts positions in a page rather than describing the person in the row: it
 * renumbers itself the moment the table is sorted, filtered or paged, and this one is all three
 * constantly — so "the third one" means a different employee on every visit and cannot be quoted to
 * anybody. The number people actually quote is the Employee ID, which is a column of its own.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

const TABLE = read("components", "employees", "EmployeeTable.js");
const PAGE = read("components", "employees", "EmployeeVerificationPage.js");
const CELLS = read("components", "data-table", "tableCells.js");

test("the column is dropped from the table", () => {
  assert.match(TABLE, /\.filter\(\(column\) => column\.id !== "serial"\)/);
});

test("and from Manage Columns, not only from the header row", () => {
  /*
   * The menu is built from the default visibility map, so a key left behind there is a tick box
   * that shows and hides a column which is not on the table.
   */
  assert.match(TABLE, /delete visibility\.serial;/);
});

test("nothing is left computing a row number nobody shows", () => {
  // `startIndex` fed the serial accessor and nothing else, and the page passed a constant 0 into it.
  assert.doesNotMatch(TABLE, /startIndex/, "the table still asks for a row offset it cannot use");
  assert.doesNotMatch(PAGE, /startIndex=\{0\}/);
});

test("every other module's table keeps its Sl. No.", () => {
  /*
   * Dropped at this table rather than removed from the shared builder — Accounts, Payment Requests,
   * Tasks and Employee Reviews are unchanged, and this is the same way Employee Attendance already
   * drops it.
   */
  assert.match(CELLS, /\{ id: "serial", accessorFn: \(_, index\) => startIndex \+ index \+ 1, header: "Sl\. No\."/);
  const attendance = read("components", "hrm", "EmployeeAttendancePage.js");
  assert.match(attendance, /\.filter\(\(column\) => column\.id !== "serial"\)/, "the precedent this follows has gone");
});
