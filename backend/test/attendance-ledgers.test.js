const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ledgers = require("../src/modules/hrm/attendance/ledgers");

/*
 * The attendance ledgers - casual_leave_ledger, permission_ledger, comp_off_ledger - hold what the rules
 * come to for each employee, written again whenever something of theirs changes: a record for history
 * and audit, never a second set of rules.
 */

const DIR = path.join(__dirname, "..", "src", "modules", "hrm", "attendance");
const at = (iso, time = "00:00") => new Date(`${iso}T${time}:00+05:30`);
const day = (iso) => new Date(`${iso}T00:00:00.000Z`);

// One employee who joined on 1 Jan 2026, under rules of 1 Casual Leave a month, Sunday off, an 8-hour
// day, comp-offs that expire after 30 days and a limit of 2 permissions a month.
const SETTINGS = {
  casualLeavePerMonth: 1, casualLeaveMonthlyCarry: true, casualLeaveYearCarryMax: 0, casualLeavePeriod: "CALENDAR_MONTH",
  weeklyOffDays: "0", dailyTargetMinutes: 480, compOffExpiryDays: 30, permissionsPerPeriod: 2, permissionPeriod: "CALENDAR_MONTH",
};
const REQUESTS = [
  { id: 11, type: "LEAVE", status: "APPROVED", leaveType: "CL", fromDate: day("2026-03-10"), toDate: day("2026-03-10") },
  { id: 12, type: "PERMISSION", status: "APPROVED", fromDate: day("2026-03-05"), toDate: day("2026-03-05"), fromTime: "10:00", toTime: "11:00" },
  { id: 13, type: "PERMISSION", status: "REJECTED", fromDate: day("2026-03-06"), toDate: day("2026-03-06"), fromTime: "15:00", toTime: "15:30" },
  { id: 14, type: "COMP_OFF", status: "APPROVED", workedDate: day("2026-03-01"), fromDate: day("2026-03-03"), toDate: day("2026-03-03"), createdAt: day("2026-03-02") },
];
const SESSIONS = [
  // Sunday 1 Mar, a full day: earns a comp-off (claimed, and its day off taken).
  { workDate: day("2026-03-01"), loginAt: at("2026-03-01", "09:30"), logoutAt: at("2026-03-01", "18:00"), awayMinutes: 0 },
  // Sunday 8 Mar, two hours: earns nothing.
  { workDate: day("2026-03-08"), loginAt: at("2026-03-08", "10:00"), logoutAt: at("2026-03-08", "12:00"), awayMinutes: 0 },
];

function fakeClient() {
  const written = { casualLeaveLedger: [], permissionLedger: [], compOffLedger: [] };
  const table = (name) => ({
    deleteMany: async () => { written[name] = []; return { count: 0 }; },
    createMany: async ({ data }) => { written[name].push(...data); return { count: data.length }; },
  });
  const client = {
    written,
    // An interactive transaction runs on the client itself; the lock is recorded.
    locked: [],
    $transaction: async (work) => work(client),
    $queryRaw: async (strings, ...values) => { client.locked.push(values[0]); return []; },
    casualLeaveLedger: table("casualLeaveLedger"),
    permissionLedger: table("permissionLedger"),
    compOffLedger: table("compOffLedger"),
    employee: { findUnique: async () => ({ dateOfJoining: day("2026-01-01"), archivedAt: null, excludeFromAttendance: false }) },
    attendanceHoliday: { findMany: async () => [] },
    attendanceSession: { findMany: async () => SESSIONS },
    attendanceRequest: {
      findFirst: async ({ where }) => REQUESTS.filter((request) => request.type === where.type && request.status === where.status).sort((a, b) => b.toDate - a.toDate)[0] || null,
      findMany: async ({ where }) => REQUESTS.filter((request) => request.type === where.type
        && (typeof where.status === "string" ? request.status === where.status : !where.status?.in || where.status.in.includes(request.status))),
    },
  };
  return client;
}

test("one employee's three ledgers are written from the rules", async () => {
  const client = fakeClient();
  await ledgers.rebuildEmployee(7, { client, settings: SETTINGS, today: "2026-03-20" });
  const { casualLeaveLedger, permissionLedger, compOffLedger } = client.written;

  // Casual Leave: a row a month from the joining month, one credited each month, March's leave taken.
  assert.deepEqual(casualLeaveLedger.map((row) => [row.period, row.opening, row.credited, row.taken, row.lossOfPay, row.closing]), [
    ["2026-01", 0, 1, 0, 0, 1],
    ["2026-02", 1, 1, 0, 0, 2],
    ["2026-03", 2, 1, 1, 0, 2],
  ]);
  assert.deepEqual([casualLeaveLedger[2].periodFrom.toISOString().slice(0, 10), casualLeaveLedger[2].periodTo.toISOString().slice(0, 10), casualLeaveLedger[2].countedBy], ["2026-03-01", "2026-03-31", "CALENDAR_MONTH"]);

  // Permissions: one row per request, the refused one kept but not counted toward the limit.
  assert.deepEqual(permissionLedger.map((row) => [row.requestId, row.period, row.minutes, row.status, row.countsTowardLimit]), [
    [12, "2026-03", 60, "APPROVED", true],
    [13, "2026-03", 30, "REJECTED", false],
  ]);

  // Comp-offs: the full Sunday, claimed and its day off taken - used; the two-hour Sunday earns no row.
  assert.deepEqual(compOffLedger.map((row) => [row.workedDate.toISOString().slice(0, 10), row.workedMinutes, row.expiresOn.toISOString().slice(0, 10), row.status, row.requestId]), [
    ["2026-03-01", 510, "2026-03-31", "USED", 14],
  ]);
});

test("a comp-off is available, claimed or expired by where it stands", async () => {
  // A day worked before the approval rule went live (`compOffApprovalFrom`) earns as it always did.
  const BEFORE_THE_RULE = { ...SETTINGS, compOffApprovalFrom: day("2026-03-15") };
  const run = async (claims, today, { settings = BEFORE_THE_RULE, credits = [] } = {}) => {
    const client = fakeClient();
    client.attendanceRequest.findMany = async ({ where }) => (where.type === "COMP_OFF" ? claims : where.type === "COMP_OFF_CREDIT" ? credits : []);
    await ledgers.rebuildEmployee(7, { client, settings, today });
    return client.written.compOffLedger.map((row) => row.status);
  };
  assert.deepEqual(await run([], "2026-03-20"), ["AVAILABLE"]);
  assert.deepEqual(await run([], "2026-04-05"), ["EXPIRED"], "30 days after 1 Mar has passed, never claimed");
  assert.deepEqual(await run([{ id: 15, status: "PENDING", workedDate: day("2026-03-01"), fromDate: day("2026-03-25") }], "2026-03-20"), ["CLAIMED"]);

  // From the day the rule went live, a day worked earns a comp-off only once its credit is approved.
  const UNDER_THE_RULE = { ...SETTINGS, compOffApprovalFrom: day("2026-02-01") };
  const credit = (status) => [{ workedDate: day("2026-03-01"), status }];
  assert.deepEqual(await run([], "2026-03-20", { settings: UNDER_THE_RULE }), [], "nobody has approved the Sunday yet");
  assert.deepEqual(await run([], "2026-03-20", { settings: UNDER_THE_RULE, credits: credit("PENDING") }), [], "pending is not credited");
  assert.deepEqual(await run([], "2026-03-20", { settings: UNDER_THE_RULE, credits: credit("REJECTED") }), [], "rejected is never credited");
  assert.deepEqual(await run([], "2026-03-20", { settings: UNDER_THE_RULE, credits: credit("APPROVED") }), ["AVAILABLE"], "approved by every approver: one comp-off");
});

test("the ledgers follow every change: requests, a logout, the rules and the holidays", () => {
  const CONTROLLER = fs.readFileSync(path.join(DIR, "controller.js"), "utf8");
  // Raised, edited, decided, sent back, reverted, deleted - and deleted for good.
  assert.equal((CONTROLLER.match(/ledgers\.refreshSoon\((created|updated)\.employeeId\);/g) || []).length, 6);
  assert.match(CONTROLLER, /ledgers\.refreshSoon\(existing\.employeeId\);/);
  assert.match(CONTROLLER, /ledgers\.refreshSoon\(employee\.id\);\r?\n\s+if \(updated\.extraTime\)[\s\S]{0,120}?return res\.json\(\{\r?\n\s+data: \{\r?\n\s+id: updated\.row\.id, loginAt/);
  assert.match(CONTROLLER, /ledgers\.refreshAllSoon\(\);\r?\n\s+return res\.json\(\{ data: \{ \.\.\.saved/);
  const HOLIDAYS = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "settings", "holidays", "controller.js"), "utf8");
  assert.equal((HOLIDAYS.match(/ledgers\.refreshAllSoon\(\);/g) || []).length, 3);
  // Kept after the answer, and never the reason a request fails.
  const LEDGERS = fs.readFileSync(path.join(DIR, "ledgers.js"), "utf8");
  assert.match(LEDGERS, /coalesce\(`employee:\$\{employeeId\}`, \(\) => rebuildEmployee\(employeeId\),/);
  // The shared coalescer: asks during a run come to one more run after it.
  assert.match(LEDGERS, /const coalesce = createCoalescer\(\);/);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "src", "services", "coalesce.js"), "utf8"), /if \(again\.delete\(key\)\) coalesce\(key, run, failed\);/);
  const MIGRATION = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261010300000_attendance_ledgers", "migration.sql"), "utf8");
  for (const table of ["casual_leave_ledger", "permission_ledger", "comp_off_ledger"]) assert.match(MIGRATION, new RegExp(`CREATE TABLE \`${table}\``));
  assert.match(MIGRATION, /FOREIGN KEY \(`request_id`\) REFERENCES `attendance_request`\(`id`\) ON DELETE CASCADE/);
});

test("one employee is rebuilt at a time, under a lock on them; somebody kept out of attendance has theirs cleared", async () => {
  const client = fakeClient();
  await ledgers.rebuildEmployee(7, { client, settings: SETTINGS, today: "2026-03-20" });
  assert.deepEqual(client.locked, [7], "their employee row is locked before anything is read or written");
  assert.ok(client.written.casualLeaveLedger.length > 0);
  // Archived, or ticked Exclude From Attendance: the rows go, nothing is written back.
  client.employee.findUnique = async () => ({ archivedAt: new Date(), excludeFromAttendance: false });
  await ledgers.rebuildEmployee(7, { client, settings: SETTINGS, today: "2026-03-20" });
  assert.deepEqual([client.written.casualLeaveLedger.length, client.written.permissionLedger.length, client.written.compOffLedger.length], [0, 0, 0]);
  const LEDGERS = fs.readFileSync(path.join(DIR, "ledgers.js"), "utf8");
  assert.match(LEDGERS, /await tx\.\$queryRaw`SELECT id FROM employee WHERE id = \$\{id\} FOR UPDATE`;/);
  assert.match(LEDGERS, /if \(error\?\.code !== "P2034"\) throw error;/);
});

test("asks for a rebuild while one runs come to one more run, never several side by side", async () => {
  const prisma = require("../src/config/db");
  const service = require("../src/modules/hrm/attendance/service");
  const original = { transaction: prisma.$transaction, readSettings: service.readSettings };
  let runs = 0;
  let inFlight = 0;
  let most = 0;
  /*
   * Each fake rebuild hangs until this test lets it go, and the test waits for a run to have
   * **started** rather than for a number of milliseconds.
   *
   * It used to sleep: 60ms for the first run to come and go, then 5ms to be inside the second. Both
   * are long enough on an idle machine and neither is on a busy one - under a full `npm test` the
   * first `setImmediate` can be starved past 60ms, so the run is still going when the next five asks
   * arrive, `again` folds all five into one more run instead of two, and the last assertion reads
   * `2 !== 3`. The coalescer was right every time; the clock was the flake. Nothing here measures
   * time now, so the result is the same on a loaded machine as on an empty one.
   */
  let letGo = null;
  let announceStart = null;
  const nextStart = () => new Promise((resolve) => { announceStart = resolve; });
  service.readSettings = async () => SETTINGS;
  prisma.$transaction = () => {
    runs += 1;
    inFlight += 1;
    most = Math.max(most, inFlight);
    announceStart?.();
    announceStart = null;
    return new Promise((resolve) => { letGo = () => { inFlight -= 1; resolve(); }; });
  };
  /** Long enough for the coalescer's own `finally` and the `setImmediate` behind the next run. */
  const settle = async () => { await new Promise((resolve) => setImmediate(resolve)); await new Promise((resolve) => setImmediate(resolve)); };
  try {
    // Three asks before it starts: one run.
    let started = nextStart();
    for (let i = 0; i < 3; i += 1) ledgers.refreshSoon(9);
    await started;
    assert.equal(runs, 1, "asks before the rebuild starts are folded into it");
    started = nextStart();
    letGo();
    await settle();
    assert.equal(runs, 1, "and they queue nothing behind it");

    // One ask, then four while it runs - provably while it runs, not five milliseconds in.
    ledgers.refreshSoon(9);
    await started;
    assert.equal(runs, 2);
    started = nextStart();
    for (let i = 0; i < 4; i += 1) ledgers.refreshSoon(9);
    letGo();
    await started;
    assert.equal(most, 1, "never two rebuilds of one employee at once");
    assert.equal(runs, 3, "the asks during a run come to one more run after it");
    // And exactly one more: the four did not each earn their own.
    letGo();
    await settle();
    assert.equal(runs, 3, "four asks during one run come to one run, not four");
    assert.equal(inFlight, 0);
  } finally {
    prisma.$transaction = original.transaction;
    service.readSettings = original.readSettings;
  }
});

/*
 * **A day off bought with two half days spends both of them.**
 *
 * One claim, two worked days: `worked_date` and `worked_pair_date`. If the ledger read only the first,
 * the second would stay AVAILABLE and offer itself again - the same half spent twice.
 */

test("both worked days a claim spent read as claimed, and what each earned is recorded", async () => {
  // Two Sundays worked a full day, 1 Mar and 8 Mar, each granted half a day by its approvers, and one
  // claim that spends the pair on a day off of 12 Mar.
  const sessions = [
    { workDate: day("2026-03-01"), loginAt: at("2026-03-01", "09:30"), logoutAt: at("2026-03-01", "18:00"), awayMinutes: 0 },
    { workDate: day("2026-03-08"), loginAt: at("2026-03-08", "09:30"), logoutAt: at("2026-03-08", "18:00"), awayMinutes: 0 },
  ];
  const requests = [
    { id: 21, type: "COMP_OFF_CREDIT", status: "APPROVED", workedDate: day("2026-03-01"), workedToDate: null, grantedDays: 0.5, fromDate: day("2026-03-01"), toDate: day("2026-03-01") },
    { id: 22, type: "COMP_OFF_CREDIT", status: "APPROVED", workedDate: day("2026-03-08"), workedToDate: null, grantedDays: 0.5, fromDate: day("2026-03-08"), toDate: day("2026-03-08") },
    { id: 23, type: "COMP_OFF", status: "PENDING", workedDate: day("2026-03-01"), workedPairDate: day("2026-03-08"), fromDate: day("2026-03-12"), toDate: day("2026-03-12"), createdAt: day("2026-03-09") },
  ];
  const client = fakeClient();
  client.attendanceSession.findMany = async () => sessions;
  client.attendanceRequest.findMany = async ({ where }) => requests.filter((request) => request.type === where.type
    && (typeof where.status === "string" ? request.status === where.status : !where.status?.in || where.status.in.includes(request.status)));
  client.attendanceRequest.findFirst = async () => null;
  // The rule went live before these days, so each day's credit decides what it earned.
  await ledgers.rebuildEmployee(7, { client, settings: { ...SETTINGS, compOffApprovalFrom: day("2026-01-01") }, today: "2026-03-20" });

  const rows = client.written.compOffLedger.map((row) => [row.workedDate.toISOString().slice(0, 10), Number(row.earnedDays), row.status, row.requestId]);
  // Both days spent, both against the one claim - not one CLAIMED and the other still on offer.
  assert.deepEqual(rows, [
    ["2026-03-01", 0.5, "CLAIMED", 23],
    ["2026-03-08", 0.5, "CLAIMED", 23],
  ]);
});

test("a day granted half a day is worth half a day in the ledger, not a whole one", async () => {
  const sessions = [{ workDate: day("2026-03-01"), loginAt: at("2026-03-01", "09:30"), logoutAt: at("2026-03-01", "18:00"), awayMinutes: 0 }];
  const requests = [
    { id: 31, type: "COMP_OFF_CREDIT", status: "APPROVED", workedDate: day("2026-03-01"), workedToDate: null, grantedDays: 0.5, fromDate: day("2026-03-01"), toDate: day("2026-03-01") },
  ];
  const client = fakeClient();
  client.attendanceSession.findMany = async () => sessions;
  client.attendanceRequest.findMany = async ({ where }) => requests.filter((request) => request.type === where.type
    && (typeof where.status === "string" ? request.status === where.status : !where.status?.in || where.status.in.includes(request.status)));
  client.attendanceRequest.findFirst = async () => null;
  await ledgers.rebuildEmployee(7, { client, settings: { ...SETTINGS, compOffApprovalFrom: day("2026-01-01") }, today: "2026-03-20" });

  // The row is there and AVAILABLE - the day was worked and approved - but worth half a day, so
  // nothing can be claimed against it alone. This is the miscount the change fixes: it used to be 1.
  assert.deepEqual(client.written.compOffLedger.map((row) => [Number(row.earnedDays), row.status]), [[0.5, "AVAILABLE"]]);
});
