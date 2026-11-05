const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Branch-wise holidays: a holiday is the studio's (every branch) or some branches' alone, and every
 * reader - the Settings list, the studio calendar, every attendance calculation - answers "is this
 * day a holiday for this person" by the person's branch. The rule lives once, in
 * `services/holidayCalendar.js`; these pin it, and pin that each reader goes through it.
 */

const { scopeOf, appliesToBranch, holidayScopesOverlap, holidayCalendar, branchForUser, scopeLabel } = require("../src/services/holidayCalendar");
const { mayWrite, visibleTo, askedScope } = require("../src/modules/settings/holidays/controller");

const day = (iso) => new Date(`${iso}T00:00:00.000Z`);
const link = (branchId, name) => ({ branchId, branch: { id: branchId, name } });
const ROWS = [
  { id: 1, holidayDate: day("2026-10-20"), name: "Diwali", branches: [] },
  { id: 2, holidayDate: day("2026-10-21"), name: "Chennai Day", branches: [link(1, "Chennai")] },
  { id: 3, holidayDate: day("2026-10-21"), name: "Madurai Day", branches: [link(2, "Madurai")] },
  { id: 4, holidayDate: day("2026-10-22"), name: "Both", branches: [link(1, "Chennai"), link(2, "Madurai")] },
];
const fakeClient = (rows = ROWS, people = {}) => ({
  attendanceHoliday: { findMany: async () => rows },
  employee: { findUnique: async ({ where }) => people[where.id] || null },
  user: { findUnique: async ({ where }) => people[`user:${where.id}`] || null },
});

test("a holiday with no branch links is everybody's; with links it is those branches' alone", () => {
  assert.deepEqual(scopeOf(ROWS[0]), { allBranches: true, branchIds: [] });
  assert.deepEqual(scopeOf(ROWS[3]), { allBranches: false, branchIds: [1, 2] });
  assert.equal(appliesToBranch(scopeOf(ROWS[0]), 9), true, "the studio's holiday applies to any branch");
  assert.equal(appliesToBranch(scopeOf(ROWS[0]), null), true, "and to somebody with no branch at all");
  assert.equal(appliesToBranch(scopeOf(ROWS[1]), 1), true);
  assert.equal(appliesToBranch(scopeOf(ROWS[1]), 2), false, "another branch's holiday is not this one's");
  assert.equal(appliesToBranch(scopeOf(ROWS[1]), null), false, "no branch is not every branch");
  assert.equal(scopeLabel(ROWS[0]), "All branches");
  assert.equal(scopeLabel(ROWS[3]), "Chennai, Madurai");
});

test("two holidays on one day overlap when either is the studio's or they share a branch", () => {
  const all = { allBranches: true, branchIds: [] };
  const chennai = { allBranches: false, branchIds: [1] };
  const madurai = { allBranches: false, branchIds: [2] };
  const both = { allBranches: false, branchIds: [1, 2] };
  assert.equal(holidayScopesOverlap(all, chennai), true);
  assert.equal(holidayScopesOverlap(chennai, all), true);
  assert.equal(holidayScopesOverlap(chennai, madurai), false, "two branches may each have their own holiday on a day");
  assert.equal(holidayScopesOverlap(chennai, both), true);
});

test("the calendar answers per branch, once per branch, and never counts a day twice", async () => {
  const calendar = await holidayCalendar(day("2026-10-01"), day("2026-10-31"), fakeClient());
  assert.deepEqual([...calendar.forBranch(1)].sort(), ["2026-10-20", "2026-10-21", "2026-10-22"]);
  assert.deepEqual([...calendar.forBranch(2)].sort(), ["2026-10-20", "2026-10-21", "2026-10-22"]);
  assert.deepEqual([...calendar.forBranch(3)].sort(), ["2026-10-20"], "a third branch observes the studio's holiday alone");
  assert.deepEqual([...calendar.forBranch(null)].sort(), ["2026-10-20"], "and so does somebody with no branch");
  assert.equal(calendar.namesFor(1).get("2026-10-21"), "Chennai Day");
  assert.equal(calendar.namesFor(2).get("2026-10-21"), "Madurai Day");
  // A day both the studio and a branch declared is one day off, named once.
  const overlapping = await holidayCalendar(day("2026-10-01"), day("2026-10-31"), fakeClient([ROWS[0], { id: 9, holidayDate: day("2026-10-20"), name: "Chennai Diwali", branches: [link(1, "Chennai")] }]));
  assert.equal(overlapping.forBranch(1).size, 1);
  assert.equal(overlapping.namesFor(1).get("2026-10-20"), "Diwali", "the first declared keeps the name");
  // Memoised: the same Set comes back for the same branch.
  assert.equal(calendar.forBranch(1), calendar.forBranch(1));
});

test("whose branch: the employee record's, else the login's, else none", async () => {
  const people = {
    "user:10": { branchId: 5, linkedEmployeeId: 7 }, 7: { branchId: 1 },
    "user:11": { branchId: 5, linkedEmployeeId: 8 }, 8: { branchId: null },
    "user:12": { branchId: null, linkedEmployeeId: null },
  };
  assert.equal(await branchForUser(10, fakeClient(ROWS, people)), 1, "the employee's placement wins");
  assert.equal(await branchForUser(11, fakeClient(ROWS, people)), 5, "an unplaced employee falls back to the login's branch");
  assert.equal(await branchForUser(12, fakeClient(ROWS, people)), null, "no branch anywhere is none - not every branch");
  assert.equal(await branchForUser(99, fakeClient(ROWS, people)), null);
});

test("who may see and write which holidays follows the role's reach for this permission", () => {
  const all = { allBranches: true, branchIds: [] };
  const chennai = { allBranches: false, branchIds: [1] };
  const both = { allBranches: false, branchIds: [1, 2] };
  const reachChennai = new Set([1]);
  const reachEvery = new Set([1, 2]);
  const active = [1, 2];
  // Reads: the studio's holidays are everybody's to see; a branch's are its readers'.
  assert.equal(visibleTo(all, reachChennai), true);
  assert.equal(visibleTo(chennai, reachChennai), true);
  assert.equal(visibleTo({ allBranches: false, branchIds: [2] }, reachChennai), false, "another branch's holiday is not shown");
  assert.equal(visibleTo(chennai, null), true, "a Super Admin sees everything");
  // Writes: every branch named must be reached; a studio-wide holiday needs every active branch.
  assert.equal(mayWrite(chennai, reachChennai, active), true);
  assert.equal(mayWrite(both, reachChennai, active), false, "a branch out of reach cannot be declared for");
  assert.equal(mayWrite(all, reachChennai, active), false, "all branches takes reaching all of them");
  assert.equal(mayWrite(all, reachEvery, active), true);
  assert.equal(mayWrite(all, null, active), true);
  assert.equal(mayWrite(chennai, new Set(), active), false, "a role naming no branch declares nothing");
  // What a request asks for: absent scope is the studio's, as every caller before this sent.
  assert.deepEqual(askedScope({}), { allBranches: true, branchIds: [] });
  assert.deepEqual(askedScope({ allBranches: false, branchIds: [2, 2, 1] }), { allBranches: false, branchIds: [2, 1] });
  assert.deepEqual(askedScope({ allBranches: true, branchIds: [2] }), { allBranches: true, branchIds: [] });
});

test("every reader goes through the shared calendar, and the picker's route sits above the id route", () => {
  const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", ...parts), "utf8");
  const attendance = read("modules", "hrm", "attendance", "service.js");
  assert.doesNotMatch(attendance, /attendanceHoliday\.findMany/, "attendance reads the holiday table around the branch rule");
  // One person's readers pass their branch; the many-people readers ask the calendar per employee.
  for (const name of ["casualLeaveFor", "dayReadingAt", "attendanceDays", "attendanceTotals"]) {
    const start = attendance.indexOf(`async function ${name}(`);
    const body = attendance.slice(start, attendance.indexOf("\n}\n", start));
    assert.match(body, /branchForEmployee\(employeeId, client\)/, `${name} does not read the employee's branch`);
  }
  for (const name of ["attendanceRegister", "tallyRange"]) {
    const start = attendance.indexOf(`async function ${name}(`);
    const body = attendance.slice(start, attendance.indexOf("\n}\n", start));
    assert.match(body, /holidays\.forBranch\(employee\.branchId\)/, `${name} judges somebody on holidays that are not their branch's`);
  }
  const calendar = read("modules", "schedule", "calendar", "service.js");
  assert.match(calendar, /appliesToBranch\(scopeOf\(holiday\), branchId\)/, "the studio calendar shows everybody every branch's holidays");
  assert.match(calendar, /branchForUser\(viewer\?\.userId\)/);
  const routes = read("modules", "settings", "holidays", "routes.js");
  assert.ok(routes.indexOf('router.get("/branches"') < routes.indexOf('router.put("/:id"'), "/branches would be read as a holiday's id");
  const ledgers = read("modules", "hrm", "attendance", "ledgers.js");
  assert.match(ledgers, /holidayDateSet\(.*branchForEmployee\(employeeId, client\)\)/, "comp-offs are earned on another branch's holidays");
});
