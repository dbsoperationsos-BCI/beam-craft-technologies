const prisma = require("../../../config/db");
const register = require("../payroll-register/service");
const versions = require("../payroll-register/settingsVersions");
const { studioDateKey } = require("../../../services/studioTime");
const { payslipGenerateDate, payslipGenerateDaysAfter } = require("../../../services/payslipHeading");

/**
 * HRM → Payslip: the signed-in employee's own payslips, built from their rows on Payroll → Main Page -
 * the same figures, read the same way (`listEntries`), so a payslip never says anything the register
 * does not. Only months whose pay cycle has ended are offered, as the register shows them.
 *
 * Each month is laid out as Template Settings' payslip is (`payslipPdfService`): the employee's
 * details in the payslip's own words, Earnings beside Deductions, the paid and loss-of-pay days and
 * the net pay as it is paid (rounded under the month's rule).
 */

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthLabel = (year, month) => `${MONTH_NAMES[month - 1]} ${year}`;
/*
 * The month a payslip is named for: the one before its payroll month, which is named for when it is
 * paid - November's payroll (pay cycle 25 Sep - 24 Oct, paid in November) is October's payslip. The
 * payslip and HRM → Payslip say this; Payroll → Main Page, and every request, keep the payroll month.
 */
const payslipMonthOf = (year, month) => (month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 });
const payslipLabel = (year, month) => { const named = payslipMonthOf(year, month); return monthLabel(named.year, named.month); };
const payslipFileName = (year, month) => { const named = payslipMonthOf(year, month); return `payslip-${named.year}-${String(named.month).padStart(2, "0")}.pdf`; };
const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const day = (value) => (value ? dayFormat.format(new Date(value)) : "");
const text = (value) => String(value ?? "").trim() || "-";

const EMPLOYEE_SELECT = {
  id: true, employeeId: true, employeeName: true, department: true, designation: true, workBaseLocation: true,
  dateOfBirth: true, dateOfJoining: true, panCardNumber: true, accountNumber: true, residentialStatus: true,
  // Personal Details as HR typed them in Edit Employee → Payslip Details - what the payslip prints.
  payslipPersonalDetails: true,
  pfNumber: true, uanNumber: true, epsNumber: true, esiNumber: true,
  // The details added in Settings → Payroll rules → Edit Payslip, still offered.
  payslipValues: { where: { field: { archivedAt: null } }, select: { value: true, field: { select: { label: true, section: true, inputType: true, sortOrder: true, id: true } } } },
};

/** The employee record behind this login, or null where the login has none. */
async function employeeOf(userId, { client = prisma } = {}) {
  const user = await client.user.findUnique({ where: { id: Number(userId) || 0 }, select: { linkedEmployeeId: true } });
  if (!user?.linkedEmployeeId) return null;
  return client.employee.findFirst({ where: { id: user.linkedEmployeeId, archivedAt: null }, select: EMPLOYEE_SELECT });
}

/**
 * The months with a payroll row for this employee whose payslip has been generated, newest first: its
 * pay cycle has ended, and the day Template Settings sets (if any) - so many days after the month's
 * payable date - has come, in India.
 */
async function payslipMonths(employeeId, { client = prisma, now = new Date() } = {}) {
  const [rows, settingsBook, daysAfter, start] = await Promise.all([
    client.payrollEntry.findMany({
      where: { employeeId, removedAt: null },
      select: { year: true, month: true, periodFrom: true, periodTo: true, paymentStatus: true },
      orderBy: [{ year: "desc" }, { month: "desc" }],
    }),
    versions.settingsBook(client),
    payslipGenerateDaysAfter({ client }),
    require("../payroll-register/payrollStart").payrollStart({ client }),
  ]);
  const today = studioDateKey(now);
  const { beforeStart } = require("../payroll-register/payrollStart");
  return rows
    // No payslip for a month before payroll starts.
    .filter((row) => !beforeStart(row.year, row.month, start))
    .filter((row) => register.cycleGate(row.year, row.month, settingsBook, now).open)
    .map((row) => ({ row, generatedOn: generatedOnFor(row.year, row.month, settingsBook, daysAfter, now) }))
    .filter(({ generatedOn }) => generatedOn <= today)
    .map(({ row, generatedOn }) => ({
      year: row.year,
      month: row.month,
      label: payslipLabel(row.year, row.month),
      fileName: payslipFileName(row.year, row.month),
      generatedOn,
      periodFrom: row.periodFrom ? row.periodFrom.toISOString().slice(0, 10) : null,
      periodTo: row.periodTo ? row.periodTo.toISOString().slice(0, 10) : null,
      paymentStatus: row.paymentStatus,
    }));
}

/**
 * The day a month's payslip is generated: so many days after the month's payable (payback due) date,
 * as Template Settings sets - never before its pay cycle has ended - or, with none set, the day after
 * the cycle ends.
 */
function generatedOnFor(year, month, settingsBook, daysAfter, now = new Date()) {
  const { opensOn } = register.cycleGate(year, month, settingsBook, now);
  const payableOn = register.payableDateFor(year, month, settingsBook(year, month).paybackDay);
  const set = payslipGenerateDate(payableOn, daysAfter);
  return set && set > opensOn ? set : opensOn;
}

/**
 * The payroll month being paid now (its payable day not yet passed), with the day its payslip is
 * generated - for the list to say when the next one comes. Null once that payslip is out.
 */
async function upcomingPayslip({ client = prisma, now = new Date() } = {}) {
  const [{ year, month }, settingsBook, daysAfter] = await Promise.all([
    versions.openPayrollMonth(client, now),
    versions.settingsBook(client),
    payslipGenerateDaysAfter({ client }),
  ]);
  const generatesOn = generatedOnFor(year, month, settingsBook, daysAfter, now);
  if (generatesOn <= studioDateKey(now)) return null;
  const { cycle } = register.cycleGate(year, month, settingsBook, now);
  return { year, month, label: payslipLabel(year, month), periodFrom: cycle.from, periodTo: cycle.to, generatesOn };
}

/**
 * The months this employee has a payslip for, each with what it pays - the same reading the PDF
 * prints from - for the list to show before anything is downloaded.
 */
async function payslipSummaries(employee, { client = prisma, now = new Date() } = {}) {
  const months = await payslipMonths(employee.id, { client, now });
  return Promise.all(months.map(async (entry) => {
    const payslip = await payslipOf(employee, entry.year, entry.month, { client, now });
    return { ...entry, paidDays: payslip?.paidDays ?? null, lopDays: payslip?.lopDays ?? null, netPay: payslip?.netPay ?? null };
  }));
}

/** The days a month's pay is counted over under its rule - the same divisor the day's rate uses. */
const countedDays = (row) => (row.rules?.lopDivisor === "CALENDAR_DAYS" ? Number(row.periodDays) || 0
  : row.rules?.lopDivisor === "FIXED_30" ? 30 : Number(row.workingDays) || 0);

/**
 * One payroll row, and the employee it is for, laid out as the payslip prints it. `fields` - the
 * details added in Edit Payslip and still offered - prints each one, "-" where this employee has no
 * answer yet; without it, only the answered ones print.
 */
function payslipFor(row, employee, components = [], fields = null) {
  const named = new Map(components.map((column) => [String(column.id), column]));
  const extras = (kind) => Object.entries(row.componentAmounts || {})
    .filter(([id, amount]) => named.get(id)?.kind === kind && Number(amount))
    .map(([id, amount]) => [named.get(id).name, Number(amount)]);
  // A line at 0 says nothing, so it is left off - Salary alone always shows.
  const shown = (lines) => lines.filter(([name, amount], index) => (index === 0 && name === "Salary") || Number(amount));
  const lopDays = Number(row.totalLeaves) || 0;
  // Personal Details print as HR typed them on Payslip Details, never read off the rest of the record.
  const typed = employee.payslipPersonalDetails && typeof employee.payslipPersonalDetails === "object" ? employee.payslipPersonalDetails : {};
  return {
    month: payslipLabel(row.year, row.month),
    employee: [
      ["Emp Code", text(typed.empCode)], ["Emp Name", text(typed.empName)], ["PF No.", text(employee.pfNumber)],
      ["Department", text(typed.department)], ["Cost Centre", text(row.costCentre)], ["ESI No.", text(employee.esiNumber)],
      ["Location", text(typed.location)], ["Designation", text(typed.designation)], ["PAN", text(typed.pan)],
      ["Date Of Birth", text(day(typed.dateOfBirth))], ["Bank A/c No.", text(typed.bankAccount)], ["EPS No.", text(employee.epsNumber)],
      ["Date of Joining", text(day(typed.dateOfJoining))], ["Residential Status", text(employee.residentialStatus)], ["UAN", text(employee.uanNumber)],
      // Added details, after the built-in ones - a PF one marked so personal-only payslips leave it off.
      ...addedDetails(employee, fields)
        .map(({ field, value }) => [field.label, text(field.inputType === "DATE" ? day(value) : value), ...(field.section === "PF" ? ["PF"] : [])]),
    ],
    earnings: shown([
      ["Salary", Number(row.baseSalary) || 0],
      ["Incentive", Number(row.incentive) || 0],
      // The referral instalments the month paid this employee for a hire they introduced; zero on a
      // month that carried none, and `shown` leaves a zero line off the payslip as it does the rest.
      ["Referral Bonus", Number(row.referralBonus) || 0],
      ...extras("EARNING"),
      // The full and final settlement pays the months held during the notice: one line each.
      ...(row.noticeHold?.state === "settlement" ? (row.noticeHold.released || []).map((held) => [`Held salary - ${held.label}`, Number(held.amount) || 0]) : []),
    ]),
    deductions: shown([
      ["LOP Deduction", Number(row.lopDeduction) || 0],
      ["Salary Advance", Number(row.salaryAdvance) || 0],
      ["Recovery", Number(row.recoveryDeduction) || 0],
      ["Policy Breach", Number(row.policyBreachDeduction) || 0],
      ["Other Deductions", Number(row.otherDeductions) || 0],
      ...extras("DEDUCTION"),
    ]),
    // What is paid: the net salary rounded under the month's rule, as Payroll → Main Page pays it.
    netPay: Number(row.noticeHold?.state === "settlement" ? row.noticeHold.finalSettlement : row.roundedSalary) || 0,
    paidDays: Math.max(0, Math.round((countedDays(row) - lopDays) * 100) / 100),
    lopDays,
    // A month not paid yet can still change on Payroll → Main Page, so its payslip says so.
    note: row.noticeHold?.state === "held"
      ? `Held during the notice period - paid with the ${row.noticeHold.settlesIn?.label ? `${row.noticeHold.settlesIn.label} ` : ""}final settlement. This is a computer-generated payslip.`
      : row.noticeHold?.state === "settled"
        ? `Held during the notice period and paid in the ${row.noticeHold.settlesIn?.label ? `${row.noticeHold.settlesIn.label} ` : ""}final settlement. This is a computer-generated payslip and does not need a signature.`
        : row.paymentStatus === "Paid"
      ? "This is a computer-generated payslip and does not need a signature."
      : "Provisional - this month is not paid yet, and its figures may still change. This is a computer-generated payslip.",
  };
}

/** Every added detail with this employee's answer (null where none), in Edit Payslip's order. */
function addedDetails(employee, fields) {
  const answers = employee.payslipValues || [];
  const list = fields
    ? fields.map((field) => ({ field, value: answers.find((answer) => answer.field.id === field.id)?.value ?? null }))
    : [...answers];
  return list.sort((a, b) => (a.field.sortOrder - b.field.sortOrder) || (a.field.id - b.field.id));
}

/** This employee's payslip for one month, or null where there is none to give. */
async function payslipOf(employee, year, month, { client = prisma, now = new Date() } = {}) {
  const open = (await payslipMonths(employee.id, { client, now })).some((entry) => entry.year === year && entry.month === month);
  if (!open) return null;
  const read = await register.listEntries({ year, month }, null, { client, now, employeeId: employee.id });
  const row = read.rows.find((entry) => entry.employeeId === employee.id);
  if (!row) return null;
  // Every detail added in Edit Payslip and still offered - one not yet answered prints "-", as the preview shows it.
  const fields = await client.payslipField.findMany({ where: { archivedAt: null }, select: { id: true, label: true, section: true, inputType: true, sortOrder: true } });
  return payslipFor(row, employee, read.components, fields);
}

module.exports = { employeeOf, payslipMonths, payslipSummaries, upcomingPayslip, generatedOnFor, payslipFor, payslipOf, monthLabel, payslipLabel, payslipFileName };
