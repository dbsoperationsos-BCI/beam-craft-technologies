const prisma = require("../../../config/db");
const versions = require("./settingsVersions");

/*
 * Payroll rules → **Hold salary during notice**: a leaver's salary is held from their resignation to
 * their last working day, then paid in one go - the full and final settlement - on the payable date of
 * the payroll month whose pay cycle holds the last working day.
 *
 * Off unless switched on, and decided once per separation: `recordSeparation` marks a resignation
 * `salaryHeld` (from its resignation date) only while the switch is on and the employee has a notice to
 * serve. Nothing recorded before - and no month already paid - is ever touched.
 *
 * Worked out on read, never stored, so a withdrawn notice, a removed separation or a rejoin releases the
 * hold at once. For a row of somebody whose salary is held:
 *
 *   settlement  its pay cycle holds the last working day - it pays its own month and every held one
 *   held        an earlier month, not paid, payable on or after the day the hold started
 *   settled     a held month the settlement paid (`settledInEntryId`) - paid, and read as such
 *
 * Paying the settlement is what pays the held months: `service.updateEntry` marks them Paid with it, in
 * its own transaction, and stamps them `settledInEntryId`; setting it back to Pending reopens them.
 */

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dayOf = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);
const monthName = ({ year, month }) => `${MONTH_NAMES[month - 1]} ${year}`;

/** Each employee's hold, by employee id: `{ from, lastDay }` from their held separation. */
async function holdsFor(employeeIds, client = prisma) {
  const ids = [...new Set(employeeIds)].filter(Boolean);
  if (!ids.length) return new Map();
  const rows = await client.employeeSeparation.findMany({
    where: { employeeId: { in: ids }, salaryHeld: true },
    orderBy: { id: "desc" },
    select: { employeeId: true, salaryHeldFrom: true, resignationDate: true, proposedLastWorkingDate: true },
  });
  const holds = new Map();
  for (const row of rows) {
    if (holds.has(row.employeeId)) continue;
    const lastDay = dayOf(row.proposedLastWorkingDate);
    // Once the settlement is paid nothing is held any more: a month that turns up after it (a restored
    // row, an earlier month filled in) is paid on its own, as anybody's - never stranded as held.
    const settlement = await client.payrollEntry.findFirst({
      where: { employeeId: row.employeeId, removedAt: null, periodFrom: { lte: new Date(`${lastDay}T00:00:00Z`) }, periodTo: { gte: new Date(`${lastDay}T00:00:00Z`) } },
      select: { id: true, paymentStatus: true },
    });
    holds.set(row.employeeId, { from: dayOf(row.salaryHeldFrom || row.resignationDate) || lastDay, lastDay, settlementPaid: settlement?.paymentStatus === "Paid" });
  }
  return holds;
}

/** The payroll month whose pay cycle holds `day`, with the day it is paid out. */
function settlementMonth(day, settingsOf) {
  const [y, m] = day.split("-").map(Number);
  // A month's cycle runs up to its cycle day, so the day's own month or one either side of it holds it.
  for (let offset = -1; offset <= 2; offset += 1) {
    const index = y * 12 + (m - 1) + offset;
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    const { from, to } = versions.periodFor(year, month, settingsOf);
    if (from <= day && day <= to) return { year, month, payableOn: versions.payableDateFor(year, month, settingsOf(year, month).paybackDay) };
  }
  return null;
}

/** A row's place in a hold - "settled", "settlement", "held" or null - under its month's payable date. */
function holdState(entry, hold, settingsOf) {
  if (entry.settledInEntryId) return "settled";
  if (!hold?.lastDay) return null;
  const from = dayOf(entry.periodFrom);
  const to = dayOf(entry.periodTo);
  if (from <= hold.lastDay && hold.lastDay <= to) return "settlement";
  if (to >= hold.lastDay || entry.paymentStatus === "Paid" || hold.settlementPaid) return null;
  const payableOn = versions.payableDateFor(entry.year, entry.month, settingsOf(entry.year, entry.month).paybackDay);
  return payableOn >= hold.from ? "held" : null;
}

/**
 * The held months a settlement row pays, read for paying or showing: every row of the employee's still
 * held - or, once it is paid, the ones it settled. `include` reads them as the register does.
 */
async function releasedBy(settlement, hold, settingsOf, { client = prisma, include } = {}) {
  if (settlement.paymentStatus === "Paid") {
    return client.payrollEntry.findMany({ where: { settledInEntryId: settlement.id }, include, orderBy: [{ year: "asc" }, { month: "asc" }] });
  }
  if (!hold) return [];
  const rows = await client.payrollEntry.findMany({
    where: { employeeId: settlement.employeeId, id: { not: settlement.id }, removedAt: null, settledInEntryId: null, paymentStatus: { not: "Paid" } },
    include,
    orderBy: [{ year: "asc" }, { month: "asc" }],
  });
  return rows.filter((row) => holdState(row, hold, settingsOf) === "held");
}

/**
 * What the register says of each row's hold, by row id - `{ state, settlesIn, released }` - for the rows
 * of one read. `amountOf(row)` is a row's rounded salary under its own month's rules.
 */
async function holdsForRows(rows, { client = prisma, settingsOf, include, amountOf }) {
  const holds = await holdsFor(rows.map((row) => row.employeeId), client);
  const result = new Map();
  const settledInIds = [...new Set(rows.map((row) => row.settledInEntryId).filter(Boolean))];
  const settledIn = settledInIds.length
    ? new Map((await client.payrollEntry.findMany({ where: { id: { in: settledInIds } }, select: { id: true, year: true, month: true, paymentDate: true } })).map((row) => [row.id, row]))
    : new Map();
  // A paid settlement still reads as one once its separation is gone: the months it paid say so.
  const paidSettlements = new Set((await client.payrollEntry.findMany({
    where: { settledInEntryId: { in: rows.filter((row) => row.paymentStatus === "Paid").map((row) => row.id) } },
    select: { settledInEntryId: true },
  })).map((row) => row.settledInEntryId));
  for (const row of rows) {
    const hold = holds.get(row.employeeId);
    const state = paidSettlements.has(row.id) ? "settlement" : holdState(row, hold, settingsOf);
    if (!state) continue;
    if (state === "settled") {
      const by = settledIn.get(row.settledInEntryId);
      result.set(row.id, { state, settlesIn: by ? { year: by.year, month: by.month, label: monthName(by), paidOn: dayOf(by.paymentDate) } : null, released: [] });
    } else if (state === "held") {
      const month = settlementMonth(hold.lastDay, settingsOf);
      result.set(row.id, { state, settlesIn: month ? { ...month, label: monthName(month) } : null, released: [] });
    } else {
      const released = (await releasedBy(row, hold, settingsOf, { client, include })).map((held) => ({ id: held.id, year: held.year, month: held.month, label: monthName(held), amount: amountOf(held) }));
      result.set(row.id, { state, settlesIn: null, released });
    }
  }
  return result;
}

/** Whether the switch is on - Settings → Payroll rules → Hold salary during notice. */
async function holdSwitchOn(client = prisma) {
  const settings = await client.hrmSettings.findUnique({ where: { id: "default" }, select: { holdSalaryDuringNotice: true } });
  return Boolean(settings?.holdSalaryDuringNotice);
}

/**
 * What a new separation records of the hold: held only while the switch is on, for a resignation or
 * a mutual separation served on notice - from its resignation date, or today where none is given.
 */
async function holdForSeparation({ separationType, servesNotice, resignationDate, today }, client = prisma) {
  if (!servesNotice || !["Resignation", "Mutual Separation"].includes(separationType)) return { salaryHeld: false, salaryHeldFrom: null };
  if (!(await holdSwitchOn(client))) return { salaryHeld: false, salaryHeldFrom: null };
  const from = dayOf(resignationDate) || today;
  return { salaryHeld: true, salaryHeldFrom: new Date(`${from}T00:00:00Z`) };
}

module.exports = { MONTH_NAMES, monthName, holdsFor, settlementMonth, holdState, releasedBy, holdsForRows, holdSwitchOn, holdForSeparation };
