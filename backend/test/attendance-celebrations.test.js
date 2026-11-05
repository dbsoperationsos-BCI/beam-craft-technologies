const test = require("node:test");
const assert = require("node:assert/strict");

const { celebrationsOn } = require("../src/modules/hrm/attendance/service");

/*
 * The Attendance Register names the day's birthdays and wedding anniversaries among the people
 * working here - by month and day, names only, and never somebody who has left.
 */

const branches = new Map([[1, "Erode TN"]]);
const person = (id, name, extra = {}) => ({ id, employeeName: name, branchId: 1, employmentStatus: "Active", archivedAt: null, dateOfBirth: null, weddingAnniversary: null, ...extra });
const day = (iso) => new Date(`${iso}T00:00:00.000Z`);

test("a birthday and an anniversary are found by month and day, whatever the year", () => {
  const staff = [
    person(1, "Asha", { dateOfBirth: day("1994-09-28") }),
    person(2, "Ravi", { weddingAnniversary: day("2019-09-28") }),
    person(3, "Meena", { dateOfBirth: day("1990-09-27") }),
  ];
  const found = celebrationsOn("2026-09-28", staff, branches);
  assert.deepEqual(found.birthdays.map((entry) => entry.employeeName), ["Asha"]);
  assert.deepEqual(found.anniversaries.map((entry) => entry.employeeName), ["Ravi"]);
  assert.deepEqual(found.birthdays[0], { employeeId: 1, employeeName: "Asha", branchName: "Erode TN" }, "more than a name and a branch is sent");
});

test("a date stored as local midnight is still read as the day typed in", () => {
  // 28 September at midnight in Asia/Kolkata is 18:30 UTC on the 27th.
  const staff = [person(1, "Asha", { dateOfBirth: new Date("1994-09-27T18:30:00.000Z") })];
  const tz = process.env.TZ;
  if (Intl.DateTimeFormat().resolvedOptions().timeZone.includes("Calcutta") || Intl.DateTimeFormat().resolvedOptions().timeZone.includes("Kolkata") || tz === "Asia/Kolkata") {
    assert.deepEqual(celebrationsOn("2026-09-28", staff, branches).birthdays.map((entry) => entry.employeeName), ["Asha"]);
  }
});

test("only people working here now are greeted", () => {
  const staff = [
    person(1, "Asha", { dateOfBirth: day("1994-09-28") }),
    person(2, "Left", { dateOfBirth: day("1994-09-28"), archivedAt: new Date() }),
    person(3, "Relieved", { dateOfBirth: day("1994-09-28"), employmentStatus: "Relieved" }),
  ];
  assert.deepEqual(celebrationsOn("2026-09-28", staff, branches).birthdays.map((entry) => entry.employeeName), ["Asha"]);
});

test("a 29 February birthday is kept on the 28th in a year without one", () => {
  const staff = [person(1, "Leap", { dateOfBirth: day("2000-02-29") })];
  assert.equal(celebrationsOn("2026-02-28", staff, branches).birthdays.length, 1, "skipped in a non-leap year");
  assert.equal(celebrationsOn("2028-02-28", staff, branches).birthdays.length, 0, "marked twice in a leap year");
  assert.equal(celebrationsOn("2028-02-29", staff, branches).birthdays.length, 1);
});

test("nobody celebrating is empty lists, not an error", () => {
  assert.deepEqual(celebrationsOn("2026-09-28", [person(1, "Asha")], branches), { birthdays: [], anniversaries: [], workAnniversaries: [] });
});
