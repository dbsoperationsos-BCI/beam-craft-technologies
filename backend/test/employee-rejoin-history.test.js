const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { awayBetweenStints } = require("../src/modules/hrm/attendance/service");

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", ...parts), "utf8");

test("a day strictly between leaving and rejoining is one they did not work here", () => {
  const gaps = [{ leftOn: new Date("2026-10-10T00:00:00Z"), rejoinedOn: new Date("2026-10-31T00:00:00Z") }];
  assert.equal(awayBetweenStints(gaps, "2026-10-11"), true);
  assert.equal(awayBetweenStints(gaps, "2026-10-30"), true);
  assert.equal(awayBetweenStints(gaps, "2026-10-10"), false, "the last day itself is worked");
  assert.equal(awayBetweenStints(gaps, "2026-10-31"), false, "the rejoining day itself is worked");
  assert.equal(awayBetweenStints([], "2026-10-15"), false);
});

test("Move to Active keeps the departure as work history before the separation goes", () => {
  const controller = read("modules", "hrm", "employees", "controller.js");
  const reactivate = controller.slice(controller.indexOf("async function reactivateEmployee(req, res) {"), controller.indexOf("async function deleteEmployeeRecord("));
  assert.match(reactivate, /const leftOn = withdrawingNotice \? null : \(separation\?\.proposedLastWorkingDate \|\| employee\.dateOfRelieving \|\| null\);/);
  const create = reactivate.indexOf("await tx.employeeRejoin.create(");
  const remove = reactivate.indexOf("await tx.employeeSeparation.delete(");
  assert.ok(create !== -1 && remove !== -1 && create < remove, "the rejoin row is written before the separation is deleted");
  // And the list sends it, for the profile's Work History.
  assert.match(controller, /rejoins: \{ orderBy: \{ rejoinedOn: "asc" \}, select: \{ leftOn: true, separationType: true, separationReason: true, designation: true, department: true, rejoinedOn: true, reason: true \} \},/);
});

test("attendance and payroll leave out the days away, everywhere they count an employee's days", () => {
  const service = read("modules", "hrm", "attendance", "service.js");
  assert.match(service, /return \(Boolean\(last\) && iso > last\) \|\| awayBetweenStints\(employee\?\.rejoins, iso\);/);
  assert.equal((service.match(/rejoins: REJOIN_GAPS/g) || []).length, 2, "both roster queries read the gaps");
  assert.match(service, /\(sessionsByDate\.has\(iso\) \|\| !gaps\.notHere\(iso\)\)/);
  assert.match(service, /const workingDays = workingDaysInRange\(owedStart, end, \{ settings, holidayDates \}\) - awayDays\.length;/);
  const calculator = read("modules", "hrm", "attendance", "calculator.js");
  assert.match(calculator, /if \(away\) period = \{ \.\.\.period, countedDays: period\.countedDays - away \};/);
  // A day inside the gap they did log in on stays counted, as it stays on the day rows.
  assert.match(calculator, /awayBetweenStints\(gaps, iso\) && !listed\.has\(iso\)/);
});
