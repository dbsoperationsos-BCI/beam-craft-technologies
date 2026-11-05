const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const service = require("../src/modules/hrm/attendance/service");
const credits = require("../src/modules/hrm/attendance/compOffCredits");
const { approversFor } = require("../src/modules/hrm/attendance/approvals");
const { RAISABLE_REQUEST_TYPES, SYSTEM_REQUEST_TYPES, REQUEST_TYPES } = require("../src/modules/hrm/attendance/attendanceRules");

/*
 * A weekly off or holiday worked earns a comp-off only once every Leave Approver has approved it.
 * Attendance raises a COMP_OFF_CREDIT for each full day worked on one (`ensureCreditRequests`); it goes
 * through the same unanimous approval as a leave; and the ledger, the Raise Request picker and the
 * server's check count the day only once approved (`creditCleared`). Days worked before the rule went
 * live (`compOffApprovalFrom`) keep the rule they were earned under.
 */

const day = (iso) => new Date(`${iso}T00:00:00.000Z`);
// Sunday is the weekly off; a full day is 8h 30m.
const SETTINGS = { weeklyOffDays: "0", dailyTargetMinutes: 510, attendanceStartDate: null, compOffExpiryDays: 30, compOffApprovalFrom: day("2026-03-01") };
// The day the tests run on: inside every worked day's 30-day window.
const TODAY = "2026-03-10";
const session = (iso, hours = 10) => ({ workDate: day(iso), loginAt: new Date(`${iso}T03:30:00.000Z`), logoutAt: new Date(new Date(`${iso}T03:30:00.000Z`).getTime() + hours * 3600000), awayMinutes: 0 });

function fakeDb({ sessions = [], employee = { leaveApprover1EmployeeId: 4, leaveApprover2EmployeeId: 9 }, requests = [] } = {}) {
  const db = { requests: [...requests], approvals: [], events: [], nextId: 100 };
  const client = {
    $transaction: async (work) => work(client),
    employee: { findUnique: async () => ({ id: 7, archivedAt: null, excludeFromAttendance: false, branchId: null, permissionApproverEmployeeId: 2, regularizationApproverEmployeeId: null, leaveApprover3EmployeeId: null, ...employee }) },
    attendanceSession: { findMany: async ({ where }) => sessions.filter((row) => row.logoutAt && (!where.workDate?.gte || row.workDate >= where.workDate.gte)) },
    attendanceRequest: {
      findMany: async ({ where }) => db.requests.filter((row) => row.employeeId === where.employeeId && row.type === where.type),
      create: async ({ data }) => {
        // The database's unique `credit_key`: one credit request per employee and day worked.
        if (data.creditKey && db.requests.some((row) => row.creditKey === data.creditKey)) throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
        const row = { id: db.nextId++, ...data };
        db.requests.push(row);
        return row;
      },
      findUnique: async ({ where }) => db.requests.find((row) => row.id === where.id),
    },
    attendanceRequestApproval: { createMany: async ({ data }) => { db.approvals.push(...data); return { count: data.length }; } },
    attendanceRequestEvent: { create: async ({ data }) => { db.events.push(data); return data; } },
  };
  return { client, db };
}

// The holiday calendar is Settings → Holidays; here, none - only the weekly off.
test.beforeEach(() => { service.__holidayDateSet = service.__holidayDateSet || service.holidayDateSet; service.holidayDateSet = async () => new Set(); });
test.afterEach(() => { service.holidayDateSet = service.__holidayDateSet; });

test("a full day on a weekly off raises one Pending credit, to every Leave Approver, and nothing on a working day", async () => {
  // 1 Mar is a Sunday; 2 Mar a Monday.
  const { client, db } = fakeDb({ sessions: [session("2026-03-01"), session("2026-03-02")] });
  const { raised } = await credits.ensureCreditRequests(7, { client, settings: SETTINGS, today: TODAY });
  assert.equal(raised, 1);
  assert.deepEqual(db.requests.map((row) => [row.type, row.status, row.workedDate.toISOString().slice(0, 10), row.creditKey]), [["COMP_OFF_CREDIT", "PENDING", "2026-03-01", "7:2026-03-01"]]);
  assert.deepEqual(db.approvals.map((row) => row.approverEmployeeId), [4, 9], "both Leave Approvers - not the Permission Approver");
  assert.equal(db.events[0].actorName, "Attendance (automatic)");
});

test("short days, days never logged out of and days before the rule raise nothing", async () => {
  const short = fakeDb({ sessions: [session("2026-03-01", 2)] });
  assert.equal((await credits.ensureCreditRequests(7, { client: short.client, settings: SETTINGS, today: TODAY })).raised, 0, "two hours is not a full day");
  const open = fakeDb({ sessions: [{ ...session("2026-03-01"), logoutAt: null }] });
  assert.equal((await credits.ensureCreditRequests(7, { client: open.client, settings: SETTINGS, today: TODAY })).raised, 0, "not logged out: hours unknown");
  const before = fakeDb({ sessions: [session("2026-02-22")] });
  assert.equal((await credits.ensureCreditRequests(7, { client: before.client, settings: SETTINGS, today: TODAY })).raised, 0, "worked before the rule went live: earned the old way");
});

test("a day is raised once - a second pass, a rejected one, and a race all leave one request", async () => {
  const { client, db } = fakeDb({ sessions: [session("2026-03-01")] });
  await credits.ensureCreditRequests(7, { client, settings: SETTINGS, today: TODAY });
  await credits.ensureCreditRequests(7, { client, settings: SETTINGS, today: TODAY });
  assert.equal(db.requests.length, 1);
  db.requests[0].status = "REJECTED";
  await credits.ensureCreditRequests(7, { client, settings: SETTINGS, today: TODAY });
  assert.equal(db.requests.length, 1, "a rejected day is not raised again");
  // Two writes that both read "none yet": the database's unique key lets one through.
  const raced = fakeDb({ sessions: [session("2026-03-01")] });
  raced.client.attendanceRequest.findMany = async () => [];
  await Promise.all([credits.ensureCreditRequests(7, { client: raced.client, settings: SETTINGS, today: TODAY }), credits.ensureCreditRequests(7, { client: raced.client, settings: SETTINGS, today: TODAY })]);
  assert.equal(raced.db.requests.length, 1);
});

test("no live date raises nothing; a claimed, expired or old day raises nothing or raises quietly", async () => {
  const off = fakeDb({ sessions: [session("2026-03-01")] });
  assert.equal((await credits.ensureCreditRequests(7, { client: off.client, settings: { ...SETTINGS, compOffApprovalFrom: null } })).raised, 0, "rule not live");
  // A day already claimed by a comp-off needs no credit.
  const claimed = fakeDb({ sessions: [session("2026-03-01")], requests: [{ id: 1, employeeId: 7, type: "COMP_OFF", status: "APPROVED", workedDate: day("2026-03-01") }] });
  claimed.client.attendanceRequest.findMany = async ({ where }) => claimed.db.requests.filter((row) => row.type === where.type && (!where.status?.in || where.status.in.includes(row.status)));
  assert.equal((await credits.ensureCreditRequests(7, { client: claimed.client, settings: SETTINGS, today: TODAY })).raised, 0);
  // Past its expiry (30 days) it could never be taken, so it is not put up at all.
  const expired = fakeDb({ sessions: [session("2026-03-01")] });
  assert.equal((await credits.ensureCreditRequests(7, { client: expired.client, settings: SETTINGS, today: "2026-04-15" })).raised, 0);
  // Raised late, it waits in the queue without a notice; a recent one is announced.
  const notices = [];
  const late = fakeDb({ sessions: [session("2026-03-01"), session("2026-03-15")] });
  await credits.ensureCreditRequests(7, { client: late.client, settings: SETTINGS, today: "2026-03-20", notify: (request) => notices.push(request.workedDate.toISOString().slice(0, 10)) });
  assert.equal(late.db.requests.length, 2);
  assert.deepEqual(notices, ["2026-03-15"]);
});

test("somebody with no Leave Approver gets no credit request - nobody could decide it", async () => {
  const { client, db } = fakeDb({ sessions: [session("2026-03-01")], employee: { leaveApprover1EmployeeId: null, leaveApprover2EmployeeId: null } });
  assert.equal((await credits.ensureCreditRequests(7, { client, settings: SETTINGS, today: TODAY })).raised, 0);
  assert.equal(db.requests.length, 0);
});

test("only an approved credit - or a day before the rule - counts as a comp-off", () => {
  const approved = new Set(["2026-03-08"]);
  assert.equal(credits.creditCleared("2026-02-22", SETTINGS, approved), true, "before the rule: as it always was");
  assert.equal(credits.creditCleared("2026-03-01", SETTINGS, approved), false, "pending or rejected: not a comp-off");
  assert.equal(credits.creditCleared("2026-03-08", SETTINGS, approved), true, "approved by every approver");
  assert.equal(credits.creditCleared("2026-03-01", { ...SETTINGS, compOffApprovalFrom: null }, approved), true, "no live date: the rule is not live, as before it");
});

test("the server says why an unapproved day cannot be used", async () => {
  const at = (status) => ({ attendanceRequest: { findMany: async () => (status ? [{ workedDate: day("2026-03-01"), status }] : []) } });
  assert.match(await credits.creditProblem(7, "2026-03-01", SETTINGS, at("PENDING")), /still waiting for your approvers/);
  assert.match(await credits.creditProblem(7, "2026-03-01", SETTINGS, at("REJECTED")), /was not approved as a comp-off/);
  assert.match(await credits.creditProblem(7, "2026-03-01", SETTINGS, at(null)), /has not been approved as a comp-off yet/);
  assert.equal(await credits.creditProblem(7, "2026-03-01", SETTINGS, at("APPROVED")), null);
  assert.equal(await credits.creditProblem(7, "2026-02-22", SETTINGS, at(null)), null, "before the rule");
});

test("a credit is decided by every Leave Approver, like a leave, and nobody may raise one", () => {
  assert.deepEqual(approversFor({ leaveApprover1EmployeeId: 4, leaveApprover2EmployeeId: 9, permissionApproverEmployeeId: 2 }, "COMP_OFF_CREDIT"), [4, 9]);
  assert.ok(REQUEST_TYPES.includes("COMP_OFF_CREDIT"));
  // Extra time joined it: the logout past 18 hours raises its own request (`attendance-extra-time.test.js`).
  assert.deepEqual(SYSTEM_REQUEST_TYPES, ["COMP_OFF_CREDIT", "EXTRA_TIME"]);
  assert.ok(!RAISABLE_REQUEST_TYPES.includes("COMP_OFF_CREDIT"));
  assert.ok(RAISABLE_REQUEST_TYPES.includes("COMP_OFF") && RAISABLE_REQUEST_TYPES.includes("LEAVE"), "comp-off leave and every other kind still raised as before");
  const CONTROLLER = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "attendance", "controller.js"), "utf8");
  assert.match(CONTROLLER, /type: z\.enum\(RAISABLE_REQUEST_TYPES\),/);
});

test("the raiser cannot edit, revert or delete a credit, and nobody can send it back", async () => {
  const SERVICE = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "attendance", "service.js"), "utf8");
  const guard = SERVICE.slice(SERVICE.indexOf("function assertRaiserMayAct("), SERVICE.indexOf("\n}\n", SERVICE.indexOf("function assertRaiserMayAct(")));
  assert.match(guard, /SYSTEM_REQUEST_TYPES\.includes\(String\(request\.type \|\| ""\)\)\) throw badRequest\(SYSTEM_REQUEST_REFUSAL\)/);
  await assert.rejects(service.sendBack({}, { request: { id: 1, type: "COMP_OFF_CREDIT", status: "PENDING" }, user: {}, remarks: "x" }), /cannot be sent back/);
  for (const verb of ["revert", "remove"]) {
    await assert.rejects(service[verb]({}, { request: { id: 1, employeeId: 7, type: "COMP_OFF_CREDIT", status: "PENDING" }, raiserEmployeeId: 7, user: {} }), /cannot be edited, reverted or deleted/, verb);
  }
});

test("the migration adds two columns and fills only the new one, so no existing request or setting changes", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261029110000_comp_off_credit_approval", "migration.sql"), "utf8");
  const statements = sql.split("\n").filter((line) => line.trim() && !line.startsWith("--"));
  assert.deepEqual(statements, [
    "ALTER TABLE `attendance_settings` ADD COLUMN `comp_off_approval_from` DATE NULL;",
    // India's date whatever the server's time zone, and never over a date already set.
    "UPDATE `attendance_settings` SET `comp_off_approval_from` = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30')) WHERE `comp_off_approval_from` IS NULL;",
    "ALTER TABLE `attendance_request` ADD COLUMN `credit_key` VARCHAR(40) NULL;",
    "CREATE UNIQUE INDEX `attendance_request_credit_key_key` ON `attendance_request`(`credit_key`);",
  ]);
});
