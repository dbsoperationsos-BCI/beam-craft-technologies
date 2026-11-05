const prisma = require("../../../config/db");
const versions = require("./settingsVersions");
const { todayInIndia } = require("../payroll-recovery/service");

/*
 * A payroll month locks once its payable date has passed. From the end of its pay cycle to its payable
 * date, everybody holding `HRM / Payroll Register` Read / Write may change it; from the day after, only
 * somebody holding `HRM / Payroll After Payday` - granted to the Super Admin alone - may. Reading it is
 * never locked. October 2026, payable 10 Oct (under the payable day the month was settled with), locks
 * on 11 Oct.
 *
 * Asked by the controller before each write - a row saved, marked Paid, removed or restored, a deduction
 * skipped or its skip undone, a month never made filled in - so the register's own service is unchanged.
 */

const LOCK_PERMISSION = { module: "HRM", feature: "Payroll After Payday" };
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dayText = (iso) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00.000Z`));
const fail = (status, message) => Object.assign(new Error(message), { status });

/** `{ locked, payableOn }` for a payroll month, as of `now` in India. */
async function monthLock(year, month, { client = prisma, now = new Date() } = {}) {
  const settingsOf = await versions.settingsBook(client);
  const payableOn = versions.payableDateFor(year, month, settingsOf(year, month).paybackDay);
  return { locked: payableOn < todayInIndia(now), payableOn };
}

/** The sentence refusing a change to a locked month. */
function lockedMessage(year, month, payableOn) {
  return `The ${MONTH_NAMES[month - 1]} ${year} payroll was payable on ${dayText(payableOn)} and is locked. Only a Super Admin can change it now.`;
}

/**
 * For a change made elsewhere that would re-total a month's row - an advance or recovery added, moved
 * or removed, a deduction skipped into another month. A locked month whose figure would change refuses
 * the whole change, as a paid or frozen one does; one whose figure stays the same is left alone.
 * `current` and `next` are the row's figure now and after. Nobody is excepted: the Super Admin changes a
 * locked month on its row.
 */
async function assertFigureOpen(year, month, current, next, options = {}) {
  if (Number(current) === Number(next)) return;
  const { locked, payableOn } = await monthLock(year, month, options);
  if (locked) throw fail(409, `${lockedMessage(year, month, payableOn).replace(" Only a Super Admin can change it now.", "")} This would change what it took, so it cannot be made here.`);
}

/** Refuses a change to `year`/`month` once locked, unless `canEditLocked`. */
async function assertMonthOpen(year, month, canEditLocked, options = {}) {
  if (canEditLocked) return;
  const { locked, payableOn } = await monthLock(year, month, options);
  if (locked) throw fail(403, lockedMessage(year, month, payableOn));
}

/** The same for one row, by id - removed or not; a row that is not there is left to the write to refuse. */
async function assertRowOpen(id, canEditLocked, { client = prisma, now = new Date() } = {}) {
  if (canEditLocked) return;
  const row = await client.payrollEntry.findUnique({ where: { id }, select: { year: true, month: true } });
  if (row) await assertMonthOpen(row.year, row.month, false, { client, now });
}

module.exports = { LOCK_PERMISSION, monthLock, lockedMessage, assertMonthOpen, assertRowOpen, assertFigureOpen };
