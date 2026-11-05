const prisma = require("../../../config/db");
const versions = require("./settingsVersions");
const { todayInIndia } = require("../payroll-recovery/service");

/*
 * A frozen payroll month holds still until it is paid out. From the moment a row on the Main Page is
 * frozen until its payable date has passed, its employee can't raise an Attendance Regularization for a
 * day in that row's pay cycle, and no new Salary Advance or Recovery can be made for them. From the day
 * after the payable date, both work again.
 */

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dayText = (iso) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00.000Z`));
const isoOf = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);
// The day a hold lets go: the day after the payable date.
const dayAfter = (iso) => {
  const next = new Date(`${iso}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
};
const fail = (status, message) => Object.assign(new Error(message), { status });

/**
 * The frozen months still holding, per employee: `Map(employeeId → [{ year, month, label, from, to,
 * payableOn }])`, earliest first - a frozen row whose payable date is today or later.
 */
async function frozenHolds(employeeIds, { client = prisma, now = new Date() } = {}) {
  const ids = [...new Set(employeeIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  const holds = new Map();
  if (!ids.length) return holds;
  const today = todayInIndia(now);
  const [year, month] = today.split("-").map(Number);
  // A month is paid out within itself, so one before this calendar month is past its payable date.
  const rows = await client.payrollEntry.findMany({
    where: { employeeId: { in: ids }, frozen: true, OR: [{ year: { gt: year } }, { year, month: { gte: month } }] },
    orderBy: [{ year: "asc" }, { month: "asc" }],
    select: { employeeId: true, year: true, month: true, periodFrom: true, periodTo: true },
  });
  if (!rows.length) return holds;
  const settingsOf = await versions.settingsBook(client);
  for (const row of rows) {
    const payableOn = versions.payableDateFor(row.year, row.month, settingsOf(row.year, row.month).paybackDay);
    if (payableOn < today) continue;
    const hold = { year: row.year, month: row.month, label: `${MONTH_NAMES[row.month - 1]} ${row.year}`, from: isoOf(row.periodFrom), to: isoOf(row.periodTo), payableOn };
    if (!holds.has(row.employeeId)) holds.set(row.employeeId, []);
    holds.get(row.employeeId).push(hold);
  }
  return holds;
}

/** Why a day can't be regularized - it falls in a frozen pay cycle not yet paid out - or "" where it can. */
async function regularizationHoldMessage(employeeId, dayIso, { client = prisma, now = new Date() } = {}) {
  const holds = (await frozenHolds([employeeId], { client, now })).get(Number(employeeId)) || [];
  const hold = holds.find((entry) => entry.from && entry.to && dayIso >= entry.from && dayIso <= entry.to);
  if (!hold) return "";
  return `The ${hold.label} payroll (${dayText(hold.from)} to ${dayText(hold.to)}) is frozen until it is paid out on ${dayText(hold.payableOn)}. Days in it can be regularized from ${dayText(dayAfter(hold.payableOn))}.`;
}

/** The sentence refusing a new advance or recovery (`what`, in running text) for an employee with a frozen month still holding. */
function deductionHoldMessage(hold, what) {
  return `This employee's ${hold.label} payroll is frozen until it is paid out on ${dayText(hold.payableOn)}. A new ${what} can be added from ${dayText(dayAfter(hold.payableOn))}.`;
}

/** Refuses a new Salary Advance or Recovery (`what`) for an employee with a frozen month still holding. */
async function assertNoDeductionHold(client, employeeId, what, { now = new Date() } = {}) {
  const [hold] = (await frozenHolds([employeeId], { client, now })).get(Number(employeeId)) || [];
  if (hold) throw fail(409, deductionHoldMessage(hold, what));
}

module.exports = { frozenHolds, regularizationHoldMessage, deductionHoldMessage, assertNoDeductionHold };
