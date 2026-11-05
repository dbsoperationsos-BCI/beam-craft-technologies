const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Settings → Holidays: the days the studio declares itself closed.
 *
 * A small module, and every way it can go wrong is quiet:
 *
 *   * **the guard.** These routes write a record the whole studio reads. Unguarded, or guarded on
 *     a permission the catalogue cannot grant, and either anybody can declare a public holiday or
 *     nobody can.
 *   * **the day.** `attendance_holiday.holiday_date` is a `@db.Date`. Parsed through
 *     `new Date("2026-10-20")` it is midnight UTC, which is the 19th anywhere behind Greenwich -
 *     so a holiday declared on the 20th would be stored, drawn and counted on the 19th, and
 *     nothing about the screen would look wrong.
 *   * **the overwrite.** One holiday per branch per day is the rule. A create that upserts turns
 *     a second person declaring the same day into a silent rename of the first one's holiday.
 *
 * No database and no server: the guard and the day handling are read off the source, which is
 * where each of these is decided.
 */

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", "modules", "settings", "holidays", ...parts), "utf8");
const ROUTES = read("routes.js");
const CONTROLLER = read("controller.js");

test("every route is behind the permission the Settings overlay offers it on", () => {
  // `requireModule` follows the method - GET reads, everything else writes - so a route added here
  // later is guarded the moment it is written, which is the failure a per-route guard invites.
  assert.match(ROUTES, /router\.use\(protect\);/);
  assert.match(ROUTES, /router\.use\(requireModule\("SETTINGS", "Holidays"\)\);/);
  // And nothing sneaks in above the guard, where it would be behind `protect` alone.
  const guardAt = ROUTES.indexOf('requireModule("SETTINGS", "Holidays")');
  const firstRoute = ROUTES.search(/router\.(get|post|put|delete|patch)\(/);
  assert.ok(guardAt > 0 && guardAt < firstRoute, "a route is mounted above the permission guard");
});

test("the permission it names is one the catalogue can actually grant", () => {
  // A guard naming a permission that is not seeded refuses everybody but a Super Admin, and the
  // Role Management screen offers no way to fix it.
  const { PERMISSIONS } = require("../prisma/seeds/permission-catalogue");
  const catalogue = new Set(PERMISSIONS.map((permission) => `${permission.module}:${permission.feature}`));
  assert.ok(catalogue.size > 5, "the permission catalogue could not be read");
  assert.ok(catalogue.has("SETTINGS:Holidays"), "SETTINGS:Holidays is not in the catalogue");
});

test("a holiday is read as the day it was written, never through a timezone", () => {
  /*
   * `calendarDay` is attendance's, and is the only correct reading of these columns in the
   * codebase: it takes a written `YYYY-MM-DD` literally instead of parsing it into an instant.
   * A second copy of that logic here is how the two would come to disagree about which day Diwali
   * is on - so what is pinned is that it is *reused*.
   */
  assert.match(CONTROLLER, /require\("\.\.\/\.\.\/hrm\/attendance\/attendanceRules"\)/);
  assert.match(CONTROLLER, /calendarDay\(parsed\.data\.date\)/);
  // Written as text on the way out too, for the same reason.
  assert.match(CONTROLLER, /date: localIsoDate\(row\.holidayDate\)/);
  // And a day that is not a written day is refused rather than guessed at.
  assert.match(CONTROLLER, /regex\(\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\//);
});

test("declaring a day that already has a holiday for the same branch is refused, not silently overwritten", () => {
  /*
   * The day is no longer unique in the table - two branches may each have a holiday on it - so the
   * refusal is the controller's: the day's rows are locked and read inside the write's own
   * transaction, and a second holiday whose branches overlap one already there is refused with the
   * 409 the screen turns into "edit the one that is there". A `create`, never an `upsert`.
   */
  assert.match(CONTROLLER, /tx\.attendanceHoliday\.create\(/);
  assert.doesNotMatch(CONTROLLER, /attendanceHoliday\.upsert\(/);
  // A named lock, not a row lock: the first holiday on a day has no row to lock, and a gap lock
  // lets two first declarations both in.
  assert.match(CONTROLLER, /GET_LOCK\(\?, \?\)/, "holiday writes are not serialised before the overlap check");
  assert.match(CONTROLLER, /RELEASE_LOCK\(\?\)/);
  // A day the calendar does not have is refused, not rolled into the next month.
  assert.match(CONTROLLER, /refine\(\(value\) => localIsoDate\(calendarDay\(value\)\) === value/);
  assert.match(CONTROLLER, /holidayScopesOverlap\(scopeOf\(row\), scope\)/);
  assert.match(CONTROLLER, /status\(409\)/);
});

test("the holiday list is no longer written from the attendance module", () => {
  /*
   * The same list used to be created and deleted through `/api/hrm/attendance/holidays`, behind
   * HRM / Attendance Approval. Two write paths into one table on two different permissions is how
   * a screen comes to be refused what another screen allows - and a company-declared holiday was
   * never an attendance decision about one person. Attendance still *reads* the table when it
   * judges a day, which is the half that has to survive this.
   */
  const attendance = path.join(__dirname, "..", "src", "modules", "hrm", "attendance");
  const routes = fs.readFileSync(path.join(attendance, "routes.js"), "utf8");
  assert.doesNotMatch(routes, /router\.(post|delete|put)\("\/holidays/);
  const service = fs.readFileSync(path.join(attendance, "service.js"), "utf8");
  // Read through the shared calendar, which answers per branch - see holiday-branches.test.js.
  assert.match(service, /holidayCalendar\(start, end, client\)/, "attendance no longer reads the holidays when it judges a day");
});
