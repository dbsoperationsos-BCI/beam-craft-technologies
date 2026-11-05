const test = require("node:test");
const assert = require("node:assert/strict");

/*
 * Attendance Rules saves one section at a time: a save sends that section's fields alone, and the rest
 * are read as stored - so a section is checked against the others as they stand, and never changes them.
 */

const service = require("../src/modules/hrm/attendance/service");
const controller = require("../src/modules/hrm/attendance/controller");

const STORED = {
  shiftStart: "09:30", shiftEnd: "18:30", lateGraceMinutes: 15, dailyTargetMinutes: 510, weeklyOffDays: "0,6",
  maxPermissionMinutes: 180, halfDayMinMinutes: 240, earlyExitGraceMinutes: 15, attendanceStartDate: null,
  casualLeavePerMonth: "1.5", casualLeaveMonthlyCarry: true, casualLeaveYearCarryMax: "3.0", casualLeavePeriod: "PAY_CYCLE",
  compOffExpiryDays: 0, permissionsPerPeriod: 2, permissionPeriod: "CALENDAR_MONTH",
};
let saved = null;
service.canManageRules = async () => true;
service.readSettings = async () => STORED;
service.saveSettings = async (input) => { saved = input; return { ...STORED, ...input }; };

const response = () => {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
};

test("saving one section changes that section and leaves every other as stored", async () => {
  saved = null;
  const res = response();
  await controller.updateSettings({ body: { compOffExpiryDays: 30 }, user: { id: 1 } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(saved.compOffExpiryDays, 30);
  assert.deepEqual(
    [saved.shiftStart, saved.shiftEnd, saved.weeklyOffDays, saved.casualLeavePerMonth, saved.casualLeavePeriod, saved.permissionsPerPeriod],
    ["09:30", "18:30", "0,6", 1.5, "PAY_CYCLE", 2],
  );
  assert.equal("attendanceStartDate" in saved, false, "a date not sent is left as it is");
});

test("a section is checked against the others as stored: a shift end before the stored start is refused", async () => {
  saved = null;
  const res = response();
  await controller.updateSettings({ body: { shiftEnd: "08:00" }, user: { id: 1 } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(JSON.stringify(res.body), /The shift end must be later than the shift start/);
  assert.equal(saved, null, "nothing written");
});
