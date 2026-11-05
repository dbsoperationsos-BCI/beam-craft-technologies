import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { branchRows, branchScheduleEntries, rowBranches, scheduleBranches } from "../src/lib/meetingSources.js";

/*
 * Calendar → the branch filter: the branches the entries on it are in, and one branch's entries -
 * with the holidays and the viewer's own attendance, which belong to no branch, kept whichever.
 */

const entries = [
  { id: "shoot:1", kind: "shoot", branch: { id: 3, name: "Erode TN" } },
  { id: "project:1", kind: "project", branch: { id: 2, name: "Coimbatore TN" } },
  { id: "meeting:1", kind: "meeting", branch: { id: 3, name: "Erode TN" } },
  { id: "holiday:1", kind: "holiday", branch: null },
  { id: "attendance:2026-10-01", kind: "attendance", branch: null },
];

test("the branches offered are those the entries are in, once each, by name", () => {
  assert.deepEqual(scheduleBranches(entries), [{ id: 2, name: "Coimbatore TN" }, { id: 3, name: "Erode TN" }]);
  assert.deepEqual(scheduleBranches([]), []);
});

test("a branch picked keeps its entries and those of no branch; none picked keeps all", () => {
  assert.deepEqual(branchScheduleEntries(entries, ["3"]).map((entry) => entry.id), ["shoot:1", "meeting:1", "holiday:1", "attendance:2026-10-01"]);
  // Several at once, since the filter is a multi-select: the union, and the branchless entries.
  assert.deepEqual(branchScheduleEntries(entries, ["3", "2"]).map((entry) => entry.id), entries.map((entry) => entry.id));
  // Nothing ticked is every branch, whichever way the emptiness arrives.
  for (const none of [[], "", null, undefined, ["", "abc"]]) {
    assert.equal(branchScheduleEntries(entries, none).length, entries.length, `${JSON.stringify(none)} narrows nothing`);
  }
  // One id on its own still answers, so a caller that was never changed keeps working.
  assert.deepEqual(branchScheduleEntries(entries, "3").map((entry) => entry.id), ["shoot:1", "meeting:1", "holiday:1", "attendance:2026-10-01"]);
});

test("the list's rows: a meeting by its lead's branch, a project by its own, an interview by the candidate's", () => {
  const rows = [
    { id: "meeting:1", day: "2026-10-14", meeting: { lead: { branchId: 3, branchName: "Erode TN" } } },
    { id: "project:1", day: "2026-10-20", project: { branchId: 2, sourceBranch: "Coimbatore TN" } },
    { id: "interview:1", day: "2026-11-02", interview: { branch: { id: 3, name: "Erode TN" } } },
    { id: "attendance:1", day: "2026-10-14", attendance: {} },
  ];
  assert.deepEqual(rowBranches(rows), [{ id: 2, name: "Coimbatore TN" }, { id: 3, name: "Erode TN" }]);
  assert.deepEqual(branchRows(rows, ["3"]).map((row) => row.id), ["meeting:1", "interview:1", "attendance:1"]);
  assert.deepEqual(branchRows(rows, ["3", "2"]).map((row) => row.id), rows.map((row) => row.id));
  assert.deepEqual(branchRows(rows, []).map((row) => row.id), rows.map((row) => row.id));
});

test("both views offer the branch, as a multi-select with the row's own controls", () => {
  const page = fs.readFileSync(path.join(process.cwd(), "src", "components", "sales", "MeetingsPage.js"), "utf8");
  // Several branches at once, header-sized, and in `leadingActions` - the slot for a control that
  // scopes what the page shows - rather than beside the heading where it used to sit.
  assert.match(page, /leadingActions=\{<MultiSelectField\n\s*hideLabel\n\s*size="sm"\n\s*label="Branch"/);
  assert.match(page, /values=\{branchIds\}\n\s*onChange=\{setBranchIds\}/);
  // Kept between the two views, and offering the branches whichever view is open is in.
  assert.match(page, /options=\{\(activeView === "calendar" \? calendarBranches : listBranches\)\.map\(/);
  assert.match(page, /\{activeView === "calendar" && <Dropdown\s+mode="switch"\s+ariaLabel="Calendar period"/);
  assert.match(page, /const allRows = useMemo\(\(\) => branchRows\(sourceRowsAll, branchIds\), \[sourceRowsAll, branchIds\]\);/);
  assert.doesNotMatch(page, /listPeriod|listAnchor|All dates/);
});
