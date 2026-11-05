const prisma = require("../../../config/db");
const compOffCredits = require("./compOffCredits");
const { branchForEmployee } = require("../../../services/holidayCalendar");
const { createCoalescer } = require("../../../services/coalesce");
const {
  attendanceStartIso,
  calendarDay,
  compOffExpiresOn,
  earnsCompOff,
  fullDayWorked,
  localIsoDate,
  permissionMinutes,
  workedMinutes,
} = require("./attendanceRules");

/*
 * The attendance ledgers: a stored record of each employee's Casual Leave, permissions and comp-offs -
 * `casual_leave_ledger`, `permission_ledger`, `comp_off_ledger` - for history and audit.
 *
 * The rules stay the truth: the balance (`casualLeaveFor`), the permission limit's periods
 * (`attendancePeriods`) and comp-off eligibility (`earnsCompOff`, `fullDayWorked`,
 * `compOffExpiresOn`) are worked out exactly as the screens and payroll work them out, and these
 * tables keep what that comes to. So an employee's rows are written again, whole, whenever something of
 * theirs changes (`refreshSoon`) - a request raised, edited, decided, sent back, reverted or deleted, a
 * logout - and everybody's when Attendance Rules or the holidays change (`refreshAllSoon`): a stored
 * row can never disagree with the screen for long, and is never a second set of rules to keep in step.
 * Who decided what, and when, stays on the request's own history.
 *
 * Written after the answer has gone (`setImmediate`), and a failure is logged rather than thrown: a
 * ledger is a record, and keeping it must never stop somebody's leave being raised or decided.
 */

/** Statuses of a request that is still in play - it counts toward a limit, or holds a comp-off. */
const LIVE_STATUSES = ["PENDING", "SENT_BACK", "APPROVED"];

const dateOf = (iso) => new Date(`${iso}T00:00:00.000Z`);
const two = (value) => Math.round((Number(value) || 0) * 100) / 100;

/** The Casual Leave ledger's rows for one employee: one per period, opening to closing. */
async function casualLeaveRows(employeeId, settings, today, client) {
  // Required here: the service reads this module's neighbours, and a top-level require would be a circle.
  const service = require("./service");
  // Worked out through the later of today and the last approved Casual Leave, so a leave booked ahead
  // is on the record of the period it falls in.
  const latest = await client.attendanceRequest.findFirst({
    where: { employeeId, type: "LEAVE", status: "APPROVED", OR: [{ leaveType: null }, { leaveType: { not: "LOP" } }] },
    orderBy: { toDate: "desc" },
    select: { toDate: true },
  });
  const latestIso = latest?.toDate ? localIsoDate(latest.toDate) : today;
  const ledger = await service.casualLeaveFor(employeeId, latestIso > today ? latestIso : today, { client, settings });
  if (!ledger.enabled) return [];
  const { startOf, endOf } = await service.casualLeavePeriods(settings, client);
  const countedBy = settings.casualLeavePeriod === "PAY_CYCLE" ? "PAY_CYCLE" : "CALENDAR_MONTH";
  return ledger.months.map((month) => ({
    employeeId,
    period: month.month,
    periodFrom: dateOf(startOf(month.month)),
    periodTo: dateOf(endOf(month.month)),
    countedBy,
    opening: two(month.opening),
    credited: two(month.credited),
    taken: two(month.taken),
    lossOfPay: two(month.lossOfPay),
    closing: two(month.closing),
  }));
}

/** The permission ledger's rows for one employee: one per permission request, in its period. */
async function permissionRows(employeeId, settings, client) {
  const service = require("./service");
  const requests = await client.attendanceRequest.findMany({
    where: { employeeId, type: "PERMISSION" },
    select: { id: true, fromDate: true, fromTime: true, toTime: true, status: true },
  });
  if (!requests.length) return [];
  const { periodOf, startOf, endOf } = await service.attendancePeriods(settings.permissionPeriod, client);
  const countedBy = settings.permissionPeriod === "PAY_CYCLE" ? "PAY_CYCLE" : "CALENDAR_MONTH";
  return requests.map((request) => {
    const day = localIsoDate(request.fromDate);
    const period = periodOf(day);
    return {
      employeeId,
      requestId: request.id,
      permissionDate: dateOf(day),
      period,
      periodFrom: dateOf(startOf(period)),
      periodTo: dateOf(endOf(period)),
      countedBy,
      minutes: permissionMinutes(request.fromTime, request.toTime) || 0,
      status: request.status,
      countsTowardLimit: LIVE_STATUSES.includes(request.status),
    };
  });
}

/**
 * The comp-off ledger's rows for one employee: every weekly off or declared holiday they worked a full
 * day on, from the day attendance is counted, and every day a live comp-off claims - each with when it
 * expires and where it stands: AVAILABLE, CLAIMED (asked for, or approved for a day still ahead), USED
 * (its day off taken) or EXPIRED (never claimed, past its expiry).
 */
async function compOffRows(employeeId, settings, today, client) {
  const service = require("./service");
  const goLive = attendanceStartIso(settings);
  const [sessions, claims] = await Promise.all([
    client.attendanceSession.findMany({
      where: { employeeId, workDate: { lt: dateOf(today), ...(goLive ? { gte: dateOf(goLive) } : {}) } },
      select: { workDate: true, loginAt: true, logoutAt: true, awayMinutes: true },
    }),
    client.attendanceRequest.findMany({
      where: { employeeId, type: "COMP_OFF", status: { in: LIVE_STATUSES }, workedDate: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { id: true, workedDate: true, workedPairDate: true, fromDate: true, status: true },
    }),
  ]);
  if (!sessions.length && !claims.length) return [];
  // A claim's worked days: the one it names, and the second half day where the day off was bought
  // with two halves. Both are spent, so both have to read as claimed rather than the second staying
  // AVAILABLE and offering itself again.
  const claimDays = (claim) => [localIsoDate(claim.workedDate), ...(claim.workedPairDate ? [localIsoDate(claim.workedPairDate)] : [])];
  const days = [...sessions.map((session) => localIsoDate(session.workDate)), ...claims.flatMap(claimDays)].sort();
  // The person's own branch's holidays: a day another branch was shut earns them no comp-off.
  const holidayDates = await service.holidayDateSet(calendarDay(days[0]), calendarDay(days.at(-1)), client, await branchForEmployee(employeeId, client));
  const claimOf = new Map();
  for (const claim of claims) for (const day of claimDays(claim)) if (!claimOf.has(day)) claimOf.set(day, claim);
  const sessionOf = new Map(sessions.map((session) => [localIsoDate(session.workDate), session]));
  // Earned once approved: a day worked from the day the approval rule went live counts only when every
  // Leave Approver has approved its COMP_OFF_CREDIT; a day before it, as it always did (`compOffCredits`).
  const approved = await compOffCredits.approvedCreditDates(employeeId, client);
  /*
   * **What each day earned**, rather than whether it earned. A worked day used to be worth one day
   * off; its approvers now grant an amount (0, 0.5, 1 …), and the ledger carries that so the balance
   * is a sum instead of a count. A day whose credit predates amounts earns a whole day, as it did.
   */
  const earnedDays = await compOffCredits.earnedDaysByDate(employeeId, client);
  const earned = sessions.filter((session) => earnsCompOff(session.workDate, holidayDates, settings) && fullDayWorked(session, settings))
    .map((session) => localIsoDate(session.workDate))
    .filter((iso) => compOffCredits.creditCleared(iso, settings, approved));
  return [...new Set([...earned, ...claimOf.keys()])].sort().map((worked) => {
    const claim = claimOf.get(worked) || null;
    const session = sessionOf.get(worked) || null;
    const expiresOn = compOffExpiresOn(worked, settings);
    const dayOff = claim ? localIsoDate(claim.fromDate) : null;
    const status = claim
      ? claim.status === "APPROVED" && dayOff < today ? "USED" : "CLAIMED"
      : expiresOn && expiresOn < today ? "EXPIRED" : "AVAILABLE";
    return {
      employeeId,
      workedDate: dateOf(worked),
      // What this day is actually worth. A granted 0 stays in the ledger as a row worth nothing - the
      // day was worked and looked at, and dropping it would read as though nobody had decided.
      earnedDays: earnedDays.has(worked) ? earnedDays.get(worked) : 1,
      workedMinutes: session?.logoutAt ? workedMinutes(session) : 0,
      expiresOn: expiresOn ? dateOf(expiresOn) : null,
      status,
      requestId: claim?.id ?? null,
      dayOff: dayOff ? dateOf(dayOff) : null,
    };
  });
}

/**
 * Writes one employee's three ledgers again from the rules: each table's rows for them replaced with
 * what the rules come to now. `today` is the studio's day; tests pass their own.
 *
 * One rebuild of an employee at a time, across every server process: the transaction locks their
 * employee row first and works the rows out inside that lock, so two rebuilds a moment apart - an
 * approval and a logout, say - queue rather than both deleting and both inserting, and the last to
 * write always wrote from what was there when it ran. An employee archived or kept out of attendance
 * has their rows cleared rather than left to go stale. A deadlock is tried once more.
 */
async function rebuildEmployee(employeeId, { client = prisma, settings = null, today = localIsoDate(calendarDay(new Date())) } = {}) {
  const id = Number(employeeId);
  if (!Number.isInteger(id) || id <= 0) return;
  const service = require("./service");
  const rules = settings || await service.readSettings(client);
  /*
   * A weekly off or holiday worked is put up for approval first, outside the ledger's own write: its
   * request is the approvers', not the ledger's, and one that cannot be raised must not stop the
   * balances being written. Idempotent (`compOffCredits.ensureCreditRequests`).
   */
  try {
    await compOffCredits.ensureCreditRequests(id, { client, settings: rules, notify: require("./requestNotifications").notifyApprovers });
  } catch (error) {
    console.error(`Comp-off credits could not be raised for employee ${id}:`, error.message);
  }
  const write = () => client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM employee WHERE id = ${id} FOR UPDATE`;
    const employee = await tx.employee.findUnique({ where: { id }, select: { archivedAt: true, excludeFromAttendance: true } });
    const kept = Boolean(employee) && !employee.archivedAt && !employee.excludeFromAttendance;
    const [casual, permissions, compOffs] = kept ? await Promise.all([
      casualLeaveRows(id, rules, today, tx),
      permissionRows(id, rules, tx),
      compOffRows(id, rules, today, tx),
    ]) : [[], [], []];
    await tx.casualLeaveLedger.deleteMany({ where: { employeeId: id } });
    await tx.permissionLedger.deleteMany({ where: { employeeId: id } });
    await tx.compOffLedger.deleteMany({ where: { employeeId: id } });
    if (casual.length) await tx.casualLeaveLedger.createMany({ data: casual });
    if (permissions.length) await tx.permissionLedger.createMany({ data: permissions });
    if (compOffs.length) await tx.compOffLedger.createMany({ data: compOffs });
  }, { timeout: 30000 });
  try {
    await write();
  } catch (error) {
    if (error?.code !== "P2034") throw error;
    await write();
  }
}

/** Everybody attendance is kept for, written again - after a change to Attendance Rules or the holidays. */
async function rebuildAll({ client = prisma } = {}) {
  const service = require("./service");
  const settings = await service.readSettings(client);
  // Everybody attendance is kept for, and everybody holding ledger rows - so somebody archived or kept
  // out of attendance since has theirs cleared.
  const [kept, holding] = await Promise.all([
    client.employee.findMany({ where: { archivedAt: null, excludeFromAttendance: false }, select: { id: true } }),
    client.casualLeaveLedger.findMany({ distinct: ["employeeId"], select: { employeeId: true } }),
  ]);
  const employees = [...new Set([...kept.map((employee) => employee.id), ...holding.map((row) => row.employeeId)])].map((id) => ({ id }));
  let failed = 0;
  for (const employee of employees) {
    try {
      await rebuildEmployee(employee.id, { client, settings });
    } catch (error) {
      failed += 1;
      console.error(`Attendance ledgers could not be written for employee ${employee.id}:`, error.message);
    }
  }
  return { employees: employees.length, failed };
}

// One rebuild per key at a time: a burst of asks never stacks up rebuilds of the same people.
const coalesce = createCoalescer();

/** `rebuildEmployee` after the answer has gone; a failure is logged, never thrown. */
function refreshSoon(employeeId) {
  if (!employeeId) return;
  coalesce(`employee:${employeeId}`, () => rebuildEmployee(employeeId),
    (error) => console.error(`Attendance ledgers could not be written for employee ${employeeId}:`, error.message));
}

/** `rebuildAll` after the answer has gone; a failure is logged, never thrown. */
function refreshAllSoon() {
  coalesce("all", () => rebuildAll(), (error) => console.error("Attendance ledgers could not be written:", error.message));
}

/**
 * One employee's comp-off rows **worked out now**, not read back from the table. The Raise Request
 * picker asks this rather than `comp_off_ledger`, so a day never goes missing from the list because
 * the ledger had not been written since it was earned; the table stays what the balance is read from.
 */
async function compOffBalanceNow(employeeId, { client = prisma, settings = null, today = localIsoDate(calendarDay(new Date())) } = {}) {
  const service = require("./service");
  const rules = settings || await service.readSettings(client);
  return compOffRows(Number(employeeId), rules, today, client);
}

module.exports = { rebuildEmployee, rebuildAll, refreshSoon, refreshAllSoon, compOffBalanceNow, LIVE_STATUSES };
