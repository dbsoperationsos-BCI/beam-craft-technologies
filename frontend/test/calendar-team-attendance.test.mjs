import test from "node:test";
import assert from "node:assert/strict";
import { branchScheduleEntries, permittedSources, scheduleBranches, sourceRows, sourceScheduleEntries } from "../src/lib/meetingSources.js";
import { scheduleEntryCell } from "../src/lib/schedule.js";

/*
 * The calendar's Team Attendance layer: offered to an administrator only, **one** count chip per
 * day whatever statuses it holds, narrowed by the branch filter to that branch's people, and one
 * table row per person.
 *
 * One chip, not one per status: a day with two absences and three on leave drew two chips, and in
 * a busy month they stacked under the shoots and the meetings until the cell was a column of counts
 * nobody could take in. The pop-up behind the chip is where the day is read, status by status.
 */

const people = [
  { employeeId: 1, employeeName: "Anu", employeeCode: "E1", branchId: 10, branchName: "Erode", department: "Editing", status: "Absent" },
  { employeeId: 2, employeeName: "Bala", employeeCode: "E2", branchId: 20, branchName: "Salem", department: "Sales", status: "Absent" },
];
const absent = { id: "teamAttendance:2026-10-05", kind: "teamAttendance", title: "Attendance · 2", day: "2026-10-05", branch: null, meta: { status: "Absent", count: 2, groups: [{ status: "Absent", count: 2 }], people } };
/** A day holding both: two away without leave and one on it - one chip, three names, two headings. */
const mixed = {
  id: "teamAttendance:2026-10-06",
  kind: "teamAttendance",
  title: "Attendance · 3",
  day: "2026-10-06",
  branch: null,
  meta: {
    // No single status, so the chip takes the kind's own colour rather than one of the two.
    status: null,
    count: 3,
    groups: [{ status: "Absent", count: 2 }, { status: "On leave", count: 1 }],
    people: [...people, { employeeId: 3, employeeName: "Chitra", employeeCode: "E3", branchId: 10, branchName: "Erode", department: "Sales", status: "On leave" }],
  },
};

test("Team Attendance is offered to an administrator only", () => {
  const can = () => true;
  assert.ok(!permittedSources(can).some((source) => source.value === "team-attendance"));
  assert.ok(permittedSources(can, { isAdministrator: true }).some((source) => source.value === "team-attendance"));
});

test("its chips are coloured by status and drawn under their own source and under All", () => {
  assert.match(scheduleEntryCell(absent), /bg-red-50/);
  assert.match(scheduleEntryCell({ ...absent, meta: { ...absent.meta, status: "On leave" } }), /bg-purple-50/);
  // A day of two kinds has no one colour to take, so it takes the layer's own.
  assert.doesNotMatch(scheduleEntryCell(mixed), /bg-red-50|bg-purple-50/);
  assert.deepEqual(sourceScheduleEntries("team-attendance", [absent]), [absent]);
  assert.deepEqual(sourceScheduleEntries("all", [absent], { sources: ["team-attendance"] }), [absent]);
  assert.deepEqual(sourceScheduleEntries("all", [absent], { sources: ["meetings"] }), []);
});

test("the branch filter narrows a day to that branch's people, and offers their branches", () => {
  const [erode] = branchScheduleEntries([absent], 10);
  assert.equal(erode.title, "Attendance · 1");
  assert.deepEqual(erode.meta.people.map((person) => person.employeeName), ["Anu"]);
  assert.deepEqual(branchScheduleEntries([absent], 99), [], "nobody from that branch, no chip");
  assert.deepEqual(scheduleBranches([absent]).map((branch) => branch.name), ["Erode", "Salem"]);

  /*
   * The counts behind the chip are rebuilt from whoever is left, never carried over: Erode holds
   * one of the two absences and the one on leave, so the chip says two and the pop-up lists two.
   * The statuses narrow with them - a branch left with one kind of day colours its chip again.
   */
  const [erodeMixed] = branchScheduleEntries([mixed], ["10"]);
  assert.equal(erodeMixed.title, "Attendance · 2");
  assert.deepEqual(erodeMixed.meta.groups, [{ status: "Absent", count: 1 }, { status: "On leave", count: 1 }]);
  const [salem] = branchScheduleEntries([mixed], ["20"]);
  assert.deepEqual(salem.meta.groups, [{ status: "Absent", count: 1 }], "the status nobody is left in is dropped");
  assert.equal(salem.meta.status, "Absent", "one status left, so the chip is coloured by it again");
});

test("the pop-up reads the day status by status", () => {
  const rows = sourceRows("team-attendance", { teamAttendance: [mixed] });
  // Each person carries the status they are counted under, which is what the pop-up groups by and
  // what the table reads per row - the day's own `status` is null once it holds more than one.
  assert.deepEqual(rows.map((row) => row.teamAttendance.status), ["Absent", "Absent", "On leave"]);
});

test("the table lists one row per person per day", () => {
  const rows = sourceRows("team-attendance", { teamAttendance: [absent] });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => [row.day, row.teamAttendance.status, row.teamAttendance.person.employeeName]), [["2026-10-05", "Absent", "Anu"], ["2026-10-05", "Absent", "Bala"]]);
  assert.equal(sourceRows("all", { teamAttendance: [absent], sources: ["team-attendance"] }).length, 0, "never part of All's table");
});

test("a Team Attendance chip opens its names in a pop-up, not the side panel", async () => {
  const fs = await import("node:fs");
  const page = fs.readFileSync(new URL("../src/components/sales/MeetingsPage.js", import.meta.url), "utf8");
  assert.match(page, /if \(entry\.kind === "teamAttendance"\) \{\n\s+setTeamDay\(entry\);\n\s+return;/);
  assert.match(page, /\{teamDay && <Dialog[\s\S]*?<TeamAttendancePeople people=\{teamDay\.meta\?\.people \|\| \[\]\} \/>/);
  // And the pop-up says what the day was made of, which the one chip no longer carries.
  assert.match(page, /\(teamDay\.meta\?\.groups \|\| \[\]\)\.map\(\(group\) => `\$\{group\.status\} \$\{group\.count\}`\)/);
  assert.ok(!/panelEntry\.kind === "teamAttendance"/.test(page), "the side panel no longer lists them");
});
