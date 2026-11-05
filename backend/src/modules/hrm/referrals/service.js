const prisma = require("../../../config/db");
const dataScope = require("../../../services/dataScope.service");
const { nextIdentifier } = require("../../../services/identifiers");
const { workingEmployeeStatuses } = require("../../../services/employeeOptionLists");

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
 * **Stopped**: an instalment that will never be handed over, because one of the two people a
 * referral is between had already left when its month came.
 *
 * Either of them ends it, and for different reasons. The bonus is a retention reward paid at the
 * third month and the sixth *because the new hire stayed*, so the day **they** leave the instalments
 * still to come stop. And it is money owed to **the referrer**, so once they have gone there is
 * nobody to pay it to. Each on its own is enough; the payroll side asks the same question
 * (`referralBonusDueIn`), so the register and the payslip cannot disagree about what is owed.
 *
 * Not one of `PAYOUT_STATUSES` - nothing writes it. It is worked out from the two employees' own
 * statuses every time the register is read, so nothing has to be written when somebody is relieved,
 * and somebody who rejoins is simply due again - the alternative was a stored Cancelled that would
 * have had to be unwound by hand.
 */
const STOPPED = "Stopped";

/** Why a referral stopped, for the screen to say which of the two it was. */
const STOPPED_REASONS = { BOTH: "BOTH_LEFT", REFERRED: "REFERRED_LEFT", REFERRER: "REFERRER_LEFT" };

/**
 * Why this referral's unpaid instalments will never be paid, or null while they still can be.
 *
 * A referrer who is **gone from the repository altogether** - `referrerEmployeeId` cleared, only the
 * name kept beside it - reads as left: there is no employee left to pay.
 */
function stoppedReasonFor(referral, working) {
  const referredGone = !isWorking(referral.referred, working);
  const referrerGone = !isWorking(referral.referrer, working);
  if (referredGone && referrerGone) return STOPPED_REASONS.BOTH;
  if (referredGone) return STOPPED_REASONS.REFERRED;
  return referrerGone ? STOPPED_REASONS.REFERRER : null;
}

/**
 * Whether an employee was working - the one question every rule here turns on.
 *
 * "Working" is the studio's own list (Settings → Fields → Employee Statuses, `countsAsWorking`), not
 * a word hard-coded here: a studio that adds "Sabbatical" decides for itself whether it counts.
 * Archived is never working, whatever the status says.
 */
const isWorking = (employee, working) => Boolean(employee) && !employee.archivedAt && working.includes(employee.employmentStatus);

/** What a referral's instalments are selected with wherever one of these rules has to be applied. */
const REFERRAL_READ_INCLUDE = {
  payouts: { orderBy: { monthOffset: "asc" } },
  referrer: { select: { id: true, employmentStatus: true, archivedAt: true } },
  referred: { select: { employeeName: true, employeeId: true, employmentStatus: true, archivedAt: true } },
};

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
    include: REFERRAL_READ_INCLUDE,
  });
  if (!referral) return null;
  // Shown on the employee's own record whatever their status - it is their referral, and HR opening
  // a leaver's record is exactly who needs to see what stopped - but its instalments read Stopped.
  return serializeReferral(referral, { reason: stoppedReasonFor(referral, await workingEmployeeStatuses()) });
}

/**
 * One referral as every screen reads it, with the rules about who is still here already applied.
 *
 * `stopped` is whether the employee the referral was for has left. Its unpaid instalments are
 * reported `Stopped`, which takes them out of what is outstanding and settles the referral by the
 * rule the register already uses (nothing Pending, something Paid). What was paid stands: money that
 * has left is a fact, not something a later resignation rewrites.
 */
function serializeReferral(referral, { reason = null } = {}) {
  const stopped = Boolean(reason);
  const statusOf = (payout) => (stopped && payout.status === "Pending" ? STOPPED : payout.status);
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
      status: statusOf(payout),
      paidOn: payout.paidOn,
      remarks: payout.remarks,
    })),
    // Which of the two has left, where one has, so a screen can say why an instalment stopped
    // rather than leaving a reader to guess at it.
    stoppedReason: reason,
    total: (referral.payouts || []).reduce((sum, payout) => sum + (statusOf(payout) === "Paid" || statusOf(payout) === "Pending" ? Number(payout.amount || 0) : 0), 0),
  };
}

/**
 * The register's rows, with the two rules about an employee who has left applied.
 *
 * A referral that stopped **before anything was paid** is left out altogether: nothing was earned,
 * nothing is owed, and a row that can never do anything is a row somebody has to work out they can
 * ignore. One with an instalment already paid stays, settled, because it is a record of money that
 * left the studio. Either person leaving is enough for both rules - and while both are still here,
 * a referral half paid stays **Outstanding**: it is not settled until the last instalment is.
 */
function applyLeavers(referrals, working) {
  return referrals.reduce((rows, referral) => {
    const reason = stoppedReasonFor(referral, working);
    const paidAnything = (referral.payouts || []).some((payout) => payout.status === "Paid");
    if (reason && !paidAnything) return rows;
    rows.push(serializeReferral(referral, { reason }));
    return rows;
  }, []);
}

/**
 * What Payroll owes this employee in referral bonuses for one month, and which referrals they are.
 *
 * The register's instalments are **paid through payroll** - `payroll-register/service.js` brings this
 * in on generate and refresh as the row's Referral Bonus, and paying the month settles the
 * instalments (`settleReferralBonus`). An instalment counts when its due date falls in the month and
 * **both** people were working: the referrer, because the money is theirs and there is nobody to pay
 * once they have gone, and the employee they referred, because the bonus is for that person staying.
 *
 * Takes referrals already loaded with `REFERRAL_BONUS_SELECT`, the way `policyBreachDueIn` takes the
 * breaches off the employee - so the register reads every figure of a month in one query.
 */
function referralBonusDueIn(year, month, referrals = [], { referrer = null, working = [], entryId = null } = {}) {
  if (!isWorking(referrer, working)) return { amount: 0, referralIds: [], payoutIds: [] };
  const wanted = Number(year);
  const wantedMonth = Number(month);
  const carried = [];
  for (const referral of referrals) {
    // The bonus is for the new hire staying: one who has left stops the instalments still to come.
    if (!isWorking(referral.referred, working)) continue;
    for (const payout of referral.payouts || []) {
      /*
       * Still to pay, or already paid **by this row**.
       *
       * The second half is what makes a paid month read itself correctly. Without it, the figure and
       * its Referral IDs were recomputed from what is still Pending - which, once this row had paid
       * them, was nothing: a reopened month lost the figure it had paid, and a paid row showed no
       * Referral ID at all. `entryId` is the row asking; left out (a month being generated, which
       * has no row yet) only what is still Pending counts, which is the same answer.
       */
      const mine = Boolean(entryId) && payout.payrollEntryId === entryId;
      if (!mine && payout.status !== "Pending") continue;
      if (!payout.dueOn) continue;
      // `dueOn` is written by `addMonths` from the joining date in UTC, so it is compared in UTC.
      const dueOn = new Date(payout.dueOn);
      if (dueOn.getUTCFullYear() !== wanted || dueOn.getUTCMonth() + 1 !== wantedMonth) continue;
      carried.push({ referral, payout, settled: mine && payout.status === "Paid" });
    }
  }
  const amount = carried.reduce((sum, { payout }) => sum + Number(payout.amount || 0), 0);
  return {
    amount: Math.round(amount * 100) / 100,
    referralIds: [...new Set(carried.map(({ referral }) => referral.referralId).filter(Boolean))],
    // Only the ones still to settle: paying a month again must not move a date already set.
    payoutIds: carried.filter(({ settled }) => !settled).map(({ payout }) => payout.id),
  };
}

/** How payroll selects what `referralBonusDueIn` reads, beside the referrer's own status. */
const REFERRAL_BONUS_SELECT = {
  select: {
    referralId: true,
    payouts: { select: { id: true, status: true, dueOn: true, amount: true, payrollEntryId: true } },
    referred: { select: { employmentStatus: true, archivedAt: true } },
  },
};

/**
 * Settles the instalments a paid payroll month carried - called inside that month's own transaction.
 *
 * Payroll is what hands the money over, so payroll is what records it as handed over: the register's
 * own Mark paid is gone, because an instalment that could be marked in two places is one that can be
 * paid twice. Only an instalment still Pending is written, so paying a month twice (or paying it
 * after a correction) cannot move a date that is already set.
 */
async function settleReferralBonus(tx, payoutIds, { paidOn, userId = null, payrollEntryId = null } = {}) {
  if (!payoutIds?.length) return 0;
  const { count } = await tx.employeeReferralPayout.updateMany({
    where: { id: { in: payoutIds }, status: "Pending" },
    data: { status: "Paid", paidOn: paidOn || new Date(), paidByUserId: userId || null, payrollEntryId },
  });
  return count;
}

/**
 * Puts back the instalments a payroll row had paid - the row being set from Paid back to Pending.
 *
 * The other half of `settleReferralBonus`, and the reason the payout carries the row that paid it: a
 * month reopened has not paid anything, so its instalments are owed again and the next Refresh reads
 * them as due. Only the instalments **this row** settled, so a reopened month cannot put back one
 * another month paid.
 */
async function unsettleReferralBonus(tx, payrollEntryId) {
  if (!payrollEntryId) return 0;
  const { count } = await tx.employeeReferralPayout.updateMany({
    where: { payrollEntryId, status: "Paid" },
    data: { status: "Pending", paidOn: null, paidByUserId: null, payrollEntryId: null },
  });
  return count;
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

/**
 * Settles one instalment by hand - the Employee Referral screen's **Mark 3rd month paid** - for money
 * handed over outside payroll (cash, a transfer). It is recorded Paid with no payroll row, so payroll
 * never carries it again: `referralBonusDueIn` reads only what is still Pending. A month already
 * worked out with it in its Referral Bonus is refused at Pay until it is refreshed, which drops it.
 *
 * Only a Pending instalment of a referral this person may see, and not one that stopped because
 * either of the two has left. The write is conditional on it still being Pending, so payroll paying
 * the same instalment at the same moment cannot record it twice.
 */
async function updatePayout(payoutId, { paidOn = null, remarks = null } = {}, userId) {
  const notFound = () => Object.assign(new Error("Referral instalment not found."), { status: 404 });
  const payout = await prisma.employeeReferralPayout.findUnique({
    where: { id: payoutId },
    include: { referral: { select: { id: true, referrer: REFERRAL_READ_INCLUDE.referrer, referred: REFERRAL_READ_INCLUDE.referred } } },
  });
  if (!payout) throw notFound();
  // Answered 404 rather than 403, as the list answers: a referral somebody may not read is one they
  // must not learn exists by being refused it.
  const readable = await prisma.employeeReferral.findFirst({ where: { AND: [await referralAccessWhere(userId), { id: payout.referralId }] }, select: { id: true } });
  if (!readable) throw notFound();
  if (payout.status !== "Pending") throw Object.assign(new Error(`This instalment is already ${payout.status === "Paid" ? "paid" : "cancelled"}.`), { status: 409 });
  if (stoppedReasonFor(payout.referral, await workingEmployeeStatuses())) {
    throw Object.assign(new Error("This instalment has stopped - the employee or the referrer has left - so there is nothing to pay."), { status: 409 });
  }
  const { count } = await prisma.employeeReferralPayout.updateMany({
    where: { id: payoutId, status: "Pending" },
    data: { status: "Paid", paidOn: paidOn ? new Date(paidOn) : new Date(), paidByUserId: userId || null, payrollEntryId: null, remarks: remarks ?? payout.remarks },
  });
  if (!count) throw Object.assign(new Error("This instalment was paid a moment ago. Refresh to see it."), { status: 409 });
  return prisma.employeeReferralPayout.findUnique({ where: { id: payoutId } });
}

/**
 * Deletes one referral and its instalments - the register's ⋮ → Delete, and each row of a bulk
 * Delete. The same rule the employee form keeps when Referred By is cleared (`syncEmployeeReferral`):
 * a referral with an instalment already **paid**, through payroll or by hand, is a record of money
 * that left the studio and is not removed. Only a referral this person may see; 404 otherwise.
 * The employee form reads Referred By from this row, so it reads empty afterwards.
 */
async function deleteReferral(id, userId) {
  const referralId = Number(id);
  const notFound = () => Object.assign(new Error("Referral not found."), { status: 404 });
  if (!Number.isInteger(referralId) || referralId <= 0) throw notFound();
  const referral = await prisma.employeeReferral.findFirst({
    where: { AND: [await referralAccessWhere(userId), { id: referralId }] },
    select: { id: true, payouts: { select: { status: true } } },
  });
  if (!referral) throw notFound();
  if (referral.payouts.some((payout) => payout.status === "Paid")) {
    throw Object.assign(new Error("This referral has already been paid, so it cannot be deleted."), { status: 409 });
  }
  // Conditional on nothing having been paid since it was read: payroll paying an instalment of it at
  // this moment leaves it in place. Its instalments go with it (`onDelete: Cascade`).
  const { count } = await prisma.employeeReferral.deleteMany({ where: { id: referralId, payouts: { none: { status: "Paid" } } } });
  if (!count) throw Object.assign(new Error("This referral was paid a moment ago, so it cannot be deleted."), { status: 409 });
}

async function listReferrals({ status = "", userId } = {}) {
  /*
   * Only a status something is actually stored as. `Stopped` is worked out on the way out (an
   * employee who has left), so asking the database for it would answer nothing at all - and the
   * register's own tabs count what came back rather than asking per tab, so nothing sends one today.
   */
  const wanted = PAYOUT_STATUSES.includes(status) ? status : "";
  const access = await referralAccessWhere(userId);
  const [referrals, working] = await Promise.all([
    prisma.employeeReferral.findMany({
      // Under `AND` rather than spread beside the status: the rule's `where` is itself an `OR`, and
      // spreading it next to another clause would replace the rule rather than narrow with it.
      where: { AND: [access, ...(wanted ? [{ payouts: { some: { status: wanted } } }] : [])] },
      include: REFERRAL_READ_INCLUDE,
      orderBy: { referredOn: "desc" },
    }),
    workingEmployeeStatuses(),
  ]);
  return applyLeavers(referrals, working);
}

module.exports = {
  // The pure halves of the rules `listReferrals` applies, for the tests: the query itself needs a
  // database, and what is worth holding on to is the arithmetic about who is still here.
  _internals: { applyLeavers, serializeReferral, stoppedReasonFor },
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
  STOPPED,
  STOPPED_REASONS,
  isWorking,
  referralBonusDueIn,
  REFERRAL_BONUS_SELECT,
  settleReferralBonus,
  unsettleReferralBonus,
  addMonths,
  referralSettings,
  saveReferralSettings,
  syncEmployeeReferral,
  referralForEmployee,
  listReferrals,
  updatePayout,
  deleteReferral,
  referralAccessWhere,
};
