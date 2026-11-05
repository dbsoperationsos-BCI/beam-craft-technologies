const prisma = require("../../../config/db");
const versions = require("./settingsVersions");
const { attendanceStartIso } = require("../attendance/attendanceRules");

/*
 * Settings → Payroll rules → **Payroll starts from**: the first payroll month the Main Page keeps.
 * A month before it is never made, never read and never handed out as a payslip - it has no
 * attendance behind it, so its loss of pay would mean nothing.
 *
 * Chosen there (`hrm_settings.payroll_starts_from`, the 1st of the month), or - left unchosen - the
 * first payroll month whose pay cycle starts on or after the attendance start date, the first one
 * whose attendance is whole. With neither, there is no limit, as before.
 */

const SETTINGS_ID = "default";
const fail = (status, message) => Object.assign(new Error(message), { status });
const asMonth = (date) => (date ? { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 } : null);
const indexOf = (value) => value.year * 12 + value.month;

/** The first payroll month whose pay cycle starts on or after attendance went live, or null. */
async function defaultStart(client, settingsOf) {
  // Read, never written: no attendance settings yet is no start date yet.
  const attendance = await client.attendanceSettings?.findUnique({ where: { id: 1 }, select: { attendanceStartDate: true } });
  const live = attendanceStartIso(attendance);
  if (!live) return null;
  const [year, month] = live.split("-").map(Number);
  // A payroll month's cycle starts up to two months before it (October's on 25 August), so the first
  // whole one is within three months of attendance's start.
  for (let step = 0; step <= 3; step += 1) {
    const at = year * 12 + (month - 1) + step;
    const candidate = { year: Math.floor(at / 12), month: (at % 12) + 1 };
    if (versions.periodFor(candidate.year, candidate.month, settingsOf).from >= live) return candidate;
  }
  return null;
}

/**
 * `{ startsFrom, chosen, defaultFrom }` - each `{ year, month }` or null: the month in force, the one
 * chosen in Payroll rules, and the one attendance's start would give.
 */
async function payrollStart({ client = prisma } = {}) {
  const [row, settingsOf] = await Promise.all([
    client.hrmSettings.findUnique({ where: { id: SETTINGS_ID }, select: { payrollStartsFrom: true } }),
    versions.settingsBook(client),
  ]);
  const chosen = asMonth(row?.payrollStartsFrom);
  const defaultFrom = await defaultStart(client, settingsOf);
  return { startsFrom: chosen || defaultFrom, chosen, defaultFrom };
}

/** Whether a payroll month falls before the start - never made, read or paid out. */
function beforeStart(year, month, start) {
  return Boolean(start?.startsFrom) && year * 12 + month < indexOf(start.startsFrom);
}

/**
 * Sets the month payroll starts from (`"YYYY-MM"`), or clears it (null) back to attendance's start.
 * Every branch's payroll at once, so - like the rules - only somebody who reaches every branch.
 */
async function savePayrollStart(startsFrom, userId, reach = null, client = prisma) {
  if (reach) throw fail(403, "When payroll starts applies to every branch, so only somebody who reaches every branch may change it.");
  const data = { payrollStartsFrom: startsFrom ? new Date(`${startsFrom}-01T00:00:00Z`) : null, updatedByUserId: userId || null };
  await client.hrmSettings.upsert({ where: { id: SETTINGS_ID }, update: data, create: { id: SETTINGS_ID, ...data } });
  return payrollStart({ client });
}

module.exports = { payrollStart, beforeStart, savePayrollStart };
