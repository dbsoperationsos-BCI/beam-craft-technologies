const test = require("node:test");
const assert = require("node:assert/strict");

/*
 * Attendance Rules: a half day runs from "Half day from" up to the full day, so Half day from has to
 * be less than the full day. A save that says otherwise is refused before anything is read or written.
 */

const dbPath = require.resolve("../src/config/db");
require(dbPath);
const touched = [];
require.cache[dbPath].exports = new Proxy({}, { get: (target, model) => { touched.push(String(model)); return new Proxy({}, { get: () => async () => null }); } });

const controller = require("../src/modules/hrm/attendance/controller");

const RULES = { shiftStart: "09:30", shiftEnd: "18:30", lateGraceMinutes: 15, dailyTargetMinutes: 510, weeklyOffDays: [0], maxPermissionMinutes: 180, earlyExitGraceMinutes: 15 };
const response = () => {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
};

test("Half day from at or above the full day is refused, on the Half day from field", async () => {
  for (const halfDayMinMinutes of [510, 600]) {
    touched.length = 0;
    const res = response();
    await controller.updateSettings({ body: { ...RULES, halfDayMinMinutes }, user: { id: 1 } }, res);
    assert.equal(res.statusCode, 400, `${halfDayMinMinutes}`);
    assert.match(JSON.stringify(res.body), /Half day from must be less than the full day/);
    assert.match(JSON.stringify(res.body), /halfDayMinMinutes/);
    assert.deepEqual(touched, [], "nothing was read or written");
  }
});

test("the removed Half day up to is no longer part of the rules", () => {
  const source = require("node:fs").readFileSync(require.resolve("../src/modules/hrm/attendance/controller.js"), "utf8");
  assert.doesNotMatch(source, /halfDayMaxMinutes/);
});
