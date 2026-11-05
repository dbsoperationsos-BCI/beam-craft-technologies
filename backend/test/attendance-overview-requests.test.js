const test = require("node:test");
const assert = require("node:assert/strict");
const { calendarDay } = require("../src/modules/hrm/attendance/attendanceRules");

/*
 * `GET /api/hrm/attendance/overview`, called: who is refused, which requests are refused, and what
 * the service is asked for when one is let through. The source-text tests beside this one say the
 * checks are written; this says they answer.
 *
 * `isAdministrator` is stubbed before the controller loads, because the controller takes it by
 * destructuring at require time. The service's `attendanceOverview` is replaced on the module
 * object the controller already holds, so what it was asked for can be read back.
 */

const administratorPath = require.resolve("../src/services/administrator");
require(administratorPath);
// Login 1 is an administrator; everybody else is not.
require.cache[administratorPath].exports = { isAdministrator: async (userId) => Number(userId) === 1 };

const service = require("../src/modules/hrm/attendance/service");
const controller = require("../src/modules/hrm/attendance/controller");

let asked = null;
service.attendanceOverview = async (from, to, filters) => {
  asked = { from, to, filters };
  return { ok: true };
};

const iso = (date) => date.toISOString().slice(0, 10);

async function call(query, userId = 1) {
  asked = null;
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await controller.getOverview({ user: { id: userId }, query }, res);
  return res;
}

test("anybody who is not an administrator is refused, and nothing is read", async () => {
  const res = await call({}, 2);
  assert.equal(res.statusCode, 403);
  assert.equal(asked, null);
});

test("an administrator is answered, over the last thirty days by default", async () => {
  const res = await call({});
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { data: { ok: true } });
  assert.equal(Math.round((asked.to - asked.from) / 86400000) + 1, 30);
  assert.deepEqual(asked.filters, { branchId: null, employeeIds: null });
});

test("the picked employees and branch reach the service as numbers", async () => {
  const res = await call({ from: "2026-09-01", to: "2026-09-10", branchId: "2", employeeIds: "7, 3,7" });
  assert.equal(res.statusCode, 200);
  assert.equal(asked.filters.branchId, 2);
  // Duplicates dropped, order kept.
  assert.deepEqual(asked.filters.employeeIds, [7, 3]);
});

test("a range running past today is cut at today, so the days to come are not counted absent", async () => {
  const next = new Date();
  next.setUTCDate(next.getUTCDate() + 20);
  const res = await call({ from: "2026-09-01", to: iso(next) });
  assert.equal(res.statusCode, 200);
  // "Today" is the studio's own calendar day (Asia/Kolkata), not the raw UTC instant - which, for
  // the 5.5 hours after midnight IST, already reads as tomorrow in UTC. A plain `new Date()` is the
  // wrong thing to compare a calendar day against; `calendarDay(new Date())` reads the same day the
  // controller clamped to.
  assert.ok(asked.to <= calendarDay(new Date()), "the range still reaches into the future");
});

// Every one of these is a 400 with a message, and none of them reaches the service.
const refused = [
  ["a repeated employee list", { employeeIds: ["1", "2"] }],
  ["an employee list with a gap in it", { employeeIds: "3,,7" }],
  ["an employee id that is not digits", { employeeIds: "1e3" }],
  ["a list longer than any picker makes", { employeeIds: Array.from({ length: 1001 }, (_, index) => index + 1).join(",") }],
  ["a branch that is not a number", { branchId: "abc" }],
  ["a branch that is not a whole number", { branchId: "1.5" }],
  ["a day that does not exist", { from: "2026-02-31" }],
  ["a date in another shape", { from: "01/09/2026" }],
  ["a range the wrong way round", { from: "2026-09-10", to: "2026-09-01" }],
  ["a range longer than a year", { from: "2024-01-01", to: "2026-09-01" }],
];

for (const [what, query] of refused) {
  test(`${what} is refused rather than guessed at`, async () => {
    const res = await call(query);
    assert.equal(res.statusCode, 400);
    assert.equal(typeof res.body?.message, "string");
    assert.equal(asked, null);
  });
}
