const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * **Leave cannot be asked for on a day the person is on a shoot.**
 *
 * Approved leave on a shoot day is how a crew turns up one short with nobody having decided that:
 * the leave was answered by an approver who could not see the plan, and the plan was made by a
 * manager who could not see the leave. The ask is refused where it is made, and the refusal says
 * which shoot, which day, and whose job it is to free them.
 */

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const CONTROLLER = read("src/modules/hrm/attendance/controller.js");
const block = CONTROLLER.slice(CONTROLLER.indexOf("async function shootClashProblem"), CONTROLLER.indexOf("async function overlapProblem"));

test("the days-away types are checked, and a permission is not", () => {
  assert.match(block, /if \(!DAYS_AWAY\.includes\(input\.type\)\) return null;/);
  /*
   * `DAYS_AWAY` is LEAVE and COMP_OFF - both a whole day away from work. A **permission** is an hour
   * or two inside a day and often exactly what somebody on a shoot asks for, and ON_DUTY is being at
   * work somewhere else, which is the manager's own arrangement.
   */
  assert.match(CONTROLLER, /const DAYS_AWAY = \["LEAVE", "COMP_OFF"\];/);
});

test("all three ways of being on a shoot count", () => {
  // Given a service on it, on its production team, or named as its Production Coordinator - each is
  // somebody the shoot expects to see that morning.
  assert.match(block, /\{ serviceCrew: \{ some: \{ employeeId \} \} \}/);
  assert.match(block, /\{ teamMembers: \{ some: \{ employeeId \} \} \}/);
  assert.match(block, /\{ productionCoordinatorEmployeeId: employeeId \}/);
});

test("a deleted shoot, or one on a binned project, is not a clash", () => {
  assert.match(block, /shoot: \{ deletedAt: null, dateCreated: \{[^}]*\}, project: \{ deletedAt: null \} \}/);
});

test("the day is decided in the studio's own zone, not in UTC", () => {
  /*
   * The bug this pins was found by running it: `date_created` holds the shoot's day with whatever
   * time of day the row was written with, and one of them is `2026-12-07 18:30Z` - the 8th in the
   * studio's zone. Compared as instants, leave on the 7th was refused over a shoot everybody calls
   * the 8th, and the 8th itself would have gone through.
   */
  assert.match(block, /const fromIso = localIsoDate\(from\);/);
  assert.match(block, /const day = localIsoDate\(shoot\?\.dateCreated\);\n\s*return Boolean\(day\) && day >= fromIso && day <= toIso;/);
  // Asked a day wider than needed, so no zone can put a clashing shoot outside the query.
  assert.match(block, /gte: new Date\(from\.getTime\(\) - DAY_MS\), lt: new Date\(to\.getTime\(\) \+ 2 \* DAY_MS\)/);
  assert.match(block, /const productions = found\.filter\(\(production\) => onADay\(production\.shoot\)\);/);
});

test("the refusal says which shoot, which day, where, and what they are on it for", () => {
  assert.match(block, /You cannot apply for \$\{word\} on a day you are on a shoot\./);
  assert.match(block, /shoot\.shootId, shoot\.shoot/);
  assert.match(block, /shoot\.shootPlace/);
  assert.match(block, /`you are \$\{onIt\}`/);
  // A service where they hold one, else the team or the coordinator's seat - never a bare "on it".
  assert.match(block, /on the production team/);
  assert.match(block, /its Production Coordinator/);
});

test("it names the Production Manager rather than offering to free them", () => {
  /*
   * Taking somebody off a shoot is re-planning it - the service goes to somebody else or the shoot
   * goes a person short - which is the manager's decision, not a side effect of asking for a day off.
   */
  assert.match(block, /Ask \$\{managers\[0\]\}, this project's Production Manager, to take you off it/);
  // Several shoots across several projects: each project's own manager, since one name would be wrong.
  assert.match(block, /Ask each project's Production Manager to take you off the shoot/);
  assert.match(block, /managers\.length === 1/);
});

test("it is asked where every other refusal is, and after the overlap", () => {
  assert.match(CONTROLLER, /const onAShoot = await shootClashProblem\(employee\.id, input\);\n\s*if \(onAShoot\) throw onAShoot;/);
  // "You already have leave that day" is the simpler answer and is said first.
  assert.ok(CONTROLLER.indexOf("const clash = await overlapProblem") < CONTROLLER.indexOf("const onAShoot = await shootClashProblem"));
  // Raising and editing share `assertRequestAllowed`, so both are refused.
  assert.ok(CONTROLLER.indexOf("async function assertRequestAllowed") < CONTROLLER.indexOf("const onAShoot = await shootClashProblem"));
});
