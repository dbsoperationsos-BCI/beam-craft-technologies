const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

/*
 * Attendance reads every login, logout and "today" on the studio's clock - India - whatever zone the
 * server runs in.
 *
 * It read the server's own clock instead (`getHours()`), which is India only on a machine set to
 * India: production runs on UTC, and showed a 9:38 login as 4:08, judged nobody late and turned
 * "today" over at 5:30 am - while every test passed, because the tests ran on a laptop in India.
 * So the helpers are run here in child processes under other zones, and each must answer exactly as
 * it does in India.
 */

const ZONES = ["UTC", "Asia/Kolkata", "America/New_York", "Pacific/Kiritimati"];
const SCRIPT = `
  const { calendarDay, localIsoDate, minutesOfDay, wallClockInstant } = require(${JSON.stringify(path.join(__dirname, "..", "src", "modules", "hrm", "attendance", "attendanceRules"))});
  process.stdout.write(JSON.stringify({
    login: minutesOfDay(new Date("2026-10-08T04:08:14.811Z")),
    lateEvening: minutesOfDay(new Date("2026-10-08T18:00:00.000Z")),
    beforeIndianMidnight: localIsoDate(calendarDay(new Date("2026-10-07T18:29:59.000Z"))),
    afterIndianMidnight: localIsoDate(calendarDay(new Date("2026-10-07T18:30:00.000Z"))),
    typed: wallClockInstant("2026-09-26", 18 * 60).toISOString(),
    typedAtMidnight: wallClockInstant("2026-01-01", 5).toISOString(),
    storedDay: localIsoDate(calendarDay(new Date("2026-09-26T00:00:00.000Z"))),
  }));
`;

const EXPECTED = {
  login: 9 * 60 + 38, // 9:38 am in India
  lateEvening: 23 * 60 + 30, // 18:00 UTC is 11:30 pm in India
  beforeIndianMidnight: "2026-10-07",
  afterIndianMidnight: "2026-10-08", // "today" turns over at India's midnight, not UTC's
  typed: "2026-09-26T12:30:00.000Z", // "18:00" typed by HR is 18:00 in India
  typedAtMidnight: "2025-12-31T18:35:00.000Z", // 00:05 on 1 Jan in India
  storedDay: "2026-09-26", // a day already stored stays that day
};

for (const zone of ZONES) {
  test(`attendance reads the studio's clock on a server set to ${zone}`, () => {
    const run = spawnSync(process.execPath, ["-e", SCRIPT], { env: { ...process.env, TZ: zone }, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout), EXPECTED);
  });
}
