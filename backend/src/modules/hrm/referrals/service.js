const prisma = require("../../../config/db");
const dataScope = require("../../../services/dataScope.service");
const { nextIdentifier } = require("../../../services/identifiers");

/**
 * Employee referrals: who introduced a new hire, and the instalments the studio owes for it.
 *
 * How many months a referral is settled over is the studio's to set - `referralInstalmentMonths`,
 * beside the total it divides. Every date is counted from the referred employee's joining date, and
 * every amount is stamped when the referral is created: changing either the figure or the months
 * afterwards applies to referrals made from then on, never to one already promised. That is the
 * whole reason the amounts live on the payout rows rather than being read from settings when payday
 * comes, and it is why `syncEmployeeReferral` below takes an existing referral's months from its own
 * rows rather than from settings.
 */

/**
 * How far apart the instalments are.
 *
 * Three months is the studio's own spacing - the register was built paying at the third month and
 * the sixth - so the settings form asks only *how many* instalments there are and this is what turns
 * that count into dates. The offsets are still what gets stored and what a payout row carries,
 * because `monthOffset` is what an instalment is: the register reads "3rd month" off it and the
 * money is due on a date counted from it.
 */
const INSTALMENT_INTERVAL_MONTHS = 3;

/** The months `count` instalments fall due on: one every three months, starting at the third. */
function monthsForCount(count) {
  const total = Number(count);
  if (!Number.isInteger(total) || total <= 0) return [];
  return Array.from({ length: total }, (_, index) => (index + 1) * INSTALMENT_INTERVAL_MONTHS);
}

/**
 * The months a referral is paid over when the studio has not said otherwise.
 *
 * Two instalments - the third month and the sixth - which is the pair the register was built on and
 * the column default in the migration. Here as well because a settings row written before the column
 * existed reads back empty, and a referral recorded in that moment must still get a schedule rather
 * than none.
 */
const DEFAULT_INSTALMENT_COUNT = 2;
const DEFAULT_INSTALMENT_MONTHS = monthsForCount(DEFAULT_INSTALMENT_COUNT);

/** How many instalments a studio may spread a referral over. */
const MAX_INSTALMENTS = 24;
/** The furthest out an instalment may fall. Ten years of months, well past any probation. */
const MAX_MONTH_OFFSET = 120;

/**
 * The stored "3,6" as the numbers the schedule is actually built from.
 *
 * Deliberately forgiving about how it is written - spaces, a trailing comma, the same month twice -
 * because this reads what is already in the database as well as what a form just sent, and a row
 * written by an older version must not be able to stop a referral being recorded. Anything that
 * cannot be read at all falls back to the studio's original pair rather than to no schedule: a
 * referral with no instalments is a promise the register quietly drops.
 *
 * `validateInstalmentMonths` is the half that refuses; this half only ever answers.
 */
function parseInstalmentMonths(value) {
  if (Array.isArray(value)) return normaliseMonths(value);
  const parsed = normaliseMonths(String(value ?? "").split(","));
  return parsed.length ? parsed : [...DEFAULT_INSTALMENT_MONTHS];
}

/** Whole months, above zero, each one once, in the order they fall due. */
function normaliseMonths(values) {
  const months = (values || [])
    .map((entry) => Number(String(entry).trim()))
    .filter((month) => Number.isInteger(month) && month > 0 && month <= MAX_MONTH_OFFSET);
  return [...new Set(months)].sort((first, second) => first - second);
}

/**
 * Why a proposed schedule cannot be saved, or null when it can.
 *
 * Separate from `parseInstalmentMonths` because the two want opposite things: reading the database
 * must always produce a schedule, while saving a form must be able to refuse one. A studio typing
 * "0" or "abc" is told so rather than having it quietly become the default and look saved.
 *
 * Still expressed in months rather than in the count the form asks for, because months are what is
 * stored and what arrives here - `readInstalmentCount` below is the other door, for a caller that
 * would rather send the count and let the interval be applied.
 */
function validateInstalmentMonths(value) {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(",");
  const entries = raw.map((entry) => String(entry).trim()).filter((entry) => entry !== "");
  if (!entries.length) return "Name at least one month to settle the referral over.";
  for (const entry of entries) {
    const month = Number(entry);
    if (!Number.isInteger(month) || month <= 0) return `"${entry}" is not a month. Use whole numbers of months after joining, such as 3, 6.`;
    if (month > MAX_MONTH_OFFSET) return `${month} is further out than ${MAX_MONTH_OFFSET} months.`;
  }
  const months = normaliseMonths(entries);
  if (months.length > MAX_INSTALMENTS) return `A referral can be settled over at most ${MAX_INSTALMENTS} instalments.`;
  return null;
}

/**
 * One referral amount, divided equally across its instalments: 6,000 over two becomes 3,000 and
 * 3,000; over three, 2,000 each.
 *
 * The remainder goes on the last instalment rather than being lost to rounding, so the parts always
 * add back up to the amount configured however many there are. An odd 5,001 halves to 2,500.50 and
 * 2,500.50; a total that will not divide cleanly at all - 1,000.01 over two - pays 500 then 500.01
 * rather than quietly shorting the referrer by a paisa. Over three, 1,000 is 333.33, 333.33, 333.34.
 *
 * An empty month list answers with no instalments rather than dividing by zero. Callers reach this
 * through `parseInstalmentMonths`, which never produces one.
 */
function splitReferralAmount(amount, months = DEFAULT_INSTALMENT_MONTHS) {
  if (!months?.length) return [];
  const total = Math.round((Number(amount) || 0) * 100);
  const each = Math.floor(total / months.length);
  return months.map((monthOffset, index) => ({
    monthOffset,
    amount: (index === months.length - 1 ? total - each * (months.length - 1) : each) / 100,
  }));
}

/**
 * The count the settings form asks for, as months - or why it cannot be one.
 *
 * Mirrored by `readInstalmentCount` in `frontend/src/components/hrm/referralPayouts.js`, which says
 * the same thing while somebody is still typing. This is the copy that decides.
 */
function readInstalmentCount(value) {
  const entry = String(value ?? "").trim();
  if (!entry) return { months: [], error: "Say how many instalments a referral is paid in." };
  const count = Number(entry);
  if (!Number.isInteger(count) || count <= 0) return { months: [], error: "Use a whole number of instalments, such as 2." };
  if (count > MAX_INSTALMENTS) return { months: [], error: `A referral can be paid in at most ${MAX_INSTALMENTS} instalments.` };
  return { months: monthsForCount(count), error: null };
}

const PAYOUT_STATUSES = ["Pending", "Paid", "Cancelled"];

/**
 * The same day, `months` later.
 *
 * A joining date of the 31st has no counterpart in a 30-day month, and `setMonth` answers that by
 * rolling into the next one - so a referral joined on 31 March would fall due on 1 July rather than
 * 30 June, a day into the wrong month. Clamped to the last day the target month actually has.
 */
function addMonths(date, months) {
  const start = new Date(date);
  const target = new Date(start.getTime());
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDayOfTargetMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(start.getUTCDate(), lastDayOfTargetMonth));
  return target;
}

/** The studio's current referral amount. The row is created by the migration; this is its fallback. */
async function referralSettings(client = prisma) {
  const row = await client.hrmSettings.findUnique({ where: { id: "default" } });
  return {
    referralAmount: Number(row?.referralAmount || 0),
    instalmentMonths: parseInstalmentMonths(row?.referralInstalmentMonths),
  };
}

/**
 * Saves whichever of the two the caller actually sent.
 *
 * Settings → Employee Referral asks for both and sends both, but each is written only when the
 * request actually says something about it: writing `undefined` over the other would turn a caller
 * that changed one figure into one that silently cleared the other. That is what lets the amount and
 * the schedule be changed independently without either having to restate the other.
 */
async function saveReferralSettings(values, userId) {
  const data = { updatedByUserId: userId || null };
  if (values.referralAmount !== undefined) data.referralAmount = values.referralAmount;
  if (values.instalmentMonths !== undefined) {
    data.referralInstalmentMonths = normaliseMonths(
      Array.isArray(values.instalmentMonths) ? values.instalmentMonths : String(values.instalmentMonths).split(","),
    ).join(",");
  }
  const row = await prisma.hrmSettings.upsert({ where: { id: "default" }, update: data, create: { id: "default", ...data } });
  return {
    referralAmount: Number(row.referralAmount || 0),
    instalmentMonths: parseInstalmentMonths(row.referralInstalmentMonths),
  };
}

/**
 * Record who referred an employee, with the schedule that follows from it.
 *
 * Called inside the transaction that saves the employee, so a referral is never left behind by a
 * save that then failed. Passing no referrer removes any referral the employee had - the field is
 * optional, and clearing it has to mean something.
 *
 * An instalment already paid is left exactly as it was: the amounts and dates below are written to
 * the ones still outstanding, so correcting a joining date moves what has not been handed over yet
 * and never rewrites what has.
 */
async function syncEmployeeReferral(client, referredEmployeeId, { referrerEmployeeId, referredOn, remarks = null, userId = null }) {
  const existing = await client.employeeReferral.findUnique({
    where: { referredEmployeeId },
    include: { payouts: true },
  });

  if (!referrerEmployeeId) {
    // Nothing to keep, unless money has already changed hands against it - a paid instalment is a
    // fact about the studio's cash, not a field somebody may clear by emptying a dropdown.
    if (existing && existing.payouts.some((payout) => payout.status === "Paid")) {
      const error = new Error("This referral has already been paid, so it cannot be removed.");
      error.status = 409;
      throw error;
    }
    if (existing) await client.employeeReferral.delete({ where: { id: existing.id } });
    return null;
  }

  if (referrerEmployeeId === referredEmployeeId) {
    const error = new Error("An employee cannot be recorded as referring themselves.");
    error.status = 400;
    throw error;
  }

  const referrer = await client.employee.findUnique({ where: { id: referrerEmployeeId }, select: { id: true, employeeName: true } });
  if (!referrer) {
    const error = new Error("The referring employee could not be found.");
    error.status = 400;
    throw error;
  }
  if (!referredOn) {
    const error = new Error("Set the employee's date of joining before recording who referred them — the referral instalments are counted from it.");
    error.status = 400;
    throw error;
  }

  const referredOnDate = new Date(referredOn);
  /*
   * The code the register quotes, taken from the studio's one identifier module.
   *
   * Minted inside the caller's transaction, so a referral that fails to save does not spend a
   * number and leave a gap in a run the studio reads as a count. An existing referral that has none
   * - one written before the column existed and missed by the backfill - is given the next code
   * here rather than staying blank forever.
   */
  // Named apart from the payout's own `referralId` below, which is that row's foreign key to
  // this one rather than the code.
  const referralCode = existing?.referralId || await nextIdentifier("EMPLOYEE_REFERRAL", {}, client);
  const referral = existing
    ? await client.employeeReferral.update({
      where: { id: existing.id },
      data: { referralId: referralCode, referrerEmployeeId: referrer.id, referrerName: referrer.employeeName, referredOn: referredOnDate, remarks },
    })
    : await client.employeeReferral.create({
      data: {
        referralId: referralCode,
        referrerEmployeeId: referrer.id,
        referrerName: referrer.employeeName,
        referredEmployeeId,
        referredOn: referredOnDate,
        remarks,
        createdByUserId: userId,
      },
    });

  /*
   * The amounts are read from settings only for an instalment that does not exist yet. An
   * outstanding one keeps the figure it was created with, which is what "changing the referral
   * amount must not change what was already promised" means in code.
   */
  const { referralAmount, instalmentMonths } = await referralSettings(client);
  /*
   * A referral already recorded keeps the months it was recorded with.
   *
   * This runs on **every** save of the employee, not only the first, so reading the studio's current
   * schedule here would quietly graft a new instalment onto an old referral the next time anybody
   * touched that employee's record - the same promise repriced by a setting changed months later,
   * which is exactly what stamping the amounts onto the rows exists to prevent. The configured
   * months are therefore for a referral being created; an existing one is rebuilt from its own rows.
   */
  const months = existing?.payouts.length
    ? [...new Set(existing.payouts.map((payout) => payout.monthOffset))].sort((first, second) => first - second)
    : instalmentMonths;
  for (const { monthOffset, amount } of splitReferralAmount(referralAmount, months)) {
    const held = existing?.payouts.find((payout) => payout.monthOffset === monthOffset);
    if (held?.status === "Paid") continue;
    const dueOn = addMonths(referredOnDate, monthOffset);
    if (held) {
      await client.employeeReferralPayout.update({ where: { id: held.id }, data: { dueOn } });
    } else {
      await client.employeeReferralPayout.create({ data: { referralId: referral.id, monthOffset, dueOn, amount } });
    }
  }

  return referral;
}

/** One employee's referral, as the form reads it back. */
async function referralForEmployee(referredEmployeeId) {
  const referral = await prisma.employeeReferral.findUnique({
    where: { referredEmployeeId },
    include: { payouts: { orderBy: { monthOffset: "asc" } } },
  });
  return referral ? serializeReferral(referral) : null;
}

function serializeReferral(referral) {
  return {
    id: referral.id,
    referralId: referral.referralId,
    referrerEmployeeId: referral.referrerEmployeeId,
    referrerName: referral.referrerName,
    referredEmployeeId: referral.referredEmployeeId,
    referredOn: referral.referredOn,
    remarks: referral.remarks,
    referredEmployeeName: referral.referred?.employeeName || null,
    referredEmployeeCode: referral.referred?.employeeId || null,
    payouts: (referral.payouts || []).map((payout) => ({
      id: payout.id,
      monthOffset: payout.monthOffset,
      dueOn: payout.dueOn,
      amount: Number(payout.amount || 0),
      status: payout.status,
      paidOn: payout.paidOn,
      remarks: payout.remarks,
    })),
    total: (referral.payouts || []).reduce((sum, payout) => sum + (payout.status === "Cancelled" ? 0 : Number(payout.amount || 0)), 0),
  };
}

/** Every referral, newest first, for the payout register. */
/*
 * Whose referrals a person gets.
 *
 * The register used to show every referral in the studio to everybody holding
 * `HRM / Employee Referral`, which is the wrong answer for a record about money owed to a named
 * person: what somebody introduced a hire for is their business and their manager's, not the whole
 * studio's.
 *
 * A referral is yours if **you made it**, or if somebody who reports to you made it - the studio's
 * one rule, resolved by `dataScope` on the referrer. `createdByUserId` counts too, so a referral
 * somebody entered on another person's behalf is still theirs to look at.
 *
 * The branch limb is written here rather than declared as a column, because `EmployeeReferral` has
 * no `branch_id` and should not grow one: a referral's branch is **the referrer's**, and a copy of
 * it on this row would be a second answer that goes stale the day somebody transfers. So the branch
 * is read through the relation, live, and only for a holder of `ADMIN / Branch Administration` -
 * the same permission that widens every other module, asked for once by `resolve` and read back off
 * the scope rather than queried again.
 */
const REFERRAL_SCOPE_COLUMNS = { employee: ["referrerEmployeeId"], user: ["createdByUserId"] };

async function referralAccessWhere(userId) {
  const scope = await dataScope.resolve({
    userId,
    module: "HRM",
    feature: "Employee Referral",
    columns: REFERRAL_SCOPE_COLUMNS,
  });
  if (scope.unlimited) return {};
  // A branch administrator reaching no branch is left with what their own name is on, which is the
  // direction an empty list has to fail in.
  if (!scope.administersBranches || !scope.branchIds?.length) return scope.where;
  return { OR: [scope.where, { referrer: { branchId: { in: scope.branchIds } } }] };
}

async function listReferrals({ status = "", userId } = {}) {
  const access = await referralAccessWhere(userId);
  const referrals = await prisma.employeeReferral.findMany({
    // Under `AND` rather than spread beside the status: the rule's `where` is itself an `OR`, and
    // spreading it next to another clause would replace the rule rather than narrow with it.
    where: { AND: [access, ...(status ? [{ payouts: { some: { status } } }] : [])] },
    include: {
      payouts: { orderBy: { monthOffset: "asc" } },
      referred: { select: { employeeName: true, employeeId: true } },
    },
    orderBy: { referredOn: "desc" },
  });
  return referrals.map(serializeReferral);
}

/**
 * Mark one instalment paid, or cancel it.
 *
 * Paid is not reversible here on purpose: it says money left the studio, and correcting that is an
 * Accounts entry rather than a dropdown on this screen.
 */
async function updatePayout(payoutId, { status, paidOn, remarks }, userId) {
  if (!PAYOUT_STATUSES.includes(status)) {
    const error = new Error("A referral instalment is Pending, Paid or Cancelled.");
    error.status = 400;
    throw error;
  }
  const payout = await prisma.employeeReferralPayout.findUnique({ where: { id: payoutId } });
  if (!payout) {
    const error = new Error("Referral instalment not found.");
    error.status = 404;
    throw error;
  }
  /*
   * The instalment has to belong to a referral this person may see. Hiding a row from the register
   * is not protection while its id can still be typed into this endpoint - and marking somebody
   * else's referral Paid is the write that says money left the studio.
   *
   * Answered 404 rather than 403, exactly as the list answers: a referral somebody may not read is
   * one they must not learn the existence of by being refused it.
   */
  const readable = await prisma.employeeReferral.findFirst({
    where: { AND: [await referralAccessWhere(userId), { id: payout.referralId }] },
    select: { id: true },
  });
  if (!readable) {
    const error = new Error("Referral instalment not found.");
    error.status = 404;
    throw error;
  }
  if (payout.status === "Paid" && status !== "Paid") {
    const error = new Error("This instalment is already paid. Correct it through Accounts rather than here.");
    error.status = 409;
    throw error;
  }
  const updated = await prisma.employeeReferralPayout.update({
    where: { id: payoutId },
    data: {
      status,
      paidOn: status === "Paid" ? new Date(paidOn || Date.now()) : null,
      paidByUserId: status === "Paid" ? userId || null : null,
      remarks: remarks ?? payout.remarks,
    },
  });
  return { id: updated.id, status: updated.status, paidOn: updated.paidOn, amount: Number(updated.amount || 0) };
}

module.exports = {
  INSTALMENT_INTERVAL_MONTHS,
  DEFAULT_INSTALMENT_COUNT,
  DEFAULT_INSTALMENT_MONTHS,
  MAX_INSTALMENTS,
  monthsForCount,
  readInstalmentCount,
  MAX_MONTH_OFFSET,
  parseInstalmentMonths,
  normaliseMonths,
  validateInstalmentMonths,
  splitReferralAmount,
  PAYOUT_STATUSES,
  addMonths,
  referralSettings,
  saveReferralSettings,
  syncEmployeeReferral,
  referralForEmployee,
  listReferrals,
  referralAccessWhere,
  updatePayout,
};
