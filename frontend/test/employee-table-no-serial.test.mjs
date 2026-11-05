import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * No table has a row-number column - Employees, Accounts, Payment Requests, Tasks, Interviews,
 * Speak Up, Employee Reviews and Attendance alike.
 *
 * A serial number counts positions in a page rather than describing the person in the row: it
 * renumbers itself the moment the table is sorted, filtered or paged, and this one is all three
 * constantly — so "the third one" means a different record on every visit and cannot be quoted to
 * anybody. The number people actually quote is the record's own ID, which is a column of its own.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

const TABLE = read("components", "employees", "EmployeeTable.js");
const PAGE = read("components", "employees", "EmployeeVerificationPage.js");
const CELLS = read("components", "data-table", "tableCells.js");

test("no table built from the shared column builder has a Sl. No. column", () => {
  assert.doesNotMatch(CELLS, /id: "serial"|Sl\. No\./, "the shared builder adds a serial column again");
  // Nor anything left removing one: the builder makes none, so there is nothing to filter or untick.
  assert.doesNotMatch(TABLE, /"serial"|visibility\.serial/);
  const attendance = read("components", "hrm", "attendanceRequests.js");
  assert.doesNotMatch(attendance, /"serial"|visibility\.serial/);
});

test("nothing is left computing a row number nobody shows", () => {
  // `startIndex` fed the serial accessor and nothing else.
  assert.doesNotMatch(CELLS, /startIndex/);
  assert.doesNotMatch(TABLE, /startIndex/, "the table still asks for a row offset it cannot use");
  assert.doesNotMatch(PAGE, /startIndex=\{0\}/);
  for (const file of [["accounts", "AccountsTable.js"], ["accounts", "AccountsManagerPage.js"], ["accounts", "PaymentRequestsPage.js"], ["hrm", "InterviewPage.js"], ["hrm", "TasksPage.js"]]) {
    assert.doesNotMatch(read("components", ...file), /startIndex/, `${file.join("/")} still passes a row offset`);
  }
});
