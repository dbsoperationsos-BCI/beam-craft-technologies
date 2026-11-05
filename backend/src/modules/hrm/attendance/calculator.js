const prisma = require("../../../config/db");
const { DAY_KINDS, NOT_REQUIRED_STATUS, calendarDay, eachDateInRange, isAttendedStatus, localIsoDate } = require("./attendanceRules");

/**
 * Settings → Employee → Payroll rules → Attendance calculator: one employee's pay period, turned into the
 * days payroll brings in - days away, loss of pay, Casual Leave and comp-offs taken. Days only: Payroll →
 * Main Page works the salary out itself. Read-only - it applies fixed rules to what attendance already
 * recorded and changes nothing.
 *
 * The period is a start and an end date, both counted. The page offers the studio's cycle - the 25th
 * of one month to the 25th of the next - and either end can be moved.
 *
 * The rules, in the order the page states them:
 *
 * - **A period is one pay cycle at most** (`MAX_PERIOD_DAYS`): the days it answers with are one
 *   month's payroll.
 * - **Loss of pay** is one day for each absence and half a day for each half day. Approved leave,
 *   comp-offs, approved on-duty days, holidays and weekly offs are paid. **A late mark takes nothing
 *   off** - it is shown, and that is all. A day logged in but never logged out still counts as
 *   present: the person came.
 * - **Working a holiday or weekly off does not make up for an absence.** The day off was paid
 *   anyway; the way to be given a day back for it is a comp-off, which then covers the day taken.
 * - **Payable days** are the days counted less the loss of pay. The days counted run from the later
 *   of the period's start and the date of joining, so somebody who joined mid-period is paid from
 *   that day; and for a period still running they stop at yesterday - today is not over, and a
 *   morning without a login yet is not an absence.
 *
 * The attendance comes from `attendanceDays` - each day's kind (working, leave, holiday, weekly off)
 * and its status, judged by the same rules as every other attendance screen - and is classified
 * **one day at a time** (`tallyDays`). Not from `attendanceTotals`: that works absences out as
 * working days less logins less leave, so a login on a Sunday cancelled a weekday absence and a
 * login on a leave day was counted twice, both of which would have paid a day that was missed.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Long enough for any 25th-to-25th cycle (32 days at most) with room to spare; short of two months. */
const MAX_PERIOD_DAYS = 45;

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const notFound = (message) => Object.assign(new Error(message), { status: 404 });

/** A `YYYY-MM-DD` that is a real day, as that day at UTC midnight; otherwise null. */
function dayFrom(value) {
  const text = String(value || "");
  if (!DATE_PATTERN.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? null : date;
}

const isoOf = (date) => date.toISOString().slice(0, 10);

/**
 * The stretch of a period that is counted: its start and end, how many days it has, and the days
 * actually counted in it - none for a period with nothing to count yet (it starts today, or the
 * employee had not joined by its end).
 */
function countedPeriod({ from, to } = {}, { today = calendarDay(new Date()), joinedOn = null, relievedOn = null } = {}) {
  const periodStart = dayFrom(from);
  const periodEnd = dayFrom(to);
  if (!periodStart || !periodEnd) throw badRequest("Choose a start date and an end date.");
  if (periodEnd < periodStart) throw badRequest("The end date cannot be before the start date.");
  if (periodStart > today) throw badRequest("That period has not started yet.");
  const periodDays = Math.round((periodEnd - periodStart) / DAY_MS) + 1;
  if (periodDays > MAX_PERIOD_DAYS) throw badRequest(`Choose a period of ${MAX_PERIOD_DAYS} days or fewer - one pay cycle.`);

  const yesterday = new Date(today.getTime() - DAY_MS);
  const joined = joinedOn ? calendarDay(joinedOn) : null;
  const start = joined && joined > periodStart ? joined : periodStart;
  // Counted to the relieving date at the latest: a day after it is not owed, so never an absence.
  const relieved = relievedOn ? calendarDay(relievedOn) : null;
  const lastOwed = periodEnd < today ? periodEnd : yesterday;
  const end = relieved && relieved < lastOwed ? relieved : lastOwed;
  const period = { from: isoOf(periodStart), to: isoOf(periodEnd), periodDays, inProgress: periodEnd >= today, start: null, end: null, countedDays: 0 };
  if (end < start) return period;
  return { ...period, start, end, countedDays: Math.round((end - start) / DAY_MS) + 1 };
}

/**
 * Each counted day, classified once. `days` are `attendanceDays` rows (`date`, `dayKind`, `status`);
 * `onDutyDates` the days covered by an approved on-duty request. Every day lands in exactly one of
 * working (present / absent / on leave / on duty / not required) or off (holiday / weekly off), so
 * the counts add up to the days counted.
 */
function tallyDays(days, { onDutyDates = new Set(), leaveDates = new Set(), lopLeaveDates = new Set(), leaveLossOfPay = new Map(), leaveCovered = null, compOffDates = new Set() } = {}) {
  const tally = {
    workingDays: 0, present: 0, absent: 0, onLeave: 0, onDuty: 0, notRequired: 0,
    halfDays: 0, late: 0, holidaysAndWeeklyOffs: 0, workedOnDaysOff: 0, leaveDays: 0, leaveBeyondBalance: 0, casualLeaveTaken: 0,
    compOffTaken: 0,
  };
  for (const day of days) {
    const attended = isAttendedStatus(day.status);
    // An approved comp-off's day off: counted whatever else the day was - leave beside it, or worked
    // anyway - as the comp-off ledger marks it used. Paid, never Casual Leave, never away.
    if (compOffDates.has(day.date)) tally.compOffTaken += 1;
    if (day.dayKind === DAY_KINDS.HOLIDAY || day.dayKind === DAY_KINDS.WEEKLY_OFF) {
      // Paid whatever happened. Worked or not, it neither costs nor earns a day here.
      tally.holidaysAndWeeklyOffs += 1;
      if (attended) tally.workedOnDaysOff += 1;
      continue;
    }
    tally.workingDays += 1;
    if (day.dayKind === DAY_KINDS.ON_LEAVE) {
      // Approved leave on a day that was owed: paid. Coming in anyway is present, and still paid in
      // full - the leave already covered the day, so a short day on it costs nothing.
      if (attended) tally.present += 1;
      else {
        tally.onLeave += 1;
        // An approved Leave day away: what the Casual Leave balance covered is Casual Leave taken, and
        // paid; what it could not is Loss of Pay (`casualLeaveLedger`). With no Casual Leave set
        // (`leaveCovered` null) every leave day is covered, as leave always was.
        if (lopLeaveDates.has(day.date)) {
          // A Loss of Pay leave: away, never Casual Leave, and unpaid every day.
          tally.leaveDays += 1;
          tally.leaveBeyondBalance += 1;
        } else if (leaveDates.has(day.date)) {
          tally.leaveDays += 1;
          tally.casualLeaveTaken += leaveCovered ? leaveCovered.get(day.date) || 0 : 1;
          tally.leaveBeyondBalance += leaveLossOfPay.get(day.date) || 0;
        }
      }
      continue;
    }
    if (attended) {
      tally.present += 1;
      if (day.status === "Half day") tally.halfDays += 1;
      if (day.status === "Late") tally.late += 1;
    } else if (day.status === NOT_REQUIRED_STATUS) {
      tally.notRequired += 1;
    } else if (day.status === "On leave") {
      // A day an approved Correction set to On leave: leave, paid like the leave above.
      tally.onLeave += 1;
    } else if (onDutyDates.has(day.date)) {
      // Away on the studio's business with no login to show for it: approved, so paid.
      tally.onDuty += 1;
    } else {
      tally.absent += 1;
    }
  }
  return tally;
}

/**
 * The days, on their own so they can be checked without a database. `tally` is what `tallyDays`
 * answers with.
 *
 * Days only - no rupees. Payroll → Main Page works the salary out itself, under each month's own LOP
 * divisor and rounding (`payroll-register`), from these days; a salary worked out here, over the
 * period's calendar days, disagreed with it and was read by nothing.
 */
function payableFor({ tally, countedDays }) {
  const absent = tally?.absent || 0;
  const halfDays = tally?.halfDays || 0;
  // Leave beyond the Casual Leave balance is unpaid, like an absence.
  const lossOfPayDays = absent + halfDays * 0.5 + (tally?.leaveBeyondBalance || 0);
  // Every day away - absences, half days as half, and approved leave - which payroll shows as Attendance
  // Leaves with the Casual Leave that covered some of that leave beside; the two differ by exactly the loss of pay.
  const awayDays = absent + halfDays * 0.5 + (tally?.leaveDays || 0);
  const payableDays = Math.max(0, countedDays - lossOfPayDays);
  return { lossOfPayDays, awayDays, payableDays };
}

/** The day of the month salary is paid out until the studio says otherwise. */
const DEFAULT_PAYBACK_DAY = 10;

/**
 * What is wrong with a pay period and payback day, or "" for nothing. The period is two real days,
 * the end not before the start and no longer than one pay cycle; the payback day is a whole day of
 * the month, 1 to 31 - the same every month, a day past a short month's end meaning its last day.
 */
/** The day the pay cycle turns over until the studio says otherwise: the 25th to the 25th. */
const DEFAULT_CYCLE_DAY = 25;

/**
 * What is wrong with a pay cycle day and payback day, or "" for nothing: each a whole day of the
 * month, 1 to 31 - the same every month, a day past a short month's end meaning its last day.
 */
function payPeriodProblem({ cycleDay = DEFAULT_CYCLE_DAY, paybackDay = DEFAULT_PAYBACK_DAY } = {}) {
  const isDay = (value) => Number.isInteger(Number(value)) && String(value).trim() !== "" && Number(value) >= 1 && Number(value) <= 31;
  if (!isDay(cycleDay)) return "Choose a start and end date from 1 to 31.";
  if (!isDay(paybackDay)) return "Choose a payable date from 1 to 31.";
  return "";
}

/** The saved pay cycle day and payback day of the month. */
async function readPayPeriod(client = prisma) {
  const row = await client.hrmSettings.findUnique({
    where: { id: "default" },
    select: { payCycleDay: true, paybackDay: true },
  });
  return {
    cycleDay: row?.payCycleDay ?? DEFAULT_CYCLE_DAY,
    paybackDay: row?.paybackDay ?? DEFAULT_PAYBACK_DAY,
  };
}

/**
 * Saves the pay cycle day and payback day together, refusing what `payPeriodProblem` objects to - from
 * the current month's payroll on, as every Payroll rules change is: earlier months keep the days they
 * had (`payroll-register/settingsVersions`). `{ cycleDay, paybackDay, effectiveFrom }`.
 */
async function savePayPeriod({ cycleDay = DEFAULT_CYCLE_DAY, paybackDay = DEFAULT_PAYBACK_DAY } = {}, { userId = null, client = prisma, now = new Date() } = {}) {
  const problem = payPeriodProblem({ cycleDay, paybackDay });
  if (problem) throw badRequest(problem);
  // Required here rather than at the top: the payroll register reads this module, and loading it from
  // there at start-up would be a circle.
  const { recordChange } = require("../payroll-register/settingsVersions");
  const saved = await client.$transaction((tx) => recordChange(tx, { cycleDay: Number(cycleDay), paybackDay: Number(paybackDay) }, userId, now));
  return { cycleDay: saved.cycleDay, paybackDay: saved.paybackDay, effectiveFrom: saved.effectiveFrom };
}

/** The people the calculator can be pointed at: everybody not archived, by name. */
async function calculatorEmployees(client = prisma) {
  const employees = await client.employee.findMany({
    // Not anybody ticked Exclude From Attendance: they are not in this module.
    where: { archivedAt: null, excludeFromAttendance: false },
    select: { id: true, employeeId: true, employeeName: true, employmentStatus: true },
    orderBy: { employeeName: "asc" },
  });
  return employees.map((employee) => ({
    id: employee.id,
    code: employee.employeeId,
    name: employee.employeeName,
    status: employee.employmentStatus,
  }));
}

/** One employee's period: the days and the loss of pay - what payroll brings in. */
async function periodCalculation(employeeId, { from, to } = {}, { today, client = prisma } = {}) {
  const id = Number(employeeId);
  if (!Number.isInteger(id) || id <= 0) throw badRequest("Choose an employee.");
  const employee = await client.employee.findFirst({
    where: { id, archivedAt: null, excludeFromAttendance: false },
    select: { id: true, employeeId: true, employeeName: true, dateOfJoining: true, dateOfRelieving: true },
  });
  if (!employee) throw notFound("That employee could not be found.");

  // Counted from the later of the joining date and the day attendance starts being counted.
  const { readSettings } = require("./service");
  const { attendanceStartIso, laterIso } = require("./attendanceRules");
  const settings = await readSettings(client);
  const goLive = attendanceStartIso(settings);
  const joinedIso = employee.dateOfJoining ? new Date(employee.dateOfJoining).toISOString().slice(0, 10) : null;
  const countedFrom = laterIso(joinedIso, goLive);
  let period = countedPeriod({ from, to }, { today, joinedOn: countedFrom ? new Date(`${countedFrom}T00:00:00.000Z`) : null, relievedOn: employee.dateOfRelieving || null });
  // The days between a past stint and their rejoining, taken off below once the day rows are read.
  // Required here, not at the top, for the reason the service is below: it requires this file.
  const { awayBetweenStints, rejoinGaps } = require("./service");
  const gaps = period.countedDays ? await rejoinGaps(employee.id, client) : [];
  let tally = tallyDays([]);
  let optional = false;
  if (period.countedDays) {
    // Required here rather than at the top: the service is large and loads a good deal, and this
    // file is also read by tests that only want the arithmetic above.
    const { attendanceDays, casualLeaveFor } = require("./service");
    const [reading, onDuty, leaves, casualLeave, compOffs] = await Promise.all([
      attendanceDays(employee.id, period.start, period.end, client),
      client.attendanceRequest.findMany({
        where: { employeeId: employee.id, type: "ON_DUTY", status: "APPROVED", fromDate: { lte: period.end }, toDate: { gte: period.start } },
        select: { fromDate: true, toDate: true },
      }),
      // The approved Leave in the period - each day of it away, covered by Casual Leave or not.
      client.attendanceRequest.findMany({
        where: { employeeId: employee.id, type: "LEAVE", status: "APPROVED", fromDate: { lte: period.end }, toDate: { gte: period.start } },
        select: { fromDate: true, toDate: true, leaveType: true },
      }),
      casualLeaveFor(employee.id, localIsoDate(period.end), { client, settings, joinedIso }),
      // The approved comp-offs whose day off falls in the period - Comp-Off Taken.
      client.attendanceRequest.findMany({
        where: { employeeId: employee.id, type: "COMP_OFF", status: "APPROVED", fromDate: { lte: period.end }, toDate: { gte: period.start } },
        select: { fromDate: true, toDate: true },
      }),
    ]);
    const onDutyDates = new Set(onDuty.flatMap((request) => eachDateInRange(request.fromDate, request.toDate)));
    const datesOf = (requests) => new Set(requests.flatMap((request) => eachDateInRange(request.fromDate, request.toDate)));
    // Casual Leave, and Loss of Pay leave - which never takes from the balance and is unpaid.
    const leaveDates = datesOf(leaves.filter((request) => request.leaveType !== "LOP"));
    const lopLeaveDates = datesOf(leaves.filter((request) => request.leaveType === "LOP"));
    tally = tallyDays(reading.days, {
      onDutyDates,
      leaveDates,
      lopLeaveDates,
      leaveLossOfPay: casualLeave.lossOfPayByDate,
      leaveCovered: casualLeave.enabled ? casualLeave.coveredByDate : null,
      compOffDates: datesOf(compOffs),
    });
    optional = Boolean(reading.optional);
    /*
     * Less the days between a past stint and their rejoining: they did not work here then, so those
     * days are neither paid nor a loss of pay. The day rows already leave them out unless they logged
     * in that day (`attendanceDays`); the count of days the period covers is kept in step with them.
     */
    if (gaps.length) {
      const listed = new Set(reading.days.map((row) => row.date));
      const away = eachDateInRange(period.start, period.end).filter((iso) => awayBetweenStints(gaps, iso) && !listed.has(iso)).length;
      if (away) period = { ...period, countedDays: period.countedDays - away };
    }
  }

  return {
    employee: {
      id: employee.id,
      code: employee.employeeId,
      name: employee.employeeName,
      dateOfJoining: employee.dateOfJoining ? localIsoDate(employee.dateOfJoining) : null,
    },
    from: period.from,
    to: period.to,
    periodDays: period.periodDays,
    inProgress: period.inProgress,
    countedFrom: period.start ? localIsoDate(period.start) : null,
    countedTo: period.end ? localIsoDate(period.end) : null,
    countedDays: period.countedDays,
    attendanceOptional: optional,
    days: tally,
    // Attendance Rules' irregularity penalty: its days for every day still Absent - on top of the day.
    irregularityPenaltyDays: (tally?.absent || 0) * (Number(settings?.irregularityPenaltyDays) || 0),
    ...payableFor({ tally, countedDays: period.countedDays }),
  };
}

module.exports = {
  DEFAULT_CYCLE_DAY,
  DEFAULT_PAYBACK_DAY,
  MAX_PERIOD_DAYS,
  calculatorEmployees,
  countedPeriod,
  payPeriodProblem,
  payableFor,
  periodCalculation,
  readPayPeriod,
  savePayPeriod,
  tallyDays,
};
