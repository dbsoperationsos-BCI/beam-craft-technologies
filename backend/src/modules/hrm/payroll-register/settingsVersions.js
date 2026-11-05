const prisma = require("../../../config/db");
const { todayInIndia } = require("../payroll-recovery/service");

/*
 * Settings → Payroll rules, kept by the payroll month they apply from: the salary rules (a day's pay
 * for the loss-of-pay deduction, and the rounding) and the Attendance calculator's two days (the day
 * the pay cycle turns over, and the payable day of the following month).
 *
 * A change applies from the **payroll month whose pay cycle is running today** (in India) on - with
 * months named for when they are paid, on 9 October that is November (25 Sep - 24 Oct), October's
 * cycle having ended. That month and every later one follow it, while every earlier month - the one
 * being paid out now among them, generated or not, paid or not - keeps the settings it had. Each
 * change records a version effective from its month (`payroll_rule_version`); a month reads the
 * latest version on or before it. The first change also records the settings as they stood before
 * it, from January 2000, so every earlier month has a version to read. `hrm_settings` keeps the
 * settings as they are now - what Settings shows, and what the current month follows.
 *
 * **A payroll month is named for the month it is paid in.** October's payroll is the pay cycle that
 * ended in September - 25 Aug to 24 Sep with the cycle on the 25th - paid out on the payable day of
 * October itself: 10 Oct. So a month's cycle ends the day before its cycle day *in the month before
 * it* (on the 1st, that month's last day), and starts the day after the payroll month before it
 * ended. Across a change of cycle day it neither skips nor repeats a day - from 25 to 1 in October,
 * September stays 25 Jul - 24 Aug and October runs 25 Aug - 30 Sep.
 */

const LOP_DIVISORS = ["WORKING_DAYS", "CALENDAR_DAYS", "FIXED_30"];
const ROUNDING_RULES = ["NEAREST_100", "NEAREST_50", "NEAREST_10", "NEAREST_1", "DOWN_1"];
const DEFAULTS = { lopDivisor: "WORKING_DAYS", rounding: "NEAREST_10", cycleDay: 25, paybackDay: 10 };
const BASELINE = { effectiveYear: 2000, effectiveMonth: 1 };

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const fail = (status, message) => Object.assign(new Error(message), { status });
const isDay = (value) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 31;

/** A version's or the settings row's values, each checked, with the defaults where one is missing. */
function cleaned(row = {}) {
  return {
    lopDivisor: LOP_DIVISORS.includes(row.lopDivisor) ? row.lopDivisor : DEFAULTS.lopDivisor,
    rounding: ROUNDING_RULES.includes(row.rounding) ? row.rounding : DEFAULTS.rounding,
    cycleDay: isDay(row.cycleDay) ? Number(row.cycleDay) : DEFAULTS.cycleDay,
    paybackDay: isDay(row.paybackDay) ? Number(row.paybackDay) : DEFAULTS.paybackDay,
  };
}

/** The settings as they are now. */
async function currentSettings(client = prisma) {
  const row = await client.hrmSettings.findUnique({
    where: { id: "default" },
    select: { payrollLopDivisor: true, payrollRounding: true, payCycleDay: true, paybackDay: true },
  });
  return cleaned({ lopDivisor: row?.payrollLopDivisor, rounding: row?.payrollRounding, cycleDay: row?.payCycleDay, paybackDay: row?.paybackDay });
}

const monthIndex = (year, month) => (Number(year) * 12) + (Number(month) - 1);

/**
 * A reader of the settings any month was worked out under, from one read of the versions: the latest
 * on or before it, or - before the settings were ever changed - the settings as they are.
 */
async function settingsBook(client = prisma) {
  const [versions, current] = await Promise.all([
    client.payrollRuleVersion.findMany({ orderBy: [{ effectiveYear: "asc" }, { effectiveMonth: "asc" }] }),
    currentSettings(client),
  ]);
  const ordered = versions.map((row) => ({ at: monthIndex(row.effectiveYear, row.effectiveMonth), settings: cleaned(row) }));
  return (year, month) => {
    const at = monthIndex(year, month);
    let found = null;
    for (const version of ordered) if (version.at <= at) found = version;
    return found ? found.settings : current;
  };
}

const iso = (date) => date.toISOString().slice(0, 10);
const daysIn = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** The last day of a month's pay cycle under its cycle day: the day before it, or on the 1st the month's last day. */
function cycleEnd(year, month, cycleDay) {
  const day = Number(cycleDay) || 1;
  if (day <= 1) return new Date(Date.UTC(year, month - 1, daysIn(year, month)));
  const end = new Date(Date.UTC(year, month - 1, Math.min(day, daysIn(year, month))));
  end.setUTCDate(end.getUTCDate() - 1);
  return end;
}

const monthBefore = (year, month) => (month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 });

/** The last day of a payroll month's cycle: in the calendar month before it, under its own cycle day. */
function payrollCycleEnd(year, month, settingsOf) {
  const before = monthBefore(year, month);
  return cycleEnd(before.year, before.month, settingsOf(year, month).cycleDay);
}

/**
 * A payroll month's pay cycle: from the day after the payroll month before it ended (under that
 * month's settings) to the end of its own (under its own) - October is 25 Aug to 24 Sep with the cycle
 * on the 25th. `settingsOf(year, month)` is a `settingsBook`.
 */
function periodFor(year, month, settingsOf) {
  const before = monthBefore(year, month);
  const from = payrollCycleEnd(before.year, before.month, settingsOf);
  from.setUTCDate(from.getUTCDate() + 1);
  return { from: iso(from), to: iso(payrollCycleEnd(year, month, settingsOf)) };
}

/**
 * The day a payroll month is paid out: its payable day of that same month - 10 October for October,
 * whose cycle ended in September. A day past the month's end is its last day.
 */
function payableDateFor(year, month, paybackDay = DEFAULTS.paybackDay) {
  return iso(new Date(Date.UTC(year, month - 1, Math.min(Number(paybackDay) || 1, daysIn(year, month)))));
}

/**
 * The payroll month still being paid, as of `now`: the first, from this calendar month on, whose
 * payable day has not passed in India - October (payable 10 Oct) until 10 Oct, November from the
 * 11th. The Main Page keeps it and every month after it up to date by itself; a month before it is
 * left as it was.
 */
async function openPayrollMonth(client = prisma, now = new Date()) {
  const settingsOf = await settingsBook(client);
  const today = todayInIndia(now);
  let { year, month } = currentPayrollMonth(now);
  while (payableDateFor(year, month, settingsOf(year, month).paybackDay) < today) {
    ({ year, month } = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 });
  }
  return { year, month };
}

/** The calendar month in India - where the search for the running payroll month starts. */
function currentPayrollMonth(now = new Date()) {
  const [year, month] = todayInIndia(now).split("-").map(Number);
  return { year, month };
}

/**
 * The payroll month a change starts from: the first, from this calendar month on, whose pay cycle has
 * not ended by today (in India) - the cycle running now. Never one whose cycle is over, which may
 * already be generated and paid.
 */
async function runningPayrollMonth(client = prisma, now = new Date()) {
  const today = todayInIndia(now);
  const settingsOf = await settingsBook(client);
  let { year, month } = currentPayrollMonth(now);
  for (let step = 0; step < 3 && periodFor(year, month, settingsOf).to < today; step += 1) {
    ({ year, month } = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 });
  }
  return { year, month };
}

const SETTINGS_COLUMNS = { lopDivisor: "payrollLopDivisor", rounding: "payrollRounding", cycleDay: "payCycleDay", paybackDay: "paybackDay" };

/**
 * Records a change to some of the settings, from the running payroll month on, inside `tx` (a transaction):
 * the settings row is touched first to take its lock, so two changes at once run one after the other;
 * then the settings before the first change are kept from January 2000, the current month's version
 * becomes the settings now with the change on top, and `hrm_settings` takes the change.
 *
 * A new **cycle day** is refused while a month after the current one is already generated: that
 * month's rows were read from the day after the current month's old end, and moving that end would
 * make the two months skip or share days. Remove the later month (it is generated again under the
 * new cycle), or make the change once that month is the current one.
 */
async function recordChange(tx, changes, userId = null, now = new Date()) {
  const by = userId || null;
  await tx.hrmSettings.upsert({ where: { id: "default" }, update: { updatedByUserId: by }, create: { id: "default", updatedByUserId: by } });
  // Read under the lock just taken, so two changes at once agree on where they start.
  const from = await runningPayrollMonth(tx, now);
  const before = await currentSettings(tx);
  if (changes.cycleDay !== undefined && Number(changes.cycleDay) !== before.cycleDay) {
    const later = await tx.payrollEntry.findFirst({
      // A removed row does not count: it is off its month, and its period is worked out again on Restore.
      where: { removedAt: null, OR: [{ year: { gt: from.year } }, { year: from.year, month: { gt: from.month } }] },
      orderBy: [{ year: "asc" }, { month: "asc" }],
      select: { year: true, month: true },
    });
    if (later) {
      throw fail(409, `${MONTH_NAMES[later.month - 1]} ${later.year} is already generated under the current pay cycle, so changing the cycle day now would make it skip or repeat days. Remove that month's rows first, or change the cycle day once it is the current month.`);
    }
  }
  await tx.payrollRuleVersion.upsert({
    where: { effectiveYear_effectiveMonth: BASELINE },
    update: {},
    create: { ...BASELINE, ...before, createdByUserId: by },
  });
  const next = cleaned({ ...before, ...changes });
  await tx.payrollRuleVersion.upsert({
    where: { effectiveYear_effectiveMonth: { effectiveYear: from.year, effectiveMonth: from.month } },
    update: { ...next, createdByUserId: by },
    create: { effectiveYear: from.year, effectiveMonth: from.month, ...next, createdByUserId: by },
  });
  const data = Object.fromEntries(Object.keys(changes).filter((key) => key in SETTINGS_COLUMNS).map((key) => [SETTINGS_COLUMNS[key], next[key]]));
  await tx.hrmSettings.update({ where: { id: "default" }, data });
  return { ...next, effectiveFrom: from };
}

module.exports = {
  LOP_DIVISORS,
  ROUNDING_RULES,
  DEFAULTS,
  cleaned,
  currentSettings,
  settingsBook,
  cycleEnd,
  periodFor,
  payableDateFor,
  currentPayrollMonth,
  openPayrollMonth,
  runningPayrollMonth,
  recordChange,
};
