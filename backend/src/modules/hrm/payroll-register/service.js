const prisma = require("../../../config/db");
const iamService = require("../../../services/iam.service");
const { workingEmployeeStatuses } = require("../../../services/employeeOptionLists");
const { receivedIntoOptions } = require("../../../services/branchBankAccounts");
const { recoveryDueIn, recoverySkippedIn, skipsSelect, todayInIndia } = require("../payroll-recovery/service");
const { advanceDueIn, advanceSkippedIn } = require("../payroll-advance/service");
const { policyBreachDueIn, policyBreachSkippedIn } = require("../payroll-policy-breach/service");
const { referralBonusDueIn, REFERRAL_BONUS_SELECT, settleReferralBonus, unsettleReferralBonus } = require("../referrals/service");
const { columnsForRows } = require("./components");
const versions = require("./settingsVersions");
const { payslipGenerateDaysAfter } = require("../../../services/payslipHeading");
const noticeHold = require("./noticeHold");

/*
 * HRM → Payroll → Main Page: the payroll register - one employee's pay for one month per row, the
 * studio's payroll sheet.
 *
 * **Generate** adds a row per working employee for a month, bringing in what the app already knows:
 * the base salary (the employee's current salary), the attendance leaves (loss-of-pay days over the
 * pay cycle - absences, and half days as half - read by the Attendance calculator), the pay cycle's
 * working and calendar days, what Payroll → Recovery has due that month, and the salary advances
 * Payroll → Advance Salary takes back that month (which also hands an unpaid row its new total the
 * moment an advance is recorded, corrected or removed), and what Payroll → Policy Breach has due that
 * month (a fine, apart from the typed Policy Breach Leaves). **Refresh** brings those in again for every
 * row of the month not yet paid, over the pay cycle as it is set now. The rest is typed: incentive, policy breach leaves, other deductions, remarks, the
 * payment, and an amount for each extra column Settings → Payroll rules adds under Earnings or
 * Deductions (`components.js`).
 *
 * Worked out on read, under Settings → Payroll rules **as they stood for that month** (`rulesForMonth`:
 * a change applies from the current month on, earlier months keep the rules they had), never stored:
 *
 *   Total Earned      base salary + incentive + the extra earnings
 *   Total Leaves      attendance leaves + policy breach leaves
 *   LOP Deduction     a day's pay × total leaves - a day's pay being the base salary over the
 *                     pay cycle's working days, its calendar days, or a fixed 30 (the rule)
 *   Total Deductions  LOP + salary advance + recovery deduction + policy breach deduction + other
 *                     deductions + the extra deductions
 *   Net Salary        total earned − total deductions
 *   Rounded Salary    the net rounded by the rule - nearest ₹10, nearest ₹1, or down to ₹1
 *
 * Every figure is worked out at full precision; only the figures handed out are taken to the paisa,
 * and only the rounded salary is rounded further.
 *
 * Once a row is **Paid** its figures are settled: only its payment can change, it keeps the rules it
 * was paid under (`paidLopDivisor`, `paidRounding`) so a later change to the rules never moves it,
 * and moving it back to Pending is how a paid month is reopened. Every write that depends on whether
 * a row is paid is conditional on the status it read, so a row marked Paid a moment ago cannot be
 * changed underneath it.
 *
 * Branch reach belongs to the permission: a reader reaches the branches of the roles granting them
 * `HRM / Payroll Register`, and every read and write is narrowed to employees in those.
 */

const PERMISSION = { module: "HRM", feature: "Payroll Register" };
const PAYMENT_STATUSES = ["Pending", "Paid", "On Hold"];
const { LOP_DIVISORS, ROUNDING_RULES, payableDateFor, currentPayrollMonth } = versions;
const DEFAULT_RULES = { lopDivisor: "WORKING_DAYS", rounding: "NEAREST_10" };
const CHANGED_UNDERNEATH = "This row changed while you were working on it. Reload the month and try again.";
/** A referral instalment the month carries was marked paid on the register a moment ago. */
const REFERRAL_SETTLED_UNDERNEATH = "A referral instalment in this month was just marked paid on Employee Referral. Refresh the month, then pay it.";

const fail = (status, message) => Object.assign(new Error(message), { status });
const money = (value) => Math.round(Number(value) * 100) / 100;
const number = (value) => Number(value) || 0;

/** The branch ids this login reaches through `HRM / Payroll Register`, or `null` for everywhere. */
const reachFor = (userId, iam = iamService) => iam.reachableBranchIds(userId, PERMISSION);
const employeeInReach = (reach) => (reach ? { branchId: { in: reach } } : {});
const rowInReach = (reach) => (reach ? { employee: employeeInReach(reach) } : {});

const isoDay = (date) => date.toISOString().slice(0, 10);
/** A stored day as `YYYY-MM-DD`, or null for none. */
const storedDay = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? isoDay(date) : null;
};

/**
 * The pay cycle of a payroll month under one cycle day, the same in the month before. A payroll
 * month is named for the month it is paid in, so its cycle is the one that ended in the month before:
 * 25 Apr to 24 May for June with the cycle on the 25th - so two months never share a day. A cycle day past a short month's end is its last day;
 * on the 1st the cycle is the calendar month itself. Where the cycle day changed between the two
 * months, `versions.periodFor` with the months' own settings is the answer.
 */
const payPeriodFor = (year, month, cycleDay = 25) => versions.periodFor(year, month, () => ({ cycleDay }));

/**
 * The pay cycle a month's register says it covers: the days its rows were worked out over, when they
 * all agree - a cycle day changed since does not rewrite rows already generated - or else the cycle
 * Generate would read, under the month's own settings (`settingsOf`, a `settingsBook`).
 */
function registerPeriod(rows, year, month, settingsOf) {
  const stored = new Set(rows.map((row) => `${storedDay(row.periodFrom)}|${storedDay(row.periodTo)}`));
  if (rows.length && stored.size === 1 && rows[0].periodFrom && rows[0].periodTo) {
    return { from: storedDay(rows[0].periodFrom), to: storedDay(rows[0].periodTo), generated: true };
  }
  return { ...versions.periodFor(year, month, settingsOf), generated: false };
}

const daysBetween = (from, to) => Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000) + 1;
/** The day before `iso`, as `YYYY-MM-DD`. */
const dayBefore = (iso) => new Date(new Date(`${iso}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
/** The first moment of the day after `iso` - "joined on or before `iso`" is a joining date before it. */
const startOfDayAfter = (iso) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + 86400000);

/**
 * The pay cycle's days before an employee joined, in the unit a day's pay is counted in under
 * `lopDivisor`: its working days (weekly offs and holidays left out) under WORKING_DAYS, its calendar
 * days under CALENDAR_DAYS and FIXED_30. None for somebody who joined on or before the cycle's first
 * day, or whose joining date is not on record. Never more than the 30 a FIXED_30 month's pay is split
 * into, so a 31-day cycle before joining costs the month's pay and not a day more.
 */
async function daysBeforeJoiningIn(joinedOn, { from, to, lopDivisor }, workingDaysIn) {
  const joined = joinedOn ? storedDay(joinedOn) : null;
  if (!joined || joined <= from) return 0;
  const lastBefore = joined > to ? to : dayBefore(joined);
  if (lopDivisor === "WORKING_DAYS") return number(await workingDaysIn(from, lastBefore));
  const calendarDays = daysBetween(from, lastBefore);
  return lopDivisor === "FIXED_30" ? Math.min(calendarDays, 30) : calendarDays;
}

/** The day after `iso`, as `YYYY-MM-DD`. */
const dayAfter = (iso) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);

/**
 * The pay cycle's days after an employee's relieving date - their last working day - counted the way
 * `daysBeforeJoiningIn` counts, and unpaid the same way: a leaver is paid up to their last day. None
 * for somebody not relieved, or relieved on or after the cycle's last day. Under FIXED_30 the days
 * before joining and after relieving together never pass 30.
 */
async function daysAfterRelievingIn(relievedOn, { from, to, lopDivisor }, workingDaysIn, daysBefore = 0) {
  const relieved = relievedOn ? storedDay(relievedOn) : null;
  if (!relieved || relieved >= to) return 0;
  const firstAfter = relieved < from ? from : dayAfter(relieved);
  if (lopDivisor === "WORKING_DAYS") return number(await workingDaysIn(firstAfter, to));
  const calendarDays = daysBetween(firstAfter, to);
  return lopDivisor === "FIXED_30" ? Math.max(0, Math.min(calendarDays, 30 - number(daysBefore))) : calendarDays;
}

/** A day's pay, under the rule. Nothing to divide by is no pay a day rather than a division by zero. */
function dayRateOf(entry, lopDivisor) {
  const divisor = lopDivisor === "CALENDAR_DAYS" ? number(entry.periodDays) : lopDivisor === "FIXED_30" ? 30 : number(entry.workingDays);
  return divisor > 0 ? number(entry.baseSalary) / divisor : 0;
}

/** The net salary rounded for payment, under the rule. */
function roundedSalary(net, rounding) {
  if (rounding === "NEAREST_100") return Math.round(net / 100) * 100;
  if (rounding === "NEAREST_50") return Math.round(net / 50) * 50;
  if (rounding === "NEAREST_1") return Math.round(net);
  if (rounding === "DOWN_1") return Math.floor(net);
  return Math.round(net / 10) * 10;
}

/**
 * The rules a row is worked out under: the ones it was settled under - paid, or frozen - or the rules
 * as they are now.
 */
function rulesOf(entry, rules = DEFAULT_RULES) {
  if ((entry.paymentStatus === "Paid" || entry.frozen) && entry.paidLopDivisor && entry.paidRounding) {
    return { lopDivisor: entry.paidLopDivisor, rounding: entry.paidRounding };
  }
  return { lopDivisor: rules.lopDivisor, rounding: rules.rounding };
}

/** A row's extra columns, totalled by kind - `entry.components` as read through their link. */
function extrasOf(entry) {
  const totals = { EARNING: 0, DEDUCTION: 0 };
  for (const value of entry.components || []) {
    const kind = value.component?.kind;
    if (kind in totals) totals[kind] += number(value.amount);
  }
  return { earnings: totals.EARNING, deductions: totals.DEDUCTION };
}

/** The worked-out figures of one row, under the rules - full precision inside, the paisa outside. */
function figuresFor(entry, rules = DEFAULT_RULES) {
  const extras = extrasOf(entry);
  const totalEarned = number(entry.baseSalary) + number(entry.incentive) + number(entry.referralBonus) + extras.earnings;
  // Every day away and every policy breach, less the leave Casual Leave covered - never below none.
  // Days before joining and after relieving are unpaid days like any other loss of pay.
  // The irregularity penalty is loss of pay too, on top of the absent days it was for.
  // An LOP policy breach's days are loss of pay as well, beside the Policy Breach Leaves typed by hand.
  const totalLeaves = Math.max(0, number(entry.attendanceLeaves) + number(entry.policyBreachLeaves) + number(entry.policyBreachLopDays) + number(entry.irregularityPenaltyDays) + number(entry.daysBeforeJoining) + number(entry.daysAfterRelieving) - number(entry.casualLeaveDays));
  const dayRate = dayRateOf(entry, rules.lopDivisor);
  const lopDeduction = dayRate * totalLeaves;
  const totalDeductions = lopDeduction + number(entry.salaryAdvance) + number(entry.recoveryDeduction) + number(entry.policyBreachDeduction) + number(entry.otherDeductions) + extras.deductions;
  // An approved late change to an earlier month, paid or taken back here.
  const netSalary = totalEarned - totalDeductions;
  return {
    totalEarned: money(totalEarned),
    totalLeaves: Math.round(totalLeaves * 100) / 100,
    dayRate: money(dayRate),
    lopDeduction: money(lopDeduction),
    totalDeductions: money(totalDeductions),
    netSalary: money(netSalary),
    roundedSalary: roundedSalary(netSalary, rules.rounding),
  };
}

// Each with the months skipped on this page, which every reading of what is due passes over.
const recoverySelect = { where: { deletedAt: null }, select: { recoveryId: true, totalAmount: true, startYear: true, startMonth: true, months: true, deletedAt: true, skips: skipsSelect } };
// Converted advances are their recovery's to take back, so the register never reads them as advances.
const advanceSelect = { where: { deletedAt: null, convertedRecoveryId: null }, select: { advanceId: true, amount: true, deductYear: true, deductMonth: true, deletedAt: true, convertedRecoveryId: true, skips: skipsSelect } };
const policyBreachSelect = { where: { deletedAt: null }, select: { policyBreachId: true, deductBy: true, totalAmount: true, totalDays: true, startYear: true, startMonth: true, months: true, deletedAt: true, skips: skipsSelect } };

// What a month's figures are worked out from on the employee: the Total Salary (as the reviews left it),
// joining and relieving, and the advances, recoveries and policy breaches due.
/*
 * The referrals this employee **made**, for the month's Referral Bonus. Their own status comes with
 * them - `referralBonusDueIn` wants both people's, and the employee here is the referrer - and so
 * does each referred employee's, because a bonus is for that person having stayed.
 */
const referralsMadeSelect = REFERRAL_BONUS_SELECT;

const payrollEmployeeSelect = {
  id: true, totalSalary: true, dateOfJoining: true, dateOfRelieving: true, employmentStatus: true, archivedAt: true,
  payrollRecoveries: recoverySelect, payrollAdvances: advanceSelect, payrollPolicyBreaches: policyBreachSelect,
  referralsMade: referralsMadeSelect,
};

const entryInclude = {
  employee: { select: { id: true, employeeId: true, employeeName: true, employmentStatus: true, archivedAt: true, branch: { select: { name: true } }, payrollRecoveries: recoverySelect, payrollAdvances: advanceSelect, payrollPolicyBreaches: policyBreachSelect, referralsMade: referralsMadeSelect } },
  paymentMode: { select: { id: true, name: true } },
  // Read through its link, so a renamed branch shows its name now.
  costCentreBranch: { select: { id: true, name: true } },
  components: { select: { componentId: true, amount: true, component: { select: { kind: true } } } },
};

/**
 * A stored row as the register reads it: what was stored, read through its links, and its figures.
 *
 * `working` is the studio's working employee statuses, which the Referral Bonus turns on - a bonus
 * is due only where the referrer and the person they referred are both still here. Left out, the row
 * still reads its stored figure; it only cannot name which referrals that figure is for.
 */
function toRow(entry, rules = DEFAULT_RULES, working = []) {
  const own = rulesOf(entry, rules);
  const referrals = referralBonusDueIn(entry.year, entry.month, entry.employee?.referralsMade || [], { referrer: entry.employee, working, entryId: entry.id });
  return {
    id: entry.id,
    employeeId: entry.employeeId,
    employeeCode: entry.employee?.employeeId || "",
    employeeName: entry.employee?.employeeName || "",
    branch: entry.employee?.branch?.name || "",
    year: entry.year,
    month: entry.month,
    periodFrom: storedDay(entry.periodFrom),
    periodTo: storedDay(entry.periodTo),
    baseSalary: number(entry.baseSalary),
    incentive: number(entry.incentive),
    // What HRM → Employee Referral owes this employee this month for a hire they introduced, and
    // which referrals - brought in, never typed. An earning, so it adds to Total Earned Salary.
    referralBonus: number(entry.referralBonus),
    referralIds: referrals.referralIds,
    attendanceLeaves: number(entry.attendanceLeaves),
    // Casual Leave Taken over the cycle - paid, so Total Leaves takes it off Attendance Leaves.
    casualLeaveDays: number(entry.casualLeaveDays),
    // Comp-Off Taken over the cycle - shown, never paid for or taken off.
    compOffTakenDays: number(entry.compOffTakenDays),
    // The cycle's days before joining and after relieving - unpaid, so Total Leaves adds them.
    daysBeforeJoining: number(entry.daysBeforeJoining),
    daysAfterRelieving: number(entry.daysAfterRelieving),
    // Typed by hand, so kept as typed through the month's updates.
    baseSalaryTyped: Boolean(entry.baseSalaryTyped),
    attendanceLeavesTyped: Boolean(entry.attendanceLeavesTyped),
    policyBreachLeaves: number(entry.policyBreachLeaves),
    // What Payroll → Policy Breach's LOP breaches take this month, in days - brought in, never typed.
    policyBreachLopDays: number(entry.policyBreachLopDays),
    irregularityPenaltyDays: number(entry.irregularityPenaltyDays),
    workingDays: entry.workingDays,
    periodDays: entry.periodDays,
    salaryAdvance: number(entry.salaryAdvance),
    // Which advances the month takes back - read from Payroll → Advance Salary, as they are now - and
    // which were skipped in it (Skip on this page).
    advanceIds: advanceDueIn(entry.year, entry.month, entry.employee?.payrollAdvances || []).advanceIds,
    skippedAdvanceIds: advanceSkippedIn(entry.year, entry.month, entry.employee?.payrollAdvances || []),
    recoveryDeduction: number(entry.recoveryDeduction),
    // Which recoveries the month is due under - read from Payroll → Recovery, so it names them as
    // they are now.
    recoveryIds: recoveryDueIn(entry.year, entry.month, entry.employee?.payrollRecoveries || []).recoveryIds,
    skippedRecoveryIds: recoverySkippedIn(entry.year, entry.month, entry.employee?.payrollRecoveries || []),
    // What Payroll → Policy Breach takes this month, and which fines - not the Policy Breach Leaves above.
    policyBreachDeduction: number(entry.policyBreachDeduction),
    policyBreachIds: policyBreachDueIn(entry.year, entry.month, entry.employee?.payrollPolicyBreaches || []).policyBreachIds,
    skippedPolicyBreachIds: policyBreachSkippedIn(entry.year, entry.month, entry.employee?.payrollPolicyBreaches || []),
    otherDeductions: number(entry.otherDeductions),
    // The extra columns' amounts, by column id; a column with none here is 0.
    componentAmounts: Object.fromEntries((entry.components || []).map((value) => [value.componentId, number(value.amount)])),
    remarks: entry.remarks || "",
    paymentStatus: entry.paymentStatus,
    paymentModeId: entry.paymentModeId,
    paymentMode: entry.paymentMode?.name || "",
    // Payment → Cost Centre: the branch the pay is booked to, by id and as its name now.
    costCentreBranchId: entry.costCentreBranchId ?? null,
    costCentre: entry.costCentreBranch?.name || "",
    paymentFrom: entry.paymentFrom || "",
    paymentDate: storedDay(entry.paymentDate),
    paymentRemarks: entry.paymentRemarks || "",
    // Frozen on this page: its figures settled until it is unfrozen, paid or not.
    frozen: Boolean(entry.frozen),
    frozenAt: entry.frozenAt || null,
    // The rules this row's figures are worked out under - its own once paid.
    rules: own,
    ...figuresFor(entry, own),
    updatedAt: entry.updatedAt,
  };
}

/** The salary rules alone, out of a month's settings. */
const pickRules = (settings) => ({ lopDivisor: settings.lopDivisor, rounding: settings.rounding });

/**
 * Rows as the register reads them, each with what Hold salary during notice says of it (`noticeHold`):
 * null for nearly everybody; for a held leaver the month that settles it, and on the settlement row the
 * held months it pays and the full and final total - its own pay and theirs, each under its own rules.
 */
async function rowsWithHolds(entries, rules, working, { client, settingsOf }) {
  const amountOf = (row) => figuresFor(row, rulesOf(row, pickRules(settingsOf(row.year, row.month)))).roundedSalary;
  const holds = await noticeHold.holdsForRows(entries, { client, settingsOf, include: entryInclude, amountOf });
  return entries.map((entry) => {
    const row = toRow(entry, rules, working);
    const hold = holds.get(entry.id);
    if (!hold) return { ...row, noticeHold: null };
    const releasedTotal = money(hold.released.reduce((sum, held) => sum + held.amount, 0));
    return {
      ...row,
      noticeHold: { ...hold, releasedTotal, finalSettlement: hold.state === "settlement" ? money(row.roundedSalary + releasedTotal) : null },
    };
  });
}

/** The rules as they are now - what Settings shows, and what the current month and later follow. */
async function readRules(client = prisma) {
  return pickRules(await versions.currentSettings(client));
}

/**
 * The rules one payroll month is worked out under: the latest version effective on or before it.
 * Before the rules were ever changed there are no versions, and every month follows them as they are.
 */
async function rulesForMonth(year, month, client = prisma) {
  return pickRules((await versions.settingsBook(client))(year, month));
}

/**
 * Saves the rules, from the current month on: this month and later ones follow them, earlier months
 * keep the rules they had (and a paid month the rules it was paid under). The first change also
 * records the rules as they stood before it, from January 2000, so every earlier month has a version.
 * They are the studio's, every branch's payroll at once, so only somebody who reaches every branch
 * through `HRM / Payroll Register` may change them.
 */
async function saveRules({ lopDivisor, rounding }, userId, reach = null, client = prisma, now = new Date()) {
  if (reach) throw fail(403, "The payroll rules apply to every branch, so only somebody who reaches every branch may change them.");
  const saved = await client.$transaction((tx) => versions.recordChange(tx, { lopDivisor, rounding }, userId, now));
  return { lopDivisor: saved.lopDivisor, rounding: saved.rounding, effectiveFrom: saved.effectiveFrom };
}

/**
 * How many days after its payable date a month's payslip is generated (0-30), or null - once its pay
 * cycle ends. Every branch's payslips at once, so - like the rules - only somebody who reaches every
 * branch may change it.
 */
async function savePayslipGeneration(generateDaysAfter, userId, reach = null, client = prisma) {
  if (reach) throw fail(403, "When payslips are generated applies to every branch, so only somebody who reaches every branch may change it.");
  const data = { payslipGenerateDaysAfter: generateDaysAfter, updatedByUserId: userId || null };
  await client.hrmSettings.upsert({ where: { id: "default" }, update: data, create: { id: "default", ...data } });
  return { generateDaysAfter: await payslipGenerateDaysAfter({ client }) };
}

/**
 * Payroll rules → Hold salary during notice, on or off. It decides for separations recorded from now on
 * (`noticeHold`); one already recorded keeps what it was given. Every branch's at once, so - like the
 * rules - only somebody who reaches every branch may change it.
 */
async function saveNoticeHold(enabled, userId, reach = null, client = prisma) {
  if (reach) throw fail(403, "Holding salary during notice applies to every branch, so only somebody who reaches every branch may change it.");
  const data = { holdSalaryDuringNotice: Boolean(enabled), updatedByUserId: userId || null };
  await client.hrmSettings.upsert({ where: { id: "default" }, update: data, create: { id: "default", ...data } });
  return { enabled: await noticeHold.holdSwitchOn(client) };
}

/** The real sources, read lazily: the attendance module is large and the tests do not need it. */
function defaultSources(client) {
  return {
    attendance: (...args) => require("../attendance/calculator").periodCalculation(...args),
    workingDaysIn: async (from, to) => {
      const attendance = require("../attendance/service");
      const { workingDaysInRange } = require("../attendance/attendanceRules");
      const [settings, holidayDates] = await Promise.all([attendance.readSettings(client), attendance.holidayDateSet(from, to, client)]);
      return workingDaysInRange(from, to, { settings, holidayDates });
    },
  };
}

/**
 * A month's pay cycle and the day it is paid out, under its own settings - what Generate will read
 * for a month not generated yet, said before it is pressed.
 */
async function monthSchedule({ year, month }, { client = prisma } = {}) {
  const settingsOf = await versions.settingsBook(client);
  return { ...versions.periodFor(year, month, settingsOf), payableOn: payableDateFor(year, month, settingsOf(year, month).paybackDay) };
}

/**
 * When a payroll month can be made: the day after its pay cycle ends, under its own settings - 25 Oct
 * for November, whose cycle is 25 Sep - 24 Oct. Until then its attendance is not finished, so the month
 * has no payroll: no row is made or read again, and the Main Page shows none. `{ cycle, opensOn, open }`.
 */
function cycleGate(year, month, settingsOf, now = new Date()) {
  const cycle = versions.periodFor(year, month, settingsOf);
  const opensOn = new Date(`${cycle.to}T00:00:00Z`);
  opensOn.setUTCDate(opensOn.getUTCDate() + 1);
  return { cycle, opensOn: opensOn.toISOString().slice(0, 10), open: cycle.to < todayInIndia(now) };
}

async function listEntries({ year, month }, reach = null, { client = prisma, now = new Date(), employeeId = null } = {}) {
  const settingsBook = await versions.settingsBook(client);
  const gate = cycleGate(year, month, settingsBook, now);
  // A month before payroll starts shows nothing - nor rows made for it before the start was set.
  const start = await require("./payrollStart").payrollStart({ client });
  if (require("./payrollStart").beforeStart(year, month, start)) {
    const settings = settingsBook(year, month);
    return {
      rules: pickRules(settings),
      cycleDay: settings.cycleDay,
      paybackDay: settings.paybackDay,
      period: { ...gate.cycle, generated: false },
      payableOn: payableDateFor(year, month, settings.paybackDay),
      beforeStart: true,
      startsFrom: start.startsFrom,
      components: [],
      rows: [],
    };
  }
  if (!gate.open) {
    // A month whose pay cycle has not ended shows nothing - not even rows made for it before this rule.
    const settings = settingsBook(year, month);
    return {
      rules: pickRules(settings),
      cycleDay: settings.cycleDay,
      paybackDay: settings.paybackDay,
      period: { ...gate.cycle, generated: false },
      payableOn: payableDateFor(year, month, settings.paybackDay),
      opensOn: gate.opensOn,
      components: [],
      rows: [],
    };
  }
  // `working` is read here rather than inside `toRow`, which is called once per row: the Referral
  // Bonus asks whether two people are still here, and the answer is one list for the whole month.
  const [rows, removed, settingsOf, working] = await Promise.all([
    client.payrollEntry.findMany({
      // `employeeId` narrows it to one person's row - HRM → Payslip reads only its own.
      where: { year, month, removedAt: null, ...rowInReach(reach), ...(employeeId ? { employeeId } : {}) },
      orderBy: [{ employee: { employeeName: "asc" } }],
      include: entryInclude,
    }),
    // Removed on this page - kept, with who removed them and why, for Restore.
    client.payrollEntry.findMany({
      where: { year, month, removedAt: { not: null }, ...rowInReach(reach), ...(employeeId ? { employeeId } : {}) },
      orderBy: [{ removedAt: "desc" }],
      select: { id: true, removedAt: true, removedReason: true, employee: { select: { employeeId: true, employeeName: true } }, removedByUser: { select: { name: true } } },
    }),
    versions.settingsBook(client),
    workingEmployeeStatuses(),
  ]);
  const settings = settingsOf(year, month);
  const rules = pickRules(settings);
  // The rules this month is worked out under (the form previews by them); the pay cycle it covers and
  // the day it is paid out, which the screen states above the register; and the extra columns it shows.
  return {
    rules,
    cycleDay: settings.cycleDay,
    paybackDay: settings.paybackDay,
    period: registerPeriod(rows, year, month, settingsOf),
    payableOn: payableDateFor(year, month, settings.paybackDay),
    components: await columnsForRows(rows, client),
    rows: await rowsWithHolds(rows, rules, working, { client, settingsOf }),
    removed: removed.map((row) => ({
      id: row.id,
      employeeCode: row.employee?.employeeId || "",
      employeeName: row.employee?.employeeName || "",
      removedAt: row.removedAt,
      removedBy: row.removedByUser?.name || "",
      reason: row.removedReason || "",
    })),
  };
}

/**
 * What the app knows about one employee's month: loss-of-pay days from the Attendance calculator
 * (none for a cycle not begun, or for somebody attendance is not kept for), the salary advances
 * taken back that month, and the recovery and policy breach due.
 * The cycle's working and calendar days are the same for everybody and come in worked out once.
 */
async function broughtIn(employee, { year, month, from, to, workingDays, lopDivisor, working = [], entryId = null }, { client, attendance, workingDaysIn }) {
  // Every day away over the cycle - absences, half days as half and approved leave - and the Casual
  // Leave that covered some of that leave; Total Leaves is the one less the other.
  let attendanceLeaves = 0;
  let casualLeaveDays = 0;
  // The approved comp-off days off taken - counted only, each paid as any other day already.
  let compOffTakenDays = 0;
  // Attendance Rules' irregularity penalty over the cycle - its days for every day still Absent.
  let irregularityPenaltyDays = 0;
  try {
    const reading = await attendance(employee.id, { from, to }, { client });
    attendanceLeaves = number(reading.awayDays ?? reading.lossOfPayDays);
    casualLeaveDays = number(reading.days?.casualLeaveTaken);
    compOffTakenDays = number(reading.days?.compOffTaken);
    irregularityPenaltyDays = number(reading.irregularityPenaltyDays);
  } catch (error) {
    // A cycle that has not begun, or somebody outside attendance, has no loss of pay to bring in.
    if (!error.status) throw error;
  }
  const recovery = recoveryDueIn(year, month, employee.payrollRecoveries || []);
  const breach = policyBreachDueIn(year, month, employee.payrollPolicyBreaches || []);
  // The cycle's days before joining and after relieving: unpaid, so a part month is paid as a part month.
  const daysBeforeJoining = await daysBeforeJoiningIn(employee.dateOfJoining, { from, to, lopDivisor }, workingDaysIn);
  const daysAfterRelieving = await daysAfterRelievingIn(employee.dateOfRelieving, { from, to, lopDivisor }, workingDaysIn, daysBeforeJoining);
  return {
    // The employee's Total Salary as it stands - after every review - each month afresh; a figure typed
    // on a row is that month's alone (`baseSalaryTyped`), and the next month starts from the record again.
    baseSalary: number(employee.totalSalary),
    attendanceLeaves,
    casualLeaveDays,
    compOffTakenDays,
    irregularityPenaltyDays,
    daysBeforeJoining,
    daysAfterRelieving,
    workingDays,
    periodDays: daysBetween(from, to),
    salaryAdvance: advanceDueIn(year, month, employee.payrollAdvances || []).amount,
    recoveryDeduction: recovery.amount,
    policyBreachDeduction: breach.amount,
    policyBreachLopDays: breach.lopDays,
    // The referral instalments that fall due this month, where both the referrer (this employee) and
    // the hire they introduced are still working. An earning: the one figure here that adds.
    referralBonus: referralBonusDueIn(year, month, employee.referralsMade || [], { referrer: employee, working, entryId }).amount,
  };
}

const isDuplicate = (error) => error?.code === "P2002";

/**
 * Adds the month's rows for every working employee in reach who has none yet. Rows already there are
 * left as they are - Refresh is how one is brought up to date - so generating twice never doubles
 * anybody or undoes what was typed; and two Generates at once settle on the unique key, the one that
 * finds a row already made counting it as there rather than failing.
 */
async function generateMonth({ year, month }, userId, reach = null, { client = prisma, statuses = workingEmployeeStatuses, sources = defaultSources(client) } = {}) {
  // The month's own pay cycle - under the settings it had - starting the day after the month before ended.
  const settingsOf = await versions.settingsBook(client);
  const { from, to } = versions.periodFor(year, month, settingsOf);
  const { lopDivisor } = settingsOf(year, month);
  const working = await statuses();
  const [employees, existing, workingDays] = await Promise.all([
    client.employee.findMany({
      where: {
        archivedAt: null,
        AND: [
          // Working, or relieved on or after the cycle's first day - a leaver's last, part month is theirs.
          { OR: [{ employmentStatus: { in: working } }, { dateOfRelieving: { gte: new Date(`${from}T00:00:00Z`) } }] },
          // Nobody who joined after the cycle ended: a month they were never employed in is not theirs.
          { OR: [{ dateOfJoining: null }, { dateOfJoining: { lt: startOfDayAfter(to) } }] },
        ],
        ...employeeInReach(reach),
      },
      select: payrollEmployeeSelect,
      orderBy: { employeeName: "asc" },
    }),
    // A row removed on the Main Page counts as there: the employee is not added back. (An earlier month's
    // "has rows" count in `syncMonth` counts removed ones for the same reason.)
    client.payrollEntry.findMany({ where: { year, month, ...rowInReach(reach) }, select: { employeeId: true } }),
    sources.workingDaysIn(from, to),
  ]);
  const have = new Set(existing.map((row) => row.employeeId));
  let added = 0;
  let alreadyThere = have.size;
  for (const employee of employees.filter((entry) => !have.has(entry.id))) {
    const values = await broughtIn(employee, { year, month, from, to, workingDays, lopDivisor, working }, { client, ...sources });
    try {
      await client.payrollEntry.create({
        data: { employeeId: employee.id, year, month, periodFrom: new Date(`${from}T00:00:00Z`), periodTo: new Date(`${to}T00:00:00Z`), ...values, createdByUserId: userId || null, updatedByUserId: userId || null },
      });
      added += 1;
    } catch (error) {
      if (!isDuplicate(error)) throw error;
      alreadyThere += 1;
    }
  }
  return { added, alreadyThere, period: { from, to } };
}

/** A row in reach, or a 404 - one outside it answers as though it were not there. */
async function entryInReach(client, id, reach) {
  // A removed row answers only to Restore (`restoreEntry`).
  const row = await client.payrollEntry.findFirst({ where: { id, removedAt: null, ...rowInReach(reach) }, include: entryInclude });
  if (!row) throw fail(404, "This payroll row could not be found.");
  return row;
}

/**
 * Brings the salary, attendance, advances and recovery in again for every row of a month in reach not
 * yet paid, over the month's pay cycle as Payroll rules set it now - so a changed cycle day, or an
 * advance added since, reaches the whole month at once. A Base Salary or Attendance Leaves typed by
 * hand (`baseSalaryTyped`, `attendanceLeavesTyped`) is kept as typed. Paid and frozen rows are settled
 * and left as they are (`paid`, `frozen`); a row paid or frozen while this runs is left too, counted as paid.
 */
async function refreshMonth({ year, month }, userId, reach = null, { client = prisma, statuses = workingEmployeeStatuses, sources = defaultSources(client) } = {}) {
  const settingsOf = await versions.settingsBook(client);
  const { from, to } = versions.periodFor(year, month, settingsOf);
  const { lopDivisor } = settingsOf(year, month);
  const rows = await client.payrollEntry.findMany({
    // A removed row stays as it was removed.
    where: { year, month, removedAt: null, ...rowInReach(reach) },
    select: {
      id: true, employeeId: true, paymentStatus: true, frozen: true, baseSalaryTyped: true, attendanceLeavesTyped: true,
      baseSalary: true, attendanceLeaves: true, casualLeaveDays: true, compOffTakenDays: true, irregularityPenaltyDays: true, daysBeforeJoining: true, daysAfterRelieving: true, workingDays: true, periodDays: true, salaryAdvance: true, recoveryDeduction: true, policyBreachDeduction: true, policyBreachLopDays: true, referralBonus: true, periodFrom: true, periodTo: true,
    },
  });
  const open = rows.filter((row) => row.paymentStatus !== "Paid" && !row.frozen);
  let frozen = rows.filter((row) => row.paymentStatus !== "Paid" && row.frozen).length;
  let paid = rows.length - open.length - frozen;
  if (!open.length) return { refreshed: 0, paid, frozen, period: { from, to } };
  const [employees, workingDays, working] = await Promise.all([
    client.employee.findMany({ where: { id: { in: open.map((row) => row.employeeId) } }, select: payrollEmployeeSelect }),
    sources.workingDaysIn(from, to),
    statuses(),
  ]);
  const employeeOf = new Map(employees.map((employee) => [employee.id, employee]));
  let refreshed = 0;
  for (const row of open) {
    // An employee gone between the two reads leaves their row as it was.
    const employee = employeeOf.get(row.employeeId);
    if (!employee) continue;
    // `entryId`, so a row reads the instalments it has already paid as its own rather than losing
    // the figure the month was paid with.
    const values = await broughtIn(employee, { year, month, from, to, workingDays, lopDivisor, working, entryId: row.id }, { client, ...sources });
    // A figure typed by hand on the row stays as typed; the rest follows attendance and the record.
    if (row.baseSalaryTyped) delete values.baseSalary;
    if (row.attendanceLeavesTyped) delete values.attendanceLeaves;
    // Nothing different, nothing written: the row keeps who last changed it, and an opening of the
    // month that changes nothing writes nothing.
    const same = Object.entries(values).every(([field, value]) => Number(row[field] ?? 0) === Number(value ?? 0))
      && storedDay(row.periodFrom) === from && storedDay(row.periodTo) === to;
    if (same) continue;
    const { count } = await client.payrollEntry.updateMany({
      // Only while it is still as read: not settled since, and no figure typed by hand meanwhile.
      where: { id: row.id, paymentStatus: { not: "Paid" }, frozen: false, baseSalaryTyped: Boolean(row.baseSalaryTyped), attendanceLeavesTyped: Boolean(row.attendanceLeavesTyped) },
      data: { ...values, periodFrom: new Date(`${from}T00:00:00Z`), periodTo: new Date(`${to}T00:00:00Z`), updatedByUserId: userId || null },
    });
    if (count) {
      refreshed += 1;
      continue;
    }
    // Settled while this ran - counted for what it became, frozen or paid - or typed by hand meanwhile,
    // which is left as typed and counted as neither.
    const now = await client.payrollEntry.findFirst({ where: { id: row.id }, select: { paymentStatus: true, frozen: true } });
    if (now?.frozen && now.paymentStatus !== "Paid") frozen += 1;
    else if (now?.paymentStatus === "Paid") paid += 1;
  }
  return { refreshed, paid, frozen, period: { from, to } };
}

/**
 * Brings a month up to date by itself, as the Main Page opens it - in place of Generate and Refresh.
 *
 * The month still being paid (`openPayrollMonth`) and every month after it: every row not paid or
 * frozen read again (`refreshMonth`, a typed figure kept), then a row added for every working employee
 * without one (`generateMonth`) - so a change to attendance, Attendance Rules or Payroll rules reaches
 * them. Rows are made no further ahead than the month after it - a month beyond that has not begun, so
 * it is only read again where it already has rows (`ahead`). A month before it is left as it was:
 * filled in once, where it has no rows in reach at all (counted in the caller's reach, so a
 * branch-limited administrator fills their own branches), and never read again.
 * `{ earlier, ahead, added, refreshed }`.
 */
async function syncMonth({ year, month }, userId, reach = null, { client = prisma, statuses, sources = defaultSources(client), now = new Date() } = {}) {
  // A month before payroll starts is never made: it has no attendance behind it.
  const start = await require("./payrollStart").payrollStart({ client });
  if (require("./payrollStart").beforeStart(year, month, start)) return { beforeStart: true, startsFrom: start.startsFrom, earlier: true, ahead: false, added: 0, refreshed: 0 };
  const open = await versions.openPayrollMonth(client, now);
  const at = year * 12 + month;
  const openAt = open.year * 12 + open.month;
  // Nothing is made or read again before the month's pay cycle has ended (`cycleGate`).
  const gate = cycleGate(year, month, await versions.settingsBook(client), now);
  if (!gate.open) return { earlier: at < openAt, ahead: at > openAt + 1, added: 0, refreshed: 0, opensOn: gate.opensOn };
  if (at < openAt) {
    const rows = await client.payrollEntry.count({ where: { year, month, ...rowInReach(reach) } });
    if (rows) return { earlier: true, ahead: false, added: 0, refreshed: 0 };
    const generated = await generateMonth({ year, month }, userId, reach, { client, statuses, sources });
    return { earlier: true, ahead: false, added: generated.added, refreshed: 0 };
  }
  // Read again first, then the missing added: a row just made is already up to date.
  const refreshed = await refreshMonth({ year, month }, userId, reach, { client, statuses, sources });
  const ahead = at > openAt + 1;
  const generated = ahead ? { added: 0 } : await generateMonth({ year, month }, userId, reach, { client, statuses, sources });
  return { earlier: false, ahead, added: generated.added, refreshed: refreshed.refreshed };
}

// Salary Advance is not among them: it is Payroll → Advance Salary's, brought in, never typed here.
const TYPED_FIGURES = ["baseSalary", "incentive", "attendanceLeaves", "policyBreachLeaves", "otherDeductions", "remarks"];
const PAYMENT_FIELDS = ["paymentStatus", "paymentModeId", "paymentFrom", "paymentDate", "paymentRemarks", "costCentreBranchId"];

/**
 * Saves what is typed on a row. A paid row's figures are settled - only its payment changes - and a
 * row is marked Paid only with how and when it was paid. A **frozen** row (`frozen`) is settled the
 * same way before it is paid: its figures change only once it is unfrozen, in the same save or a
 * later one, while its payment can still be recorded. Settling a row - paying or freezing it - keeps
 * the rules it was settled under; once neither, it follows the rules again. The paying account must be one
 * the studio pays from - unless it is the one already recorded.
 */
async function updateEntry(id, input, userId, reach = null, { client = prisma } = {}) {
  const current = await entryInReach(client, id, reach);
  const status = input.paymentStatus ?? current.paymentStatus;
  // The extra columns typed: each one a column there is, and an archived one only where this row
  // already holds an amount for it (so it can still be corrected or cleared).
  const held = new Map((current.components || []).map((value) => [value.componentId, number(value.amount)]));
  const extras = Object.entries(input.components || {}).map(([key, amount]) => ({ componentId: Number(key), amount: number(amount) }));
  if (extras.length) {
    const found = await client.payrollComponent.findMany({ where: { id: { in: extras.map((value) => value.componentId) } }, select: { id: true, archivedAt: true } });
    const usable = new Set(found.filter((column) => !column.archivedAt || held.has(column.id)).map((column) => column.id));
    if (extras.some((value) => !usable.has(value.componentId))) throw fail(400, "One of those columns is not offered any more. Reload the month and try again.");
  }
  const extrasChanging = extras.some((value) => value.amount !== (held.get(value.componentId) || 0));
  // Handing typed figures back to attendance and the record changes them too, so it is held like a change.
  const handingBack = input.useCalculated === true && Boolean(current.baseSalaryTyped || current.attendanceLeavesTyped);
  const figuresChanging = handingBack || extrasChanging || TYPED_FIGURES.some((field) => input[field] !== undefined && String(input[field] ?? "") !== String(current[field] ?? ""));
  if (current.paymentStatus === "Paid" && status === "Paid" && figuresChanging) {
    throw fail(409, "This month is paid, so its figures are settled. Set it back to Pending to change them.");
  }
  const wasFrozen = Boolean(current.frozen);
  const frozen = input.frozen ?? wasFrozen;
  if (wasFrozen && frozen && figuresChanging) {
    throw fail(409, "This row is on hold, so its figures are settled. Switch off Hold to change them.");
  }
  const modeId = input.paymentModeId !== undefined ? input.paymentModeId || null : current.paymentModeId;
  const date = input.paymentDate !== undefined ? input.paymentDate : current.paymentDate;
  if (status === "Paid" && (!modeId || !date)) throw fail(400, "Choose the payment mode and the payment date to mark it Paid.");
  // Hold salary during notice: a held month is paid only by its settlement, and a month the settlement
  // paid reopens only with it. Paying the settlement pays the held months with it (below).
  const paying = status === "Paid" && current.paymentStatus !== "Paid";
  const reopening = status !== "Paid" && current.paymentStatus === "Paid";
  const settingsOf = await versions.settingsBook(client);
  const hold = (await noticeHold.holdsFor([current.employeeId], client)).get(current.employeeId);
  const holdState = noticeHold.holdState(current, hold, settingsOf);
  if (paying && holdState === "held") {
    const settles = noticeHold.settlementMonth(hold.lastDay, settingsOf);
    throw fail(409, `This salary is held during the notice period. It is paid with the full and final settlement${settles ? ` in ${noticeHold.monthName(settles)}` : ""}.`);
  }
  if (holdState === "settled" && !reopening && PAYMENT_FIELDS.some((field) => input[field] !== undefined && String(input[field] ?? "") !== String(current[field] ?? ""))) {
    throw fail(409, "This month was paid in the full and final settlement, so its payment is the settlement's. Change it on that month.");
  }
  if (reopening && holdState === "settled") {
    const by = await client.payrollEntry.findUnique({ where: { id: current.settledInEntryId }, select: { year: true, month: true } });
    throw fail(409, `This month was paid in the full and final settlement${by ? ` of ${noticeHold.monthName(by)}` : ""}. Set that month back to Pending to reopen it.`);
  }
  const released = paying && holdState === "settlement" ? await noticeHold.releasedBy(current, hold, settingsOf, { client, include: entryInclude }) : [];
  if (input.paymentModeId) {
    const mode = await client.paymentMode.findFirst({ where: { id: input.paymentModeId, isActive: true }, select: { id: true } });
    if (!mode) throw fail(400, "Choose a payment mode from the list.");
  }
  // The cost centre is a branch of the organisation, still in use - or the one already booked to.
  if (input.costCentreBranchId && input.costCentreBranchId !== current.costCentreBranchId) {
    const branch = await client.branch.findFirst({ where: { id: input.costCentreBranchId, isActive: true }, select: { id: true } });
    if (!branch) throw fail(400, "Choose the cost centre from the list of branches.");
  }
  if (input.paymentFrom && input.paymentFrom !== current.paymentFrom) {
    const accounts = await receivedIntoOptions(client);
    if (!accounts.includes(input.paymentFrom)) throw fail(400, "Choose the account it was paid from from the list.");
  }
  const data = { updatedByUserId: userId || null };
  // A Base Salary or Attendance Leaves changed by hand is marked typed, so the automatic update keeps it.
  if (input.baseSalary !== undefined && Number(input.baseSalary) !== Number(current.baseSalary)) data.baseSalaryTyped = true;
  if (input.attendanceLeaves !== undefined && Number(input.attendanceLeaves) !== Number(current.attendanceLeaves)) data.attendanceLeavesTyped = true;
  // Back to the calculated figures: unmarked, so the month's next update brings them in again.
  if (handingBack) Object.assign(data, { baseSalaryTyped: false, attendanceLeavesTyped: false });
  for (const field of [...TYPED_FIGURES, ...PAYMENT_FIELDS]) {
    if (input[field] === undefined) continue;
    if (field === "paymentDate") data.paymentDate = input.paymentDate ? new Date(`${input.paymentDate}T00:00:00Z`) : null;
    else if (field === "paymentModeId") data.paymentModeId = input.paymentModeId || null;
    else if (field === "costCentreBranchId") data.costCentreBranchId = input.costCentreBranchId || null;
    else if (["remarks", "paymentFrom", "paymentRemarks"].includes(field)) data[field] = input[field] || null;
    else data[field] = input[field];
  }
  if (frozen !== wasFrozen) {
    Object.assign(data, frozen
      ? { frozen: true, frozenAt: new Date(), frozenByUserId: userId || null }
      : { frozen: false, frozenAt: null, frozenByUserId: null });
  }
  // Settling a row - Paid, or frozen - keeps the rules it is settled under; once it is neither, it
  // follows the rules again. Paying a frozen row keeps the rules it was frozen under.
  const settledBefore = current.paymentStatus === "Paid" || wasFrozen;
  const settledAfter = status === "Paid" || frozen;
  if (settledAfter && !settledBefore) {
    const rules = await rulesForMonth(current.year, current.month, client);
    Object.assign(data, { paidLopDivisor: rules.lopDivisor, paidRounding: rules.rounding });
  } else if (!settledAfter && settledBefore) {
    Object.assign(data, { paidLopDivisor: null, paidRounding: null });
  }
  // Only while the row is still what was read: a row marked Paid or frozen a moment ago is not changed
  // under it - and the extra columns are written in the same transaction, so they go back with it.
  await client.$transaction(async (tx) => {
    const { count } = await tx.payrollEntry.updateMany({ where: { id, paymentStatus: current.paymentStatus, frozen: wasFrozen }, data });
    if (!count) throw fail(409, CHANGED_UNDERNEATH);
    /*
     * Paying the month is what pays the referral instalments it carried, so it is what records them
     * as paid on HRM → Employee Referral. The register can also mark one paid by hand (paid outside
     * payroll); each way settles an instalment once, and payroll carries only what is still Pending.
     *
     * In the row's own transaction: a month that fails to save settles nothing. Which instalments
     * they are is read the same way the figure was (`referralBonusDueIn`), and only one still
     * Pending is written, so paying a corrected month again cannot move a date already set.
     */
    const paidOn = date ? new Date(typeof date === "string" ? `${date}T00:00:00Z` : date) : new Date();
    if (status === "Paid" && current.paymentStatus !== "Paid") {
      const working = await workingEmployeeStatuses();
      const due = referralBonusDueIn(current.year, current.month, current.employee?.referralsMade || [], { referrer: current.employee, working, entryId: id });
      /*
       * Held to the figure the row is being paid with.
       *
       * The amount was worked out at Generate or Refresh; the instalments are read again here. A
       * referral added, or somebody relieved, in between makes those two different numbers - and
       * then either money goes out with an instalment left Pending, or an instalment is settled that
       * the figure never included. Neither is a thing to guess at, so the month is sent back to be
       * refreshed.
       */
      if (Math.round(due.amount * 100) !== Math.round(number(current.referralBonus) * 100)) {
        throw fail(409, "The referral bonus due this month has changed since the row was worked out. Refresh the month, then pay it.");
      }
      // The month's own payment date - the one being sent, or the one already stored - rather than
      // "now": the instalment was handed over when the salary was, which is a day somebody chose.
      // Every instalment the figure carries is settled here, or none: one marked paid by hand on the
      // register between this row being read and now would otherwise go out in the salary as well.
      if (await settleReferralBonus(tx, due.payoutIds, { paidOn, userId, payrollEntryId: id }) !== due.payoutIds.length) throw fail(409, REFERRAL_SETTLED_UNDERNEATH);
      // The full and final settlement: each held month paid with it, under its own month's rules.
      for (const held of released) {
        await payHeldMonth(tx, held, { settlement: current, modeId, paidOn, paymentFrom: data.paymentFrom ?? current.paymentFrom ?? null, working, settingsOf, userId });
      }
    }
    // Reopened: it has paid nothing, so what it paid is owed again and the next Refresh sees it.
    if (status !== "Paid" && current.paymentStatus === "Paid") {
      await unsettleReferralBonus(tx, id);
      // A settlement reopened takes the held months it paid back with it: held again, as before.
      await reopenSettledMonths(tx, id, userId);
    }
    for (const { componentId, amount } of extras) {
      // A cleared amount is no row at all, so a column nobody uses again can be deleted.
      if (!amount) await tx.payrollEntryComponent.deleteMany({ where: { entryId: id, componentId } });
      else await tx.payrollEntryComponent.upsert({ where: { entryId_componentId: { entryId: id, componentId } }, create: { entryId: id, componentId, amount }, update: { amount } });
    }
  });
  const updated = await entryInReach(client, id, reach);
  // The working statuses, or the row comes back with its Referral IDs missing - `toRow` cannot tell
  // whether the two people are still here without them.
  const [row] = await rowsWithHolds([updated], pickRules(settingsOf(updated.year, updated.month)), await workingEmployeeStatuses(), { client, settingsOf });
  return row;
}

/**
 * One held month paid by its full and final settlement, in the settlement's transaction: Paid with the
 * settlement's payment, settled under its own month's rules, stamped with the settlement that paid it,
 * and its referral instalments recorded paid - held to its figure exactly as paying it alone would be.
 */
async function payHeldMonth(tx, held, { settlement, modeId, paidOn, paymentFrom, working, settingsOf, userId }) {
  const due = referralBonusDueIn(held.year, held.month, held.employee?.referralsMade || [], { referrer: held.employee, working, entryId: held.id });
  if (Math.round(due.amount * 100) !== Math.round(number(held.referralBonus) * 100)) {
    throw fail(409, `The referral bonus due in ${noticeHold.monthName(held)} has changed since that month was worked out. Refresh it, then pay the settlement.`);
  }
  const rules = pickRules(settingsOf(held.year, held.month));
  const { count } = await tx.payrollEntry.updateMany({
    where: { id: held.id, removedAt: null, paymentStatus: held.paymentStatus, frozen: held.frozen, settledInEntryId: null },
    data: {
      paymentStatus: "Paid",
      paymentModeId: modeId,
      paymentDate: paidOn,
      paymentFrom,
      paymentRemarks: `Paid in the full and final settlement of ${noticeHold.monthName(settlement)}.`,
      settledInEntryId: settlement.id,
      updatedByUserId: userId || null,
      // A frozen month keeps the rules it was frozen under, as paying it alone would.
      ...(held.frozen ? {} : { paidLopDivisor: rules.lopDivisor, paidRounding: rules.rounding }),
    },
  });
  if (!count) throw fail(409, CHANGED_UNDERNEATH);
  if (await settleReferralBonus(tx, due.payoutIds, { paidOn, userId, payrollEntryId: held.id }) !== due.payoutIds.length) throw fail(409, REFERRAL_SETTLED_UNDERNEATH);
}

/** The months a settlement paid, back to Pending with it - their payment and its stamp cleared. */
async function reopenSettledMonths(tx, settlementId, userId) {
  const settled = await tx.payrollEntry.findMany({ where: { settledInEntryId: settlementId }, select: { id: true, frozen: true } });
  for (const row of settled) {
    await tx.payrollEntry.update({
      where: { id: row.id },
      data: {
        paymentStatus: "Pending", settledInEntryId: null, paymentModeId: null, paymentDate: null, paymentFrom: null, paymentRemarks: null,
        updatedByUserId: userId || null,
        ...(row.frozen ? {} : { paidLopDivisor: null, paidRounding: null }),
      },
    });
    await unsettleReferralBonus(tx, row.id);
  }
}

/**
 * Marks several rows Paid at once with one payment - the Main Page's ticked rows: each goes through
 * `updateEntry`, so each is checked as one marked Paid by hand is (its reach, a mode and a date, the
 * paying account, the rules it is paid under). One already paid is left alone, its payment not
 * overwritten; one refused is reported with why, and the rest still go - even past an unexpected
 * failure, which is logged and reported against its row, so the answer always says which were paid.
 * The payment mode and paying account are the same for every row, so they are checked once, first,
 * and a wrong one refuses the lot before anything is written. `{ paidIds, missed }`.
 */
async function markPaid(ids, payment, userId, reach = null, { client = prisma } = {}) {
  const mode = await client.paymentMode.findFirst({ where: { id: payment.paymentModeId, isActive: true }, select: { id: true } });
  if (!mode) throw fail(400, "Choose a payment mode from the list.");
  if (payment.paymentFrom && !(await receivedIntoOptions(client)).includes(payment.paymentFrom)) {
    throw fail(400, "Choose the account it was paid from from the list.");
  }
  const paidIds = [];
  const missed = [];
  // A final settlement first, so the held months ticked beside it read as paid by it whatever the order.
  const ticked = await client.payrollEntry.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, employeeId: true, year: true, month: true, periodFrom: true, periodTo: true, paymentStatus: true, settledInEntryId: true } });
  const holds = await noticeHold.holdsFor(ticked.map((row) => row.employeeId), client);
  const settingsOf = holds.size ? await versions.settingsBook(client) : null;
  const settlements = new Set(ticked.filter((row) => holds.has(row.employeeId) && noticeHold.holdState(row, holds.get(row.employeeId), settingsOf) === "settlement").map((row) => row.id));
  const ordered = [...new Set(ids)].sort((a, b) => Number(settlements.has(b)) - Number(settlements.has(a)));
  for (const id of ordered) {
    try {
      const current = await entryInReach(client, id, reach);
      // A held month ticked beside its settlement was paid by it a moment ago: paid, not missed.
      if (current.paymentStatus === "Paid" && current.settledInEntryId && paidIds.includes(current.settledInEntryId)) { paidIds.push(id); continue; }
      if (current.paymentStatus === "Paid") throw fail(409, "It is already paid.");
      await updateEntry(id, { ...payment, paymentStatus: "Paid" }, userId, reach, { client });
      paidIds.push(id);
    } catch (error) {
      if (!error.status) console.error(`Payroll mark paid failed for row ${id}:`, error);
      missed.push({ id, message: error.status ? error.message : "It could not be marked Paid. Try again." });
    }
  }
  return { paidIds, missed };
}

/**
 * Takes a row off the month - not one paid or frozen. Kept and marked rather than deleted, with who
 * removed it and why, so the month's update does not add the employee back; Restore brings it back.
 */
async function removeEntry(id, reach = null, { client = prisma, userId = null, reason = "" } = {}) {
  const current = await entryInReach(client, id, reach);
  if (current.paymentStatus === "Paid") throw fail(409, "This month is paid and cannot be removed. Set it back to Pending first.");
  if (current.frozen) throw fail(409, "This row is on hold and cannot be removed. Switch off Hold first.");
  // The final settlement is what pays the months held through the notice: without it they could never be paid.
  const hold = (await noticeHold.holdsFor([current.employeeId], client)).get(current.employeeId);
  const settingsOf = await versions.settingsBook(client);
  if (noticeHold.holdState(current, hold, settingsOf) === "settlement" && (await noticeHold.releasedBy(current, hold, settingsOf, { client })).length) {
    throw fail(409, "This is the employee's full and final settlement, which pays the months held during their notice, so it cannot be removed.");
  }
  const { count } = await client.payrollEntry.updateMany({
    where: { id, removedAt: null, paymentStatus: { not: "Paid" }, frozen: false },
    data: { removedAt: new Date(), removedByUserId: userId || null, removedReason: String(reason || "").trim().slice(0, 500) || null },
  });
  if (!count) throw fail(409, CHANGED_UNDERNEATH);
}

/** Brings a removed row back onto its month; the month's next update reads it again. */
async function restoreEntry(id, reach = null, { client = prisma, userId = null } = {}) {
  const row = await client.payrollEntry.findFirst({ where: { id, removedAt: { not: null }, ...rowInReach(reach) }, select: { id: true } });
  if (!row) throw fail(404, "This removed row could not be found.");
  await client.payrollEntry.updateMany({ where: { id, removedAt: { not: null } }, data: { removedAt: null, removedByUserId: null, removedReason: null, updatedByUserId: userId || null } });
}

/** The payment modes and paying accounts the payment fields offer. */
async function paymentOptions(client = prisma) {
  const [modes, accounts, branches] = await Promise.all([
    client.paymentMode.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    receivedIntoOptions(client),
    // Cost Centre's choices: every active branch of the organisation, whatever the caller's own reach.
    client.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return { paymentModes: modes, accounts, branches, paymentStatuses: PAYMENT_STATUSES };
}

module.exports = {
  savePayslipGeneration,
  saveNoticeHold,
  PAYMENT_STATUSES,
  LOP_DIVISORS,
  ROUNDING_RULES,
  DEFAULT_RULES,
  reachFor,
  payPeriodFor,
  payableDateFor,
  runningPayrollMonth: versions.runningPayrollMonth,
  registerPeriod,
  monthSchedule,
  dayRateOf,
  roundedSalary,
  rulesOf,
  figuresFor,
  extrasOf,
  toRow,
  readRules,
  rulesForMonth,
  currentPayrollMonth,
  saveRules,
  listEntries,
  cycleGate,
  restoreEntry,
  broughtIn,
  payrollEmployeeSelect,
  defaultSources,
  generateMonth,
  refreshMonth,
  syncMonth,
  updateEntry,
  markPaid,
  removeEntry,
  paymentOptions,
};
